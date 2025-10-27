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

const TAXAS = {
  "SEDEX": 10.5,
  "PAC": 10.5,
  "Pac Mini": 10.5,
  "Jadlog": 70
};

function aplicarTaxa(servico, valor) {
  const taxa = TAXAS[servico] || 0;
  return Number((valor * (1 + taxa / 100)).toFixed(2));
}

async function getFrete(dados) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: puppeteer.executablePath() // usa o Chrome baixado
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
      return Array.from(document.querySelectorAll(".resultado-item")).map(linha => ({
        servico: linha.querySelector(".nome-servico")?.innerText || "",
        valor: linha.querySelector(".valor-frete")?.innerText || "",
        prazo: linha.querySelector(".prazo-entrega")?.innerText || ""
      }));
    });

    // AJUSTAR TAXAS
    return resultados.map(frete => {
      let valorNum = parseFloat(frete.valor.replace("R$", "").replace(",", ".").trim());
      return {
        servico: frete.servico,
        valor: aplicarTaxa(frete.servico, valorNum),
        prazo: frete.prazo
      };
    });

  } catch (err) {
    console.error("Erro no Puppeteer:", err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

app.post("/cotacao", async (req, res) => {
  try {
    const fretes = await getFrete(req.body);
    res.json({ fretes });
  } catch (err) {
    res.status(500).json({ erro: "Falha ao calcular o frete" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
