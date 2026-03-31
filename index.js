import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import helmet from 'helmet';
import cors from 'cors';
import Redis from 'ioredis';

import { readValidToken, saveToken } from './tokenCache.js';
import { throttle } from './rateLimit.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BACK_BASE = process.env.BACK_BASE || 'https://back.clubepostaja.com.br';
const USUARIO = process.env.POSTAJA_USUARIO;
const SENHA = process.env.POSTAJA_SENHA;
const API_KEY = process.env.API_KEY || '';
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'cotacao:';
const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || '300', 10);
const RATE_MIN_INTERVAL_MS = parseInt(process.env.RATE_MIN_INTERVAL_MS || '250', 10);

let redis = null;
if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await redis.connect();
    console.log('✅ Redis conectado');
  } catch (e) {
    console.warn('⚠️ Falha ao conectar no Redis, prosseguindo sem cache:', e.message);
    redis = null;
  }
}

['tokenCache.js', 'rateLimit.js', 'config.json'].forEach(file => {
  if (!fs.existsSync(file)) {
    console.error(`❌ Arquivo essencial ausente: ${file}`);
    process.exit(1);
  }
});

let config = { taxas: {}, seguro: { percentual: 0 } };
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  console.log('✅ config.json carregado.');
} catch {
  console.warn('⚠️ config.json inválido ou ausente, usando padrão.');
}

const SERVICE_MAP = {
  '03220': { nome: 'Sedex', transportadora: 'Correios', taxa: 'SEDEX' },
  '03298': { nome: 'PAC', transportadora: 'Correios', taxa: 'PAC' },
  '04227': { nome: 'Mini Envios', transportadora: 'Correios', taxa: 'Mini Envios' },
  '.package': { nome: '.package', transportadora: 'Jadlog', taxa: 'Jadlog' }
};
const SERVICES = ['03220', '03298', '04227', '.package'];
const MINI_ENVIOS_CODE = '04227';
const MINI_ENVIOS_MAX_DECLARED_VALUE = 100;

function normalizeValorDeclarado(v) {
  let n = Number(v);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n === 0) n = 10;
  return n.toFixed(2);
}

