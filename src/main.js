// =============================================================
// 古韵抽卡 v3.0 · 一图一诗 · 明信片
// 文艺清新 · 零依赖 · 零构建
//
// 请求纪律（严格）：
//   每次「换一张」= 1 次 /api/poems/random + 1 次图片请求，不多发一个包。
//   ① _busy 同步锁：连击 / 空格 / 触摸二次触发一律拦截
//   ② _lastClickAt 250ms 防抖：防移动端 tap×2
//   ③ AbortController：取消在途旧请求，避免旧响应覆盖新结果
//   ④ 令牌桶 + 熔断（api.js）：从源头压住 429
// =============================================================

import { apiRequest, resetBreaker } from './api.js';
import { fetchSceneImage } from './images.js';
import { composeCard, downloadCard, shareCard } from './cards.js';

const LOCAL_POEMS_URL = './src/poems.local.json';
const LS_THEME = 'pc_v3_theme';

// ── DOM ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  stage:      $('pc-stage'),
  drawBtn:    $('pc-draw'),
  dlBtn:      $('pc-download'),
  shareBtn:   $('pc-share'),
  themeBtn:   $('pc-theme-toggle'),
  degraded:   $('pc-degraded'),
  recoverBtn: $('pc-recover'),
  srcNote:    $('pc-source-note'),
};

// ── 存储（localStorage 不可用时降级内存） ─────────────────
const mem = new Map();
const ls = (() => {
  try {
    const t = '__pc_v3__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
})();

// ── 运行时状态 ────────────────────────────────────────────
let localPoems = [];      // 本地兜底诗词库
let curPoem = null;       // 当前诗
let curImg = null;        // 当前背景图（HTMLImageElement，已 CORS）
let curImgUrl = null;
let curSource = 'none';   // 图源：LoremFlickr / Picsum / none
let degraded = false;     // 是否已降级到本地库

// 请求纪律三件套
let _busy = false;
let _seq = 0;
let _abort = null;
let _lastClickAt = 0;

// ── 工具 ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg, ms = 2000) {
  let host = $('pc-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pc-toast';
    host.className = 'pc-toast';
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.classList.add('pc-toast--show');
  clearTimeout(host._t);
  host._t = setTimeout(() => host.classList.remove('pc-toast--show'), ms);
}

function setBusyUI(on) {
  els.drawBtn.disabled = on;
  els.drawBtn.classList.toggle('is-busy', on);
  els.drawBtn.querySelector('.pc-btn-label').textContent = on ? '寻诗中' : '换一张';
  els.dlBtn.disabled = on || !curPoem;
  els.shareBtn.disabled = on || !curPoem;
}

// ── 降级横幅 ──────────────────────────────────────────────
function showDegraded(kind) {
  if (!els.degraded) return;
  const msg = kind === 'offline'
    ? '网络已断开，正在使用本地诗词库'
    : '诗泉接口暂不可用（限流/错误），正在使用本地诗词库';
  els.degraded.querySelector('.pc-degraded-msg').textContent = '⚠ ' + msg;
  els.degraded.classList.add('pc-degraded--show');
  if (!degraded) {
    degraded = true;
    toast('接口不可用，已降级到本地诗词库');
  }
}
function hideDegraded() {
  if (els.degraded) els.degraded.classList.remove('pc-degraded--show');
  if (degraded) {
    degraded = false;
    toast('诗泉接口已恢复');
  }
}
async function attemptRecover() {
  resetBreaker();
  try {
    await apiRequest('/api/poems/random', { maxRetries: 1 });
    hideDegraded();
  } catch {
    toast('仍不可用，继续使用本地库');
  }
}

// ── 本地兜底 ──────────────────────────────────────────────
function pickLocalPoem() {
  if (!localPoems.length) return null;
  return localPoems[Math.floor(Math.random() * localPoems.length)];
}

// ── 渲染 ──────────────────────────────────────────────────
function showSkeleton() {
  els.stage.innerHTML = `
    <div class="pc-skeleton">
      <div class="pc-skeleton-media"><span class="pc-shimmer"></span></div>
      <div class="pc-skeleton-lines">
        <span class="pc-skeleton-line" style="width:38%"></span>
        <span class="pc-skeleton-line" style="width:22%"></span>
        <span class="pc-skeleton-line" style="width:78%"></span>
        <span class="pc-skeleton-line" style="width:70%"></span>
        <span class="pc-skeleton-line" style="width:74%"></span>
      </div>
      <div class="pc-skeleton-text">正在寻诗配图…</div>
    </div>`;
}

function renderPostcard(poem, imgUrl, source) {
  const meta = [poem.dynasty?.name, poem.author?.name, poem.type?.name]
    .filter(Boolean).map(escapeHtml).join(' · ');
  const verse = (poem.content || [])
    .map((l) => `<p>${escapeHtml(l)}</p>`).join('');

  els.stage.innerHTML = `
    <article class="postcard" id="pc-postcard">
      <div class="postcard-media">
        ${imgUrl
          ? `<img src="${escapeHtml(imgUrl)}" alt="诗意配图" crossorigin="anonymous" referrerpolicy="no-referrer">`
          : `<div class="postcard-media--empty"></div>`}
      </div>
      <div class="postcard-body">
        <h2 class="postcard-title">${escapeHtml(poem.title)}</h2>
        ${meta ? `<p class="postcard-meta">${meta}</p>` : ''}
        <div class="postcard-rule"></div>
        <div class="postcard-verse">${verse}</div>
        <div class="postcard-foot">
          <span class="postcard-credit">古韵抽卡 · 一图一诗</span>
          <span class="postcard-seal" aria-hidden="true">诗</span>
        </div>
      </div>
    </article>`;

  // 图源标注
  if (els.srcNote) {
    els.srcNote.textContent = source === 'none'
      ? '配图暂不可用（已用水墨底纹）'
      : `配图 · ${source}`;
  }
  // 入场动画
  const card = $('pc-postcard');
  if (card) requestAnimationFrame(() => card.classList.add('is-in'));
}

function showError(msg) {
  els.stage.innerHTML = `<p class="pc-empty">${escapeHtml(msg)}</p>`;
}

// ── 核心：换一张（1 次 random + 1 次图片） ─────────────────
async function drawNew() {
  // ① 同步锁：任何来源的二次触发直接丢弃
  if (_busy) return;
  // ② 250ms 防抖：防移动端 tap 二次触发
  const now = Date.now();
  if (now - _lastClickAt < 250) return;
  _lastClickAt = now;
  _busy = true;
  const seq = ++_seq;

  // ③ 取消在途旧请求
  if (_abort) _abort.abort();
  const ctrl = _abort = new AbortController();

  setBusyUI(true);
  showSkeleton();

  try {
    // ── 请求 1：随机古诗词（唯一一次 random） ──
    let poem = null;
    let fromApi = true;
    try {
      poem = await apiRequest('/api/poems/random', { maxRetries: 2, signal: ctrl.signal });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) return;
      console.warn('random 失败，降级本地库', e);
      poem = pickLocalPoem();
      fromApi = false;
      showDegraded(!navigator.onLine || e?.kind === 'network' ? 'offline' : 'api');
    }
    if (seq !== _seq) return;   // 已有更新请求，丢弃本次

    if (!poem) {
      showError('请求失败，请稍后重试');
      toast('请求失败，请稍后重试');
      return;
    }

    // ── 请求 2：按诗意意象取配图（唯一一次图片请求） ──
    const { img, url, source } = await fetchSceneImage(poem, { seed: poem.id || seq });
    if (seq !== _seq) return;   // 期间又点了，丢弃

    curPoem = poem;
    curImg = img;
    curImgUrl = url;
    curSource = source;
    renderPostcard(poem, url, source);

    if (fromApi && degraded) hideDegraded();
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return;
    console.error(e);
    showError('请求失败，请稍后重试');
    toast('请求失败，请稍后重试');
  } finally {
    if (seq === _seq) {
      _busy = false;
      setBusyUI(false);
    }
  }
}

