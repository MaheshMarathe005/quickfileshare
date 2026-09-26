// Small HTTP helpers shared by the persistent server (server.js) and the Vercel
// serverless functions (api/*). Everything here works on a plain Node req/res, which
// is what both the built-in http server and @vercel/node hand us.

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'");
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

// First hop from X-Forwarded-For when behind a proxy/CDN, else the socket address.
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Read a request stream into a Buffer, rejecting (413) if it exceeds maxBytes.
export function readStreamBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Get the raw request body as a Buffer, coping with whatever @vercel/node already did:
// it may leave req.body as a Buffer/string, a parsed object (JSON), or untouched stream.
export async function readRawBody(req, maxBytes) {
  const b = req.body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') return Buffer.from(b);
  if (b && typeof b === 'object') return Buffer.from(JSON.stringify(b));
  return readStreamBody(req, maxBytes);
}
