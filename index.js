import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// Função de cotação usando Puppeteer
async function getFrete(origem, destino, peso) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-zygote",
        "--single-process"
      ]
    });

    const page = await browser.newPage();
    await page.goto("https://www.exemplo-cotacao.com.br", { waitUntil: "networkidle2" });

    // Exemplo de preenchimento de formulário
    await page.type("#origem", origem);
    await page.type("#destino", destino);
    await page.type("#peso", peso.toString());
    await page.click("#calcular");

    await page.waitForSelector("#resultado"); // Aguarda resultado
    const resultado = await page.$eval("#resultado", el => el.textContent.trim());

    return { sucesso: true, valor: resultado };
  } catch (err) {
    console.error("Erro no Puppeteer:", err.message);
    return { sucesso: false, erro: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// Endpoint POST /cotacao
app.post("/cotacao", async (req, res) => {
  const { origem, destino, peso } = req.body;

  if (!origem || !destino || !peso) {
    return res.status(400).json({ sucesso: false, erro: "Parâmetros inválidos" });
  }

  const cotacao = await getFrete(origem, destino, peso);
  if (!cotacao.sucesso) return res.status(500).json(cotacao);

  res.json(cotacao);
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("Servidor FreteBot rodando!");
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
