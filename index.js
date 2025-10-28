import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { readToken, writeToken } from './utils/tokenCache.js';
import { createRateLimiter } from './utils/rateLimiter.js';
import { fetchCEP } from './utils/opencep.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 10000);
const BACK_BASE = (process.env.BACK_BASE || 'https://back.clubepostaja.com.br').replace(/\/$/, '');
const PJ_EMAIL = process.env.PJ_EMAIL || '';
const PJ_SENHA = process.env.PJ_SENHA || '';
const TOKEN_CACHE = process.env.TOKEN_CACHE || path.join(__dirname, 'token-cache.json');
const RATE_MIN_INTERVAL_MS = Number(process.env.RATE_MIN_INTERVAL_MS || 1000);

const limiter = createRateLimiter(RATE_MIN_INTERVAL_MS);
const app = express();
app.use(express.json({ limit: '256kb' }));

function log(...args) {
  console.log(...args);
}

function extractToken(loginResponseData) {
  if (!loginResponseData || typeof loginResponseData !== 'object') return null;
  // Try common fields
  return (
    loginResponseData.token ||
    loginResponseData.access_token ||
    loginResponseData.jwt ||
    (loginResponseData.data && (loginResponseData.data.token || loginResponseData.data.access_token || loginResponseData.data.jwt)) ||
    null
  );
}

async function loginAndGetToken(force = false) {
  if (!force) {
    const cached = await readToken(TOKEN_CACHE);
    if (cached && cached.token) return cached.token;
  }
  if (!PJ_EMAIL || !PJ_SENHA) throw new Error('Credenciais ausentes (PJ_EMAIL/PJ_SENHA).');

  const url = `${BACK_BASE}/auth/login`;
  log('🔐 Efetuando login via HTTP...', url);

  const { data } = await limiter.schedule(() =>
    axios.post(url, { email: PJ_EMAIL, senha: PJ_SENHA }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    })
  );

  const token = extractToken(data);
  if (!token) {
    throw new Error('Login OK, mas token não encontrado na resposta.');
  }

  // Optionally fetch /usuarios/me to extract exp from JWT or validate
  let exp = null;
  try {
    const [, payloadB64] = token.split('.');
    if (payloadB64) {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
      exp = payload && payload.exp ? payload.exp : null;
    }
  } catch {}

  await writeToken(TOKEN_CACHE, { token, exp, at: Date.now() });
  return token;
}

function normalizeServicos(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(Boolean).map(String);
    } catch {}
    // split by comma
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // default set
  return ['03220', '03298', '04227', '.package', 'economico'];
}

function toCentavos(possiblyKgOrGramas) {
  // PostaJá parece receber "peso" em gramas no endpoint inspeccionado (ex.: 100)
  // Nosso input vem em kg (ex.: 0.1). Convertemos: kg -> gramas (kg * 1000), arredondando.
  const n = Number(possiblyKgOrGramas);
  if (Number.isNaN(n)) return 0;
  if (n <= 10) return Math.round(n * 1000);
  // se já vier grande (ex.: 100 para 100g), retornamos como está
  return Math.round(n);
}

function buildPrecoPrazoPayload(base, remetente, destinatario, servicos) {
  // Campos padrão conforme o HAR observado
  const payload = {
    cepOrigem: base.origem,
    cepDestino: base.destino,
    altura: Math.max(2, Math.round(base.altura || 0)),
    largura: Math.max(12, Math.round(base.largura || 0)),
    comprimento: Math.max(16, Math.round(base.comprimento || 0)),
    peso: toCentavos(base.peso), // gramas
    valorDeclarado: Number(base.valorDeclarado || 0).toFixed(2),
    codigoServico: "",
    prazo: 0,
    prazoFinal: 0,
    valor: 0,
    quantidade: 1,
    logisticaReversa: false,
    remetente: {
      logradouro: remetente.logradouro || '',
      cep: remetente.cep || base.origem,
      cidade: remetente.cidade || '',
      bairro: remetente.bairro || '',
      uf: remetente.uf || '',
      complemento: remetente.complemento || ''
    },
    destinatario: {
      logradouro: destinatario.logradouro || '',
      cep: destinatario.cep || base.destino,
      cidade: destinatario.cidade || '',
      bairro: destinatario.bairro || '',
      uf: destinatario.uf || '',
      complemento: destinatario.complemento || ''
    },
    tipoEmbalagem: 1,
    tipo: 2,
    servicos // array obrigatória
  };
  return payload;
}

function normalizeCotacaoResponse(data) {
  // Tentamos ser resilientes a formatos diferentes
  // Caso venha algo tipo { resultados:[{codigoServico, valor, prazo, nome}], ... }
  const out = [];

  const candidates = Array.isArray(data) ? data
                    : Array.isArray(data?.resultados) ? data.resultados
                    : Array.isArray(data?.cotacoes) ? data.cotacoes
                    : Array.isArray(data?.data) ? data.data
                    : (typeof data === 'object' ? Object.values(data).find(Array.isArray) : null);

  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      const servico = item?.servico || item?.codigoServico || item?.codigo || item?.nome || 'desconhecido';
      const valor = Number(
        item?.valor ?? item?.preco ?? item?.precoFinal ?? item?.preco_total ?? item?.price ?? 0
      );
      // prazo pode vir como string "4-6 dias úteis" ou como número
      const prazo = item?.prazo ?? item?.prazoEntrega ?? item?.leadTime ?? item?.sla ?? item?.tempo ?? null;
      out.push({ servico, valor, prazo });
    }
  }

  // Fallback: se não achou, retorna o body bruto
  return out.length ? out : [{ raw: data }];
}

async function ensureToken() {
  let token = await loginAndGetToken(false);
  return token;
}

app.post('/cotacao', async (req, res) => {
  const started = Date.now();
  try {
    log('🚚 Iniciando cotação...');

    const body = req.body || {};
    const origem = String(body.origem || '').trim();
    const destino = String(body.destino || '').trim();
    if (!origem || !destino) {
      return res.status(400).json({ error: 'origem e destino são obrigatórios' });
    }

    // 1) garante token
    const token = await ensureToken();

    // 2) enriquece CEPs
    const [rem, des] = await Promise.all([fetchCEP(origem), fetchCEP(destino)]);

    // 3) normaliza serviços (default se não vier)
    const servicos = normalizeServicos(body.servicos);

    // 4) monta payload
    const payload = buildPrecoPrazoPayload(body, rem, des, servicos);

    // 5) envia requisição ao PostaJá
    const url = `${BACK_BASE}/preco-prazo`;
    log('📨 Enviando para', url);

    const { data } = await limiter.schedule(() =>
      axios.get(url, {
        // Endpoint do HAR era GET com querystring — manter compatibilidade
        params: payload,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        timeout: 30000
      })
    );

    const resultados = normalizeCotacaoResponse(data);
    const took = Date.now() - started;
    return res.json({ ok: true, tookMs: took, resultados, fonte: 'PostaJá /preco-prazo' });

  } catch (err) {
    // Se login 401, força renovar token
    const status = err?.response?.status;
    const data = err?.response?.data;
    if (status === 401) {
      try {
        await fs.unlink(TOKEN_CACHE);
      } catch {}
    }
    log('❌ Erro na cotação:', err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      status,
      data
    });
  }
});

app.get('/', (_, res) => {
  res.type('text/plain').send('fretebot v4.2 online');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Available at your primary URL`);
});
