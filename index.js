import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;
const COOKIES_PATH = "./cookies.json";

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(page) {
  console.log("🔍 Verificando se cookies existem...");
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
    await page.setCookie(...cookies);
    await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "domcontentloaded" });
    if (page.url().includes("calculadora")) {
      console.log("✅ Sessão reutilizada com sucesso.");
      return true;
    }
  }

  console.log("🔑 Fazendo login...");
  const loginUrls = [
    "https://clubepostaja.com.br/login",
    "https://clubepostaja.com.br/home",
    "https://clubepostaja.com.br/entrar"
  ];

  let success = false;
  for (const url of loginUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      const emailInput = await page.$('input[type="email"], input[name*="email" i], input[placeholder*="mail" i]');
      const senhaInput = await page.$('input[type="password"], input[name*="senha" i]');
      if (emailInput && senhaInput) {
        await emailInput.type(process.env.POSTAJA_EMAIL, { delay: 50 });
        await senhaInput.type(process.env.POSTAJA_SENHA, { delay: 50 });
        const loginButton = await page.$('button, input[type="submit"]');
        if (loginButton) {
          await Promise.all([loginButton.click(), page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 })]);
        }
        success = true;
        break;
      }
    } catch (err) {
      console.warn("⚠️ Falha em URL de login:", url, err.message);
    }
  }

  if (!success) throw new Error("Falha ao localizar formulário de login.");
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log("✅ Login efetuado e cookies salvos.");
}

async function getFrete({ origem, destino, peso, largura, altura, comprimento, valorDeclarado }) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--single-process",
      "--no-zygote",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  try {
    await login(page);
    console.log("📦 Acessando calculadora de frete...");
    await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "domcontentloaded", timeout: 120000 });

    const fields = [
      { name: "cepOrigem", value: origem },
      { name: "cepDestino", value: destino },
      { name: "peso", value: peso },
      { name: "largura", value: largura },
      { name: "altura", value: altura },
      { name: "comprimento", value: comprimento },
      { name: "valorDeclarado", value: valorDeclarado }
    ];

    for (const f of fields) {
      try {
        await page.evaluate((n) => (document.querySelector(`input[name='${n}']`).value = ""), f.name);
        await page.type(`input[name='${f.name}']`, String(f.value));
      } catch {
        console.warn(`⚠️ Campo ${f.name} não encontrado.`);
      }
    }

    await page.evaluate(() => {
      const botoes = Array.from(document.querySelectorAll("button"));
      const botao = botoes.find(b => b.innerText.toUpperCase().includes("CALCULAR FRETE"));
      if (botao) botao.click();
    });

    await wait(8000);
    console.log("📊 Extraindo resultados...");
    const resultados = await page.evaluate(() => {
      const textos = Array.from(document.querySelectorAll("*"))
        .map(el => el.innerText.trim())
        .filter(t => /R\$\s?\d+/i.test(t));
      return textos;
    });

    const fretes = [];
    for (let i = 0; i < resultados.length; i++) {
      const matchPrazo = resultados[i].match(/(\d+-\d+\s*dias?\s*úteis)/i);
      const matchValor = resultados[i].match(/R\$\s?([0-9.,]+)/i);
      if (matchPrazo && matchValor) {
        fretes.push({
          servico: `Serviço ${i + 1}`,
          prazo: matchPrazo[1],
          valor: parseFloat(matchValor[1].replace(",", "."))
        });
      }
    }

    await browser.close();
    return fretes;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

app.post("/cotacao", async (req, res) => {
  try {
    console.log("🚚 Iniciando cotação...");
    const fretes = await getFrete(req.body);
    res.json({ sucesso: true, fretes });
  } catch (err) {
    console.error("❌ Erro na cotação:", err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
