import express from "express";
import puppeteer from "puppeteer-core";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.BROWSERLESS_TOKEN; // use esse nome no Render

// Rota GET para testar se o servidor está online
app.get("/", (req, res) => {
  res.send("Servidor FreteBot rodando com Browserless!");
});

// Exemplo de rota POST para cotação de frete
app.post("/cotacao", async (req, res) => {
  let browser;
  try {
    // Conectando ao Browserless via WebSocket
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${TOKEN}`,
    });

    const page = await browser.newPage();
    await page.goto("https://example.com"); // coloque sua URL de consulta aqui

    // Exemplo: captura de screenshot só para testar
    const screenshot = await page.screenshot({ encoding: "base64" });

    await browser.close();

    res.json({
      sucesso: true,
      mensagem: "Browserless funcionando!",
      imagem: `data:image/png;base64,${screenshot}`,
    });
  } catch (error) {
    console.error("Erro no Puppeteer/Browserless:", error);
    if (browser) await browser.close();
    res.status(500).json({
      sucesso: false,
      erro: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor FreteBot rodando na porta ${PORT}`);
});
