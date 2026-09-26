// Minimal Upstash Redis client over its REST API — zero dependencies (built-in fetch).
// Upstash exposes every Redis command as a JSON POST, which lets us keep the whole app
// dependency-free while still using a shared, durable store on serverless (Vercel).
//   Single command:  POST <url>            body: ["SET","k","v"]        -> { result }
//   Pipeline:        POST <url>/pipeline   body: [["INCR","k"],["PTTL","k"]] -> [{result}|{error}]
import { config } from './config.js';

function creds() {
  const { url, token } = config.redis;
  if (!url || !token) {
    throw new Error('Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
  return { url, token };
}

// Run one Redis command. `args` is the command as an array, e.g. ["GET","share:abc"].
export async function redis(args) {
  const { url, token } = creds();
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Redis ${args[0]} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`Redis ${args[0]} error: ${json.error}`);
  return json.result;
}

// Run several commands in one round-trip. Returns an array of results (throws on any error).
export async function redisPipeline(commands) {
  if (!commands.length) return [];
  const { url, token } = creds();
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline failed: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  return arr.map((entry, i) => {
    if (entry && entry.error) throw new Error(`Redis ${commands[i][0]} error: ${entry.error}`);
    return entry ? entry.result : null;
  });
}
