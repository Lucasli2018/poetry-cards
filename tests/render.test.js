import { describe, it, expect } from 'vitest';
import { renderCard } from '../src/card.js';
import { renderGallery, renderDetail } from '../src/render.js';

const poem = {
  id: 'a', title: '静夜思', author: '李白', dynasty: '唐', category: '小学古诗',
  content: ['床前明月光', '疑是地上霜'],
};
const full = { ...poem, translate: '译', authorBio: '简介' };

describe('render', () => {
  it('renderCard 主卡片包含 title/author/content', () => {
    const el = renderCard(poem, { mode: 'main' });
    expect(el.classList.contains('pc-card')).toBe(true);
    expect(el.querySelector('.pc-title').textContent).toBe('静夜思');
    expect(el.querySelector('.pc-author').textContent).toContain('李白');
    expect(el.querySelectorAll('.pc-line').length).toBe(2);
  });

  it('renderCard 画廊模式带缩略', () => {
    const el = renderCard(poem, { mode: 'gallery' });
    expect(el.classList.contains('pc-card--mini')).toBe(true);
  });

  it('renderGallery 按时间倒序', () => {
    const history = [{ id: 'a', drawnAt: 100 }, { id: 'b', drawnAt: 200 }];
    const getById = id => ({ id, title: id, content: ['x'] });
    const frag = renderGallery(history, getById);
    const cards = frag.querySelectorAll('.pc-card--mini');
    expect(cards[0].dataset.poemId).toBe('b');
    expect(cards[1].dataset.poemId).toBe('a');
  });

  it('renderDetail 含译文/简介/复制/收藏', () => {
    const el = renderDetail(full, false, { onCopy: () => {}, onToggleFav: () => {}, onClose: () => {} });
    expect(el.querySelector('.pc-translate')).toBeTruthy();
    expect(el.querySelector('.pc-bio')).toBeTruthy();
    expect(el.querySelector('.pc-copy-btn')).toBeTruthy();
    expect(el.querySelector('.pc-fav-btn')).toBeTruthy();
  });

  it('renderCard 不修改原对象', () => {
    const orig = JSON.stringify(poem);
    renderCard(poem, { mode: 'main' });
    expect(JSON.stringify(poem)).toBe(orig);
  });
});