// =============================================================
// 古韵抽卡 v2.2 · 零依赖 · 诗泉在线
// 单次 random + 等待返回 + 限流/熔断/降级 + 搜索/统计/PWA
// API: https://poetry.palemoky.com
// =============================================================

import { apiRequest, ApiError, resetBreaker } from './api.js';

const LOCAL_POEMS_URL = './src/poems.local.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── DOM 引用 ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  typeChips:     $('pc-type-chips'),
  dynastyChips:  $('pc-dynasty-chips'),
  drawBtn:       $('pc-draw'),
  slot:          $('pc-card-slot'),
  gallery:       $('pc-gallery'),
  gCount:        $('pc-gallery-count'),
  clear:         $('pc-clear'),
  favPanel:      $('pc-favorites-panel'),
  searchInput:   $('pc-search'),
  statsPanel:    $('pc-stats'),
  themeToggle:   $('pc-theme-toggle'),
};

// ── 存储 ───────────────────────────────────────────────────
const LS_KEYS = { history: 'pc_v2_history', favs: 'pc_v2_favs', filters: 'pc_v2_filters', theme: 'pc_v2_theme' };
const memFallback = new Map();
const memLS = {
  getItem: k => memFallback.has(k) ? memFallback.get(k) : null,
  setItem: (k, v) => memFallback.set(k, String(v)),
  removeItem: k => memFallback.delete(k),
};
const ls = (() => {
  try {
    const t = '__pc_test__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch { return memLS; }
})();
function safeParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }
function loadJSON(key, fb) {
  const raw = ls.getItem(key);
  return raw == null ? fb : safeParse(raw, fb);
}
function saveJSON(key, val) {
  try { ls.setItem(key, JSON.stringify(val)); } catch {}
}

const store = {
  history: () => loadJSON(LS_KEYS.history, []),
  saveHistory: (h) => saveJSON(LS_KEYS.history, h),
  favs: () => new Set(loadJSON(LS_KEYS.favs, [])),
  saveFavs: (set) => saveJSON(LS_KEYS.favs, [...set]),
  filters: () => loadJSON(LS_KEYS.filters, { type: 'all', dynasty: 'all' }),
  saveFilters: (f) => saveJSON(LS_KEYS.filters, f),
  theme: () => ls.getItem(LS_KEYS.theme) || 'auto',
  saveTheme: (t) => { try { ls.setItem(LS_KEYS.theme, t); } catch {} },
};

// ── API 调用（统一请求层：令牌桶 + 退避 + 熔断） ──────────
async function loadTypes() {
  const list = await apiRequest('/api/types');
  return list.filter(t => t.id !== 99);
}
async function loadDynasties() {
  return await apiRequest('/api/dynasties');
}
async function randomPoem() {
  return await apiRequest('/api/poems/random', { maxRetries: 2 });
}

// ── 运行状态 ──────────────────────────────────────────────
const state = {
  typeFilter: 'all',
  dynastyFilter: 'all',
  appMode: 'online',   // online | degraded
  drawing: false,
};

let localPoems = [];
let typesList = [];
let dynastiesList = [];
const allKnownPoems = new Map(); // id -> poem（抽到的、搜索到的、收藏的）
let currentPoem = null;
let favs = store.favs();

// ── 降级横幅 ──────────────────────────────────────────────
function degradedBannerEl() { return document.getElementById('pc-degraded'); }
function showDegradedBanner(kind) {
  const el = degradedBannerEl();
  if (!el) return;
  const msg = kind === 'offline'
    ? '网络已断开，已切换本地诗词库（70 首）'
    : '诗泉接口暂不可用（限流/错误），已切换本地诗词库（70 首）';
  el.querySelector('.pc-degraded-msg').textContent = '⚠ ' + msg;
  el.classList.add('pc-degraded--show');
  if (state.appMode !== 'degraded') {
    state.appMode = 'degraded';
    toast('请求失败，已降级到本地库，可点横幅「重试恢复」');
  }
}
function hideDegradedBanner() {
  const el = degradedBannerEl();
  if (el) el.classList.remove('pc-degraded--show');
  if (state.appMode === 'degraded') state.appMode = 'online';
}
async function attemptRecover() {
  resetBreaker();
  try {
    await apiRequest('/api/poems/random', { maxRetries: 1 });
    hideDegradedBanner();
    toast('已恢复在线模式');
  } catch {
    toast('仍不可用，继续本地模式');
  }
}

