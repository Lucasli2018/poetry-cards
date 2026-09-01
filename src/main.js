// =============================================================
// 古韵抽卡 v2.1 · 零依赖 · 诗泉在线
// 令牌桶主动限流 + 熔断 + 指数退避(全抖动) + 显式失败/本地降级 + 骨架屏
// API: https://poetry.palemoky.com
// =============================================================

import { apiRequest, ApiError, resetBreaker } from './api.js';

const LOCAL_POEMS_URL = './src/poems.local.json';
const FETCH_BATCH = 3;          // 每轮并发随机请求数（令牌桶另限同时在途 ≤2）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── DOM 引用 ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  type:     $('pc-type'),
  dynasty:  $('pc-dynasty'),
  drawBtn:  $('pc-draw'),
  slot:     $('pc-card-slot'),
  gallery:  $('pc-gallery'),
  gCount:   $('pc-gallery-count'),
  clear:    $('pc-clear'),
  favPanel: $('pc-favorites-panel'),
};

// ── 存储 ───────────────────────────────────────────────────
const LS_KEYS = { history: 'pc_v2_history', favs: 'pc_v2_favs', filters: 'pc_v2_filters' };
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

// ── 抽卡池（客户端过滤） ──────────────────────────────────
const pool = {
  items: [],
  seenIds: new Set(),
  typeFilter: 'all',
  dynastyFilter: 'all',
  inflight: false,
  usingLocal: false,   // 是否已切换到本地兜底库
};

// 本地内置诗词库（API 限流 / 不可用时启用）
let localPoems = [];

// ── 运行状态：online | degraded ──────────────────────────
// degraded = 诗泉接口不可用（限流/离线/错误），已切换本地库但仍可抽卡
let appMode = 'online';
function degradedBannerEl() { return document.getElementById('pc-degraded'); }
function showDegradedBanner(kind) {
  const el = degradedBannerEl();
  if (!el) return;
  const msg = kind === 'offline'
    ? '网络已断开，已切换本地诗词库（70 首）'
    : '诗泉接口暂不可用（限流/错误），已切换本地诗词库（70 首）';
  el.querySelector('.pc-degraded-msg').textContent = '⚠ ' + msg;
  el.classList.add('pc-degraded--show');
  if (appMode !== 'degraded') {
    appMode = 'degraded';
    toast('请求失败，已降级到本地库，可点横幅「重试恢复」');
  }
}
function hideDegradedBanner() {
  const el = degradedBannerEl();
  if (el) el.classList.remove('pc-degraded--show');
  if (appMode === 'degraded') appMode = 'online';
}
// 「重试恢复」：复位熔断器并探测一次，成功则回到在线模式
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

function passesFilter(poem) {
  if (pool.typeFilter !== 'all' && poem.type.id !== Number(pool.typeFilter)) return false;
  if (pool.dynastyFilter !== 'all' && poem.dynasty.id !== Number(pool.dynastyFilter)) return false;
  return true;
}

// 用本地库补齐抽卡池。优先匹配当前筛选，匹配不到则放宽筛选兜底，
// 保证「抽卡永远能抽到东西」。返回本次新加入的数量。
function fillFromLocal(targetSize) {
  if (!localPoems.length) return 0;
  const unseen = localPoems.filter(p => !pool.seenIds.has(p.id));
  let candidates = unseen.filter(passesFilter);
  if (candidates.length === 0) candidates = unseen; // 放宽：本地库兜底不限筛选
  let added = 0;
  for (const p of candidates) {
    if (pool.items.length >= targetSize) break;
    if (pool.items.some(it => it.id === p.id)) continue;
    pool.seenIds.add(p.id);
    pool.items.push(p);
    added++;
  }
  if (added > 0 && !pool.usingLocal) pool.usingLocal = true;
  return added;
}

async function refillPool(targetSize = 40, maxRounds = 60) {
  if (pool.inflight) return;
  pool.inflight = true;
  let emptyRounds = 0;
  try {
    let rounds = 0;
    while (pool.items.length < targetSize && rounds < maxRounds) {
      rounds++;
      // 经统一请求层（令牌桶 + 退避 + 熔断）；失败时保留错误对象用于判断类型
      const batch = await Promise.all(Array.from({ length: FETCH_BATCH }, async () => {
        try { return await randomPoem(); }
        catch (e) { return e; }
      }));
      let got = 0;
      for (const p of batch) {
        if (!p || p instanceof Error) continue;
        got++;
        if (pool.seenIds.has(p.id)) continue;
        pool.seenIds.add(p.id);
        if (passesFilter(p)) pool.items.push(p);
      }
      if (got > 0) {
        // 拿到数据 → 若此前处于降级态，尝试自动恢复在线
        if (appMode === 'degraded') { hideDegradedBanner(); toast('诗泉接口已恢复'); }
        emptyRounds = 0;
      } else {
        // 本轮全部失败（很可能 429 / 离线）
        emptyRounds++;
        if (emptyRounds >= 2) {
          const err = batch.find(x => x instanceof Error);
          const kind = (!navigator.onLine || (err && err.kind === 'network')) ? 'offline' : 'api';
          showDegradedBanner(kind);
          fillFromLocal(targetSize);
          break;
        }
        await sleep(1200 * emptyRounds);
      }
    }
    // 池仍不足（如筛选过窄 + 本地也匹配不上）→ 兜底补齐并提示
    if (pool.items.length < targetSize) {
      if (appMode !== 'degraded') showDegradedBanner('api');
      fillFromLocal(targetSize);
    }
  } finally {
    pool.inflight = false;
  }
}

