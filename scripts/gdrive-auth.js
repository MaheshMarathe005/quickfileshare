// One-time helper to obtain a Google Drive OAuth refresh token.
// Prereqs: create an OAuth 2.0 Client (type: Desktop app) in Google Cloud Console,
// enable the Google Drive API, then put the client id/secret in .env, and run:
//   npm run gdrive-auth
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { config } from '../lib/config.js';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/`;
// drive.file = access only to files this app creates. Least-privilege for this tool.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const { clientId, clientSecret } = config.gdrive;
if (!clientId || !clientSecret) {
  console.error('\nMissing GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET.');
  console.error('Add them to your .env first (from Google Cloud Console > Credentials).\n');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  state,
});

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  const code = url.searchParams.get('code');
  const gotState = url.searchParams.get('state');
  const done = (msg) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<h2>${msg}</h2><p>You can close this tab and return to the terminal.</p>`); };

  if (url.searchParams.get('error')) { done('Authorization denied.'); console.error('Denied:', url.searchParams.get('error')); server.close(); process.exit(1); }
  if (!code) { res.writeHead(400).end('missing code'); return; }
  if (gotState !== state) { done('State mismatch — aborting.'); console.error('State mismatch'); server.close(); process.exit(1); }

  try {
    const tokens = await exchange(code);
    done('Success! Refresh token captured.');
    console.log('\n=== Google Drive authorized ===');
    if (tokens.refresh_token) {
      console.log('\nAdd this line to your .env:\n');
      console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } else {
      console.log('\nNo refresh_token returned. Remove the app from');
      console.log('https://myaccount.google.com/permissions and run again (needs prompt=consent).\n');
    }
  } catch (e) {
    done('Error exchanging code — see terminal.');
    console.error(e.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('\nOpen this URL in your browser to authorize:\n');
  console.log(authUrl + '\n');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} "${authUrl}"`, () => {});
  console.log(`Waiting for the Google redirect on ${REDIRECT} ...`);
});