// ── 筛选逻辑 ──────────────────────────────────────────────
function passesFilter(poem) {
  if (state.typeFilter !== 'all' && poem.type?.id !== Number(state.typeFilter)) return false;
  if (state.dynastyFilter !== 'all' && poem.dynasty?.id !== Number(state.dynastyFilter)) return false;
  return true;
}

function pickLocalOne(preferUnseen = true) {
  if (!localPoems.length) return null;
  let candidates = localPoems.filter(passesFilter);
  if (preferUnseen) {
    const unseen = candidates.filter(p => !allKnownPoems.has(p.id));
    if (unseen.length) candidates = unseen;
  }
  if (!candidates.length) candidates = localPoems.filter(p => !preferUnseen || !allKnownPoems.has(p.id));
  if (!candidates.length) candidates = localPoems;
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

// ── 图片多源守护 ──────────────────────────────────────────
const IMG_TIMEOUT_MS = 4500;

function imageKeyword(poem) {
  const parts = [
    poem.dynasty?.name || '',
    poem.type?.name || '',
    poem.author?.name?.slice(0, 1) || '',
    'chinese painting',
  ].filter(Boolean);
  return encodeURIComponent(parts.join(' '));
}

async function tryBackgroundImage(poem) {
  const sources = [
    (kw) => `https://source.unsplash.com/featured/800x600?${kw},landscape,traditional`,
    (kw) => `https://picsum.photos/seed/poem${poem.id}/800/600`,
  ];
  for (const src of sources) {
    const url = src(imageKeyword(poem));
    try {
      const ok = await preloadImage(url, IMG_TIMEOUT_MS);
      if (ok) return url;
    } catch {}
  }
  return null;
}

function preloadImage(url, timeout) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeout);
    img.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(true); } };
    img.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve(false); } };
    img.src = url;
  });
}

// ── 视图渲染 ──────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const ICONS = {
  starFill: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
  starEmpty: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.03 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 2c-1.05 0-2.05.16-3 .46 1.69 1.24 2.79 3.25 2.79 5.54 0 3.87-3.13 7-7 7-1.06 0-2.06-.24-2.98-.66C.89 19.4 5.43 22 10.5 22 16.85 22 22 16.85 22 10.5S16.85-1 10.5-1c-.55 0-1.08.05-1.6.14.62.48 1.1 1.1 1.4 1.82z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm13-4.66l1.79-1.8 1.41 1.41-1.79 1.79-1.41-1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.87 0-7 3.13-7 7s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 12.5c-3.03 0-5.5-2.47-5.5-5.5s2.47-5.5 5.5-5.5 5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5z"/></svg>`,
};

function renderCardEl(poem, { mode = 'main' } = {}) {
  const el = document.createElement('article');
  el.className = 'pc-card' + (mode === 'gallery' ? ' pc-card--mini' : '');
  el.dataset.poemId = poem.id;

  const sealHtml = mode === 'main' ? '<div class="pc-card-seal">诗</div>' : '';
  const linesHtml = mode === 'main'
    ? (poem.content || []).map(l => `<p class="pc-line">${escapeHtml(l)}</p>`).join('')
    : '';
  const titleClass = mode === 'main' ? 'pc-title' : 'pc-title pc-title--mini';

  el.innerHTML = `
    ${sealHtml}
    <h3 class="${titleClass}">${escapeHtml(poem.title)}</h3>
    <div class="pc-author">${escapeHtml(poem.author?.name || '')} · ${escapeHtml(poem.dynasty?.name || '')} · ${escapeHtml(poem.type?.name || '')}</div>
    <div class="pc-content">${linesHtml}</div>
  `;
  return el;
}

function renderDetailEl(poem, isFav) {
  const el = document.createElement('div');
  el.className = 'pc-detail';
  const lines = (poem.content || []).map(l => `<p>${escapeHtml(l)}</p>`).join('');
  el.innerHTML = `
    <button class="pc-close" type="button" aria-label="关闭">×</button>
    <h2 class="pc-title">${escapeHtml(poem.title)}</h2>
    <div class="pc-author">${escapeHtml(poem.author?.name || '')} · ${escapeHtml(poem.dynasty?.name || '')} · ${escapeHtml(poem.type?.name || '')}</div>
    <div class="pc-content">${lines}</div>
    <div class="pc-actions">
      <button class="pc-copy-btn" type="button">${ICONS.copy} 复制全文</button>
      <button class="pc-fav-btn ${isFav ? 'is-fav' : ''}" type="button">${isFav ? ICONS.starFill : ICONS.starEmpty} ${isFav ? '已收藏' : '收藏'}</button>
    </div>
  `;
  return el;
}

