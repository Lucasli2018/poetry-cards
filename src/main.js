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

import { apiRequest, resetBreaker } from './net/api.js';
import { fetchSceneImage, extractThemes } from './images.js';
import { composeCard, downloadCard, shareCard } from './cards.js';
// v4.5.2: domToCanvas + vendor/html-to-image 已清理 — v3.2.5 引入的「未来 1:1 路径」
//   从未被启用, composeCard 字节级稳定, 此路径永久废弃
import { createHistoryStore } from './store/history.js';
import { createStatsStore } from './store/stats.js';
import { createFavoritesStore } from './store/favorites.js';
import { createMemoryPanel } from './ui/memory-panel.js';
import { renderFavorites, renderHistory, renderStats } from './ui/renderers.js';
import {
  snapshotForExport, downloadSnapshot, parseSnapshot,
  mergeImport, readFileAsText,
} from './ui/storage-dialog.js';

const LOCAL_POEMS_URL = './src/poems.local.json';
// ── 诗源:典藏诗库(本地经典,默认) / 随机一遇(诗泉全网) ───────
// 开关位于 header。内部 key 沿用 v3.1 命名(localFirst),保持向后兼容。
const LSK = { theme: 'pc_v3_theme', localFirst: 'pc_v3_local_first' };
function setLs(k, v) { ls.setItem(k, v == null ? '' : String(v)); }
function getLsBool(k, def) {
  const v = ls.getItem(k);
  if (v == null) return def;
  return v === '1' || v === 'true';
}

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
  localFirstSwitch: $('pc-local-first'),
  memoryOpenBtn: $('pc-memory-open'),
  // v4.1 贺卡入口已迁出到独立页 festival.html — 不再绑定
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
let localFirst = true;    // 「经典诗词」模式：默认开启，只走本地 70 首，不发远程

// 请求纪律三件套
let _busy = false;
let _seq = 0;
let _abort = null;
let _lastClickAt = 0;

// v3.1 个性化记忆 store(由 init() 在拿到 ls 后实例化)
let history = null;
let stats = null;
let favorites = null;
let memoryPanel = null;

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

// ── 本地库加载 ───────────────────────────────────────────
async function loadLocalPoems() {
  try {
    const r = await fetch(LOCAL_POEMS_URL, { cache: 'no-cache' });
    const j = r.ok ? await r.json() : [];
    localPoems = Array.isArray(j) ? j : [];
  } catch {
    localPoems = [];
  }
}

// ── 诗源切换 · 典藏诗库 / 随机一遇 ───────────────────────
//
// 视觉是一个开关:默认开启「典藏诗库」(本地经典 70 首,无声可达),
// 关闭后切到「随机一遇」(诗泉 API 全网随机)。
// 文案全程不暴露本地/网络/离线等技术细节。
//
const POEM_SOURCE_LABEL = {
  classic: '典藏诗库',
  random:  '随机一遇',
};

