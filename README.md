# mahesh_fs

<img src="public/logo.jpg" alt="mahesh_fs logo" width="72" height="72" />

Send files and text, get a **one-time code**, and let the receiver enter that code to
download everything. Files are stored on a pluggable backend: **local disk** (default)
or **your Google Drive**.

Built as a **zero-dependency** Node.js server (Node 18+). No `npm install` needed —
it uses only built-in modules (`http`, `crypto`, global `fetch`/`FormData`/`Response`).
Runs either as a normal long-lived server or on **Vercel** (serverless) backed by Upstash
Redis + Google Drive — still dependency-free, since Redis and Drive are reached over the
built-in `fetch`. See [Deploying](#deploying).

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
| `STORAGE_BACKEND` | `local` | Where file bytes live: `local` or `gdrive` |
| `STORE_BACKEND` | `file` | Where share records live: `file` (disk) or `redis` (Upstash) |
| `CODE_STYLE` | `code` | `code` (8-char, strong) or `digits` (6-digit, weaker) |
| `SHARE_TTL_HOURS` | `24` | Hours until a share expires and is deleted |
| `SHARE_GRACE_HOURS` | `2` | Extra hours redis metadata lingers so the cron can delete blobs |
| `MAX_FILE_BYTES` | `15728640` | Max size of a single file (15 MB) |
| `MAX_UPLOAD_BYTES` | `62914560` | Max total upload size per share (60 MB) |
| `MAX_DOWNLOADS` | `0` | Max redemptions per code (`0` = unlimited until expiry) |
| `MAX_ATTEMPTS` | `10` | Verify attempts per IP per 5 min before rate-limiting |
| `DRIVE_RESERVE_BYTES` | `107374182400` | Drive space kept free for personal use (100 GB) |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis REST URL (needed when `STORE_BACKEND=redis`) |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis REST token |
| `CRON_SECRET` | — | Bearer secret the Vercel Cron sweep must send |
| `GDRIVE_*` | — | Google Drive OAuth settings (see above) |

## How the new features work

- **Encryption:** files are encrypted with AES-256-GCM using a key derived (scrypt) from
  `ENCRYPTION_KEY` (or `APP_SECRET`). The ciphertext is what's stored; the IV + auth tag
  live in the share metadata. If you ever change the key, previously stored files can no
  longer be decrypted — keep it stable.
- **Size limits:** enforced both in the browser and on the server (`413` if exceeded).
- **Expiry:** checked on every access, and swept in the background — every 15 minutes on a
  persistent server, or by the Vercel Cron on serverless. On expiry the files, the
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

You can run mahesh_fs two ways — pick based on the file sizes you need.

### Option A — Persistent server (recommended; supports the full 15 MB files)

A long-lived `node server.js` process with a writable disk. Hosts: **Render, Railway,
Fly.io, a VPS**, or any container platform.

1. Push to GitHub (the `.env` file is git-ignored — never commit it).
2. Create a Web Service from the repo. Start command: `node server.js` (or `npm start`).
3. Add env vars from `.env.example`: `APP_SECRET`, `ENCRYPTION_KEY`,
   `STORAGE_BACKEND=gdrive` and the `GDRIVE_*` values. Keep `STORE_BACKEND=file` for a
   single instance (or `redis` if you run several).
4. Set `BASE_URL` to your public HTTPS URL (e.g. `https://mahesh-fs.onrender.com`).
5. Use `STORAGE_BACKEND=gdrive` so files persist even if the host disk is ephemeral.

### Option B — Vercel (serverless)

Vercel serves the static `public/` UI and runs each file in `api/` as a function. It has
**no persistent disk and no background timers**, so this repo is wired to use **Upstash
Redis** for metadata + rate limiting (`STORE_BACKEND=redis`), **Google Drive** for the
file bytes, and a **Vercel Cron** job (`vercel.json`) for the expiry sweep.

> **⚠️ Hard limit: Vercel functions cap the request/response body at ~4.5 MB.** Uploads
> and downloads pass *through* a function, so a full 15 MB file won't fit. For the Vercel
> deployment set `MAX_FILE_BYTES=4000000` (≈4 MB) and `MAX_UPLOAD_BYTES` to taste. If you
> need the full 15 MB, use **Option A** — the code is identical, only the host differs.
> (Confirm Vercel's current limit in their docs.)

1. Create a free **Upstash Redis** database at upstash.com and copy its **REST URL** +
   **REST token**. (Or add Upstash from the Vercel Marketplace, which injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` — both names are read automatically.)
2. Push this repo to GitHub, then **Import Project** in Vercel (framework preset: *Other*).
3. In Vercel → Settings → Environment Variables add: `APP_SECRET`, `ENCRYPTION_KEY`,
   `STORE_BACKEND=redis`, `STORAGE_BACKEND=gdrive`, `GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`,
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET` (any long random
   string), `MAX_FILE_BYTES=4000000`, and `BASE_URL=https://<your-app>.vercel.app`.
4. Deploy. `vercel.json` registers `GET /api/cron/sweep` (protected by `CRON_SECRET`) as a
   daily cron. Hobby runs crons once/day; on Pro edit `schedule` (e.g. `0 * * * *` hourly).
   Access is blocked exactly at expiry regardless — verify/download re-check `expiresAt`;
   the cron only garbage-collects the Drive files afterwards.
5. `maxDuration` is 60s in `vercel.json`; lower it if your plan rejects that value.

## Limitations & next steps

- The `redis` store updates the download counter with a read-modify-write, not atomically
  — fine at low contention; use `INCR` on a field for heavy concurrent use.
- Uploads are buffered in memory (bounded by `MAX_UPLOAD_BYTES`). For very large files,
  switch to streaming/resumable, direct-to-storage transfers.
- Consider virus scanning and abuse reporting before exposing publicly.

## Project layout

```
server.js              persistent HTTP server (local dev + Option A hosts)
vercel.json            Vercel routing, function maxDuration, cron schedule
api/                   Vercel serverless functions (Option B)
  config.js  healthz.js  share.js  verify.js
  download/[shareId]/[fileId].js
  cron/sweep.js        expiry sweep, triggered by Vercel Cron
lib/
  config.js            env/.env loading
  util.js              code generation, hashing, helpers
  crypto.js            AES-256-GCM at-rest encryption
  handlers.js          transport-agnostic request logic (shared by server + api)
  http-helpers.js      security headers, body reading, JSON replies
  redis.js             Upstash Redis REST client (zero-dep)
  shares.js            create / verify / download-token / expiry logic
  store/               metadata store: index.js selector, file.js, redis.js
  ratelimit/           rate limiter: index.js selector, memory.js, redis.js
  storage/             blob store: index.js selector, local.js, gdrive.js
public/                sender + receiver UI (static)
scripts/gdrive-auth.js one-time OAuth refresh-token helper
```
