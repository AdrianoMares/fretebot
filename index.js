import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { readToken, writeToken } from './tokenCache.js';
import { createRateLimiter } from './rateLimiter.js';
import { fetchCEP } from './opencep.js';

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

function extractToken(data) {
  if (!data) return null;
  return data.token || data.access_token || data.jwt || data?.data?.token || null;
}

async function login(force = false) {
  console.log('🔐 Fazendo login via HTTP...');
  if (!force) {
    const cached = await readToken(TOKEN_CACHE);
    if (cached?.token) {
      console.log('✅ Token carregado do cache');
      return cached.token;
    }
  }
  const url = `${BACK_BASE}/auth/login`;
  const { data } = await limiter.schedule(() =>
    axios.post(url, { email: PJ_EMAIL, senha: PJ_SENHA }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
  );
  const token = extractToken(data);
  if (!token) throw new Error('Token não retornado no login');
  let exp = null;
  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
    exp = payload?.exp;
  } catch {}
  await writeToken(TOKEN_CACHE, { token, exp, at: Date.now() });
  console.log('🔑 Token salvo em cache');
  return token;
}

function normalizeServicos(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return input.split(',').map(s => s.trim()).filter(Boolean);
  return ['03220', '03298', '04227', '.package', 'economico'];
}

function toGramas(peso) {
  const n = Number(peso);
  if (n <= 10) return Math.round(n * 1000);
  return Math.round(n);
}

function buildPayload(base, rem, des, servicos, usuario) {
  return {
    usuario,
    cepOrigem: base.origem,
    cepDestino: base.destino,
    altura: base.altura || 2,
    largura: base.largura || 12,
    comprimento: base.comprimento || 16,
    peso: toGramas(base.peso),
    valorDeclarado: Number(base.valorDeclarado || 0).toFixed(2),
    codigoServico: '',
    prazo: 0,
    prazoFinal: 0,
    valor: 0,
    quantidade: 1,
    logisticaReversa: false,
    remetente: rem,
    destinatario: des,
    tipoEmbalagem: 1,
    tipo: 2,
    servicos
  };
}

function normalizeResponse(data) {
  const arr = Array.isArray(data) ? data : data?.resultados || data?.cotacoes || data?.data || [];
  if (!Array.isArray(arr)) return [{ raw: data }];
  return arr.map(x => ({
    servico: x.servico || x.codigoServico || x.nome || 'desconhecido',
    valor: Number(x.valor || x.preco || x.price || 0),
    prazo: x.prazo || x.prazoEntrega || x.leadTime || null
  }));
}

app.post('/cotacao', async (req, res) => {
  const started = Date.now();
  console.log('🚚 Iniciando cotação...');
  try {
    const { origem, destino } = req.body;
    if (!origem || !destino) return res.status(400).json({ error: 'Campos origem e destino são obrigatórios' });
    const token = await login();
    const [rem, des] = await Promise.all([fetchCEP(origem), fetchCEP(destino)]);
    const servicos = normalizeServicos(req.body.servicos);
    const payload = buildPayload(req.body, rem, des, servicos, PJ_EMAIL);
    console.log('📦 Enviando requisição POST para /preco-prazo...');
    const { data } = await limiter.schedule(() =>
      axios.post(`${BACK_BASE}/preco-prazo`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      })
    );
    const resultados = normalizeResponse(data);
    const took = Date.now() - started;
    console.log(`✅ Cotação concluída em ${took}ms`);
    res.json({ ok: true, fonte: BACK_BASE, tookMs: took, timestamp: new Date().toISOString(), resultados });
  } catch (err) {
    console.error('❌ Erro na cotação:', err.message);
    res.status(500).json({ ok: false, error: err.message, data: err.response?.data });
  }
});

app.get('/', (_, res) => res.send('fretebot v4.5 online'));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
