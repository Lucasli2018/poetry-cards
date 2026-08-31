import { describe, it, expect } from 'vitest';
import { formatTime, randomInt, safeJSONParse, clone } from '../src/utils.js';

describe('utils', () => {
  it('formatTime 格式化为 YYYY-MM-DD HH:mm', () => {
    const ms = new Date('2026-08-31T15:30:00').getTime();
    expect(formatTime(ms)).toBe('2026-08-31 15:30');
  });

  it('randomInt 返回 [0, max)', () => {
    for (let i = 0; i < 50; i++) {
      const v = randomInt(3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });

  it('safeJSONParse 解析失败返回 fallback', () => {
    expect(safeJSONParse('{a:1}', { ok: false })).toEqual({ ok: false });
    expect(safeJSONParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it('clone 深拷贝', () => {
    const o = { a: 1, b: { c: 2 } };
    const c = clone(o);
    c.b.c = 99;
    expect(o.b.c).toBe(2);
  });
});