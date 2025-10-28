import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { readValidToken, saveToken } from './utils/tokenCache.js';
import { throttle } from './utils/rateLimit.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BACK_BASE = process.env.BACK_BASE || 'https://back.clubepostaja.com.br';
const USUARIO = process.env.POSTAJA_USUARIO;
const SENHA = process.env.POSTAJA_SENHA;

let config = { taxas: {} };
try {
  config = JSON.parse(fs.readFileSync(path.resolve('config.json'), 'utf-8'));
} catch {}

const SERVICE_MAP = {
  '03220': { nome: 'Sedex', transportadora: 'Correios', taxa: 'SEDEX' },
  '03298': { nome: 'PAC', transportadora: 'Correios', taxa: 'PAC' },
  '04227': { nome: 'Mini Envios', transportadora: 'Correios', taxa: 'Mini Envios' },
  '.package': { nome: '.package', transportadora: 'Jadlog', taxa: 'Jadlog' }
};
const SERVICES = ['03220', '03298', '04227', '.package'];

function normalizeValorDeclarado(v) {
  let n = Number(v);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n === 0) n = 10;
  return n.toFixed(2);
}

function applyTaxa(servico, valorStr) {
  const meta = SERVICE_MAP[servico];
  if (!meta) return valorStr;
  const taxa = Number(config?.taxas?.[meta.taxa]) || 0;
  const preco = Number(String(valorStr).replace('.', '').replace(',', '.'));
  if (!Number.isFinite(preco) || preco <= 0) return valorStr;
  const final = preco + preco * (taxa / 100);
  return final.toFixed(2).replace('.', ',');
}

async function httpLogin() {
  const cached = readValidToken();
  if (cached) {
    console.log('🔐 Token válido reutilizado');
    return cached;
  }
  console.log('🔐 Gerando novo token...');
  const { data } = await axios.post(`${BACK_BASE}/auth/login`, {
    usuario: USUARIO,
    senha: SENHA
  });
  saveToken(data.token, 43200);
  console.log('✅ Novo token salvo em cache');
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

function massageResultado(raw) {
  const out = [];
  for (const it of raw || []) {
    const s = it?.coProduto || it?.servico;
    if (!SERVICE_MAP[s]) continue;
    let valor = it?.pcFinal ?? it?.valor ?? '0,00';
    if (typeof valor === 'number') valor = valor.toFixed(2).replace('.', ',');
    let prazo = Number(it?.prazoEntrega ?? it?.prazo ?? 0);
    let txErro = false;
    if (!valor || valor === '0,00' || valor === '0') {
      valor = s === '04227'
        ? 'Peso/Valor excede o limite de aceitacao do servico no ambito nacional.'
        : 'Área de CEP de destino não atendida.';
      txErro = true;
    } else {
      valor = applyTaxa(s, valor);
    }
    out.push({
      transportadora: SERVICE_MAP[s].transportadora,
      servico: SERVICE_MAP[s].nome,
      valor,
      prazo,
      txErro
    });
  }
  for (const s of SERVICES) {
    if (!out.find(o => o.servico === SERVICE_MAP[s].nome)) {
      out.push({
        transportadora: SERVICE_MAP[s].transportadora,
        servico: SERVICE_MAP[s].nome,
        valor: s === '04227'
          ? 'Peso/Valor excede o limite de aceitacao do servico no ambito nacional.'
          : 'Área de CEP de destino não atendida.',
        prazo: 0,
        txErro: true
      });
    }
  }
  return out;
}

app.post('/cotacao', async (req, res) => {
  const start = Date.now();
  try {
    await throttle();
    console.log('🚚 Iniciando cotação...');
    const token = await httpLogin();
    const url = buildURL(req.body || {});
    const { data, status } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    const tempo = Date.now() - start;
    console.log(`✅ Cotação concluída | HTTP ${status} | Tempo: ${tempo}ms`);
    return res.json({ ok: true, tempoRespostaMs: tempo, statusHTTP: status, resultados: massageResultado(data) });
  } catch (err) {
    const tempo = Date.now() - start;
    console.error('❌ Erro:', err.message);
    return res.status(500).json({ ok: false, error: err.message, tempoRespostaMs: tempo });
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
