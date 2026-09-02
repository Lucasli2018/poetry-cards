// 深度测印章点击到底发生了什么
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8080/';
const TMP = path.join(os.tmpdir(), `pc-seal-${Date.now()}`);
const CDP_PORT = 9225;
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

await new Promise((r) => { const k = spawn('taskkill', ['/F', '/IM', 'chrome.exe'], { stdio: 'ignore' }); k.on('exit', r); k.on('error', r); });
await new Promise(r => setTimeout(r, 500));
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${TMP}`, '--no-first-run'], { stdio: ['ignore', 'pipe', 'pipe'] });
async function waitCDP() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP'); }
await waitCDP();
const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find(t => t.type === 'page');
const wsConn = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
wsConn.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); } });
function send(method, params) { const id = nextId++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); wsConn.send(JSON.stringify({ id, method, params })); }); }
await new Promise(r => wsConn.addEventListener('open', r, { once: true }));
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }

await send('Page.enable', {});
await send('Page.navigate', { url: URL_BASE });
await new Promise(r => setTimeout(r, 3500));
await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);
await send('Page.reload', {});
await new Promise(r => setTimeout(r, 3500));

await evaluate(`document.getElementById('pc-festival-open').click()`);
await new Promise(r => setTimeout(r, 1000));

// 查 DOM 看 .pc-seal-chip 数量 + is-current
const sealInfo = await evaluate(`(() => {
  const chips = document.querySelectorAll('.pc-festival-screen .pc-seal-chip');
  return {
    count: chips.length,
    currentSeal: document.querySelector('.pc-festival-screen .pc-seal-chip.is-current')?.dataset?.seal,
    postCardSeal: document.querySelector('.pc-festival-screen .postcard-seal')?.textContent,
  };
})()`);
console.log('[before click]', JSON.stringify(sealInfo));

// 点击「福」chip
const clickResult = await evaluate(`(() => {
  const chip = document.querySelector('.pc-festival-screen .pc-seal-chip[data-seal="福"]');
  if (!chip) return { error: 'no chip' };
  chip.click();
  return {
    clicked: true,
    tag: chip.tagName,
    role: chip.getAttribute('role'),
    dataSeal: chip.dataset.seal,
  };
})()`);
console.log('[click]', JSON.stringify(clickResult));

await new Promise(r => setTimeout(r, 500));

const afterInfo = await evaluate(`(() => {
  const chips = document.querySelectorAll('.pc-festival-screen .pc-seal-chip');
  const current = Array.from(chips).find(c => c.classList.contains('is-current'));
  return {
    currentSeal: current?.dataset?.seal,
    postCardSeal: document.querySelector('.pc-festival-screen .postcard-seal')?.textContent,
  };
})()`);
console.log('[after click]', JSON.stringify(afterInfo));

wsConn.close(); chrome.kill();
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});