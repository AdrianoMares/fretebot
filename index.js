import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

async function getFrete({ origem, destino, peso, largura, altura, comprimento, valorDeclarado }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  console.log("Acessando página de login...");
  await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });

  // Login
  await page.type('input[placeholder*="e-mail" i]', process.env.POSTAJA_EMAIL);
  await page.type('input[placeholder*="senha" i]', process.env.POSTAJA_SENHA);
  await page.click('button[type="submit"], button:has-text("Entrar")');
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("Login efetuado, indo para calculadora...");
  await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "networkidle2" });

  // Preencher dados
  await page.type('input[name="cepOrigem"]', origem);
  await page.type('input[name="cepDestino"]', destino);
  await page.type('input[name="peso"]', String(peso));
  await page.type('input[name="largura"]', String(largura));
  await page.type('input[name="altura"]', String(altura));
  await page.type('input[name="comprimento"]', String(comprimento));
  await page.type('input[name="valorDeclarado"]', String(valorDeclarado));

  // Clicar em Calcular Frete
  await page.click('button:has-text("CALCULAR FRETE")');
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("Extraindo valores...");
  const resultados = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".card, .box, .result-item"));
    return cards.map(el => el.innerText).filter(Boolean);
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
  await browser.close();
  return resultados;
}

app.post("/cotacao", async (req, res) => {
  try {
    const result = await getFrete(req.body);
    res.json({ sucesso: true, resultado: result });
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