// ── 导出 / 分享 ───────────────────────────────────────────
async function onDownload() {
  if (!curPoem) return;
  try {
    toast('正在合成卡片…');
    const cv = composeCard(curPoem, curImg);
    const name = await downloadCard(cv, curPoem);
    toast(`已下载 ${name}`);
  } catch (e) {
    console.error(e);
    toast('导出失败，请稍后重试');
  }
}

async function onShare() {
  if (!curPoem) return;
  try {
    const cv = composeCard(curPoem, curImg);
    const r = await shareCard(cv, curPoem);
    if (r === 'shared') toast('已分享');
    else if (r === 'copied') toast('已复制诗词文案到剪贴板');
    else if (r === 'cancelled') { /* 用户取消，静默 */ }
    else toast('当前环境不支持分享，可点下载保存图片');
  } catch (e) {
    console.error(e);
    toast('分享失败，可点下载保存图片');
  }
}

// ── 主题 ──────────────────────────────────────────────────
const THEME_ORDER = ['auto', 'light', 'dark'];
function applyTheme(mode) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark);
  document.documentElement.classList.toggle('pc-dark', isDark);
  if (els.themeBtn) {
    els.themeBtn.textContent = mode === 'auto' ? '自动' : (isDark ? '暗色' : '亮色');
    els.themeBtn.title = `主题：${mode}（点击切换）`;
  }
}
function cycleTheme() {
  const cur = ls.getItem(LS_THEME) || 'auto';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  ls.setItem(LS_THEME, next);
  applyTheme(next);
  toast(next === 'auto' ? '主题：跟随系统' : (next === 'dark' ? '主题：暗色' : '主题：亮色'), 1400);
}

// ── PWA ───────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── 初始化 ───────────────────────────────────────────────
async function init() {
  // 主题
  applyTheme(ls.getItem(LS_THEME) || 'auto');
  els.themeBtn?.addEventListener('click', cycleTheme);
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => applyTheme(ls.getItem(LS_THEME) || 'auto'));

  // 事件
  els.drawBtn.addEventListener('click', drawNew);
  els.dlBtn.addEventListener('click', onDownload);
  els.shareBtn.addEventListener('click', onShare);
  els.recoverBtn?.addEventListener('click', attemptRecover);
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    drawNew();
  });

  setBusyUI(false);

  // 后台预载本地兜底库（不阻塞首屏）
  fetch(LOCAL_POEMS_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((j) => { localPoems = Array.isArray(j) ? j : []; })
    .catch(() => { localPoems = []; });

  registerSW();

  // 首屏：自动来一张（1 次 random + 1 次图片）
  drawNew();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
