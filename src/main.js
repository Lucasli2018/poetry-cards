import { loadPoems, getById, getAll, getMeta } from './data.js';
import { loadHistory, saveHistory, loadFavorites, toggleFavorite, loadFilter, saveFilter, clearHistory } from './store.js';
import { filterByCategory, getCategories } from './filter.js';
import { draw } from './draw.js';
import { renderCard } from './card.js';
import { renderGallery, renderDetail } from './render.js';
import { toast, confirmDialog, copyText, showDetail, hideDetail } from './ui.js';

const els = {
  drawBtn: document.getElementById('pc-draw'),
  cardSlot: document.getElementById('pc-card-slot'),
  category: document.getElementById('pc-category'),
  gallery: document.getElementById('pc-gallery'),
  galleryCount: document.getElementById('pc-gallery-count'),
  clearBtn: document.getElementById('pc-clear'),
  favPanel: document.getElementById('pc-favorites-panel'),
};

let currentPoem = null;
let favorites = new Set();

function renderCategoryOptions(poems) {
  const cats = getCategories(getMeta(), poems);
  els.category.innerHTML = cats.map(c =>
    `<option value="${c === '全部' ? 'all' : c}">${c}</option>`
  ).join('');
  const saved = loadFilter();
  if ([...els.category.options].some(o => o.value === saved)) {
    els.category.value = saved;
  }
}

function applyFilterAndDraw() {
  const category = els.category.value;
  saveFilter(category);
  const pool = filterByCategory(getAll(), category);
  const history = loadHistory();
  currentPoem = draw(pool, history);
  if (!currentPoem) { toast('当前分类无数据'); return; }
  showMainCard(currentPoem);
  appendHistory(currentPoem);
}

function showMainCard(poem) {
  els.cardSlot.innerHTML = '';
  const card = renderCard(poem, { mode: 'main' });
  card.classList.add('pc-card--flip');
  card.addEventListener('click', () => openDetail(poem));
  els.cardSlot.appendChild(card);
  requestAnimationFrame(() => card.classList.remove('pc-card--flip'));
}

function appendHistory(poem) {
  const history = loadHistory();
  history.push({ id: poem.id, drawnAt: Date.now() });
  if (history.length > 5000) history.splice(0, history.length - 5000);
  saveHistory(history);
  refreshGallery();
}

function refreshGallery() {
  els.gallery.innerHTML = '';
  const history = loadHistory();
  const frag = renderGallery(history, getById);
  els.gallery.appendChild(frag);
  els.galleryCount.textContent = `共 ${els.gallery.children.length} 张`;
  // 新卡片滑到末尾
  if (els.gallery.children.length > 0) {
    const last = els.gallery.children[els.gallery.children.length - 1];
    last.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  }
}

function refreshFavoritesPanel() {
  els.favPanel.innerHTML = '';
  const ids = [...favorites];
  const poems = ids.map(getById).filter(Boolean);
  poems.forEach(p => {
    const c = renderCard(p, { mode: 'gallery' });
    c.addEventListener('click', () => openDetail(p));
    els.favPanel.appendChild(c);
  });
  if (poems.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--ink-soft);font-size:13px;margin:0';
    empty.textContent = '暂无收藏，点卡片上的☆收藏喜欢的诗';
    els.favPanel.appendChild(empty);
  }
}

function openDetail(poem) {
  const node = renderDetail(poem, favorites.has(poem.id), {
    onCopy: (p) => {
      const text = `${p.title}\n${p.author} · ${p.dynasty}\n\n${(p.content || []).join('\n')}`;
      copyText(text).then(() => toast('已复制到剪贴板'));
    },
    onToggleFav: (p) => {
      const now = toggleFavorite(p.id);
      favorites = loadFavorites();
      now ? toast('已加入收藏') : toast('已取消收藏');
      refreshFavoritesPanel();
    },
    onClose: hideDetail,
  });
  showDetail(node);
}

async function init() {
  try {
    const { poems } = await loadPoems();
    renderCategoryOptions(poems);
    favorites = loadFavorites();
    refreshGallery();
    refreshFavoritesPanel();
    els.drawBtn.addEventListener('click', applyFilterAndDraw);
    els.category.addEventListener('change', () => saveFilter(els.category.value));
    els.clearBtn.addEventListener('click', () => {
      if (confirmDialog('清空所有抽取历史？')) {
        clearHistory();
        refreshGallery();
        toast('已清空历史');
      }
    });
  } catch (e) {
    toast('诗词加载失败，请刷新重试');
    console.error(e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}