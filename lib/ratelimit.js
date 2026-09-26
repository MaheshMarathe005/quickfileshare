// Tiny in-memory rate limiter (fixed window). Per-process only; for multi-instance
// deployments put a shared limiter (e.g. Redis) in front. Good enough to blunt abuse.
const buckets = new Map(); // key -> { count, resetAt }

// Returns { ok, remaining, retryAfter(ms) }.
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  const ok = b.count <= limit;
  return { ok, remaining: Math.max(0, limit - b.count), retryAfter: ok ? 0 : b.resetAt - now };
}

// Periodic cleanup so the map does not grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000).unref();
