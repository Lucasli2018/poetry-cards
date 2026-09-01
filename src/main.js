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
// ── 本地优先模式（默认开启，即「经典诗词」） ─────────
// 设计意图：默认就只从本地经典诗词库抽卡（70 首），不发起远程请求，
// 既首屏秒开、加载更快，又避免了诗泉 API 限流 / 离线场景。
// 用户主动关闭时才会去打诗泉 random。
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
  localFirstBtn: $('pc-local-first'),
  memoryOpenBtn: $('pc-memory-open'),
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

// ── 本地优先 / 经典诗词 模式 ───────────────────────────
function applyLocalFirst(on) {
  if (!els.localFirstBtn) return;
  els.localFirstBtn.classList.toggle('is-on', on);
  els.localFirstBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.localFirstBtn.title = on
    ? '已开启：仅从本地经典诗词库抽取（离线可用）· 点击切回全网'
    : '已关闭：从全网抽取诗词 · 点击切换回本地经典诗词库';
  els.localFirstBtn.textContent = '经典诗词';
}
function toggleLocalFirst() {
  localFirst = !localFirst;
  setLs(LSK.localFirst, localFirst ? '1' : '0');
  applyLocalFirst(localFirst);
  if (localFirst) {
    toast('已开启经典诗词，下次换诗从本地抽取');
    if (!_busy) drawNew();
  } else {
    toast('已切回全网诗词，下次换诗将请求网络');
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
function updateImageOnly(url, source) {
  const media = els.stage.querySelector('.postcard-media');
  if (!media) { renderPostcard(curPoem, url, source); return; }
  const old = media.querySelector('img');
  if (old) old.remove();
  const empty = media.querySelector('.postcard-media--empty');
  if (empty) empty.remove();
  if (url) {
    const ni = document.createElement('img');
    ni.alt = '诗意配图';
    ni.crossOrigin = 'anonymous';
    ni.referrerPolicy = 'no-referrer';
    ni.src = url;
    media.appendChild(ni);
  } else {
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
async function swapImage() {
  if (!curPoem || _busy) return;
  const seq = ++_seq;
  if (_abort) _abort.abort();
  _abort = new AbortController();
  _busy = true;
  const btn = els.stage.querySelector('.pc-swap-img');
  btn?.classList.add('is-busy');
  try {
    // 新随机 seed → 不同的图（与首图 seed 区分开，避免拿到同一张）
    const { img, url, source } = await fetchSceneImage(
      curPoem, { seed: Date.now() + Math.floor(Math.random() * 1e6) }
    );
    if (seq !== _seq) return;   // 期间又触发了换诗/换图，丢弃本次
    curImg = img;
    curImgUrl = url;
    curSource = source;
    updateImageOnly(url, source);
    if (source === 'none') toast('配图暂不可用，再试一次吧');
    else toast('已换一张配图');
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return;
    console.error(e);
    toast('换图失败，请稍后重试');
  } finally {
    if (seq === _seq) {
      _busy = false;
      els.stage.querySelector('.pc-swap-img')?.classList.remove('is-busy');
    }
  }
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
    // ── 请求 1：随机古诗词 ──
    // 本地优先模式：直接从本地库取，完全不发远程请求（离线可用）
    let poem = null;
    let fromApi = true;
    if (localFirst) {
      poem = pickLocalPoem();
      fromApi = false;
      if (!poem) {
        showError('本地诗词库尚未就绪，请稍候再试');
        toast('本地库尚未就绪，请稍候再试');
        return;
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

    // v3.1 个性化记忆:成功渲染后写库(失败/取消不写)
    //   history.push 内部做 normalizePoem,任何字段缺失都能容错
    //   stats.onDraw 接受 themes(由 extractThemes 取 top 2 主题词)
    history?.push(poem);
    stats?.onDraw(poem, extractThemes(poem));

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
  memoryPanel.update({
    favorites: { items: favorites.list() },
    history:   { items: history.list() },
    stats: {
      totalDraws:   stats.get().totalDraws,
      todayDraws:   stats.get().todayDraws,
      topDynasties: stats.topDynasties(5),
      topImagery:   stats.topImagery(5),
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
    els.themeBtn.textContent = mode === 'auto' ? '自动' : (isDark ? '暗色' : '亮色');
    els.themeBtn.title = `主题：${mode}（点击切换）`;
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
  els.localFirstBtn?.addEventListener('click', toggleLocalFirst);

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

  // v3.1 个性化记忆:实例化 history / stats / favorites store(注入 ls 适配器)
  history = createHistoryStore(ls);
  stats = createStatsStore(ls);
  favorites = createFavoritesStore(ls);

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