function applyLocalFirst(on) {
  if (!els.localFirstSwitch) return;
  els.localFirstSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  const current = on ? POEM_SOURCE_LABEL.classic : POEM_SOURCE_LABEL.random;
  els.localFirstSwitch.setAttribute(
    'aria-label',
    `诗源切换：当前${current}，点击切换`
  );
  els.localFirstSwitch.title = on
    ? `当前：${POEM_SOURCE_LABEL.classic} · 点击切换至${POEM_SOURCE_LABEL.random}`
    : `当前：${POEM_SOURCE_LABEL.random} · 点击切换至${POEM_SOURCE_LABEL.classic}`;
  // 当前态文字标签(单元素,内容随 aria-checked 切换)
  const labelEl = els.localFirstSwitch.querySelector('.pc-switch-label--current');
  if (labelEl) labelEl.textContent = current;
}
function toggleLocalFirst() {
  localFirst = !localFirst;
  setLs(LSK.localFirst, localFirst ? '1' : '0');
  applyLocalFirst(localFirst);
  if (localFirst) {
    toast(`已开启「${POEM_SOURCE_LABEL.classic}」,且听风吟`);
    if (!_busy) drawNew();
  } else {
    toast(`已切换至「${POEM_SOURCE_LABEL.random}」,每次相逢皆新意`);
  }
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

  // v3.1 收藏态:渲染时即时反映
  const isFav = favorites?.has(poem.id) ?? false;

  els.stage.innerHTML = `
    <article class="postcard" id="pc-postcard">
      <div class="postcard-media">
        <button class="pc-swap-img" type="button" title="换一张配图（保留诗词）" aria-label="换一张配图">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
        </button>
        ${imgUrl
          ? `<img src="${escapeHtml(imgUrl)}" alt="诗意配图" crossorigin="anonymous" referrerpolicy="no-referrer">`
          : `<div class="postcard-media--empty"></div>`}
      </div>
      <div class="postcard-body">
        <div class="postcard-head">
          <h2 class="postcard-title">${escapeHtml(poem.title)}</h2>
          <button class="pc-fav-btn ${isFav ? 'is-fav' : ''}" type="button"
                  title="${isFav ? '已收藏 · 点击取消' : '收藏这首诗'}"
                  aria-label="${isFav ? '取消收藏' : '收藏'}"
                  aria-pressed="${isFav ? 'true' : 'false'}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
          </button>
        </div>
        ${meta ? `<p class="postcard-meta">${meta}</p>` : ''}
        <div class="postcard-rule"></div>
        <div class="postcard-verse">${verse}</div>
        <div class="postcard-foot">
          <span class="postcard-credit">古韵抽卡 · 一图一诗</span>
          <span class="postcard-seal" aria-hidden="true">诗</span>
        </div>
      </div>
    </article>`;

  // 图源提示：仅在完全无图（none）时给"已用水墨底纹"的兜底文案，
  // 有图时不再展示第三方图源，保持卡片底部整洁。
  if (els.srcNote) {
    els.srcNote.textContent = source === 'none'
      ? '配图暂不可用（已用水墨底纹）'
      : '';
  }
  // 入场动画
  const card = $('pc-postcard');
  if (card) requestAnimationFrame(() => card.classList.add('is-in'));
}

function showError(msg) {
  els.stage.innerHTML = `<p class="pc-empty">${escapeHtml(msg)}</p>`;
}

// ── 只换图（保留诗词） ───────────────────────────────────
// 仅替换配图区 DOM，不动诗文，避免整卡重播入场动画。
// v4.5.1: 接受可选的 readyImg(已 CORS 加载完成的 HTMLImageElement)
//   优先级: readyImg > url
//   - 传 readyImg: 直接 appendChild(reusable img), 不触发浏览器重新加载, 0 闪屏
//   - 只传 url: 创建新 <img> + 浏览器加载 (异步, 有短暂空白)
//   - 都不传: 渲染 .postcard-media--empty 占位
function updateImageOnly(url, source, readyImg) {
  const media = els.stage.querySelector('.postcard-media');
  if (!media) { renderPostcard(curPoem, url, source); return; }
  // v4.5.1: 关键修复 — 新图到位前不销毁老图
  //   先创建新节点(若已 readyImg, 直接 clone 后 append; 老图等新节点插入后再 remove)
  //   保证视觉上始终有一张图, 不会 "换图反而无图"
  const old = media.querySelector('img');
  const empty = media.querySelector('.postcard-media--empty');
  let appended = false;
  if (readyImg) {
    // 已加载完成的 img, 可直接插入 DOM (浏览器复用 decoded 数据)
    // 注意: readyImg 来自 fetchSceneImage, 已是 crossOrigin='anonymous' 加载完的 Image
    // 直接 appendChild 会把同一节点挪进 DOM — 但 readyImg 在 fetchSceneImage 之外
    // 没有继续被引用, 所以可以被重用;若 caller 后面还想要它, 应该传 clone
    const ni = document.createElement('img');
    ni.alt = '诗意配图';
    ni.crossOrigin = 'anonymous';
    ni.referrerPolicy = 'no-referrer';
    ni.src = readyImg.src;       // 复用 url, 浏览器命中缓存(同 url 已 decoded)→ 同步完成
    media.appendChild(ni);        // 插入新图
    appended = true;
  } else if (url) {
    const ni = document.createElement('img');
    ni.alt = '诗意配图';
    ni.crossOrigin = 'anonymous';
    ni.referrerPolicy = 'no-referrer';
    ni.src = url;
    media.appendChild(ni);
    appended = true;
  }
  // 新图就位后才清老图 — 杜绝 "换图瞬间空白"
  if (appended) {
    if (old) old.remove();
    if (empty) empty.remove();
  } else if (!url && !readyImg) {
    // 既没 url 也没 img — 走空态
    if (old) old.remove();
    if (empty) empty.remove();
    const d = document.createElement('div');
    d.className = 'postcard-media--empty';
    media.appendChild(d);
  }
  if (els.srcNote) {
    els.srcNote.textContent = source === 'none'
      ? '配图暂不可用（已用水墨底纹）'
      : '';
  }
}

