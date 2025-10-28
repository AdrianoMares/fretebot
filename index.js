import express from 'express';
import axios from 'axios';
import fs from 'fs';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const LOGIN_URL = 'https://back.clubepostaja.com.br/auth/login';
const FRETE_URL = 'https://back.clubepostaja.com.br/preco-prazo';
const CACHE_FILE = './tokenCache.json';

// Função para obter o token do cache ou fazer login
async function getToken() {
  if (fs.existsSync(CACHE_FILE)) {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (cache.token && Date.now() < cache.expireAt) {
      console.log('✅ Token em cache válido');
      return cache.token;
    }
  }

  console.log('🔐 Gerando novo token...');
  const response = await axios.post(LOGIN_URL, {
    usuario: process.env.POSTAJA_USER,
    senha: process.env.POSTAJA_PASS
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  const token = response.data.token;
  const expireAt = Date.now() + 1000 * 60 * 60 * 4; // 4h
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ token, expireAt }));
  console.log('✅ Novo token salvo em cache');
  return token;
}

// Função principal de cotação
app.post('/cotacao', async (req, res) => {
  console.log('🚚 Iniciando cotação...');
  const { origem, destino, altura, largura, comprimento, peso, valorDeclarado } = req.body;

  if (!origem || !destino) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios ausentes.' });
  }

  try {
    const token = await getToken();
    const url = `${FRETE_URL}?cepOrigem=${origem}&cepDestino=${destino}&altura=${altura}&largura=${largura}&comprimento=${comprimento}&peso=${peso}&valorDeclarado=${valorDeclarado}&codigoServico=&prazo=0&prazoFinal=0&valor=0&quantidade=1&logisticaReversa=false&remetente[logradouro]=Rua+Quintino+Loureiro&remetente[cep]=29190-014&remetente[cidade]=Aracruz&remetente[bairro]=Centro&remetente[uf]=ES&remetente[complemento]=&destinatario[logradouro]=Rua+Vitorino+Carmilo&destinatario[cep]=${destino}&destinatario[cidade]=Sao+Paulo&destinatario[bairro]=Barra+Funda&destinatario[uf]=SP&destinatario[complemento]=&tipoEmbalagem=1&tipo=2&servicos[]=03220&servicos[]=03298&servicos[]=04227&servicos[]=.package&servicos[]=economico`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const resultados = response.data.map(frete => ({
      servico: frete.coProduto,
      valor: frete.pcFinal,
      prazo: frete.prazoEntrega
    }));

    return res.json({ ok: true, resultados });

  } catch (error) {
    console.error('❌ Erro na cotação:', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: error.message,
      data: error.response?.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
