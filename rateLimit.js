let last = 0;
const MIN_INTERVAL = 1000;

export async function throttle() {
  const now = Date.now();
  const delta = now - last;
  if (delta < MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL - delta));
  }
  last = Date.now();
}