// 单独换图：复用当前诗词，换新 seed 重新取配图；遵守请求纪律（_busy / _seq）。
// v4.7.1: 等双源最终结果回来再一次性替换配图(保留诗词) — 不再渐进替换;
//   全失败 → 保留原图 + toast "已保留原图"
async function swapImage() {
  if (!curPoem || _busy) return;
  const seq = ++_seq;
  if (_abort) _abort.abort();
  _abort = new AbortController();
  _busy = true;
  const btn = els.stage.querySelector('.pc-swap-img');
  btn?.classList.add('is-busy');
  try {
    const seed = Date.now() + Math.floor(Math.random() * 1e6);
    // 不传渐进回调: 保留当前图, 等双源最终结果回来再一次性替换
    const finalResult = await fetchSceneImage(curPoem, { seed });
    if (seq !== _seq) return;

    if (finalResult.source !== 'none') {
      curImg = finalResult.img;
      curImgUrl = finalResult.url;
      curSource = finalResult.source;
      updateImageOnly(finalResult.url, finalResult.source, finalResult.img);
      toast(finalResult.source === 'LoremFlickr' ? '已换意境图' : '已换一张配图');
    } else {
      toast('配图暂不可用，已保留原图');
    }
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return;
    console.error(e);
    toast('换图失败，已保留原图');
  } finally {
    if (seq === _seq) {
      _busy = false;
      els.stage.querySelector('.pc-swap-img')?.classList.remove('is-busy');
    }
  }
}

// ── 核心：换一张（1 次 random + 双源并发图） ─────────────────
// v4.7.1: 诗词与配图同时呈现 — 先留骨架(showSkeleton), 拿到诗后继续等图,
//   待 fetchSceneImage 最终结果回来, 再一次性 renderPostcard(诗词+图);
//   不再让诗词毫秒级先显、配图异步追上来。
//   T+0ms    → showSkeleton() 骨架(无诗词、无图)
//   T+0+ms  → 拿到诗(本地优先/远程) → 继续等图
//   T+~1500ms → LoremFlickr 主源先到(或 Picsum 兜底) → 一次性渲染整卡(诗词+图)
//   失败/超时 → 渲染诗词 + 单色占位(.postcard-media--empty)
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
    // ── 请求 1：随机古诗词 ──
    // 本地优先模式：直接从本地库取，完全不发远程请求（离线可用）
    let poem = null;
    let fromApi = true;
    if (localFirst) {
      poem = pickLocalPoem();
      fromApi = false;
      if (!poem) {
        throw new Error('LOCAL_LIB_NOT_READY');
      }
    } else {
      try {
        poem = await apiRequest('/api/poems/random', { maxRetries: 2, signal: ctrl.signal });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) return;
        console.warn('random 失败，降级本地库', e);
        poem = pickLocalPoem();
        fromApi = false;
        showDegraded(!navigator.onLine || e?.kind === 'network' ? 'offline' : 'api');
      }
    }
    if (seq !== _seq) return;   // 已有更新请求，丢弃本次

    if (!poem) {
      throw new Error('POEM_EMPTY');
    }

    // ── 等图一起出（v4.7.1）──
    //   诗词与配图同时呈现: 不先显诗词、再异步追图; 而是先留骨架(showSkeleton),
    //   待 fetchSceneImage 拿到最终结果(或全失败)后, 一次性 renderPostcard。
    //   取诗期间已显示骨架, 故此处不再提前 renderPostcard。
    curPoem = poem;
    curImg = null;
    curImgUrl = '';
    curSource = 'none';

    // ── 请求 2：双源并发取图（不传渐进回调, 等最终结果一起渲染）──
    const finalResult = await fetchSceneImage(poem, {
      seed: poem.id || seq,
    });
    if (seq !== _seq) return;

    curImg = finalResult.img;
    curImgUrl = finalResult.url;
    curSource = finalResult.source;

    // 诗词 + 图 一次性渲染
    renderPostcard(poem, finalResult.url, finalResult.source);

    // 全失败: 图区单色占位 + 提示文案
    if (finalResult.source === 'none') {
      if (els.srcNote) els.srcNote.textContent = '配图暂不可用（已用水墨底纹）';
    }

    // v3.1 个性化记忆:成功渲染后写库(失败/取消不写)
    history?.push(poem);
    stats?.onDraw(poem, extractThemes(poem));

    if (fromApi && degraded) hideDegraded();
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return;
    console.error(e);
    const msg = e?.message === 'LOCAL_LIB_NOT_READY'
      ? '本地诗词库尚未就绪，请稍候再试'
      : e?.message === 'POEM_EMPTY'
        ? '本次未取到诗，请稍后重试'
        : '请求失败，请稍后重试';
    showError(msg);
    toast(msg);
  } finally {
    if (seq === _seq) {
      _busy = false;
      setBusyUI(false);
    }
  }
}

