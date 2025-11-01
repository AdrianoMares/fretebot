
import fs from 'fs';
import Redis from 'ioredis';

const TOKEN_FILE = '.token.json';
const redisUrl = process.env.REDIS_URL;
const redisPrefix = process.env.REDIS_PREFIX || 'fretebot:';
let redis = null;
if (redisUrl) {
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (e) => console.error('Redis tokenCache error:', e.message));
}

export async function saveToken(token, expSeconds) {
  const expAt = Date.now() + expSeconds * 1000;
  const payload = JSON.stringify({ token, expAt });
  if (redis) {
    try {
      await redis.setex(`${redisPrefix}token`, expSeconds, payload);
      return;
    } catch (e) {
      console.warn('Redis saveToken falhou, fallback para arquivo:', e.message);
    }
  }
  fs.writeFileSync(TOKEN_FILE, payload, 'utf-8');
}

export async function readValidToken() {
  try {
    if (redis) {
      const raw = await redis.get(`${redisPrefix}token`);
      if (raw) {
        const data = JSON.parse(raw);
        if (Date.now() < data.expAt - 30000) return data.token;
        return null;
      }
    }
  } catch (e) {
    console.warn('Redis readValidToken falhou, fallback para arquivo:', e.message);
  }
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    if (Date.now() < data.expAt - 30000) return data.token;
    return null;
  } catch {
    return null;
  }
}
