
let last = 0;
const MIN_INTERVAL = 400; // ms

export async function throttle() {
  const now = Date.now();
  const delta = now - last;
  if (delta < MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL - delta));
  }
  last = Date.now();
}

export function ipRateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map(); // ip -> { count, ts }
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const rec = hits.get(ip) || { count: 0, ts: now };
    if (now - rec.ts > windowMs) { rec.count = 0; rec.ts = now; }
    rec.count += 1;
    hits.set(ip, rec);
    if (rec.count > max) {
      return res.status(429).json({ ok:false, error: "Too Many Requests" });
    }
    next();
  };
}