function pickOne() {
  if (pool.items.length === 0) return null;
  return pool.items[Math.floor(Math.random() * pool.items.length)];
}

function consumeOne(picked) {
  const idx = pool.items.findIndex(p => p.id === picked.id);
  if (idx >= 0) pool.items.splice(idx, 1);
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
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}

// ── 视图渲染 ──────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderCardEl(poem, { mode = 'main' } = {}) {
  const el = document.createElement('article');
  el.className = 'pc-card' + (mode === 'gallery' ? ' pc-card--mini' : '');
  el.dataset.poemId = poem.id;

  const sealHtml = mode === 'main'
    ? '<div class="pc-card-seal">诗</div>' : '';
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
      <button class="pc-copy-btn" type="button">复制全文</button>
      <button class="pc-fav-btn ${isFav ? 'is-fav' : ''}" type="button">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
    </div>
  `;
  return el;
}

// ── 历史 / 收藏 ──────────────────────────────────────────
let favs = store.favs();
let poemsById = new Map();
let currentPoem = null;

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
    const poem = poemsById.get(entry.id);
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
    empty.textContent = '暂无收藏，点详情里的☆收藏喜欢的诗';
    els.favPanel.appendChild(empty);
    return;
  }
  for (const id of ids) {
    const poem = poemsById.get(id);
    if (!poem) continue;
    const el = renderCardEl(poem, { mode: 'gallery' });
    el.addEventListener('click', () => openDetail(poem));
    els.favPanel.appendChild(el);
  }
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
  poemsById.set(poem.id, poem);
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
  if (els.drawBtn.disabled) return;
  els.drawBtn.disabled = true;
  const originalText = els.drawBtn.textContent;
  els.drawBtn.textContent = '寻 诗 中';
  showSkeleton();
  try {
    if (pool.items.length === 0) {
      await refillPool(40, 60);
    }
    let picked = pickOne();
    if (!picked) {
      await refillPool(80, 120);
      picked = pickOne();
    }
    if (!picked) {
      toast('当前过滤无数据，请放宽筛选');
      els.slot.innerHTML = '<p class="pc-empty">暂无符合条件的诗</p>';
      return;
    }
    consumeOne(picked);
    await showCard(picked);
    pushToHistory(picked);
    refreshGallery();
    if (pool.items.length < 20) refillPool(40, 60);
  } catch (e) {
    console.error(e);
    toast('请求失败，请稍后重试');
    els.slot.innerHTML = '<p class="pc-empty">请求失败，请稍后重试</p>';
  } finally {
    els.drawBtn.disabled = false;
    els.drawBtn.textContent = originalText;
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
    btn.textContent = newIsFav ? '★ 已收藏' : '☆ 收藏';
    btn.classList.toggle('is-fav', newIsFav);
  };
  showOverlay(node);
  tryBackgroundImage(poem).then(url => {
    if (url) node.style.backgroundImage = `url("${url}")`;
  });
}

// ── 初始化 ───────────────────────────────────────────────
function fillSelect(select, items, labelField) {
  const opts = ['<option value="all">不限</option>'];
  for (const it of items) {
    opts.push(`<option value="${it.id}">${escapeHtml(it[labelField])}</option>`);
  }
  select.innerHTML = opts.join('');
}

// 元数据拉取失败时，用本地库的体裁 / 朝代目录兜底填下拉框
function buildSelectsFromLocal() {
  const types = [], dyn = [];
  const tSeen = new Set(), dSeen = new Set();
  for (const p of localPoems) {
    if (p.type && !tSeen.has(p.type.id)) { tSeen.add(p.type.id); types.push(p.type); }
    if (p.dynasty && !dSeen.has(p.dynasty.id)) { dSeen.add(p.dynasty.id); dyn.push(p.dynasty); }
  }
  fillSelect(els.type, types, 'name');
  fillSelect(els.dynasty, dyn, 'name');
}

async function init() {
  // 预载本地兜底诗词库（不影响首屏，失败时抽卡仍可走 API）
  try {
    const r = await fetch(LOCAL_POEMS_URL, { cache: 'no-cache' });
    if (r.ok) localPoems = await r.json();
  } catch { localPoems = []; }

  const saved = store.filters();
  pool.typeFilter = saved.type || 'all';
  pool.dynastyFilter = saved.dynasty || 'all';

  try {
    const [types, dynasties] = await Promise.all([loadTypes(), loadDynasties()]);
    fillSelect(els.type, types, 'name');
    fillSelect(els.dynasty, dynasties, 'name');
    if ([...els.type.options].some(o => o.value === pool.typeFilter)) els.type.value = pool.typeFilter;
    if ([...els.dynasty.options].some(o => o.value === pool.dynastyFilter)) els.dynasty.value = pool.dynastyFilter;
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

  els.drawBtn.addEventListener('click', drawOnce);
  const recoverBtn = document.getElementById('pc-recover');
  if (recoverBtn) recoverBtn.addEventListener('click', attemptRecover);
  els.type.addEventListener('change', () => {
    pool.typeFilter = els.type.value;
    pool.items = [];
    store.saveFilters({ type: pool.typeFilter, dynasty: pool.dynastyFilter });
  });
  els.dynasty.addEventListener('change', () => {
    pool.dynastyFilter = els.dynasty.value;
    pool.items = [];
    store.saveFilters({ type: pool.typeFilter, dynasty: pool.dynastyFilter });
  });
  els.clear.addEventListener('click', () => {
    if (confirm('清空所有抽取历史？')) {
      store.saveHistory([]);
      refreshGallery();
      toast('已清空历史');
    }
  });

  refreshGallery();
  refreshFavorites();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}