import express from "express";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import Bottleneck from "bottleneck";
import jwt_decode from "jsonwebtoken";

const PORT = process.env.PORT || 10000;
const BACK_BASE = process.env.BACK_BASE || "https://back.clubepostaja.com.br";
const USUARIO = process.env.POSTA_USUARIO || process.env.POSTA_USER || "";
const SENHA = process.env.POSTA_SENHA || process.env.POSTA_PASS || "";
const TOKEN_PATH = path.join(process.cwd(), "local-cache", "token.json");

await fs.ensureDir(path.join(process.cwd(), "local-cache"));

const limiter = new Bottleneck({
  minTime: 1000, // 1 request per second
  maxConcurrent: 1,
});

const app = express();
app.use(express.json());

function log(...args){ console.log(...args); }

async function saveToken(token, expiresAt){
  const obj = { token, obtained_at: Date.now(), expires_at: expiresAt };
  await fs.writeJson(TOKEN_PATH, obj, { spaces: 2 });
}

async function readToken(){
  try{
    const obj = await fs.readJson(TOKEN_PATH);
    return obj;
  }catch(e){
    return null;
  }
}

function tokenExpired(obj){
  if(!obj) return true;
  if(!obj.expires_at) return false;
  return Date.now() > obj.expires_at - 5*1000; // 5s leeway
}

async function doLogin(){
  if(!USUARIO || !SENHA){
    throw new Error("POSTA_USUARIO or POSTA_SENHA env vars not set");
  }
  log("Logging in via HTTP to", BACK_BASE + "/auth/login");
  const payload = { usuario: USUARIO, senha: SENHA };
  const resp = await axios.post(`${BACK_BASE}/auth/login`, payload, {
    headers: { "Content-Type": "application/json", "Origin": "https://clubepostaja.com.br" },
    timeout: 30000,
  });
  const data = resp.data || {};
  const token = data.token || data.accessToken || data.jwt || data?.data?.token;
  if(!token) throw new Error("Login succeeded but no token found in response: " + JSON.stringify(data).slice(0,200));
  // try to decode exp
  let expiresAt = null;
  try{
    const decoded = jwt_decode.decode(token);
    if(decoded && decoded.exp){
      expiresAt = decoded.exp * 1000;
    } else if(data.expiresIn){
      expiresAt = Date.now() + (Number(data.expiresIn) * 1000);
    } else {
      // default 1 hour
      expiresAt = Date.now() + 60*60*1000;
    }
  }catch(e){
    expiresAt = Date.now() + 60*60*1000;
  }
  await saveToken(token, expiresAt);
  return token;
}

async function getToken(){
  const cached = await readToken();
  if(cached && !tokenExpired(cached)) return cached.token;
  // else login
  const token = await doLogin();
  return token;
}

async function apiGet(pathUrl, params={}, retry=true){
  return limiter.schedule(async ()=>{
    const token = await getToken();
    try{
      const resp = await axios.get(`${BACK_BASE}${pathUrl}`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      });
      return resp.data;
    }catch(err){
      if(err.response && err.response.status === 401 && retry){
        // maybe token expired, force login and retry once
        await doLogin();
        return apiGet(pathUrl, params, false);
      }
      throw err;
    }
  });
}

// Convert incoming request to /preco-prazo params expected by PostaJá
function buildPrecoParams(body){
  const params = {
    cepOrigem: body.origem?.replace(/\D/g,'') ? body.origem.replace(/\D/g,'') : body.origem,
    cepDestino: body.destino?.replace(/\D/g,'') ? body.destino.replace(/\D/g,'') : body.destino,
    altura: body.altura ?? 1,
    largura: body.largura ?? 1,
    comprimento: body.comprimento ?? 1,
    peso: body.peso ?? 0.1,
    valorDeclarado: (body.valorDeclarado ?? 0).toFixed(2),
    quantidade: body.quantidade ?? 1,
    logisticaReversa: body.logisticaReversa ?? false,
    tipoEmbalagem: body.tipoEmbalagem ?? 1,
    tipo: body.tipo ?? 2,
  };
  // If remetente/destinatario provided copy fields
  if(body.remetente) {
    for(const k of ["logradouro","cep","cidade","bairro","uf","complemento"]){
      if(body.remetente[k] !== undefined) params[`remetente[${k}]`] = body.remetente[k];
    }
  }
  if(body.destinatarioData || body.destinatario) {
    const d = body.destinatarioData ?? body.destinatario;
    for(const k of ["logradouro","cep","cidade","bairro","uf","complemento"]){
      if(d[k] !== undefined) params[`destinatario[${k}]`] = d[k];
    }
  }
  if(Array.isArray(body.servicos)){
    for(const s of body.servicos) params["servicos[]"] = body.servicos;
  }
  return params;
}

function normalizeServiceItem(item){
  const serv = item.nome || item.nomeServico || item.servico || item.title || item.service || item.name;
  const valorStr = item.valor || item.preco || item.price || item.valorServico || item.vl || item.value;
  const prazo = item.prazo || item.tempo || item.prazoEntrega || item.deliveryTime || item.days;
  let valor = null;
  if(typeof valorStr === "number") valor = valorStr;
  else if(typeof valorStr === "string"){
    const m = valorStr.match(/[\d\.,]+/);
    if(m) valor = parseFloat(m[0].replace(/\./g,"").replace(",", "."));
  }
  return {
    servico: serv ?? item.title ?? item.name ?? "unknown",
    valor: valor,
    prazo: prazo ?? null,
    raw: item
  };
}

app.post("/cotacao", async (req, res) => {
  try{
    log("🚚 Iniciando cotação...");
    const body = req.body || {};
    const params = buildPrecoParams(body);
    log("🔐 Using BACK_BASE:", BACK_BASE);
    const data = await apiGet("/preco-prazo", params);
    let services = [];
    if(Array.isArray(data)) services = data;
    else if(Array.isArray(data.servicos)) services = data.servicos;
    else if(Array.isArray(data.data)) services = data.data;
    else if(data.result && Array.isArray(data.result)) services = data.result;
    else {
      for(const k of Object.keys(data||{})){
        if(Array.isArray(data[k])) { services = data[k]; break; }
      }
    }
    const normalized = services.map(normalizeServiceItem);
    if(normalized.length === 0){
      return res.json({ ok: true, raw: data });
    }
    const list = normalized.map(s => ({ servico: s.servico, valor: s.valor, prazo: s.prazo }));
    const cheapest = list.filter(x=>x.valor!=null).sort((a,b)=>a.valor-b.valor)[0] ?? null;
    return res.json({ ok: true, cheapest, list });
  }catch(err){
    console.error("❌ Erro na cotação:", err.message || err);
    if(err.response){
      console.error("status:", err.response.status, "data:", JSON.stringify(err.response.data).slice(0,400));
      return res.status(err.response.status).json({ ok:false, error: err.message, status: err.response.status, data: err.response.data });
    }
    return res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

app.get("/health", (req,res)=> res.json({ ok:true }));

app.listen(PORT, ()=>{
  console.log("Servidor rodando na porta", PORT);
  console.log("Available at your primary URL", process.env.PRIMARY_URL || "");
});
