let last = 0;
export async function throttle(minIntervalMs = 250) {
  const now = Date.now();
  const delta = now - last;
  if (delta < minIntervalMs) {
    await new Promise(r => setTimeout(r, minIntervalMs - delta));
  }
  last = Date.now();
}
