import express from "express";
import bodyParser from "body-parser";
import puppeteer from "puppeteer-core";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN; // adicione seu token nas variáveis de ambiente

async function getFrete(reqBody) {
    const browser = await puppeteer.connect({
        browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
    });

    const page = await browser.newPage();
    await page.goto("https://example.com"); // substitua pela URL real do frete
    // Código de scraping/cotação aqui
    const resultado = { preco: "100,00" }; // exemplo
    await browser.close();
    return resultado;
}

app.post("/cotacao", async (req, res) => {
    try {
        const frete = await getFrete(req.body);
        res.json({ sucesso: true, dados: frete });
    } catch (erro) {
        console.error("Erro no Puppeteer:", erro.message);
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor FreteBot rodando na porta ${PORT}`);
});
