import { describe, it, expect, beforeEach } from 'vitest';
import { _setLS, loadHistory, saveHistory, loadFavorites, toggleFavorite, loadFilter, saveFilter, clearHistory } from '../src/store.js';

const fakeLs = (() => {
  const m = new Map();
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
})();

describe('store', () => {
  beforeEach(() => { _setLS(fakeLs); fakeLs.clear(); });

  it('loadHistory 空数据返回 []', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('saveHistory + loadHistory 往返', () => {
    const data = [{ id: 'a', drawnAt: 1 }];
    saveHistory(data);
    expect(loadHistory()).toEqual(data);
  });

  it('损坏 JSON 兜底为 []', () => {
    fakeLs.setItem('pc_history', '{broken');
    expect(loadHistory()).toEqual([]);
  });

  it('toggleFavorite 切换并返回新状态', () => {
    expect(toggleFavorite('x')).toBe(true);
    expect(loadFavorites().has('x')).toBe(true);
    expect(toggleFavorite('x')).toBe(false);
    expect(loadFavorites().has('x')).toBe(false);
  });

  it('loadFilter 默认 all', () => {
    expect(loadFilter()).toBe('all');
  });

  it('saveFilter + loadFilter 往返', () => {
    saveFilter('唐诗精选');
    expect(loadFilter()).toBe('唐诗精选');
  });

  it('clearHistory 清空历史', () => {
    saveHistory([{ id: 'a', drawnAt: 1 }]);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});