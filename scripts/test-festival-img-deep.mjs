// 深度排查「图片未显示」— 测三种场景:
//   A. 首次进入贺卡屏(loadImage 调用)
//   B. 切节日(loadImage 重画)
//   C. 切节日后图区是否更新
//   D. 关闭重开(localStorage 草稿有 imageUrl)图是否回来
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8080/';
const TMP = path.join(os.tmpdir(), `pc-img-${Date.now()}`);
const CDP_PORT = 9224;
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

console.log('[img-deep] launching chrome …');
await new Promise((r) => { const k = spawn('taskkill', ['/F', '/IM', 'chrome.exe'], { stdio: 'ignore' }); k.on('exit', r); k.on('error', r); });
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
const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find(t => t.type === 'page');
const wsConn = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
wsConn.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
});
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); wsConn.send(JSON.stringify({ id, method, params })); });
}
await new Promise(r => wsConn.addEventListener('open', r, { once: true }));

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function getMediaState() {
  return await evaluate(`(() => {
    const media = document.querySelector('.pc-festival-screen .postcard-media');
    if (!media) return { error: 'no .postcard-media' };
    const img = media.querySelector('img');
    const fb = media.querySelector('.postcard-media-fallback');
    return {
      hasImg: !!img,
      imgSrc: img?.src?.slice(0, 100) || null,
      imgComplete: img?.complete || null,
      imgNaturalW: img?.naturalWidth || 0,
      imgNaturalH: img?.naturalHeight || 0,
      hasFallback: !!fb,
      fallbackText: fb?.querySelector('.postcard-media-fallback-text')?.textContent || null,
      fallbackIcon: fb?.querySelector('.postcard-media-fallback-icon')?.textContent || null,
    };
  })()`);
}

try {
  await send('Page.enable', {});
  await send('Page.navigate', { url: URL_BASE });
  await new Promise(r => setTimeout(r, 3500));
  await evaluate(`localStorage.removeItem('pc_v3_festival_draft')`);
  await evaluate(`localStorage.removeItem('pc_v3_local_first')`);
  await evaluate(`localStorage.removeItem('pc_v3_theme')`);
  // 重新加载确保 LS 干净
  await send('Page.reload', {});
  await new Promise(r => setTimeout(r, 3500));

  // 场景 A: 首次进入贺卡屏
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 1000));
  const stateA_loading = await getMediaState();
  console.log('[A 初次进入 t=1s]', JSON.stringify(stateA_loading, null, 2));

  // 等 Pollinations 出图(可能要 5-10s)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = await getMediaState();
    if (s.imgComplete && s.imgNaturalW > 0) {
      console.log(`[A 出图 t=${i+2}s]`, JSON.stringify(s));
      break;
    }
    if (i === 14) console.log(`[A t=15s 仍未出图]`, JSON.stringify(s));
  }
  const stateA_final = await getMediaState();

  // 场景 B: 切到中秋
  await evaluate(`document.querySelector('[data-festival-id="midautumn"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  const stateB_loading = await getMediaState();
  console.log('[B 切中秋 t=0.5s]', JSON.stringify(stateB_loading, null, 2));
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = await getMediaState();
    if (s.imgComplete && s.imgNaturalW > 0) {
      console.log(`[B 出图 t=${i+1}s]`, JSON.stringify(s));
      break;
    }
  }
  const stateB_final = await getMediaState();

  // 场景 D: 关闭重开(草稿有 imageUrl)
  await evaluate(`localStorage.getItem('pc_v3_festival_draft')`);
  const draftBefore = await evaluate(`localStorage.getItem('pc_v3_festival_draft')`);
  console.log('[D 关闭前草稿]', draftBefore?.slice(0, 200));
  // 返回抽卡屏
  await evaluate(`window.confirm = () => true`);
  await evaluate(`document.getElementById('pc-festival-back').click()`);
  await new Promise(r => setTimeout(r, 500));
  // 重新进入
  await evaluate(`document.getElementById('pc-festival-open').click()`);
  await new Promise(r => setTimeout(r, 1000));
  const stateD_loading = await getMediaState();
  console.log('[D 重新进入 t=1s]', JSON.stringify(stateD_loading, null, 2));
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = await getMediaState();
    if (s.imgComplete && s.imgNaturalW > 0) {
      console.log(`[D 出图 t=${i+2}s]`, JSON.stringify(s));
      break;
    }
  }
  const stateD_final = await getMediaState();

  // 汇总
  console.log('\n========== 汇总 ==========');
  console.log('A 最终:', stateA_final.hasImg && stateA_final.imgNaturalW > 0 ? '✅ 出图' : '❌ 未出图');
  console.log('B 切节日最终:', stateB_final.hasImg && stateB_final.imgNaturalW > 0 ? '✅ 出图' : '❌ 未出图');
  console.log('D 关闭重开最终:', stateD_final.hasImg && stateD_final.imgNaturalW > 0 ? '✅ 出图' : '❌ 未出图');

} catch (e) {
  console.error('❌ 异常:', e.message);
} finally {
  wsConn.close(); chrome.kill();
}
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});