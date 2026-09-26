// Google Drive storage backend. Uploads into a per-share subfolder inside a root
// app folder in the OWNER's Drive, using an OAuth2 refresh token. Enforces a
// reserved-space policy so the app never fills beyond (quota - reserve).
// Uses only Node built-in fetch — no googleapis dependency.
import { config } from '../config.js';
import { sanitizeFilename } from '../util.js';

export const name = 'gdrive';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let cachedToken = null;    // { accessToken, expiresAt }
let cachedRootId = null;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.accessToken;
  const g = config.gdrive;
  if (!g.clientId || !g.clientSecret || !g.refreshToken) {
    throw new Error('Google Drive is not configured. Set GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN (run `npm run gdrive-auth`).');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId, client_secret: g.clientSecret,
      refresh_token: g.refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function api(url, opts = {}) {
  const token = await getAccessToken();
  return fetch(url, { ...opts, headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
}

async function createFolder(nameStr, parentId) {
  const meta = { name: nameStr, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  const res = await api(`${API}/files?fields=id`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta),
  });
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function ensureRoot() {
  if (config.gdrive.folderId) return config.gdrive.folderId;
  if (cachedRootId) return cachedRootId;
  const q = encodeURIComponent(`name='mahesh_fs uploads' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const found = await api(`${API}/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.ok) {
    const data = await found.json();
    if (data.files?.length) { cachedRootId = data.files[0].id; return cachedRootId; }
  }
  cachedRootId = await createFolder('mahesh_fs uploads', null);
  return cachedRootId;
}

export async function init() {
  await getAccessToken();   // fail fast on bad credentials
}

// Reject the upload if it would eat into the reserved free space.
export async function assertCapacity(bytesNeeded, reserveBytes) {
  const res = await api(`${API}/about?fields=storageQuota`);
  if (!res.ok) throw new Error(`Drive quota check failed: ${res.status} ${await res.text()}`);
  const q = (await res.json()).storageQuota || {};
  if (q.limit == null) return; // unlimited (e.g. some Workspace plans)
  const available = Number(q.limit) - Number(q.usage);
  if (available - bytesNeeded < reserveBytes) {
    const err = new Error('Storage is full: the owner-reserved space would be used up. Try a smaller file later.');
    err.status = 507;
    throw err;
  }
}

export async function createContainer(label) {
  const root = await ensureRoot();
  const folderId = await createFolder(sanitizeFilename(label), root);
  return { folderId };
}

export async function put({ filename, mime, buffer, container }) {
  const parent = container?.folderId || await ensureRoot();
  const boundary = 'mahfsb' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: sanitizeFilename(filename), parents: [parent] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, buffer, tail]),
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return { fileId: (await res.json()).id };
}

export async function get(ref) {
  const res = await api(`${API}/files/${encodeURIComponent(ref.fileId)}?alt=media`);
  if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function remove(ref) {
  const res = await api(`${API}/files/${encodeURIComponent(ref.fileId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed: ${res.status} ${await res.text()}`);
}

export async function removeContainer(container) {
  if (!container?.folderId) return;
  const res = await api(`${API}/files/${encodeURIComponent(container.folderId)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Drive folder delete failed: ${res.status} ${await res.text()}`);
}
