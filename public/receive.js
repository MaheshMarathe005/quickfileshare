const $ = (s) => document.querySelector(s);
let current = null; // { id, files, downloadToken }

function humanSize(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let n = b, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fileUrl(f) {
  return `/api/download/${encodeURIComponent(current.id)}/${encodeURIComponent(f.id)}?token=${encodeURIComponent(current.downloadToken)}`;
}

async function unlock() {
  const btn = $('#unlockBtn');
  const code = $('#codeInput').value.trim();
  if (!code) { $('#err').textContent = 'Enter the code first.'; return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Checking…';
  $('#err').textContent = '';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not unlock');
    current = data;
    render();
  } catch (e) {
    $('#err').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock files';
  }
}

function render() {
  $('#enter').hidden = true;
  $('#files').hidden = false;

  if (current.text && current.text.trim()) {
    $('#messageWrap').hidden = false;
    $('#messageOut').textContent = current.text;
  }

  const list = $('#recvList');
  list.innerHTML = '';
  for (const f of current.files) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = f.name;
    const right = document.createElement('span');
    right.style.display = 'flex'; right.style.alignItems = 'center'; right.style.gap = '10px';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = humanSize(f.size);
    const a = document.createElement('a');
    a.className = 'dl';
    a.textContent = '⬇ Download';
    a.href = fileUrl(f);
    a.setAttribute('download', f.name);
    right.append(meta, a);
    li.append(left, right);
    list.append(li);
  }
  $('#dlAll').style.display = current.files.length ? '' : 'none';
}

function downloadAll() {
  // Trigger each file download sequentially via hidden iframes.
  current.files.forEach((f, i) => {
    setTimeout(() => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = fileUrl(f);
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 60_000);
    }, i * 400);
  });
}

$('#unlockBtn').addEventListener('click', unlock);
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
$('#dlAll').addEventListener('click', downloadAll);
$('#another').addEventListener('click', () => location.reload());

// Optional convenience: prefill from ?code= or #code (reduces two-channel security).
const pre = new URLSearchParams(location.search).get('code') || location.hash.slice(1);
if (pre) { $('#codeInput').value = decodeURIComponent(pre); }
