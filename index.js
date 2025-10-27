import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import puppeteer from "puppeteer-core";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

// Config
const PORT = Number(process.env.PORT || 10000);
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const POSTAJA_EMAIL = process.env.POSTAJA_EMAIL || "";
const POSTAJA_SENHA = process.env.POSTAJA_SENHA || "";

if (!BROWSERLESS_TOKEN) {
  console.warn("[WARN] BROWSERLESS_TOKEN não definido. Configure no Render.");
}

// simples cache de cookies por processo (reinicia a cada deploy)
let cookieCache = null;

/**
 * Funções utilitárias para seleção robusta
 */
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

async function typeByPlaceholderContains(page, containsText, value) {
  const handle = await page.evaluateHandle((txt) => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const target = inputs.find((i) => {
      const ph = (i.getAttribute("placeholder") || "").toLowerCase();
      return ph.includes(txt.toLowerCase());
    });
    return target || null;
  }, containsText);
  const el = handle.asElement();
  if (!el) throw new Error(`Input com placeholder contendo "${containsText}" não encontrado.`);
  await el.type(value, { delay: 15 });
}

async function ensureLogged(page) {
  // Se já tem cookies válidos, injeta e tenta abrir /home direto
  if (cookieCache) {
    try {
      await page.setCookie(...cookieCache);
      await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });
      // se carregou o menu lateral, assumimos logado
      const logged = await page.evaluate(() => !!document.querySelector('a[href="/calculadora"]') || !!document.body.innerText.includes("Calculadora"));
      if (logged) return true;
    } catch (_) {}
  }

  // Faz login manual (como usuário)
  await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });
  // Alguns tenants mostram o formulário de login nesta própria URL
  // Localiza os dois campos pelo placeholder
  await typeByPlaceholderContains(page, "e-mail", POSTAJA_EMAIL);
  await typeByPlaceholderContains(page, "senha", POSTAJA_SENHA);

  // Botão "ACESSAR"
  await clickByText(page, "button", "acessar");

  // Aguarda redirecionar para home autenticada
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });

  // Armazena cookies na memória para próximas requisições
  cookieCache = await page.cookies();
  return true;
}

function parseMoneyToNumber(text) {
  if (!text) return 0;
  const raw = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/**
 * Extrai cards de preço/prazo na calculadora-completa
 */
async function scrapeCards(page) {
  // Espera os cards aparecerem
  await page.waitForSelector("body", { timeout: 60000 });

  const items = await page.evaluate(() => {
    // Cada card costuma ter um preço com "R$" e um bloco de prazo "dias úteis".
    const candidates = Array.from(document.querySelectorAll("div, article, section"));
    const cards = candidates.filter((el) => {
      const t = (el.textContent || "").toLowerCase();
      return t.includes("dias úteis") && t.includes("r$");
    });

    // Função auxiliar para identificar serviço pelo texto e imagens
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
      const m = (el.textContent || "").match(/R\$\s*[\d\.\,]+/iu);
      return m ? m[0] : "";
    };

    const uniq = [];
    cards.forEach((el) => {
      const s = serviceNameFrom(el);
      const pz = prazoFrom(el);
      const pr = precoFrom(el);
      if (pr && pz) {
        uniq.push({ servico: s, prazo: pz, valorStr: pr });
      }
    });

    // Dedup por (servico,prazo,valorStr)
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

  // Normaliza valores
  const normalized = items.map((it) => ({
    servico: it.servico,
    prazo: it.prazo,
    valor: parseMoneyToNumber(it.valorStr),
  })).filter((x) => x.valor > 0 && x.prazo);

  // Mantém somente serviços de interesse e ordena por valor
  const preferredOrder = ["SEDEX", "PAC", "Pac Mini", "Jadlog", "Loggi"];
  normalized.sort((a, b) => a.valor - b.valor);
  // ordena dentro do mesmo nome pela ordem preferida
  normalized.sort((a, b) => preferredOrder.indexOf(a.servico) - preferredOrder.indexOf(b.servico));

  return normalized;
}

/**
 * Fluxo principal de cotação
 */
async function getFrete(dados) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    // 1) garantir login
    await ensureLogged(page);

    // 2) ir à calculadora
    await page.goto("https://clubepostaja.com.br/calculadora", { waitUntil: "networkidle2" });

    // 3) preencher campos (por placeholder/labels)
    const fillByIdOrPlaceholder = async (id, phContains, value) => {
      // tenta por id
      let ok = false;
      if (id) {
        const byId = await page.$(`#${id}`);
        if (byId) {
          await byId.click({ clickCount: 3 });
          await byId.type(String(value), { delay: 15 });
          ok = true;
        }
      }
      if (!ok) {
        await typeByPlaceholderContains(page, phContains, String(value));
      }
    };

    await fillByIdOrPlaceholder(null, "CEP de origem", dados.origem);
    await fillByIdOrPlaceholder(null, "CEP de destino", dados.destino);
    await fillByIdOrPlaceholder(null, "Altura", dados.altura);
    await fillByIdOrPlaceholder(null, "Largura", dados.largura);
    await fillByIdOrPlaceholder(null, "Compr", dados.comprimento);
    // Peso na UI aparenta ser em gramas; se vier em kg, converter
    const pesoGramas = dados.peso > 10 ? dados.peso : Math.round(Number(dados.peso) * 1000);
    await fillByIdOrPlaceholder(null, "Peso", pesoGramas);
    await fillByIdOrPlaceholder(null, "Valor declarado", (dados.valorDeclarado || 0).toFixed(2));

    // 4) clicar em "CALCULAR FRETE"
    await clickByText(page, "button", "CALCULAR FRETE");

    // 5) aguardar navegação/resultado
    await page.waitForFunction(
      () => location.href.includes("calculadora-completa"),
      { timeout: 60000 }
    ).catch(async () => {
      // alguns fluxos atualizam via ajax, então só espera surgir os cards
      await page.waitForSelector("body", { timeout: 60000 });
    });

    // 6) extrair cards
    const fretes = await scrapeCards(page);

    return fretes;
  } finally {
    await browser.close();
  }
}

app.get("/", (_req, res) => {
  res.send("FreteBot ok");
});

app.post("/cotacao", async (req, res) => {
  try {
    const dados = req.body || {};
    const obrig = ["origem", "destino", "peso", "largura", "altura", "comprimento"];
    for (const f of obrig) {
      if (dados[f] === undefined || dados[f] === null || dados[f] === "") {
        return res.status(400).json({ erro: `Campo obrigatório: ${f}` });
      }
    }

    const fretes = await getFrete(dados);

    // filtra e formata na resposta desejada
    res.json({ fretes });
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ erro: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
