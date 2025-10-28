import express from 'express';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN_FILE = './token.json';
let lastRequestTime = 0;

// Delay de 1 requisição por segundo
const rateLimit = async () => {
  const now = Date.now();
  const diff = now - lastRequestTime;
  if (diff < 1000) await new Promise(res => setTimeout(res, 1000 - diff));
  lastRequestTime = Date.now();
};

// Lê token salvo
const getTokenLocal = () => {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (Date.now() - data.timestamp > 6 * 60 * 60 * 1000) return null; // expira em 6h
  return data.token;
};

// Login e salvamento de token
const login = async () => {
  console.log('🔐 Fazendo login...');
  const res = await axios.post('https://back.clubepostaja.com.br/auth/login', {
    email: process.env.POSTAJA_EMAIL,
    senha: process.env.POSTAJA_SENHA
  });
  const token = res.data.token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, timestamp: Date.now() }, null, 2));
  return token;
};

// Garante token válido
const getValidToken = async () => {
  let token = getTokenLocal();
  if (!token) token = await login();
  return token;
};

// Consulta de frete
const cotarFrete = async (params) => {
  await rateLimit();
  const token = await getValidToken();
  const res = await axios.get('https://back.clubepostaja.com.br/preco-prazo', {
    params,
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
};

// Endpoint principal
app.post('/cotacao', async (req, res) => {
  try {
    console.log('🚚 Iniciando cotação...');
    const result = await cotarFrete(req.body);
    const json = result.map(item => ({
      servico: item.servico || item.nome || 'Desconhecido',
      valor: item.valor || item.preco || 0,
      prazo: item.prazo || 'N/D'
    }));
    res.json({ sucesso: true, fretes: json });
  } catch (err) {
    console.error('❌ Erro na cotação:', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
