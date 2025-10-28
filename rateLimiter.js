// Minimal 1-req-per-interval limiter
export function createRateLimiter(minIntervalMs = 1000) {
  let last = 0;
  let queue = Promise.resolve();

  async function schedule(fn) {
    queue = queue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, minIntervalMs - (now - last));
      if (wait) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    return queue;
  }

  return { schedule };
}
