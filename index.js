import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import Redis from "ioredis";
import fetch from "node-fetch";
import rateLimit from "./rateLimit.js";
import config from "./config.json" assert { type: "json" };

const app = express();
app.use(express.json());
app.use(helmet());
app.use(compression());
app.use(cors({ origin: ["https://freteaz.com.br", "https://www.freteaz.com.br"], methods: ["POST"] }));

const redis = new Redis(process.env.REDIS_URL);

// --- Endpoint público otimizado ---
app.post("/api/public/quote", rateLimit, async (req, res) => {
  const { cepOrigem, cepDestino, peso } = req.body;
  if (!cepOrigem || !cepDestino || !peso) {
    return res.status(400).json({ error: "Parâmetros obrigatórios ausentes." });
  }

  const cacheKey = `quote:${cepOrigem}:${cepDestino}:${peso}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("🟢 Cache HIT:", cacheKey);
      return res.json(JSON.parse(cached));
    }

    const response = await fetch(`${process.env.BACK_BASE}/api/cotacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cepOrigem, cepDestino, peso }),
    });

    const data = await response.json();
    const safeData = Array.isArray(data)
      ? data.map(r => ({ servico: r.servico, prazo: r.prazo, valor: r.valor_frete }))
      : [];

    await redis.set(cacheKey, JSON.stringify(safeData), "EX", 300);
    console.log("🟡 Cache SET:", cacheKey);
    res.json(safeData);
  } catch (err) {
    console.error("❌ Erro ao consultar frete:", err.message);
    res.status(500).json({ error: "Falha na consulta de frete." });
  }
});

// --- Healthcheck ---
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor FreteAZ ativo na porta ${PORT}`));
