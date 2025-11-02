import fs from 'fs';

const CACHE_FILE = process.env.TOKEN_CACHE || './.token_cache.json';

export function readValidToken() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const { token, exp } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (!token || !exp) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now >= exp) return null;
    return token;
  } catch {
    return null;
  }
}

export function saveToken(token, ttlSeconds=3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ token, exp })); } catch {}
}
