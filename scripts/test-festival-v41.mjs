// v4.1 贺卡独立页 e2e 测试:
//   1. 主屏点 🎴 跳到 festival.html
//   2. festival.html 渲染(节日 + 印章下拉 + 字段 + 预览 + 3 操作按钮)
//   3. 切换节日 / 印章 / 输入字段
//   4. 点 ← 抽卡 返回主页
//   5. 主页正常显示(无 JS 异常)
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8080/';
const FESTIVAL_URL = URL_BASE.replace(/\/$/, '') + '/festival.html';
const TMP = path.join(os.tmpdir(), `pc-v41-${Date.now()}`);
const CDP_PORT = 9226;
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
const events = [];
wsConn.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); } else if (m.method) { events.push(m); } });
function send(method, params) { const id = nextId++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); wsConn.send(JSON.stringify({ id, method, params })); }); }
await new Promise(r => wsConn.addEventListener('open', r, { once: true }));

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

let passed = 0, failed = 0;
function ok(c, l) { if (c) { passed++; console.log(`✅ ${l}`); } else { failed++; console.log(`❌ ${l}`); } }

try {
  await send('Page.enable', {});

  // ── 1. 主屏 ──
  await send('Page.navigate', { url: URL_BASE });
  await new Promise(r => setTimeout(r, 3500));
  await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);
  await send('Page.reload', {});
  await new Promise(r => setTimeout(r, 3500));

  const mainOk = await evaluate(`!!document.getElementById('pc-draw')`);
  ok(mainOk, 'v4.1-1: 主屏 抽卡屏正常加载');
  // 主屏不再有 #pc-festival-screen 容器
  const noScreen = await evaluate(`!document.getElementById('pc-festival-screen')`);
  ok(noScreen, 'v4.1-1b: 主屏不再有 #pc-festival-screen(贺卡已独立)');
  // 主屏 🎴 入口是 <a> 链接
  const isLink = await evaluate(`(() => {
    const a = document.getElementById('pc-festival-open');
    return a && a.tagName === 'A' && a.getAttribute('href') === './festival.html';
  })()`);
  ok(isLink, 'v4.1-1c: 主屏 🎴 是 <a href="./festival.html"> 链接');

  // ── 2. 跳转到 festival.html ──
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 1500));
  const onFestival = await evaluate(`location.pathname.endsWith('festival.html')`);
  ok(onFestival, 'v4.1-2: 点击 🎴 跳转到 festival.html');

  // festival.html 应该自动渲染
  await new Promise(r => setTimeout(r, 2500));  // 等 ESM 模块加载
  // 详细查 console + console.error
  await send('Runtime.enable', {});
  const consoleMsgs = await evaluate(`(() => {
    // 让 Runtime.consoleAPICalled 事件传到 events 数组 — 我们用 console.log 触发
    return { scripts: Array.from(document.scripts).map(s => s.src) };
  })()`);
  console.log('[debug] scripts:', JSON.stringify(consoleMsgs));
  const debugInfo = await evaluate(`(() => ({
    title: document.getElementById('pc-festival-title')?.textContent,
    fieldsHTML: document.getElementById('pc-festival-fields')?.innerHTML?.slice(0, 200),
    selectsHTML: document.getElementById('pc-festival-selects-wrap')?.innerHTML?.slice(0, 200),
    cardHTML: document.getElementById('pc-festival-card')?.innerHTML?.slice(0, 200),
    actionsHTML: document.getElementById('pc-festival-actions')?.innerHTML?.slice(0, 200),
  }))()`);
  console.log('[debug] festival.html DOM:', JSON.stringify(debugInfo, null, 2));
  const consErrs = events.filter(e => e.method === 'Runtime.exceptionThrown');
  console.log('[debug] console errors full:', JSON.stringify(consErrs, null, 2));
  const titleEl = await evaluate(`document.getElementById('pc-festival-title')?.textContent`);
  ok(titleEl && titleEl.includes('贺卡'), `v4.1-2b: 标题渲染 (${titleEl})`);

  // v4.1.1 新增:返回按钮宽度 ≈ 文字宽度(不撑满)
  const backMetrics = await evaluate(`(() => {
    const a = document.getElementById('pc-festival-back');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { w: Math.round(r.width), text: a.textContent };
  })()`);
  ok(backMetrics && backMetrics.w <= 80, `v4.1.1-A: 抽卡按钮宽度 ≈ 文字 (实际 ${backMetrics?.w}px, 文字 "${backMetrics?.text}")`);

  // v4.1.1 新增:下拉区在字段区"上面"(DOM 顺序 + Y 坐标)
  const order = await evaluate(`(() => {
    const s = document.getElementById('pc-festival-selects-wrap');
    const f = document.getElementById('pc-festival-fields');
    if (!s || !f) return null;
    return {
      sTop: Math.round(s.getBoundingClientRect().top),
      fTop: Math.round(f.getBoundingClientRect().top),
      sBeforeF: !!(s.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  })()`);
  ok(order && order.sBeforeF && order.sTop < order.fTop, `v4.1.1-B: 下拉区在字段区上方 (selects top=${order?.sTop}, fields top=${order?.fTop})`);
  const fOpts = await evaluate(`document.querySelectorAll('#pc-f-field-festival option').length`);
  ok(fOpts === 5, `v4.1-2c: 5 个节日选项 (${fOpts})`);
  const sOpts = await evaluate(`document.querySelectorAll('#pc-f-field-seal option').length`);
  ok(sOpts === 8, `v4.1-2d: 8 个印章选项 (${sOpts})`);

  // ── 3. 切换节日 + 印章 + 输入 ──
  // 切换到中秋
  await evaluate(`(() => {
    const s = document.getElementById('pc-f-field-festival');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, 'midautumn');
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 500));
  const fest = await evaluate(`document.getElementById('pc-f-field-festival')?.value`);
  ok(fest === 'midautumn', `v4.1-3: 节日切到 midautumn (${fest})`);

  // 印章切到 福
  await evaluate(`(() => {
    const s = document.getElementById('pc-f-field-seal');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, '福');
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 300));
  const seal = await evaluate(`document.querySelector('.postcard-seal')?.textContent`);
  ok(seal === '福', `v4.1-3b: 印章切到 福 (${seal})`);

  // 输入收信人
  await evaluate(`(() => {
    const r = document.getElementById('pc-f-field-recipient');
    r.value = '小王';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 700));  // debounce 500ms + 缓冲
  const gift = await evaluate(`document.querySelector('.postcard-gift')?.textContent`);
  ok(gift && gift.includes('小王'), `v4.1-3c: 送给 字段绑定 (${gift})`);

  // 草稿已存到 localStorage
  const draft = await evaluate(`localStorage.getItem('pc_v3_festival_draft')`);
  console.log('[debug] draft:', draft?.slice(0, 300));
  ok(draft && draft.includes('小王'), 'v4.1-3d: 草稿已自动保存(含小王)');

  // ── 4. ← 抽卡 返回主页(dirty 提示 confirm 必须覆盖) ──
  await evaluate(`window.confirm = () => true`);  // 接受"确定离开"
  await evaluate(`document.getElementById('pc-festival-back').click()`);
  await new Promise(r => setTimeout(r, 2500));
  const backHome = await evaluate(`location.pathname.endsWith('index.html') || location.pathname === '/'`);
  ok(backHome, `v4.1-4: ← 抽卡 返回主页 (path=${await evaluate('location.pathname')})`);

  // ── 5. 主页应正常显示,无 JS 异常 ──
  await new Promise(r => setTimeout(r, 2000));
  const mainStage = await evaluate(`!!document.getElementById('pc-stage')`);
  ok(mainStage, 'v4.1-5: 返回主页后抽卡屏正常');
  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown');
  ok(errs.length === 0, `v4.1-5b: 无 JS 异常 (${errs.length} 个)`);

  // ── 6. 跨页草稿恢复(再进贺卡页) ──
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 2500));
  const restoredRecipient = await evaluate(`document.getElementById('pc-f-field-recipient')?.value`);
  ok(restoredRecipient === '小王', `v4.1-6: 跨页草稿恢复 (${restoredRecipient})`);

} catch (e) {
  console.error('❌ 异常:', e.message);
  failed++;
} finally {
  wsConn.close();
  chrome.kill();
}
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

console.log(`\n[v4.1 e2e] ${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);
