import { describe, it, expect } from 'vitest';
import { filterByCategory, getCategories } from '../src/filter.js';

const poems = [
  { id: 'a', category: '唐诗精选', dynasty: '唐' },
  { id: 'b', category: '宋词精选', dynasty: '宋' },
  { id: 'c', category: '小学古诗', dynasty: '唐' },
  { id: 'd', category: '唐诗精选', dynasty: '唐' },
];

describe('filter', () => {
  it('all 返回全部', () => {
    expect(filterByCategory(poems, 'all').length).toBe(4);
  });

  it('按分类筛选', () => {
    expect(filterByCategory(poems, '唐诗精选').map(p => p.id)).toEqual(['a', 'd']);
  });

  it('未知分类返回 []', () => {
    expect(filterByCategory(poems, '不存在')).toEqual([]);
  });

  it('空数组', () => {
    expect(filterByCategory([], '唐诗精选')).toEqual([]);
  });

  it('getCategories 返回带"全部"的不重复分类列表', () => {
    expect(getCategories({}, poems)).toEqual(['全部', '唐诗精选', '宋词精选', '小学古诗']);
  });

  it('不修改原数组', () => {
    const arr = JSON.stringify(poems);
    filterByCategory(poems, '唐诗精选');
    expect(JSON.stringify(poems)).toBe(arr);
  });
});