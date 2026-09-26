// In-memory fixed-window rate limiter. Per-process only — good for a single persistent
// instance. On serverless/multi-instance the counters reset per cold start, so use the
// redis limiter there instead. Async signature to match the redis backend.
const buckets = new Map(); // key -> { count, resetAt }

export async function rateLimit(key, limit, windowMs) {
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

// Periodic cleanup so the map does not grow unbounded (no-op relevance on serverless).
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000).unref();
