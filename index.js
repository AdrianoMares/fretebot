import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json());

let processing = false;

async function getFrete(data) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote'
      ]
    });
    const page = await browser.newPage();
    await page.goto('https://www.google.com');
    await page.waitForTimeout(2000);
    return { status: 'OK', message: 'Teste de Puppeteer bem-sucedido!' };
  } catch (error) {
    console.error('Erro no Puppeteer:', error);
    return { status: 'ERRO', message: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

app.post('/cotacao', async (req, res) => {
  if (processing) {
    return res.status(429).json({ erro: 'Servidor ocupado, tente novamente em alguns segundos' });
  }
  processing = true;
  try {
    const result = await getFrete(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  } finally {
    processing = false;
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
