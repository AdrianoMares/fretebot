import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import puppeteer from "puppeteer-core";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const POSTAJA_EMAIL = process.env.POSTAJA_EMAIL || "";
const POSTAJA_SENHA = process.env.POSTAJA_SENHA || "";

const LOGIN_URL = "https://clubepostaja.com.br/home";
const CALC_BACK = "https://back.clubepostaja.com.br";
const OPENCEP = "https://opencep.com.br/v1"; // falls back to .com if needed

// ---- Taxas (percentuais) ----
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

// cache simples do token em memória (e opcionalmente em /tmp)
let tokenCache = { token: null, exp: 0 };
const TOKEN_FILE = "/tmp/fretebot_token.json";

function loadTokenCache() {
  try {
    const raw = require("fs").readFileSync(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    tokenCache = parsed;
  } catch {}
}
function saveTokenCache() {
  try {
    require("fs").writeFileSync(TOKEN_FILE, JSON.stringify(tokenCache));
  } catch {}
}
loadTokenCache();

function decodeJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return (payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

async function typeBy(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.focus(); el.value = ""; }
  }, selector);
  await page.type(selector, text, { delay: 20 });
}

async function clickButtonByText(page, texts = ["Entrar", "Acessar", "Login"]) {
  await page.waitForSelector("button", { timeout: 15000 });
  const clicked = await page.evaluate((btnTexts) => {
    const norm = (s) => (s || "").trim().toLowerCase();
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const t of btnTexts) {
      const match = buttons.find(b => norm(b.innerText).includes(norm(t)));
      if (match) { match.click(); return true; }
    }
    // fallback: submit first form
    const form = document.querySelector("form");
    if (form) { form.submit(); return true; }
    return false;
  }, texts);
  if (!clicked) throw new Error("Não foi possível clicar no botão de login.");
}

async function browserConnect() {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("Defina BROWSERLESS_TOKEN nos envs do Render.");
  }
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });
  return browser;
}

// Tenta descobrir um JWT válido no localStorage após login
async function extractJwtFromLocalStorage(page) {
  return await page.evaluate(() => {
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const val = localStorage.getItem(k) || "";
      // Heurística simples para JWT: contém 2 pontos.
      if (val.includes(".") && val.split(".").length === 3) {
        results.push(val);
      }
    }
    return results[0] || null;
  });
}

async function ensureLogged(page) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now + 60_000) {
    return tokenCache.token;
  }

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Se já estiver logado, possivelmente não há inputs de email/senha
  const hasEmailInput = await page.$('input[type="email"], input[name="email"]');
  const hasPasswordInput = await page.$('input[type="password"], input[name="password"]');

  if (hasEmailInput && hasPasswordInput) {
    if (!POSTAJA_EMAIL || !POSTAJA_SENHA) {
      throw new Error("POSTAJA_EMAIL e POSTAJA_SENHA precisam estar definidos nos envs.");
    }
    await typeBy(page, 'input[type="email"], input[name="email"]', POSTAJA_EMAIL);
    await typeBy(page, 'input[type="password"], input[name="password"]', POSTAJA_SENHA);
    await clickButtonByText(page);
    // aguarda a aplicação inicializar após login
    await page.waitForTimeout(2500);
  }

  // tenta obter o JWT que a SPA usa para o back.clubepostaja.com.br
  const jwt = await extractJwtFromLocalStorage(page);
  if (!jwt) {
    // alguns apps armazenam token em sessionStorage
    const sessionJwt = await page.evaluate(() => {
      const results = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        const val = sessionStorage.getItem(k) || "";
        if (val.includes(".") && val.split(".").length === 3) results.push(val);
      }
      return results[0] || null;
    });
    if (!sessionJwt) throw new Error("Não foi possível capturar o token JWT após o login.");
    tokenCache.token = sessionJwt;
    tokenCache.exp = decodeJwtExp(sessionJwt);
    saveTokenCache();
    return sessionJwt;
  } else {
    tokenCache.token = jwt;
    tokenCache.exp = decodeJwtExp(jwt);
    saveTokenCache();
    return jwt;
  }
}

async function getEnderecoByCEP(cep) {
  // remove hifen
  const digits = (cep || "").replace(/\D/g, "");
  const urls = [
    `https://opencep.com.br/v1/${digits}`,
    `https://opencep.com/v1/${digits}`,
  ];
  for (const u of urls) {
    try {
      const resp = await fetch(u);
      if (resp.ok) {
        const j = await resp.json();
        return {
          logradouro: j.logradouro || "",
          bairro: j.bairro || "",
          cidade: j.localidade || j.cidade || "",
          uf: j.uf || "",
          cep: j.cep || cep,
        };
      }
    } catch {}
  }
  // fallback mínimo
  return { logradouro: "", bairro: "", cidade: "", uf: "", cep };
}

