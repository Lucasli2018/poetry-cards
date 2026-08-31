export function renderCard(poem, { mode = 'main' } = {}) {
  const el = document.createElement('article');
  el.className = 'pc-card' + (mode === 'gallery' ? ' pc-card--mini' : '');
  el.dataset.poemId = poem.id;

  const lines = (poem.content || []).map(line =>
    `<p class="pc-line">${escapeHtml(line)}</p>`
  ).join('');

  const sub = `${escapeHtml(poem.author || '')} · ${escapeHtml(poem.dynasty || '')}`;

  if (mode === 'gallery') {
    el.innerHTML = `
      <h4 class="pc-title pc-title--mini">${escapeHtml(poem.title)}</h4>
      <div class="pc-author">${sub}</div>
    `;
  } else {
    el.innerHTML = `
      <h3 class="pc-title">${escapeHtml(poem.title)}</h3>
      <div class="pc-author">${sub}</div>
      <div class="pc-content">${lines}</div>
    `;
  }
  return el;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}