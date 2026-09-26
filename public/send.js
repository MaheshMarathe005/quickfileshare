const $ = (s) => document.querySelector(s);
const files = [];
let cfg = { maxFileBytes: 15728640, maxUploadBytes: 62914560, shareTtlHours: 24 };

function humanSize(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = b, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Fetch + parse JSON, but degrade gracefully when the server returns non-JSON
// (e.g. a platform/proxy error page like "The deployment could not be found."),
// so the user sees the real message instead of a cryptic JSON.parse error.
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const raw = await res.text();
  let data, parsed = true;
  try { data = raw ? JSON.parse(raw) : {}; } catch { parsed = false; }
  if (!parsed) {
    const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(snippet ? `Server: ${snippet}` : `Unexpected response (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

async function loadConfig() {
  try {
    cfg = await fetchJson('/api/config');
  } catch { /* keep defaults */ }
  const perFile = humanSize(cfg.maxFileBytes);
  $('#limitHint').textContent = `Max ${perFile} per file · ${humanSize(cfg.maxUploadBytes)} total`;
  const badgeSize = document.querySelector('#badgeSize');
  const badgeTtl = document.querySelector('#badgeTtl');
  if (badgeSize) badgeSize.textContent = `${perFile} per file`;
  if (badgeTtl) badgeTtl.textContent = `Auto-deletes in ${cfg.shareTtlHours}h`;
  const where = cfg.storageBackend === 'gdrive' ? 'the owner’s Google Drive' : 'the server';
  $('#ttlHint').textContent = `🔒 Files are AES-256 encrypted and stored on ${where}. Shares auto-delete after ${cfg.shareTtlHours}h.`;
}

function renderFiles() {
  const list = $('#fileList');
  list.innerHTML = '';
  let total = 0;
  let tooBig = null;
  files.forEach((f, i) => {
    total += f.size;
    if (f.size > cfg.maxFileBytes) tooBig = f;
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = f.name;
    const right = document.createElement('span');
    right.className = 'meta';
    right.textContent = humanSize(f.size);
    if (f.size > cfg.maxFileBytes) { right.style.color = 'var(--bad)'; }
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.onclick = () => { files.splice(i, 1); renderFiles(); };
    const wrap = document.createElement('span');
    wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '10px';
    wrap.append(right, rm);
    li.append(left, wrap);
    list.append(li);
  });
  if (tooBig) {
    $('#err').textContent = `"${tooBig.name}" is ${humanSize(tooBig.size)} — over the ${humanSize(cfg.maxFileBytes)} per-file limit.`;
  } else if (total > cfg.maxUploadBytes) {
    $('#err').textContent = `Selected ${humanSize(total)} exceeds the ${humanSize(cfg.maxUploadBytes)} total limit.`;
  } else {
    $('#err').textContent = '';
  }
}

function addFiles(fileList) {
  for (const f of fileList) files.push(f);
  renderFiles();
}

function initDropzone() {
  const drop = $('#drop'), input = $('#fileInput');
  drop.onclick = () => input.click();
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); });
}

async function submit() {
  const btn = $('#sendBtn');
  const text = $('#text').value;
  if (!text.trim() && files.length === 0) { $('#err').textContent = 'Add a file or write a message first.'; return; }

  const oversize = files.find((f) => f.size > cfg.maxFileBytes);
  if (oversize) { $('#err').textContent = `"${oversize.name}" is over the ${humanSize(cfg.maxFileBytes)} per-file limit. Remove it first.`; return; }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > cfg.maxUploadBytes) { $('#err').textContent = `Total ${humanSize(total)} exceeds the ${humanSize(cfg.maxUploadBytes)} limit.`; return; }

  const fd = new FormData();
  fd.append('text', text);
  for (const f of files) fd.append('files', f, f.name);

  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Uploading…';
  $('#err').textContent = '';
  try {
    const data = await fetchJson('/api/share', { method: 'POST', body: fd });
    showResult(data);
  } catch (e) {
    $('#err').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create share code';
  }
}

function showResult(data) {
  $('#compose').hidden = true;
  $('#result').hidden = false;
  $('#codeOut').textContent = data.code;
  const when = new Date(data.expiresAt).toLocaleString();
  $('#resultMeta').textContent = `${data.fileCount} file(s), ${humanSize(data.totalSize)} · expires ${when}`;
  $('#copyCode').onclick = () => navigator.clipboard.writeText(data.code).then(() => flash('#copyCode', 'Copied!'));
  $('#copyLink').onclick = () => navigator.clipboard.writeText(data.receiveUrl).then(() => flash('#copyLink', 'Copied!'));
}

function flash(sel, msg) {
  const el = $(sel); const old = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = old; }, 1400);
}

$('#sendBtn').addEventListener('click', submit);
$('#newShare').addEventListener('click', () => location.reload());
initDropzone();
loadConfig();
