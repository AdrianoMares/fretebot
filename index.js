
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import axios from 'axios';
import crypto from 'crypto';
import Redis from 'ioredis';
import { throttle, ipRateLimit } from './rateLimit.js';
import { readValidToken, saveToken } from './tokenCache.js';
import config from './config.json' assert { type: 'json' };

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(helmet());
app.use(compression());
app.use(cors({ origin: ['https://freteaz.com.br','https://www.freteaz.com.br'], methods: ['POST','OPTIONS'] }));
app.use(ipRateLimit({ windowMs: 60_000, max: 120 })); // 120 req/min/IP

const PORT = process.env.PORT || 10000;
const BACK_BASE = process.env.BACK_BASE || 'https://back.clubepostaja.com.br';
const USUARIO = process.env.POSTAJA_USUARIO;
const SENHA = process.env.POSTAJA_SENHA;

// --- Redis (opcional) para cache de resposta ---
const redisUrl = process.env.REDIS_URL;
const redisPrefix = process.env.REDIS_PREFIX || 'fretebot:';
const REDIS_TTL = parseInt(process.env.REDIS_TTL_SECONDS || '300', 10);
let redis = null;
if (redisUrl) {
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (e) => console.error('Redis error:', e.message));
  try { await redis.connect(); } catch {}
}

// --- Util: normaliza e gera chave para cache ---
function cacheKeyFrom(req) {
  const body = JSON.stringify(req.body || {});
  const hash = crypto.createHash('sha1').update(body).digest('hex');
  return `${redisPrefix}quote:${hash}`;
}

// --- Aplica taxa de margem ---
// Suporta config.taxes (multiplicador) OU config.taxas (percentual)
function applyTaxa(serviceName, base) {
  const key = serviceName;
  const mult = config?.taxes?.[key];
  const perc = config?.taxas?.[key];
  let final = base;
  if (typeof mult === 'number') {
    final = base * mult;
  } else if (typeof perc === 'number') {
    final = base * (1 + (perc / 100));
  }
  return Math.round(final * 100) / 100;
}

function mapService(codeOrName) {
  const map = config?.SERVICE_MAP || {};
  return map[codeOrName] || codeOrName;
}

// --- Login + token cache ---
async function httpLogin() {
  // tenta token válido
  const cached = await readValidToken();
  if (cached) return cached;

  // realiza login
  const { data } = await axios.post(`${BACK_BASE}/auth/login`, {
    usuario: USUARIO, senha: SENHA
  }, { timeout: 15000 });
  if (!data?.token || !data?.expires_in) {
    throw new Error('Login sem token válido');
  }
  await saveToken(data.token, data.expires_in);
  return data.token;
}

// --- Middleware de cache de resposta ---
async function responseCache(req, res, next) {
  if (!redis) return next();
  const key = cacheKeyFrom(req);
  try {
    const cached = await redis.get(key);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
  } catch {}
  // intercepta res.json para salvar
  const originalJson = res.json.bind(res);
  res.json = async (payload) => {
    try {
      await redis.setex(key, REDIS_TTL, JSON.stringify(payload));
    } catch {}
    return originalJson(payload);
  };
  next();
}

// --- Validação mínima do corpo ---
function validateBody(body) {
  const required = ['cepOrigem','cepDestino','peso'];
  const missing = required.filter(k => !body?.[k]);
  if (missing.length) {
    const err = new Error('Parâmetros obrigatórios ausentes: ' + missing.join(', '));
    err.status = 400;
    throw err;
  }
}

// --- Handler principal ---
app.post('/cotacao', responseCache, async (req, res) => {
  const start = Date.now();
  try {
    validateBody(req.body);
    await throttle();

    const token = await httpLogin();

    // Monta requisição para o Posta Já (ajuste o caminho se necessário)
    const { cepOrigem, cepDestino, peso, valor, largura, altura, comprimento } = req.body;
    const payload = { cepOrigem, cepDestino, peso, valor, largura, altura, comprimento };

    const { data, status } = await axios.post(`${BACK_BASE}/api/cotacao`, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });

    // Transforma a resposta e aplica margens
    const itens = Array.isArray(data) ? data : (data?.itens || data?.servicos || []);
    const resultados = itens.map((s) => {
      const serviceName = mapService(s?.code || s?.service_code || s?.servico || s?.nome);
      const base = Number(s?.valor || s?.valorFrete || s?.preco || s?.price || 0);
      return {
        servico: serviceName,
        prazo: s?.prazo || s?.prazoEntrega || s?.deadline || null,
        valor: applyTaxa(serviceName, base),
        origem: cepOrigem,
        destino: cepDestino
      };
    }).filter(x => x && !Number.isNaN(x.valor));

    const tempo = Date.now() - start;
    return res.json({
      ok: true,
      tempoRespostaMs: tempo,
      statusHTTP: status,
      resultados
    });

  } catch (err) {
    const tempo = Date.now() - start;
    const code = err.status || err.response?.status || 500;
    const msg = err.message || 'Erro interno';
    console.error('❌ /cotacao', code, msg);
    return res.status(code).json({ ok: false, error: msg, tempoRespostaMs: tempo });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 FreteBot v5.0 rodando na porta ${PORT}`);
});
