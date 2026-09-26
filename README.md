# mahesh_fs

<img src="public/logo.jpg" alt="mahesh_fs logo" width="72" height="72" />

Send files and text, get a **one-time code**, and let the receiver enter that code to
download everything. Files are stored on a pluggable backend: **local disk** (default)
or **your Google Drive**.

Built as a **zero-dependency** Node.js server (Node 18+). No `npm install` needed —
it uses only built-in modules (`http`, `crypto`, global `fetch`/`FormData`/`Response`).

Features:
- **Encrypted at rest** — every file is AES-256-GCM encrypted before it's written to disk
  or uploaded to Drive, and decrypted only when a verified receiver downloads it.
- **Per-file + total size limits** — default 15 MB per file, 60 MB per share.
- **Auto-expiry** — shares self-delete after 24h (files + metadata + their Drive folder).
- **Per-share folder** — each share's files go into their own subfolder on Drive/disk.
- **Reserved space** — keeps a configurable amount of your Drive free (default 100 GB).

```
Sender ──uploads files+text──▶ server ──encrypts + generates──▶ CODE  (e.g. K7P2-9XQM)
                                                                  │
Receiver ──enters CODE──▶ server verifies ──▶ decrypts + streams files back
```

## Quick start (local disk)

```bash
npm start
```

Then open http://localhost:3000

- **Send** page: add a message and/or files, click *Create share code* → you get a code.
- **Receive** page (`/r`): enter the code → download the files.

A ready-to-run `.env` was created for you with a strong `APP_SECRET` and the `local`
backend. Uploaded files live under `data/blobs/`, metadata in `data/metadata.json`.
Shares auto-expire after `SHARE_TTL_HOURS` (default 24h) and are swept from disk.

## Switch to Google Drive ("use my Drive to store everything")

All files upload into a folder in **your** Google Drive using an OAuth refresh token.

1. **Create OAuth credentials**
   - Go to https://console.cloud.google.com/ → create/select a project.
   - APIs & Services → **Enable APIs** → enable **Google Drive API**.
   - APIs & Services → **OAuth consent screen** → External → add yourself as a **Test user**.
   - APIs & Services → **Credentials** → *Create Credentials* → **OAuth client ID** →
     Application type **Desktop app**.
   - Copy the **Client ID** and **Client secret**.

2. **Put them in `.env`**
   ```env
   STORAGE_BACKEND=gdrive
   GDRIVE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GDRIVE_CLIENT_SECRET=xxxx
   ```

3. **Get a refresh token** (one time)
   ```bash
   npm run gdrive-auth
   ```
   This opens a browser consent screen. Approve it, then copy the printed line into `.env`:
   ```env
   GDRIVE_REFRESH_TOKEN=1//xxxx
   ```

4. **(Optional)** set `GDRIVE_FOLDER_ID` to an existing Drive folder. If left blank, the
   app creates a folder named **`mahesh_fs uploads`** on first upload.

