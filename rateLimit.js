import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

export default async function rateLimit(req, res, next) {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const key = `ratelimit:${ip}`;
    const limit = 20; // 20 req/min
    const ttl = 60;

    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, ttl);

    if (current > limit) {
      console.warn(`🚫 Rate limit atingido: ${ip}`);
      return res.status(429).json({
        error: "Limite de requisições atingido. Tente novamente em 1 minuto."
      });
    }

    next();
  } catch (err) {
    console.error("Erro no rateLimit:", err.message);
    next();
  }
}
