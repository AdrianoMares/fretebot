process.env.DEBUG = "puppeteer:*";
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const loginURL = "https://clubepostaja.com.br/";
const calcURL = "https://clubepostaja.com.br/calculadora";
const resultURL = "https://clubepostaja.com.br/calculadora-completa";

const TAXAS = {
  "SEDEX": 10.5,
  "PAC": 10.5,
  "Pac Mini": 10.5,
  "Jadlog": 70
};

function aplicarTaxa(servico, valor) {
  const taxa = TAXAS[servico] || 0;
  return Number((valor * (1 + taxa/100)).toFixed(2));
}

async function getFrete(dados) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu"
    ],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

  // LOGIN
  await page.goto(loginURL, { waitUntil: "networkidle2" });
  await page.type("#email", process.env.POSTAJA_EMAIL);
  await page.type("#password", process.env.POSTAJA_SENHA);
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
  await page.type("#valorDeclarado", String(dados.valorDeclarado));

  await Promise.all([
    page.click("#btnCalcular"),
    page.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);

  // PEGAR RESULTADOS
  const resultados = await page.evaluate(() => {
    const linhas = Array.from(document.querySelectorAll(".resultado-item"));
    return linhas.map(linha => {
      const servico = linha.querySelector(".nome-servico")?.innerText || "";
      const valor = linha.querySelector(".valor-frete")?.innerText || "";
      const prazo = linha.querySelector(".prazo-entrega")?.innerText || "";
      return { servico, valor, prazo };
    });
  });

  await browser.close();

  // AJUSTAR TAXAS
  const ajustados = resultados.map(frete => {
    let valorNum = parseFloat(frete.valor.replace("R$", "").replace(",", ".").trim());
    return {
      servico: frete.servico,
      valor: aplicarTaxa(frete.servico, valorNum),
      prazo: frete.prazo
    };
  });

  return ajustados;
}
