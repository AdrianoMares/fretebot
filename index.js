import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Função principal de cálculo de frete
async function getFrete({ cepOrigem, cepDestino, peso, altura, largura, comprimento }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  try {
    await page.goto('https://www.clubepostaja.com.br/cotacao', { waitUntil: 'networkidle2' });
    // A partir daqui você pode preencher os campos e extrair os dados da página
    await page.waitForTimeout(1000);

    const resultado = { valor: 'R$ 29,90', prazo: '3 dias úteis' };
    await browser.close();
    return resultado;
  } catch (error) {
    await browser.close();
    console.error('Erro no Puppeteer:', error);
    throw error;
  }
}

// Endpoint de cálculo
app.post('/calcular', async (req, res) => {
  try {
    const dados = req.body;
    const resultado = await getFrete(dados);
    res.json(resultado);
  } catch (error) {
    console.error('Erro na cotação:', error);
    res.status(500).json({ erro: 'Erro ao calcular o frete.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
