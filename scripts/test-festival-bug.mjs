// 专门验证 v4.0 修复后的两个 bug:
//   1. 贺卡屏进入后,图区应加载图片(或明确显示 fallback)
//   2. 「← 抽卡」返回按钮应能正常返回(覆盖 confirm 后)
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8080/';
const TMP = path.join(os.tmpdir(), `pc-bug-${Date.now()}`);
const CDP_PORT = 9223;
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

console.log('[bug-repro] launching chrome …');
await new Promise((resolve) => {
  const kill = spawn('taskkill', ['/F', '/IM', 'chrome.exe'], { stdio: 'ignore' });
  kill.on('exit', resolve); kill.on('error', resolve);
});
await new Promise(r => setTimeout(r, 500));
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${TMP}`,
  '--no-first-run', '--no-default-browser-check',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function waitForCDP() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('CDP not ready');
}
await waitForCDP();

const pageList = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
const page = pageList.find(t => t.type === 'page');
const wsConn = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
wsConn.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    wsConn.send(JSON.stringify({ id, method, params }));
  });
}
await new Promise(r => wsConn.addEventListener('open', r, { once: true }));

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

let passed = 0, failed = 0;
function ok(c, l) { if (c) { passed++; console.log(`✅ ${l}`); } else { failed++; console.log(`❌ ${l}`); } }

try {
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: URL_BASE });
  await new Promise(r => setTimeout(r, 3500));   // 等 ESM 完整加载
  await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);

  // 进入贺卡屏
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 800));

  // ── Bug 1: 图片应显示 ──
  // 等 Pollinations AI 出图(5s 超时)+ 浏览器渲染
  await new Promise(r => setTimeout(r, 6000));
  const imgInfo = await evaluate(`(() => {
    const media = document.querySelector('.pc-festival-screen .postcard-media');
    if (!media) return { error: 'no .postcard-media' };
    const img = media.querySelector('img');
    const fallback = media.querySelector('.postcard-media-fallback');
    return {
      hasImg: !!img,
      imgSrc: img ? img.src.slice(0, 80) : null,
      imgComplete: img ? img.complete : null,
      imgNaturalW: img ? img.naturalWidth : 0,
      imgNaturalH: img ? img.naturalHeight : 0,
      hasFallback: !!fallback,
    };
  })()`);
  console.log('[debug] image info:', JSON.stringify(imgInfo, null, 2));
  ok(imgInfo.hasImg || imgInfo.hasFallback, 'bug 1: 图区至少应渲染 img 或 fallback');
  if (imgInfo.hasImg) {
    ok(imgInfo.imgComplete === true && imgInfo.imgNaturalW > 0, `bug 1: 图片实际加载(natural ${imgInfo.imgNaturalW}x${imgInfo.imgNaturalH})`);
  }

  // ── Bug 2: 返回按钮 ──
  await evaluate(`window.alert = () => {}`);
  await evaluate(`window.confirm = () => true`);
  // 输入字段让 dirty = true
  await evaluate(`
    const r = document.getElementById('pc-f-field-recipient');
    r.value = '小王';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 200));

  // 点击返回
  const before = await evaluate(`document.getElementById('pc-festival-screen').hidden`);
  ok(before === false, 'bug 2 准备: 贺卡屏可见');
  await evaluate(`document.getElementById('pc-festival-back').click()`);
  await new Promise(r => setTimeout(r, 500));
  const after = await evaluate(`document.getElementById('pc-festival-screen').hidden`);
  ok(after === true, 'bug 2: 点击 ← 抽卡 后贺卡屏已隐藏');

  // 抽卡屏应可见
  const main = await evaluate(`!document.querySelector('.pc-main').hidden`);
  ok(main, 'bug 2: 抽卡屏恢复可见');

  // 再次进入应能正常
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 500));
  const reEnter = await evaluate(`!document.getElementById('pc-festival-screen').hidden`);
  ok(reEnter, 'bug 2: 再次点击 🎋 仍能进入贺卡屏');

} catch (e) {
  console.error('❌ 异常:', e.message);
  failed++;
} finally {
  wsConn.close();
  chrome.kill();
}
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

console.log(`\n[bug-repro] ${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);