// ── 历史 / 收藏 / 搜索 / 统计 ─────────────────────────────
function pushToHistory(poem) {
  const h = store.history();
  h.push({ id: poem.id, drawnAt: Date.now() });
  if (h.length > 5000) h.splice(0, h.length - 5000);
  store.saveHistory(h);
}

function refreshGallery() {
  const h = store.history();
  els.gallery.innerHTML = '';
  const sorted = [...h].sort((a, b) => b.drawnAt - a.drawnAt);
  for (const entry of sorted) {
    const poem = allKnownPoems.get(entry.id);
    if (!poem) continue;
    const el = renderCardEl(poem, { mode: 'gallery' });
    el.addEventListener('click', () => openDetail(poem));
    els.gallery.appendChild(el);
  }
  els.gCount.textContent = `共 ${els.gallery.children.length} 张`;
  if (els.gallery.lastElementChild) {
    els.gallery.lastElementChild.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  }
}

function refreshFavorites() {
  els.favPanel.innerHTML = '';
  const ids = [...favs];
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'pc-empty';
    empty.style.fontSize = '13px';
    empty.textContent = '暂无收藏，点详情里的星标收藏喜欢的诗';
    els.favPanel.appendChild(empty);
    return;
  }
  for (const id of ids) {
    const poem = allKnownPoems.get(id);
    if (!poem) continue;
    const el = renderCardEl(poem, { mode: 'gallery' });
    el.addEventListener('click', () => openDetail(poem));
    els.favPanel.appendChild(el);
  }
}

function collectSearchIndex() {
  const idx = new Map(allKnownPoems);
  for (const p of localPoems) if (!idx.has(p.id)) idx.set(p.id, p);
  return [...idx.values()];
}

function doSearch(query) {
  const q = query.trim().toLowerCase();
  const list = collectSearchIndex();
  if (!q) return list;
  return list.filter(p => {
    const title = p.title || '';
    const author = p.author?.name || '';
    const dynasty = p.dynasty?.name || '';
    const content = (p.content || []).join('');
    return title.toLowerCase().includes(q)
      || author.toLowerCase().includes(q)
      || dynasty.toLowerCase().includes(q)
      || content.toLowerCase().includes(q);
  });
}

function renderSearchResults(poems) {
  els.gallery.innerHTML = '';
  for (const poem of poems) {
    const el = renderCardEl(poem, { mode: 'gallery' });
    el.addEventListener('click', () => openDetail(poem));
    els.gallery.appendChild(el);
  }
  els.gCount.textContent = `找到 ${poems.length} 首`;
}

