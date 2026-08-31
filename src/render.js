import { renderCard } from './card.js';

export function renderGallery(history, getById) {
  const frag = document.createDocumentFragment();
  const sorted = [...history].sort((a, b) => b.drawnAt - a.drawnAt);
  for (const h of sorted) {
    const poem = getById(h.id);
    if (!poem) continue;
    frag.appendChild(renderCard(poem, { mode: 'gallery' }));
  }
  return frag;
}

export function renderDetail(poem, isFavorite, callbacks = {}) {
  const { onCopy, onToggleFav, onClose } = callbacks;
  const el = document.createElement('div');
  el.className = 'pc-detail';
  const lines = (poem.content || []).map(line => `<p>${escape(line)}</p>`).join('');
  el.innerHTML = `
    <button class="pc-close" aria-label="关闭">×</button>
    <h2 class="pc-title">${escape(poem.title)}</h2>
    <div class="pc-author">${escape(poem.author || '')} · ${escape(poem.dynasty || '')} · ${escape(poem.category || '')}</div>
    <div class="pc-content">${lines}</div>
    ${poem.translate ? `<section class="pc-translate"><h4>译文</h4><p>${escape(poem.translate)}</p></section>` : ''}
    ${poem.authorBio ? `<section class="pc-bio"><h4>作者简介</h4><p>${escape(poem.authorBio)}</p></section>` : ''}
    <div class="pc-actions">
      <button class="pc-copy-btn">复制全文</button>
      <button class="pc-fav-btn">${isFavorite ? '★ 已收藏' : '☆ 收藏'}</button>
    </div>
  `;
  if (onCopy) el.querySelector('.pc-copy-btn').onclick = () => onCopy(poem);
  if (onToggleFav) el.querySelector('.pc-fav-btn').onclick = () => onToggleFav(poem);
  if (onClose) el.querySelector('.pc-close').onclick = () => onClose();
  return el;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}