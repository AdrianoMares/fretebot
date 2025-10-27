import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Função principal de cotação
async function getFrete(dados) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://clubepostaja.com.br/", { waitUntil: "networkidle2" });

    // simulação de preenchimento do formulário
    await page.waitForSelector("input[name='cep_origem']");
    await page.type("input[name='cep_origem']", dados.cep_origem);
    await page.type("input[name='cep_destino']", dados.cep_destino);
    await page.type("input[name='peso']", dados.peso);

    await page.click("button[type='submit']");
    await page.waitForSelector(".resultado", { timeout: 20000 });

    const resultado = await page.evaluate(() => {
      const resultados = Array.from(document.querySelectorAll(".resultado"));
      return resultados.map(el => el.textContent.trim());
    });

    return resultado;
  } catch (err) {
    console.error("Erro no Puppeteer:", err);
    throw err;
  } finally {
    await browser.close();
  }
}

// 🟢 Rota de teste GET
app.get("/", (req, res) => {
  res.json({ status: "Servidor FreteBot ativo!" });
});

// 🟢 Rota principal de cotação
app.post("/cotacao", async (req, res) => {
  try {
    const dados = req.body;
    const resultado = await getFrete(dados);
    res.json({ sucesso: true, resultado });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// Porta Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
