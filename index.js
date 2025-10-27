import express from "express";
import puppeteer from "puppeteer-core";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const loginURL = "https://clubepostaja.com.br/";
const calcURL = "https://clubepostaja.com.br/calculadora";

const TOKEN = process.env.BROWSERLESS_TOKEN;

const TAXAS = {
  "SEDEX": 10.5,
  "PAC": 10.5,
  "Pac Mini": 10.5,
  "Jadlog": 70,
};

function aplicarTaxa(servico, valor) {
  const taxa = TAXAS[servico] || 0;
  return Number((valor * (1 + taxa / 100)).toFixed(2));
}

async function getFrete(dados) {
  let browser;
  try {
    // Conecta ao Browserless via WebSocket
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${TOKEN}`,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // LOGIN
    await page.goto(loginURL, { waitUntil: "networkidle2" });
    await page.type("#email", process.env.POSTAJA_EMAIL || "");
    await page.type("#password", process.env.POSTAJA_SENHA || "");
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // CALCULADORA
    await page.goto(calcURL, { waitUntil: "networkidle2" });

    // PREENCHER FORMULÁRIO
    await page.type("#cepOrigem", dados.origem);
    await page.type("#cepDestino", dados.destino);
    await page.type("#peso", String(dados.peso));
    await page.type("#largura", String(dados.largura));
    await page.type("#altura", String(dados.altura));
    await page.type("#comprimento", String(dados.comprimento));
    await page.type("#valorDeclarado", String(dados.valorDeclarado || 0));

    await Promise.all([
      page.click("#btnCalcular"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    // PEGAR RESULTADOS
    const resultados = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".resultado-item"));
      return rows.map(r => ({
        servico: r.querySelector(".nome-servico")?.innerText || "",
        valor: r.querySelector(".valor-frete")?.innerText || "",
        prazo: r.querySelector(".prazo-entrega")?.innerText || "",
      }));
    });

    const ajustados = resultados.map(frete => {
      const raw = (frete.valor || "")
        .replace("R$", "")
        .replace(".", "")
        .replace(",", ".")
        .trim();
      const valorNum = Number(raw) || 0;
      return {
        servico: frete.servico,
        valor: aplicarTaxa(frete.servico, valorNum),
        prazo: frete.prazo,
      };
    });

    await browser.close();
    return ajustados;
  } catch (err) {
    console.error("Erro no Browserless/Puppeteer:", err);
    if (browser) await browser.close();
    throw err;
  }
}

app.post("/cotacao", async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || !dados.origem || !dados.destino) {
      return res.status(400).json({ erro: "origem e destino são obrigatórios" });
    }
    const fretes = await getFrete(dados);
    res.json({ fretes });
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ erro: "Falha ao calcular o frete" });
  }
});

app.get("/", (req, res) => res.send("Servidor FreteBot rodando com Browserless!"));
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
