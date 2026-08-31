import { describe, it, expect } from 'vitest';
import { draw } from '../src/draw.js';

const pool = [
  { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
];

describe('draw', () => {
  it('返回 pool 中的元素', () => {
    for (let i = 0; i < 30; i++) {
      const picked = draw(pool, []);
      expect(pool.map(p => p.id)).toContain(picked.id);
    }
  });

  it('空池返回 null', () => {
    expect(draw([], [])).toBe(null);
  });

  it('避免最近 N 次重复', () => {
    const hist = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    for (let i = 0; i < 50; i++) {
      const picked = draw(pool, hist);
      expect(picked.id).not.toBe('a');
      expect(picked.id).not.toBe('b');
      expect(picked.id).not.toBe('c');
    }
  });

  it('可配置 recentWindow', () => {
    const hist = [{ id: 'a' }];
    let sawB = false;
    for (let i = 0; i < 50; i++) {
      const p = draw(pool, hist, { recentWindow: 0 });
      if (p.id === 'b') sawB = true;
    }
    expect(sawB).toBe(true);
  });

  it('全被排除时回退到全池', () => {
    const hist = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    for (let i = 0; i < 20; i++) {
      const p = draw(pool, hist);
      expect(pool.map(x => x.id)).toContain(p.id);
    }
  });

  it('历史为空时不报错', () => {
    expect(() => draw(pool, [])).not.toThrow();
  });
});