function parseMoneyToNumber(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const num = Number(String(valor ?? '0').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

function formatNumberToMoneyBr(valor) {
  const num = Number(valor);
  if (!Number.isFinite(num) || num <= 0) return '0,00';
  return num.toFixed(2).replace('.', ',');
}

function getSeguroPercentual() {
  const percentual = Number(config?.seguro?.percentual) || 0;
  return percentual > 0 ? percentual : 0;
}

function calcularValorSeguro(valorDeclarado) {
  const declarado = Number(valorDeclarado) || 0;
  const percentual = getSeguroPercentual();
  if (!Number.isFinite(declarado) || declarado <= 0 || percentual <= 0) return 0;
  return declarado * (percentual / 100);
}

function applyTaxa(servico, valorStr) {
  const meta = SERVICE_MAP[servico];
  if (!meta) return valorStr;
  const taxa = Number(config?.taxas?.[meta.taxa]) || 0;
  const preco = parseMoneyToNumber(valorStr);
  if (!Number.isFinite(preco) || preco <= 0) return valorStr;
  const final = preco + preco * (taxa / 100);
  return formatNumberToMoneyBr(final);
}

function isMiniEnviosBlocked(valorDeclarado) {
  return parseMoneyToNumber(valorDeclarado) > MINI_ENVIOS_MAX_DECLARED_VALUE;
}

async function httpLogin() {
  const cached = readValidToken();
  if (cached) return cached;
  const { data } = await axios.post(`${BACK_BASE}/auth/login`, {
    usuario: USUARIO,
    senha: SENHA
  });
  saveToken(data.token, 43200);
  return data.token;
}

function buildURL(p) {
  const usp = new URLSearchParams();
  usp.set('cepOrigem', p.origem);
  usp.set('cepDestino', p.destino);
  usp.set('altura', p.altura);
  usp.set('largura', p.largura);
  usp.set('comprimento', p.comprimento);
  usp.set('peso', String(Math.round(Number(p.peso) * 1000)));
  usp.set('valorDeclarado', normalizeValorDeclarado(p.valorDeclarado));
  usp.set('codigoServico', '');
  usp.set('prazo', '0');
  usp.set('prazoFinal', '0');
  usp.set('valor', '0');
  usp.set('quantidade', '1');
  usp.set('logisticaReversa', 'false');
  usp.set('tipoEmbalagem', '1');
  usp.set('tipo', '2');
  SERVICES.forEach(s => usp.append('servicos[]', s));
  return `${BACK_BASE}/preco-prazo?${usp}`;
}

function massageResultado(raw, valorDeclarado) {
  const out = [];
  const valorSeguro = calcularValorSeguro(valorDeclarado);
  const miniEnviosBlocked = isMiniEnviosBlocked(valorDeclarado);

  for (const it of raw || []) {
    const s = it?.coProduto || it?.servico;
    if (!SERVICE_MAP[s]) continue;

    let valorBase = it?.pcFinal ?? it?.valor ?? '0,00';
    if (typeof valorBase === 'number') {
      valorBase = formatNumberToMoneyBr(valorBase);
    }

    let prazo = Number(it?.prazoEntrega ?? it?.prazo ?? 0);
    let txErro = false;
    let valor = valorBase;
    let valorFrete = valorBase;

    if (s === MINI_ENVIOS_CODE && miniEnviosBlocked) {
      valor = 'Valor declarado excede o limite do Mini Envios.';
      valorFrete = valor;
      txErro = true;
    } else if (!valorBase || valorBase === '0,00' || valorBase === '0') {
      valor = s === MINI_ENVIOS_CODE
        ? 'Peso/Valor excede o limite de aceitacao do servico no ambito nacional.'
        : 'Área de CEP de destino não atendida.';
      valorFrete = valor;
      txErro = true;
    } else {
      const freteComMarkupStr = applyTaxa(s, valorBase);
      const freteComMarkup = parseMoneyToNumber(freteComMarkupStr);
      const valorFinal = freteComMarkup + valorSeguro;

      valorFrete = freteComMarkupStr;
      valor = formatNumberToMoneyBr(valorFinal);
    }

    out.push({
      transportadora: SERVICE_MAP[s].transportadora,
      servico: SERVICE_MAP[s].nome,
      valor,
      prazo,
      txErro,
      valorFrete,
      valorSeguro: txErro ? '0,00' : formatNumberToMoneyBr(valorSeguro),
      valorDeclarado: normalizeValorDeclarado(valorDeclarado)
    });
  }

  for (const s of SERVICES) {
    if (!out.find(o => o.servico === SERVICE_MAP[s].nome)) {
      const miniEnviosErrorMessage = miniEnviosBlocked
        ? 'Valor declarado excede o limite do Mini Envios.'
        : 'Peso/Valor excede o limite de aceitacao do servico no ambito nacional.';

      out.push({
        transportadora: SERVICE_MAP[s].transportadora,
        servico: SERVICE_MAP[s].nome,
        valor: s === MINI_ENVIOS_CODE
          ? miniEnviosErrorMessage
          : 'Área de CEP de destino não atendida.',
        prazo: 0,
        txErro: true,
        valorFrete: s === MINI_ENVIOS_CODE
          ? miniEnviosErrorMessage
          : 'Área de CEP de destino não atendida.',
        valorSeguro: '0,00',
        valorDeclarado: normalizeValorDeclarado(valorDeclarado)
      });
    }
  }
  return out;
}

function hashParams(body) {
  const sorted = Object.keys(body || {}).sort().reduce((acc, k)=>{acc[k]=body[k];return acc;},{});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

async function getCotacao(body) {
  await throttle(RATE_MIN_INTERVAL_MS);
  const token = await httpLogin();
  const url = buildURL(body || {});
  const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
  return massageResultado(data, body?.valorDeclarado);
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || '';
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Não autorizado. Use sua API Key.' });
  }
  return next();
}

async function rlPublic(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const key = `rl:pub:${ip}`;
  try {
    if (redis) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      if (count > 3) {
        return res.status(429).json({
          ok: false,
          error: 'Limite público atingido (3/min). Autentique-se para continuar.'
        });
      }
    } else {
      if (!global.__PUB_RL) global.__PUB_RL = new Map();
      const now = Date.now();
      const rec = global.__PUB_RL.get(ip) || { count: 0, ts: now };
      if (now - rec.ts > 60000) { rec.count = 0; rec.ts = now; }
      rec.count += 1;
      global.__PUB_RL.set(ip, rec);
      if (rec.count > 3) {
        return res.status(429).json({
          ok: false,
          error: 'Limite público atingido (3/min). Autentique-se para continuar.'
        });
      }
    }
    next();
  } catch (e) {
    console.warn('rate-limit público falhou:', e.message);
    next();
  }
}

async function handleCotacao(req, res, isPublic=false) {
  const started = Date.now();
  try {
    const body = req.body || {};
    const cacheKey = `${REDIS_PREFIX}${hashParams(body)}`;
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const tempo = Date.now() - started;
        return res.json({
          ok: true,
          cache: true,
          tempoRespostaMs: tempo,
          resultados: JSON.parse(cached)
        });
      }
    }
    const resultados = await getCotacao(body);
    if (redis) await redis.set(cacheKey, JSON.stringify(resultados), 'EX', REDIS_TTL_SECONDS);
    const tempo = Date.now() - started;
    return res.json({ ok: true, cache: false, tempoRespostaMs: tempo, resultados });
  } catch (err) {
    const tempo = Date.now() - started;
    console.error('❌ Erro cotação:', err.message);
    return res.status(500).json({ ok: false, error: err.message, tempoRespostaMs: tempo });
  }
}

app.post('/api/cotacao', requireApiKey, async (req, res) => { await handleCotacao(req, res, false); });
app.post('/api/public/cotacao', rlPublic, async (req, res) => { await handleCotacao(req, res, true); });
app.get('/healthz', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