function refreshStats() {
  if (!els.statsPanel) return;
  const h = store.history();
  const total = h.length;
  const counts = new Map();
  for (const entry of h) {
    const poem = allKnownPoems.get(entry.id);
    if (!poem) continue;
    const name = poem.dynasty?.name || '未知';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = sorted.length ? Math.max(...sorted.map(x => x[1])) : 1;

  let barsHtml = '';
  for (const [name, count] of sorted) {
    const pct = Math.round((count / max) * 100);
    barsHtml += `
      <div class="pc-stat-bar">
        <span class="pc-stat-label">${escapeHtml(name)}</span>
        <div class="pc-stat-track"><div class="pc-stat-fill" style="width:${pct}%"></div></div>
        <span class="pc-stat-num">${count}</span>
      </div>`;
  }
  els.statsPanel.innerHTML = `
    <div class="pc-stats-header">
      <span>已抽 ${total} 签</span>
      ${sorted.length ? '<span>朝代分布</span>' : ''}
    </div>
    ${barsHtml}
  `;
}

// ── Toast / 弹窗 ─────────────────────────────────────────
function toast(msg, ms = 1800) {
  let host = document.getElementById('pc-toast');
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

function showOverlay(node) {
  let ov = document.getElementById('pc-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pc-overlay';
    ov.className = 'pc-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) hideOverlay(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = '';
  ov.appendChild(node);
  ov.classList.add('pc-overlay--show');
}
function hideOverlay() {
  const ov = document.getElementById('pc-overlay');
  if (ov) ov.classList.remove('pc-overlay--show');
}

async function copyText(text) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

// ── 主流程 ───────────────────────────────────────────────
function showSkeleton() {
  els.slot.innerHTML = `
    <div class="pc-skeleton">
      <div class="pc-skeleton-card"><span class="pc-shimmer"></span></div>
      <div class="pc-skeleton-text">正在寻诗…</div>
    </div>`;
}

async function showCard(poem) {
  allKnownPoems.set(poem.id, poem);
  currentPoem = poem;
  els.slot.innerHTML = '';
  const card = renderCardEl(poem, { mode: 'main' });
  card.classList.add('pc-card--flip');
  card.addEventListener('click', () => openDetail(poem));
  els.slot.appendChild(card);
  const imgUrl = await tryBackgroundImage(poem);
  if (imgUrl && currentPoem && currentPoem.id === poem.id) {
    card.style.backgroundImage = `url("${imgUrl}")`;
    requestAnimationFrame(() => card.classList.add('pc-card--loaded'));
  }
}

async function drawOnce() {
  if (state.drawing) return;
  state.drawing = true;
  els.drawBtn.disabled = true;
  const originalText = els.drawBtn.innerHTML;
  els.drawBtn.innerHTML = `<span class="pc-spinner"></span>寻诗中`;
  showSkeleton();
  try {
    let poem = null;
    let fromApi = true;
    try {
      poem = await randomPoem();
    } catch (e) {
      console.warn('random failed', e);
      poem = pickLocalOne(true);
      fromApi = false;
      if (poem) {
        const kind = (!navigator.onLine || e.kind === 'network') ? 'offline' : 'api';
        showDegradedBanner(kind);
      } else {
        toast('请求失败，请稍后重试');
        els.slot.innerHTML = '<p class="pc-empty">请求失败，请稍后重试</p>';
        return;
      }
    }

    // 若 API 返回的诗不符合当前筛选，优先用本地库匹配筛选（仍只调了 1 次 random）
    if (fromApi && !passesFilter(poem)) {
      const local = pickLocalOne(true);
      if (local) poem = local;
    }

    await showCard(poem);
    pushToHistory(poem);
    refreshGallery();
    refreshStats();
    if (fromApi && state.appMode === 'degraded') {
      hideDegradedBanner();
      toast('诗泉接口已恢复');
    }
  } catch (e) {
    console.error(e);
    toast('请求失败，请稍后重试');
    els.slot.innerHTML = '<p class="pc-empty">请求失败，请稍后重试</p>';
  } finally {
    state.drawing = false;
    els.drawBtn.disabled = false;
    els.drawBtn.innerHTML = originalText;
  }
}

function openDetail(poem) {
  const isFav = favs.has(poem.id);
  const node = renderDetailEl(poem, isFav);
  node.querySelector('.pc-close').onclick = hideOverlay;
  node.querySelector('.pc-copy-btn').onclick = () => {
    const text = `${poem.title}\n${poem.author?.name || ''} · ${poem.dynasty?.name || ''}\n\n${(poem.content || []).join('\n')}`;
    copyText(text).then(() => toast('已复制到剪贴板'));
  };
  node.querySelector('.pc-fav-btn').onclick = () => {
    if (favs.has(poem.id)) {
      favs.delete(poem.id);
      toast('已取消收藏');
    } else {
      favs.add(poem.id);
      toast('已加入收藏');
    }
    store.saveFavs(favs);
    refreshFavorites();
    const newIsFav = favs.has(poem.id);
    const btn = node.querySelector('.pc-fav-btn');
    btn.innerHTML = `${newIsFav ? ICONS.starFill : ICONS.starEmpty} ${newIsFav ? '已收藏' : '收藏'}`;
    btn.classList.toggle('is-fav', newIsFav);
  };
  showOverlay(node);
  tryBackgroundImage(poem).then(url => {
    if (url) node.style.backgroundImage = `url("${url}")`;
  });
}

// ── 筛选芯片 UI ───────────────────────────────────────────
function renderChips(container, items, field, current) {
  container.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'pc-chip' + (current === 'all' ? ' is-active' : '');
  allBtn.textContent = '不限';
  allBtn.dataset.value = 'all';
  allBtn.addEventListener('click', () => setFilter(field, 'all'));
  container.appendChild(allBtn);

  for (const it of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pc-chip' + (String(current) === String(it.id) ? ' is-active' : '');
    btn.textContent = it.name;
    btn.dataset.value = String(it.id);
    btn.addEventListener('click', () => setFilter(field, String(it.id)));
    container.appendChild(btn);
  }
}

function setFilter(field, value) {
  if (field === 'type') state.typeFilter = value;
  if (field === 'dynasty') state.dynastyFilter = value;
  store.saveFilters({ type: state.typeFilter, dynasty: state.dynastyFilter });
  renderChips(els.typeChips, typesList, 'type', state.typeFilter);
  renderChips(els.dynastyChips, dynastiesList, 'dynasty', state.dynastyFilter);
}

function buildSelectsFromLocal() {
  typesList = [];
  dynastiesList = [];
  const tSeen = new Set(), dSeen = new Set();
  for (const p of localPoems) {
    if (p.type && !tSeen.has(p.type.id)) { tSeen.add(p.type.id); typesList.push(p.type); }
    if (p.dynasty && !dSeen.has(p.dynasty.id)) { dSeen.add(p.dynasty.id); dynastiesList.push(p.dynasty); }
  }
  renderChips(els.typeChips, typesList, 'type', state.typeFilter);
  renderChips(els.dynastyChips, dynastiesList, 'dynasty', state.dynastyFilter);
}

// ── 暗色模式 ──────────────────────────────────────────────
function applyTheme(mode) {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark);
  document.documentElement.classList.toggle('pc-dark', isDark);
  if (els.themeToggle) {
    els.themeToggle.innerHTML = isDark ? ICONS.moon : ICONS.sun;
    els.themeToggle.setAttribute('aria-pressed', String(isDark));
    els.themeToggle.title = mode === 'auto' ? '跟随系统' : (isDark ? '暗色模式' : '亮色模式');
  }
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const current = store.theme();
  const next = order[(order.indexOf(current) + 1) % order.length];
  store.saveTheme(next);
  applyTheme(next);
  toast(next === 'auto' ? '已跟随系统主题' : (next === 'dark' ? '已切换暗色' : '已切换亮色'));
}

// ── PWA ───────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  }
}

// ── 初始化 ───────────────────────────────────────────────
async function init() {
  // 预载本地兜底诗词库
  try {
    const r = await fetch(LOCAL_POEMS_URL, { cache: 'no-cache' });
    if (r.ok) localPoems = await r.json();
  } catch { localPoems = []; }

  // 主题
  applyTheme(store.theme());
  if (els.themeToggle) els.themeToggle.addEventListener('click', cycleTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.theme()));

  // 筛选
  const saved = store.filters();
  state.typeFilter = saved.type || 'all';
  state.dynastyFilter = saved.dynasty || 'all';

  // 加载元数据
  try {
    const [types, dynasties] = await Promise.all([loadTypes(), loadDynasties()]);
    typesList = types;
    dynastiesList = dynasties;
    renderChips(els.typeChips, typesList, 'type', state.typeFilter);
    renderChips(els.dynastyChips, dynastiesList, 'dynasty', state.dynastyFilter);
  } catch (e) {
    console.error('元数据加载失败', e);
    if (localPoems.length) {
      buildSelectsFromLocal();
      const kind = (!navigator.onLine || (e && e instanceof ApiError && e.kind === 'network')) ? 'offline' : 'api';
      showDegradedBanner(kind);
    } else {
      toast('诗泉 API 不可用，请检查网络');
    }
  }

  // 恢复已知诗库（历史 + 收藏）
  for (const id of favs) allKnownPoems.set(id, null);
  for (const entry of store.history()) allKnownPoems.set(entry.id, null);

  // 事件绑定
  els.drawBtn.addEventListener('click', drawOnce);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !['INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName)) {
      e.preventDefault();
      drawOnce();
    }
  });
  const recoverBtn = document.getElementById('pc-recover');
  if (recoverBtn) recoverBtn.addEventListener('click', attemptRecover);
  els.clear.addEventListener('click', () => {
    if (confirm('清空所有抽取历史？')) {
      store.saveHistory([]);
      refreshGallery();
      refreshStats();
      toast('已清空历史');
    }
  });

  // 搜索
  if (els.searchInput) {
    let t;
    els.searchInput.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = e.target.value.trim();
        if (q) renderSearchResults(doSearch(q));
        else refreshGallery();
      }, 180);
    });
  }

  refreshGallery();
  refreshFavorites();
  refreshStats();
  registerSW();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
