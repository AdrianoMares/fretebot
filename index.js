import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import puppeteer from "puppeteer-core";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

const PORT = Number(process.env.PORT || 10000);
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const POSTAJA_EMAIL = process.env.POSTAJA_EMAIL || "";
const POSTAJA_SENHA = process.env.POSTAJA_SENHA || "";

let cookieCache = null;

// utilitários básicos
async function clickByText(page, tag, text) {
  const handle = await page.evaluateHandle(
    (t, txt) => {
      const elList = Array.from(document.querySelectorAll(t));
      const found = elList.find(
        (el) => el.textContent && el.textContent.trim().toLowerCase().includes(txt.toLowerCase())
      );
      return found || null;
    },
    tag,
    text
  );
  const el = handle.asElement();
  if (!el) throw new Error(`Elemento <${tag}> com texto contendo "${text}" não encontrado.`);
  await el.click();
}

// login robusto
async function ensureLogged(page) {
  if (cookieCache) {
    try {
      await page.setCookie(...cookieCache);
      await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });
      const logged = await page.evaluate(() =>
        document.body.innerText.toLowerCase().includes("calculadora")
      );
      if (logged) return true;
    } catch (_) {}
  }

  await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });

  // preenche login via labels "Insira seu e-mail" e "Insira sua senha"
  await page.evaluate((email, senha) => {
    const findLabelInput = (labelText) => {
      const label = Array.from(document.querySelectorAll("label"))
        .find((el) => el.innerText.toLowerCase().includes(labelText.toLowerCase()));
      if (!label) return null;
      const input = label.parentElement.querySelector("input");
      return input;
    };

    const emailInput = findLabelInput("insira seu e-mail");
    if (emailInput) {
      emailInput.focus();
      emailInput.value = email;
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const senhaInput = findLabelInput("insira sua senha");
    if (senhaInput) {
      senhaInput.focus();
      senhaInput.value = senha;
      senhaInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, POSTAJA_EMAIL, POSTAJA_SENHA);

  await clickByText(page, "button", "acessar");

  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
  cookieCache = await page.cookies();
  return true;
}

// extrai cards da calculadora-completa
function parseMoneyToNumber(text) {
  if (!text) return 0;
  const raw = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

async function scrapeCards(page) {
  await page.waitForSelector("body", { timeout: 60000 });

  const items = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("div, article, section"));
    const cards = candidates.filter((el) => {
      const t = (el.textContent || "").toLowerCase();
      return t.includes("dias úteis") && t.includes("r$");
    });

    const serviceNameFrom = (el) => {
      const txt = (el.textContent || "").toLowerCase();
      const alts = Array.from(el.querySelectorAll("img"))
        .map((i) => (i.getAttribute("alt") || "").trim().toLowerCase())
        .filter(Boolean);
      let name = "";
      if (alts.some((a) => a.includes("sedex"))) name = "SEDEX";
      else if (alts.some((a) => a.includes("pac"))) name = "PAC";
      else if (alts.some((a) => a.includes("mini"))) name = "Pac Mini";
      else if (alts.some((a) => a.includes("jadlog"))) name = "Jadlog";
      else if (alts.some((a) => a.includes("loggi"))) name = "Loggi";
      if (!name) {
        if (txt.includes("sedex")) name = "SEDEX";
        else if (txt.includes("pac ")) name = "PAC";
        else if (txt.includes("mini")) name = "Pac Mini";
        else if (txt.includes("jadlog")) name = "Jadlog";
        else if (txt.includes("loggi")) name = "Loggi";
      }
      return name || "Desconhecido";
    };

    const prazoFrom = (el) => {
      const m = (el.textContent || "").match(/(\d+\s*[-–]\s*\d+|\d+)\s*dias?\s*úteis/iu);
      return m ? m[0].replace(/\s+/g, " ").trim() : "";
    };

    const precoFrom = (el) => {
      const m = (el.textContent || "").match(/R\$\s*[\d.,]+/iu);
      return m ? m[0] : "";
    };

    const uniq = [];
    cards.forEach((el) => {
      const s = serviceNameFrom(el);
      const pz = prazoFrom(el);
      const pr = precoFrom(el);
      if (pr && pz) uniq.push({ servico: s, prazo: pz, valorStr: pr });
    });

    const keyset = new Set();
    const out = [];
    for (const it of uniq) {
      const k = `${it.servico}|${it.prazo}|${it.valorStr}`;
      if (!keyset.has(k)) {
        keyset.add(k);
        out.push(it);
      }
    }
    return out;
  });

  return items.map((it) => ({
    servico: it.servico,
    prazo: it.prazo,
    valor: parseMoneyToNumber(it.valorStr),
  }));
}

async function getFrete(dados) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    await ensureLogged(page);

    await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "networkidle2" });

    const preencher = async (texto, valor) => {
      await page.evaluate(
        (txt, val) => {
          const input = Array.from(document.querySelectorAll("input"))
            .find((i) => (i.placeholder || "").toLowerCase().includes(txt.toLowerCase()));
          if (input) {
            input.focus();
            input.value = val;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
        texto,
        String(valor)
      );
    };

    await preencher("cep de origem", dados.origem);
    await preencher("cep de destino", dados.destino);
    await preencher("altura", dados.altura);
    await preencher("largura", dados.largura);
    await preencher("compr", dados.comprimento);
    const pesoGramas = dados.peso > 10 ? dados.peso : Math.round(Number(dados.peso) * 1000);
    await preencher("peso", pesoGramas);
    await preencher("valor declarado", (dados.valorDeclarado || 0).toFixed(2));

    await clickByText(page, "button", "CALCULAR FRETE");

    await page.waitForFunction(
      () => location.href.includes("calculadora-completa"),
      { timeout: 60000 }
    ).catch(async () => {
      await page.waitForSelector("body", { timeout: 60000 });
    });

    const fretes = await scrapeCards(page);
    return fretes;
  } finally {
    await browser.close();
  }
}

app.get("/", (_req, res) => res.send("FreteBot ok"));

app.post("/cotacao", async (req, res) => {
  try {
    const dados = req.body || {};
    const obrig = ["origem", "destino", "peso", "largura", "altura", "comprimento"];
    for (const f of obrig) {
      if (!dados[f]) return res.status(400).json({ erro: `Campo obrigatório: ${f}` });
    }

    const fretes = await getFrete(dados);
    res.json({ fretes });
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ erro: String(err.message || err) });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
