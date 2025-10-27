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
const POSTAJA_EMAIL = process.env.POSTAJA_EMAIL;
const POSTAJA_SENHA = process.env.POSTAJA_SENHA;

const LOGIN_URL = "https://clubepostaja.com.br/home";
const CALC_URL = "https://clubepostaja.com.br/calculadora";
const RESULT_URL = "https://clubepostaja.com.br/calculadora-completa";

const TAXAS = { "SEDEX": 10.5, "PAC": 10.5, "Pac Mini": 10.5, "Jadlog": 70 };
function aplicarTaxa(servico, valor) {
  const taxa = TAXAS[servico] || 0;
  return Number((valor * (1 + taxa / 100)).toFixed(2));
}

let cachedCookies = null;
let lastLoginAt = 0;
const LOGIN_TTL_MS = 1000 * 60 * 30;

async function connectBrowser() {
  if (!BROWSERLESS_TOKEN) throw new Error("BROWSERLESS_TOKEN não configurado");
  return puppeteer.connect({ browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_TOKEN}` });
}

async function newPageWithCookies(browser) {
  const page = await browser.newPage();
  if (cachedCookies && Date.now() - lastLoginAt < LOGIN_TTL_MS) {
    try { await page.setCookie(...cachedCookies); } catch {}
  }
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

async function ensureLogged(page) {
  try {
    await page.goto("https://clubepostaja.com.br/home", { waitUntil: "networkidle2" });
    const hasSidebar = await page.$x("//a[contains(., 'Calculadora')]");
    if (hasSidebar && hasSidebar.length > 0) return true;
  } catch {}
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });
  const emailSelectors = ["input#email","input[name='email']","input[type='email']","input[placeholder*='e-mail' i]","input[placeholder*='email' i]"];
  const senhaSelectors = ["input#password","input[name='password']","input[type='password']","input[placeholder*='senha' i]"];
  async function typeFirst(list, value) {
    for (const sel of list) { const el = await page.$(sel); if (el) { await page.click(sel,{clickCount:3}); await page.type(sel, value, {delay:20}); return true; } }
    if (list === emailSelectors) {
      const [x] = await page.$x("//input[contains(translate(@placeholder,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'email')]");
      if (x) { await x.click({clickCount:3}); await x.type(value, {delay:20}); return true; }
    } else {
      const [x] = await page.$x("//input[@type='password' or contains(translate(@placeholder,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'senha')]");
      if (x) { await x.click({clickCount:3}); await x.type(value, {delay:20}); return true; }
    }
    return false;
  }
  const okEmail = await typeFirst(emailSelectors, POSTAJA_EMAIL || "");
  const okSenha = await typeFirst(senhaSelectors, POSTAJA_SENHA || "");
  if (!okEmail || !okSenha) throw new Error("Campos de login não encontrados.");
  const [btn] = await page.$x("//button[contains(., 'ACESSAR')]");
  if (btn) await btn.click(); else { const generic = await page.$("button[type='submit'], button"); if (!generic) throw new Error("Botão ACESSAR não encontrado."); await generic.click(); }
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  const sidebar = await page.$x("//a[contains(., 'Calculadora')]");
  if (!sidebar || sidebar.length === 0) throw new Error("Falha no login");
  try { cachedCookies = await page.cookies(); lastLoginAt = Date.now(); } catch {}
  return true;
}

async function preencherCalculadora(page, dados) {
  await page.goto(CALC_URL, { waitUntil: "networkidle2" });
  async function setByLabelLike(labelText, value) {
    if (value === undefined || value === null) return;
    let el = await page.$(`input[placeholder*='${labelText}' i]`);
    if (!el) {
      const [inp] = await page.$x(`//label[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${labelText.toLowerCase()}')]/following::input[1]`);
      if (inp) el = inp;
    }
    if (!el) {
      const [any] = await page.$x("//button[contains(., 'CALCULAR FRETE')]/preceding::input[1]");
      if (any) el = any;
    }
    if (!el) throw new Error(`Campo '${labelText}' não encontrado.`);
    try { await el.click({clickCount:3}); } catch {}
    await el.type(String(value), { delay: 10 });
  }
  await setByLabelLike("CEP de origem", dados.origem);
  await setByLabelLike("CEP de destino", dados.destino);
  await setByLabelLike("Altura", dados.altura);
  await setByLabelLike("Largura", dados.largura);
  await setByLabelLike("Compr", dados.comprimento);
  await setByLabelLike("Peso", Math.round((Number(dados.peso) || 0) * 1000));
  await setByLabelLike("Valor declarado", dados.valorDeclarado || 0);
  const [btnCalc] = await page.$x("//button[contains(., 'CALCULAR FRETE')]");
  if (!btnCalc) throw new Error("Botão CALCULAR FRETE não encontrado.");
  await Promise.all([btnCalc.click(), page.waitForNavigation({ waitUntil: "networkidle2" })]);
  if (!page.url().includes("/calculadora-completa")) await page.goto(RESULT_URL, { waitUntil: "networkidle2" });
}

