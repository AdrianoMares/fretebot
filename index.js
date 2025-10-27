import express from "express";
import puppeteer from "puppeteer-core";
import fs from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BROWSERLESS_URL = process.env.BROWSERLESS_URL;
const EMAIL = process.env.POSTAJA_EMAIL;
const SENHA = process.env.POSTAJA_SENHA;
const COOKIE_PATH = "./cookies.json";

async function iniciarBrowser() {
  return await puppeteer.connect({
    browserWSEndpoint: `${BROWSERLESS_URL}?token=${process.env.BROWSERLESS_TOKEN}`,
  });
}

async function login(page) {
  console.log("🔐 Fazendo login...");
  await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle0" });

  await page.waitForSelector("input[name='email']");
  await page.type("input[name='email']", EMAIL, { delay: 50 });

  await page.waitForSelector("input[name='password']");
  await page.type("input[name='password']", SENHA, { delay: 50 });

  await page.click("button[type='submit']");
  await page.waitForNavigation({ waitUntil: "networkidle0" });

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies));
  console.log("✅ Login realizado e cookies salvos!");
}

async function ensureLogged(page) {
  if (fs.existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
    await page.setCookie(...cookies);
    await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "networkidle0" });

    if (page.url().includes("login") || page.url().includes("home")) {
      console.log("⚠️ Sessão expirada, refazendo login...");
      await login(page);
    }
  } else {
    await login(page);
  }
}

async function getFrete(data) {
  const browser = await iniciarBrowser();
  const page = await browser.newPage();
  await ensureLogged(page);

  await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "networkidle0" });

  console.log("📦 Preenchendo formulário de cotação...");
  await page.waitForSelector("input[name='cepOrigem']");
  await page.type("input[name='cepOrigem']", data.origem);
  await page.type("input[name='cepDestino']", data.destino);
  await page.type("input[name='peso']", String(data.peso));
  await page.type("input[name='largura']", String(data.largura));
  await page.type("input[name='altura']", String(data.altura));
  await page.type("input[name='comprimento']", String(data.comprimento));
  await page.type("input[name='valorDeclarado']", String(data.valorDeclarado || 0));

  await page.click("button[type='submit']");
  await page.waitForSelector(".resultado-row", { timeout: 20000 });

  const fretes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".resultado-row")).map((row) => ({
      servico: row.querySelector(".nome-servico")?.innerText || "Indefinido",
      valor: parseFloat(
        row.querySelector(".valor-servico")?.innerText.replace("R$", "").replace(",", ".").trim() || 0
      ),
      prazo: row.querySelector(".prazo-servico")?.innerText || "-",
    }));
  });

  console.log("✅ Cotação concluída.");
  await browser.disconnect();
  return { fretes };
}

app.get("/", (req, res) => {
  res.send("🚀 Servidor FreteBot ativo e pronto para cotações!");
});

app.post("/cotacao", async (req, res) => {
  try {
    const resultado = await getFrete(req.body);
    res.json(resultado);
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
