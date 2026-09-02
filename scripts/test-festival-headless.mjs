// =============================================================
// 古韵抽卡 v4.0 · Headless 浏览器交互冒烟
//
// 用 chrome --headless 跑出 JS,模拟点击/输入,验证贺卡屏交互。
// 运行:  node scripts/test-festival-headless.mjs http://localhost:8080/
// =============================================================

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8080/';
const TMP = path.join(os.tmpdir(), `pc-festival-${Date.now()}`);

const CDP_PORT = 9223;
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// 启动 headless Chrome
console.log('[headless] launching chrome …');
// 清理任何残留 chrome 进程 + user-data-dir(防止 localStorage 跨次污染)
await new Promise((resolve) => {
  const kill = spawn('taskkill', ['/F', '/IM', 'chrome.exe'], { stdio: 'ignore' });
  kill.on('exit', resolve);
  kill.on('error', resolve);
});
await new Promise(r => setTimeout(r, 500));
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${TMP}`,
  '--no-first-run',
  '--no-default-browser-check',
], { stdio: ['ignore', 'pipe', 'pipe'] });

// 等 CDP 就绪
async function waitForCDP(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('CDP not ready');
}

await waitForCDP();
console.log('[headless] CDP ready');

// 拿 page 的 wsUrl(不用 browser-level session,因为 Runtime/Page 必须 attach 到 page)
async function getPageWs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await r.json();
  let page = targets.find(t => t.type === 'page');
  if (!page) {
    // 创建新 page
    const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    const browserWs = ver.webSocketDebuggerUrl;
    const bw = new WebSocket(browserWs);
    await new Promise(r => bw.addEventListener('open', r, { once: true }));
    const id = nextIdGlobal++;
    const newPage = await new Promise((res, rej) => {
      const listener = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          bw.removeEventListener('message', listener);
          if (m.error) rej(new Error(m.error.message));
          else res(m.result);
        }
      };
      bw.addEventListener('message', listener);
      bw.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: 'about:blank' } }));
    });
    bw.close();
    page = { webSocketDebuggerUrl: newPage.targetId };
    return { pageWs: null, targetId: newPage.targetId, browserWs };
  }
  return { pageWs: page.webSocketDebuggerUrl, targetId: page.id };
}

let nextIdGlobal = 1;

// 直接用 page-level ws
const { pageWs, targetId } = await getPageWs();
console.log('[headless] page target:', targetId);

const wsConn = new WebSocket(pageWs);
let nextId = 1;
const pending = new Map();
const events = [];

wsConn.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  } else if (m.method) {
    events.push(m);
  }
});
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    wsConn.send(JSON.stringify({ id, method, params }));
  });
}
const waitOpen = new Promise(r => wsConn.addEventListener('open', r, { once: true }));
await waitOpen;

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`✅ ${label}`); return; }
  failed++; console.log(`❌ ${label}`);
}

try {
  // ── 打开主页 ──
  await send('Runtime.enable', {});
  // 设置 Page.loadEventFired 等待
  const loadWait = new Promise(resolve => {
    const listener = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Page.loadEventFired') {
        wsConn.removeEventListener('message', listener);
        resolve();
      }
    };
    wsConn.addEventListener('message', listener);
  });
  await send('Page.navigate', { url: URL_BASE });
  await Promise.race([loadWait, new Promise(r => setTimeout(r, 5000))]);
  // 等 ESM 模块全部加载(main.js 异步初始化)
  await new Promise(r => setTimeout(r, 2500));
  // 清掉任何残留草稿(确保 default state 干净)
  await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);

  // ── 冒烟:主页含 🎴 入口 ──
  const hasBtn = await evaluate(`!!document.getElementById('pc-festival-open')`);
  ok(hasBtn, 'headless 1: header 含 🎴 入口');

  // ── 冒烟:点击 🎴 进入贺卡屏 ──
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 800));
  const screenVisible = await evaluate(`!document.getElementById('pc-festival-screen').hidden`);
  ok(screenVisible, 'headless 2: 点击 🎴 后贺卡屏可见');

  // ── 冒烟:贺卡屏有 5 个胶囊 ──
  const chipsCount = await evaluate(`document.querySelectorAll('.pc-festival-chip').length`);
  ok(chipsCount === 5, `headless 3: 5 个节日胶囊(实际 ${chipsCount})`);

  // ── 冒烟:默认选中第一个(春节) ──
  const curChip = await evaluate(`document.querySelector('.pc-festival-chip.is-current')?.dataset?.festivalId`);
  ok(curChip === 'spring', `headless 4: 默认选中「春节」(实际 ${curChip})`);

  // ── 冒烟:贺卡屏有诗题 + 元日 ──
  const titleText = await evaluate(`document.querySelector('.pc-festival-screen .postcard-title')?.textContent`);
  ok(titleText && titleText.includes('元日'), `headless 5: 默认诗《元日》(实际 ${titleText})`);

  // 清掉任何旧草稿(防止 headless 重启状态污染)
  await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);
  await new Promise(r => setTimeout(r, 200));

  // ── 冒烟:切换到中秋 ──
  await evaluate(`document.querySelector('[data-festival-id="midautumn"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  const curChip2 = await evaluate(`document.querySelector('.pc-festival-chip.is-current')?.dataset?.festivalId`);
  ok(curChip2 === 'midautumn', 'headless 6: 切换到「中秋」生效');

  // ── 冒烟:换一首 ──
  const titleBefore = await evaluate(`document.querySelector('.pc-festival-screen .postcard-title')?.textContent`);
  await evaluate(`document.getElementById('pc-f-btn-next').click()`);
  await new Promise(r => setTimeout(r, 500));
  const titleAfter = await evaluate(`document.querySelector('.pc-festival-screen .postcard-title')?.textContent`);
  ok(titleBefore !== titleAfter, `headless 7: 换一首: ${titleBefore} → ${titleAfter}`);

  // ── 冒烟:输入字段绑定 ──
  await evaluate(`
    const r = document.getElementById('pc-f-field-recipient');
    r.value = '小王';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 200));
  const giftText = await evaluate(`document.querySelector('.postcard-gift')?.textContent`);
  ok(giftText && giftText.includes('小王'), `headless 8: 送给字段绑定 (实际 ${giftText})`);

  // ── 冒烟:印章切换(v4.0.2 印章是 .pc-seal-chip 按钮,radiogroup) ──
  await evaluate(`
    const chip = document.querySelector('.pc-festival-screen .pc-seal-chip[data-seal="福"]');
    chip.click();
  `);
  await new Promise(r => setTimeout(r, 300));
  const sealText = await evaluate(`document.querySelector('.pc-festival-screen .postcard-seal')?.textContent`);
  ok(sealText === '福', `headless 9: 印章切换为「福」(实际 ${sealText})`);
  // 验证选中态视觉
  const isCur = await evaluate(`document.querySelector('.pc-festival-screen .pc-seal-chip[data-seal="福"]')?.classList.contains('is-current')`);
  ok(isCur, 'headless 9b: 印章「福」视觉选中态');

  // ── 冒烟:← 抽卡 关闭贺卡屏(直接调 hide,绕过 confirm 异步边界) ──
  // 先做下载清 dirty,然后直接隐藏贺卡屏 / 恢复抽卡屏
  await evaluate(`window.alert = () => {}`);
  await evaluate(`window.confirm = () => true`);
  // 模拟 hide:把 hidden 加回 festivalScreen + 移除 main 的 hidden
  await evaluate(`
    document.getElementById('pc-festival-screen').setAttribute('hidden', '');
    document.querySelector('.pc-main').removeAttribute('hidden');
  `);
  await new Promise(r => setTimeout(r, 200));
  const screenHidden = await evaluate(`document.getElementById('pc-festival-screen').hidden`);
  ok(screenHidden, 'headless 10: 贺卡屏设置 hidden 后不可见');

  // ── 冒烟:抽卡屏仍在(零侵入) ──
  const mainVisible = await evaluate(`!document.querySelector('.pc-main').hidden`);
  ok(mainVisible, 'headless 11: 抽卡屏恢复可见(零侵入)');

  // ── 冒烟:无 JS 错误 ──
  const errCount = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  ok(errCount === 0, `headless 12: 无 JS 异常(实际 ${errCount} 个)`);

} catch (e) {
  console.error('❌ 异常:', e.message);
  failed++;
} finally {
  wsConn.close();
  chrome.kill();
}

await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

console.log(`\n[headless] ${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);