function normalizarServico(nome) {
  const n = (nome || "").toLowerCase();
  if (n.includes("sedex")) return "SEDEX";
  if (n.includes("pac") && !n.includes("mini")) return "PAC";
  if (n.includes("mini")) return "Pac Mini";
  if (n.includes("jadlog")) return "Jadlog";
  return nome?.trim() || "Outro";
}

async function extrairResultados(page) {
  const itens = await page.evaluate(() => {
    function parsePreco(txt){ if(!txt) return null; const m = txt.replace(/\./g,'').match(/R\$\s*([\d,]+)/); if(!m) return null; return Number(m[1].replace(',','.')); }
    function limpar(t){ return (t||'').replace(/\s+/g,' ').trim(); }
    const results=[];
    const candidates = Array.from(document.querySelectorAll('div,section,article')).filter(el => /R\$\s*\d/.test(el.textContent||''));
    for (const el of candidates){
      let service='';
      const img = el.querySelector('img[alt]');
      if (img && img.alt && img.alt.length<=40) service = img.alt;
      if(!service){ const t=(el.querySelector('h3,h4,h5,strong,b')||el).textContent; service=limpar(t); }
      const prazoEl = Array.from(el.querySelectorAll('*')).find(n=>/dias úteis/i.test(n.textContent||''));
      const prazo = prazoEl ? limpar(prazoEl.textContent) : '';
      const preco = parsePreco(el.textContent||'');
      if (preco) results.push({servico: service, valor: preco, prazo});
    }
    const byService=new Map();
    for (const r of results){ const key=limpar(r.servico).toLowerCase(); const prev=byService.get(key); if(!prev || (r.valor && r.valor<prev.valor)) byService.set(key,r); }
    return Array.from(byService.values());
  });
  const ajustados = itens.map(i => ({ servico: normalizarServico(i.servico), valor: aplicarTaxa(normalizarServico(i.servico), i.valor||0), prazo: i.prazo||'' }));
  const preferidos = ["SEDEX","PAC","Pac Mini","Jadlog"];
  const prior = ajustados.filter(a=>preferidos.includes(a.servico)).sort((a,b)=>a.valor-b.valor);
  return prior.length ? prior : ajustados;
}

async function getFrete(dados){
  let browser;
  try{
    browser = await connectBrowser();
    const page = await newPageWithCookies(browser);
    await ensureLogged(page);
    await preencherCalculadora(page, dados);
    const fretes = await extrairResultados(page);
    await page.close();
    await browser.disconnect();
    return fretes;
  }catch(err){
    if (browser){ try{ await browser.disconnect(); }catch{} }
    throw err;
  }
}

app.get("/", (req,res)=>{ res.send("Servidor FreteBot rodando com Browserless!"); });
app.get("/healthz", (req,res)=> res.json({ok:true}) );

app.post("/cotacao", async (req,res)=>{
  try{
    const { origem, destino, peso, largura, altura, comprimento, valorDeclarado } = req.body || {};
    if (!origem || !destino) return res.status(400).json({ erro: "Campos 'origem' e 'destino' são obrigatórios." });
    const dados = { origem, destino, peso:Number(peso||0), largura:Number(largura||0), altura:Number(altura||0), comprimento:Number(comprimento||0), valorDeclarado:Number(valorDeclarado||0) };
    const fretes = await getFrete(dados);
    res.json({ fretes });
  }catch(error){
    console.error("Erro na cotação:", error);
    res.status(500).json({ erro: error?.message || "Falha ao calcular o frete" });
  }
});

app.listen(PORT, ()=>{ console.log(`Servidor rodando na porta ${PORT}`); });