function kgToGrams(kg) {
  const num = Number(kg || 0);
  return Math.max(1, Math.round(num * 1000));
}

// Mapeia a resposta do backend no formato desejado
function mapRespostaPrecoPrazo(respJson) {
  // Tentamos cobrir formatos prováveis.
  // Ex.: [{nome:'SEDEX', valor: 10.5, prazo: '1-3 dias'}]
  const out = [];

  const addItem = (servico, preco, prazo) => {
    if (!servico) return;
    const valorNum = Number(preco) || 0;
    out.push({
      servico,
      valor: aplicarTaxa(servico, valorNum),
      prazo: prazo || "",
    });
  };

  if (Array.isArray(respJson)) {
    for (const it of respJson) {
      const nome = it.servico || it.nome || it.descricao || it.carrier || it.sigla || "";
      const valor = it.preco || it.valor || it.price || it.total || 0;
      const prazo = it.prazo || it.prazoEntrega || it.leadtime || it.delivery || "";
      addItem(nome, valor, prazo);
    }
  } else if (respJson && typeof respJson === "object") {
    const keys = Object.keys(respJson);
    for (const k of keys) {
      const it = respJson[k];
      if (it && typeof it === "object") {
        const nome = it.servico || it.nome || k;
        const valor = it.preco || it.valor || 0;
        const prazo = it.prazo || it.prazoEntrega || "";
        addItem(nome, valor, prazo);
      }
    }
  }

  // Ordena por valor ascendente
  out.sort((a, b) => a.valor - b.valor);
  return out;
}

async function cotarViaBackend(page, jwt, dados) {
  // Consulta CEP para remetente/destinatário como a SPA faz
  const remetente = await getEnderecoByCEP(dados.origem);
  const destinatario = await getEnderecoByCEP(dados.destino);

  // Alguns serviços padrão (podemos ajustar depois com valores reais)
  const servicos = ["03220", "03298", "04227", ".package", "economico"];

  // Backend do Posta Já recebe unidades em gramas e cm na maioria dos casos
  const params = new URLSearchParams({
    cepOrigem: dados.origem,
    cepDestino: dados.destino,
    altura: String(dados.altura ?? 1),
    largura: String(dados.largura ?? 1),
    comprimento: String(dados.comprimento ?? 1),
    peso: String(kgToGrams(dados.peso ?? 0.3)), // 0.3kg default
    valorDeclarado: (Number(dados.valorDeclarado || 0)).toFixed(2),
    codigoServico: "",
    prazo: "0",
    prazoFinal: "0",
    valor: "0",
    quantidade: "1",
    logisticaReversa: "false",
    "remetente[logradouro]": remetente.logradouro,
    "remetente[cep]": remetente.cep,
    "remetente[cidade]": remetente.cidade,
    "remetente[bairro]": remetente.bairro,
    "remetente[uf]": remetente.uf,
    "remetente[complemento]": "",
    "destinatario[logradouro]": destinatario.logradouro,
    "destinatario[cep]": destinatario.cep,
    "destinatario[cidade]": destinatario.cidade,
    "destinatario[bairro]": destinatario.bairro,
    "destinatario[uf]": destinatario.uf,
    "destinatario[complemento]": "",
    tipoEmbalagem: "1",
    tipo: "2",
  });
  for (const s of servicos) params.append("servicos[]", s);

  // Faz a chamada ao backend usando fetch do Node (sem CORS) com o JWT da sessão
  const url = `${CALC_BACK}/preco-prazo?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Accept": "application/json, text/plain, */*",
    }
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`preco-prazo falhou (${resp.status}): ${t.slice(0,200)}`);
  }
  const json = await resp.json();
  return mapRespostaPrecoPrazo(json);
}

async function getFrete(dados) {
  let browser;
  try {
    browser = await browserConnect();
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    const jwt = await ensureLogged(page);
    const fretes = await cotarViaBackend(page, jwt, dados);
    await browser.close();
    return fretes;
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

app.get("/", (_req, res) => {
  res.send("FreteBot online (Browserless).");
});

app.post("/cotacao", async (req, res) => {
  try {
    const dados = req.body;
    const obrig = ["origem", "destino", "peso", "largura", "altura", "comprimento"];
    const faltando = obrig.filter(k => !(k in dados));
    if (faltando.length) {
      return res.status(400).json({ erro: `Campos obrigatórios ausentes: ${faltando.join(", ")}` });
    }
    const fretes = await getFrete(dados);
    res.json({ fretes });
  } catch (err) {
    console.error("Erro na cotação:", err);
    res.status(500).json({ erro: String(err.message || err) });
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

// Render usa a variável de ambiente PORT. Mantemos 10000 como default.
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
