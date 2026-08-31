export function toast(msg, ms = 1800) {
  let host = document.getElementById('pc-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pc-toast';
    host.className = 'pc-toast';
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.classList.add('pc-toast--show');
  clearTimeout(host._timer);
  host._timer = setTimeout(() => host.classList.remove('pc-toast--show'), ms);
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}

export async function copyText(text) {
  if (navigator && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

export function showDetail(node) {
  let overlay = document.getElementById('pc-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pc-detail-overlay';
    overlay.className = 'pc-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideDetail(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '';
  overlay.appendChild(node);
  overlay.classList.add('pc-overlay--show');
}

export function hideDetail() {
  const overlay = document.getElementById('pc-detail-overlay');
  if (overlay) overlay.classList.remove('pc-overlay--show');
}