// ── 导出 / 分享 ───────────────────────────────────────────
// hostEl = 当前 DOM 明信片节点;canvas = composeCard(hostEl) —
//   按 DOM 实际尺寸 + dpr 锐化,展示与导出在尺寸/字体比例上完全对齐。
//   v4.5.2: domToCanvas 路径永久移除 — composeCard 是唯一下载/分享路径
function getPostcardHost() {
  return document.getElementById('pc-postcard');
}

async function onDownload() {
  if (!curPoem) return;
  try {
    toast('正在合成卡片…');
    const host = getPostcardHost();
    // v3.2.6 回退到 composeCard(主路径,稳定);img = curImg 已 CORS 加载,canvas 不污染
    const cv = composeCard(curPoem, curImg, host);
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
    const host = getPostcardHost();
    const cv = composeCard(curPoem, curImg, host);
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

// ── 收藏切换 ──────────────────────────────────────────────
function toggleFavorite() {
  if (!curPoem || !favorites) return;
  const r = favorites.toggle(curPoem);
  if (r.error) {
    toast(r.error + ' · 请在收藏夹清理旧诗');
    return;
  }
  // 同步按钮态(就地更新,不动整张卡片避免重播入场动画)
  const btn = els.stage.querySelector('.pc-fav-btn');
  if (btn) {
    btn.classList.toggle('is-fav', r.favorited);
    btn.setAttribute('aria-pressed', r.favorited ? 'true' : 'false');
    btn.title = r.favorited ? '已收藏 · 点击取消' : '收藏这首诗';
  }
  toast(r.favorited ? `已收藏《${curPoem.title || '无题'}》` : '已取消收藏');
}

// ── 数据迁移(导出 / 导入) ────────────────────────────────
function onExportBackup() {
  try {
    const snap = snapshotForExport(ls);
    downloadSnapshot(snap);
    toast(`已导出备份(${snap.favorites.items.length} 收藏 · ${snap.history.items.length} 历史)`);
  } catch (e) {
    console.error(e);
    toast('导出失败,请稍后重试');
  }
}

async function onImportBackup() {
  // 用隐藏的 <input type=file> 触发文件选择
  let input = document.getElementById('pc-import-file');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'pc-import-file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  input.value = '';   // 允许重选同一文件
  input.onchange = async () => {
    const file = input.files?.[0];
    input.onchange = null;
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const snap = parseSnapshot(text);
      const statsCount = snap.statsMeta?.totalDraws ?? 0;
      if (!confirm(`即将合并导入:\n· 收藏 ${snap.favorites.items.length} 首\n· 历史 ${snap.history.items.length} 条\n· 统计 ${statsCount} 次累计\n\n同 ID 收藏/历史按时间戳去重,统计会覆盖。\n\n继续?`)) {
        return;
      }
      const r = mergeImport(ls, snap);
      // 内存中的 store 缓存需要下次读取时刷新 — reload 是最简单稳妥的做法
      toast(`导入完成 · 新增收藏 ${r.addedFav} · 新增历史 ${r.addedHist}`);
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast('导入失败: ' + e.message);
    }
  };
  input.click();
}

// ── 记忆面板刷新 ─────────────────────────────────────────
// 把三个 store 的快照拼成一个对象,字段以 tab 名命名(favorites/history/stats),
// renderers 按需读取对应字段。这样既不污染命名空间,也方便测试注入。
function refreshMemoryPanel() {
  if (!memoryPanel || !favorites || !history || !stats) return;
  const snap = stats.snapshot();
  memoryPanel.update({
    favorites: { items: favorites.list() },
    history:   { items: history.list() },
    stats: {
      totalDraws:    snap.totalDraws,
      todayDraws:    snap.todayDraws,
      totalFavorites: snap.totalFavorites,
      topDynasties:  snap.topDynasties,
      topImagery:    snap.topImagery,
    },
  });
}

// ── 主题 ──────────────────────────────────────────────────
const THEME_ORDER = ['auto', 'light', 'dark'];
function applyTheme(mode) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark);
  document.documentElement.classList.toggle('pc-dark', isDark);
  if (els.themeBtn) {
    // v4.1.7: 用图标代替文字 — auto/sun/moon
    const labelMap = { auto: '自动', light: '亮色', dark: '暗色' };
    els.themeBtn.title = `主题：${labelMap[mode] || mode}（点击切换）`;
    els.themeBtn.setAttribute('aria-label', `切换主题 · 当前 ${labelMap[mode] || mode}`);
    // 切换图标 — 3 个 SVG 兄弟元素, CSS 控制显示
    els.themeBtn.setAttribute('data-theme-mode', mode);
  }
}
function cycleTheme() {
  const cur = ls.getItem(LSK.theme) || 'auto';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  setLs(LSK.theme, next);
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
  applyTheme(ls.getItem(LSK.theme) || 'auto');
  els.themeBtn?.addEventListener('click', cycleTheme);
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => applyTheme(ls.getItem(LSK.theme) || 'auto'));

  // 本地优先模式（默认开启 = 经典诗词）
  //  - 首次进入、且用户从未显式关闭过 → 默认开启
  //  - 用户关闭过（LS 存的是 '0'）→ 保持关闭
  localFirst = getLsBool(LSK.localFirst, true);
  applyLocalFirst(localFirst);
  // switch 既响应鼠标点击,也支持键盘 Space/Enter 切换(无障碍)
  els.localFirstSwitch?.addEventListener('click', toggleLocalFirst);
  els.localFirstSwitch?.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleLocalFirst();
    }
  });

  // 事件
  els.drawBtn.addEventListener('click', drawNew);
  els.dlBtn.addEventListener('click', onDownload);
  els.shareBtn.addEventListener('click', onShare);
  els.recoverBtn?.addEventListener('click', attemptRecover);

  // 明信片配图上的「换图」按钮（事件委托：renderPostcard 会重建 DOM）
  els.stage.addEventListener('click', (e) => {
    const sw = e.target.closest('.pc-swap-img');
    if (sw) { e.preventDefault(); swapImage(); return; }
    const fb = e.target.closest('.pc-fav-btn');
    if (fb) { e.preventDefault(); toggleFavorite(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    drawNew();
  });

  setBusyUI(false);

  // v3.1 个性化记忆:实例化 history / favorites store(注入 ls 适配器)
  history = createHistoryStore(ls);
  favorites = createFavoritesStore(ls);
  // v3.2.7 stats 双源:totalDraws/todayDraws 走 statsMeta(累加),
  //   topDynasties/topImagery 走 favorites 实时计算
  stats = createStatsStore(ls, favorites);

  // v3.1 记忆面板:三个 tab 共享 modal
  memoryPanel = createMemoryPanel();
  memoryPanel.mount(document.body);
  memoryPanel.registerRenderer('favorites', (snap) => renderFavorites(snap, {
    onRemove: (id) => { favorites.remove(id); refreshMemoryPanel(); toast('已取消收藏'); },
    onClear:  ()    => { favorites.clear();  refreshMemoryPanel(); toast('已清空收藏'); },
  }));
  memoryPanel.registerRenderer('history', (snap) => renderHistory(snap, {
    onClear:  ()    => { history.clear();    refreshMemoryPanel(); toast('已清空历史'); },
  }));
  memoryPanel.registerRenderer('stats', (snap) => renderStats(snap, {
    onReset:  ()    => { stats.reset();      refreshMemoryPanel(); toast('已重置统计'); },
    onExport: ()    => { onExportBackup(); },
    onImport: ()    => { onImportBackup(); },
  }));
  els.memoryOpenBtn?.addEventListener('click', () => {
    refreshMemoryPanel();
    memoryPanel.open(memoryPanel.currentTab);
  });

  // v4.1 贺卡模式已迁出到独立页 festival.html
  // 主 main.js 不再 mount FestivalUI,festival.html 走自己的 src/festival-main.js

  // 预载本地兜底库（首屏前就绪，保证「本地优先」立即可用）
  await loadLocalPoems();

  registerSW();

  // 首屏：自动来一张（本地优先模式走本地库；否则 1 次 random + 1 次图片）
  drawNew();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