5. `npm start` — uploads now go to your Drive. The scope is `drive.file`, so the app can
   only see/manage files **it** creates, not the rest of your Drive.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:3000` | Used in generated links |
| `APP_SECRET` | *(generated)* | Secret for hashing codes / signing download tokens |
| `ENCRYPTION_KEY` | *(uses APP_SECRET)* | Dedicated key for at-rest file encryption |
| `STORAGE_BACKEND` | `local` | `local` or `gdrive` |
| `CODE_STYLE` | `code` | `code` (8-char, strong) or `digits` (6-digit, weaker) |
| `SHARE_TTL_HOURS` | `24` | Hours until a share expires and is deleted |
| `MAX_FILE_BYTES` | `15728640` | Max size of a single file (15 MB) |
| `MAX_UPLOAD_BYTES` | `62914560` | Max total upload size per share (60 MB) |
| `MAX_DOWNLOADS` | `0` | Max redemptions per code (`0` = unlimited until expiry) |
| `MAX_ATTEMPTS` | `10` | Verify attempts per IP per 5 min before rate-limiting |
| `DRIVE_RESERVE_BYTES` | `107374182400` | Drive space kept free for personal use (100 GB) |
| `GDRIVE_*` | — | Google Drive OAuth settings (see above) |

## How the new features work

- **Encryption:** files are encrypted with AES-256-GCM using a key derived (scrypt) from
  `ENCRYPTION_KEY` (or `APP_SECRET`). The ciphertext is what's stored; the IV + auth tag
  live in the share metadata. If you ever change the key, previously stored files can no
  longer be decrypted — keep it stable.
- **Size limits:** enforced both in the browser and on the server (`413` if exceeded).
- **Expiry:** checked on every access and swept every 15 minutes; on expiry the files, the
  per-share folder, and the metadata record are all removed.
- **Per-share folder:** on Drive, files land in `mahesh_fs uploads / share-<id>/…`; on
  local disk, in `data/blobs/share-<id>/…`. Deleting a share deletes its whole folder.
- **Reserved space (Drive only):** before each upload the app checks your Drive quota via
  the Drive API. If completing the upload would leave less than `DRIVE_RESERVE_BYTES` free,
  it refuses with `507` — so the app can use everything *except* your reserved 100 GB.

## HTTP API

- `POST /api/share` — `multipart/form-data` with `text` and repeated `files`. Returns
  `{ code, receiveUrl, expiresAt, fileCount, totalSize }`.
- `POST /api/verify` — JSON `{ code }`. Returns share view `{ id, text, files[], downloadToken }`
  or an error. Rate-limited per IP.
- `GET /api/download/:shareId/:fileId?token=…` — streams a file. Requires the short-lived
  `downloadToken` from `/api/verify`.
- `GET /api/config`, `GET /healthz` — UI config and health check.

## Security notes

- **Uploads are unauthenticated by design** ("anyone can send"). Mitigations: total size
  cap, per-IP upload rate limit, share expiry + auto-delete, and download limits.
- **Codes are never stored in plaintext** — only an HMAC (`APP_SECRET`) is kept, used both
  as a lookup index and verifier. The default `code` style has ~40 bits of entropy, strong
  enough to be the sole secret. `digits` (6-digit) is weaker; it relies on rate limiting.
- **Downloads** require a signed, short-lived (10 min) token issued after code verification;
  files in Drive stay private (served through the app, never made public).
- Set a unique `APP_SECRET` and run behind HTTPS (a reverse proxy like Caddy/Nginx) in
  production. `X-Forwarded-For` is honored for client IP when proxied.

## Deploying

This is a **long-running, stateful HTTP server**: it keeps share metadata in a JSON file
on the local filesystem (`data/`), runs a `setInterval` sweep to auto-delete expired
shares, and holds the rate-limit counters in memory. Pick a host that runs it as a
persistent process with a writable disk.

**Recommended hosts (run it as-is):** Render, Railway, Fly.io, a VPS, or any container
platform. Just run `node server.js`, set the environment variables, and put HTTPS in
front (the platform's TLS, or Caddy/Nginx as a reverse proxy).

Steps:
1. Push to GitHub (the `.env` file is git-ignored — never commit it).
2. Create the service from the repo. Start command: `node server.js` (or `npm start`).
3. Add the environment variables from `.env.example` in the host's dashboard — including
   `APP_SECRET`, `ENCRYPTION_KEY`, and the `GDRIVE_*` values. Set `STORAGE_BACKEND=gdrive`.
4. Set `BASE_URL` to your public HTTPS URL (e.g. `https://mahesh-fs.onrender.com`).
5. If the host's disk is **ephemeral** (wiped on redeploy), use `STORAGE_BACKEND=gdrive`
   so the *files* live in Drive. Note the metadata JSON in `data/` is still local — for
   durable multi-instance metadata you'd move it to a database (see Limitations).

> **⚠️ Vercel / Netlify (serverless) won't run this as-is.** Serverless functions are
> stateless and short-lived: there is no persistent local disk (so `data/metadata.json`
> and `data/blobs` don't survive), background `setInterval` timers don't run, and
> in-memory rate limiting resets on every cold start. To deploy on Vercel you'd need to
> refactor: move metadata to a managed database (e.g. Vercel KV/Postgres, Upstash Redis),
> store all blobs in Drive (not local disk), replace the sweep with a scheduled Cron
> job, and move rate limiting to a shared store. If you don't want that refactor, use one
> of the persistent hosts above instead.



- Single-instance: metadata is a JSON file and rate limiting is in-memory. For scale, move
  metadata to a database and rate limiting to a shared store.
- Uploads are buffered in memory (bounded by `MAX_UPLOAD_BYTES`). For very large files,
  switch to streaming/resumable uploads.
- Consider virus scanning and abuse reporting before exposing publicly.

## Project layout

```
server.js            HTTP server + routing
lib/
  config.js          env/.env loading
  util.js            code generation, hashing, helpers
  store.js           JSON metadata store (atomic writes)
  shares.js          create / verify / download-token / expiry logic
  ratelimit.js       in-memory rate limiter
  storage/
    index.js         backend selector
    local.js         local disk backend
    gdrive.js        Google Drive backend (built-in fetch)
public/              sender + receiver UI (static)
scripts/gdrive-auth.js  one-time OAuth refresh-token helper
```
