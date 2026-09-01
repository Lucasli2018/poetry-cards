// =============================================================
// 古韵抽卡 v3.1 · store 模块测试
//
// 运行:  node scripts/test-store.mjs
// 设计: 纯 node,无测试框架;每个用例 assertEq 失败即抛错并退出 1。
// 覆盖:
//   - parseSafe(null/非 JSON/缺 version/类型不符/正常)
//   - assertCapacity(未越限/越限)
//   - ymdKey + rolloverIfNeeded(跨日归零)
//   - normalizePoem + assertPoemShape(诗泉结构/本地结构/缺 title)
// =============================================================

import {
  SCHEMA_VERSION, LIMITS, KEY, DEFAULTS,
  parseSafe, dump, CapacityError, assertCapacity,
  ymdKey, rolloverIfNeeded,
  normalizePoem, assertPoemShape,
} from '../src/store/schema.js';

import { createStatsStore } from '../src/store/stats.js';
import { createHistoryStore } from '../src/store/history.js';
import { createFavoritesStore } from '../src/store/favorites.js';

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++;
  failures.push({
    label,
    actual: JSON.stringify(actual),
    expected: JSON.stringify(expected),
  });
}

function truthy(v, label) {
  if (v) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(v), expected: 'truthy' });
}

function throws(fn, ErrorClass, label) {
  try {
    fn();
    failed++;
    failures.push({ label, actual: 'no throw', expected: ErrorClass?.name || 'throw' });
  } catch (e) {
    if (ErrorClass && !(e instanceof ErrorClass)) {
      failed++;
      failures.push({ label, actual: e.constructor.name, expected: ErrorClass.name });
      return;
    }
    passed++;
  }
}

// ───────────────────────────────────────────────────────────
// 1. parseSafe 容错
// ───────────────────────────────────────────────────────────
{
  const def = DEFAULTS.favorites();
  eq(parseSafe(null, DEFAULTS.favorites), def, 'parseSafe: null → default');
  eq(parseSafe(undefined, DEFAULTS.favorites), def, 'parseSafe: undefined → default');
  eq(parseSafe(123, DEFAULTS.favorites), def, 'parseSafe: number → default');
  eq(parseSafe('', DEFAULTS.favorites), def, 'parseSafe: 空串 → default');
  eq(parseSafe('not json', DEFAULTS.favorites), def, 'parseSafe: 坏 JSON → default');
  eq(parseSafe('[]', DEFAULTS.favorites), def, 'parseSafe: 不是对象 → default');
  eq(parseSafe('{"items":[]}', DEFAULTS.favorites), def, 'parseSafe: 缺 version → default');
  eq(parseSafe(`{"version":99,"items":[]}`, DEFAULTS.favorites), def, 'parseSafe: 版本不对 → default');

  const ok = { version: SCHEMA_VERSION, items: [{ id: 1, title: 'X' }] };
  eq(parseSafe(JSON.stringify(ok), DEFAULTS.favorites), ok, 'parseSafe: 正常解析');
}

// ───────────────────────────────────────────────────────────
// 2. dump 往返
// ───────────────────────────────────────────────────────────
{
  const obj = DEFAULTS.statsMeta();
  obj.totalDraws = 5;
  const r = parseSafe(dump(obj), DEFAULTS.statsMeta);
  eq(r.totalDraws, 5, 'dump ↔ parseSafe 往返一致');
}

// ───────────────────────────────────────────────────────────
// 3. assertCapacity
// ───────────────────────────────────────────────────────────
{
  assertCapacity('favorites', 0);                  // 通过
  assertCapacity('favorites', LIMITS.favorites - 1); // 通过(还差 1)
  throws(() => assertCapacity('favorites', LIMITS.favorites), CapacityError, 'assertCapacity: 越限抛 CapacityError');
  throws(() => assertCapacity('favorites', LIMITS.favorites + 100), CapacityError, 'assertCapacity: 超限抛 CapacityError');

  let cap;
  try { assertCapacity('favorites', 200); } catch (e) { cap = e; }
  truthy(cap && cap.kind === 'favorites' && cap.limit === 200 && cap.current === 200,
    'CapacityError 字段(kind/limit/current)完整');
}

// ───────────────────────────────────────────────────────────
// 4. ymdKey + rolloverIfNeeded
// ───────────────────────────────────────────────────────────
{
  eq(ymdKey(new Date('2026-09-01T10:00:00')), '2026-09-01', 'ymdKey: 9 月 1 日');
  eq(ymdKey(new Date('2026-01-05T03:00:00')), '2026-01-05', 'ymdKey: 1 月 5 日');
  eq(ymdKey(new Date('2026-12-31T23:59:59')), '2026-12-31', 'ymdKey: 12 月 31 日');

  // 跨日:meta.todayKey 是昨天 → todayDraws 归零,todayKey 更新
  const meta = { version: SCHEMA_VERSION, totalDraws: 10, todayDraws: 7,
    todayKey: '2026-08-31', dynastyCounter: {}, imageryCounter: {} };
  const now = new Date('2026-09-01T00:00:01');
  const r = rolloverIfNeeded(meta, now);
  eq(r.todayDraws, 0, 'rollover: todayDraws 归零');
  eq(r.todayKey, '2026-09-01', 'rollover: todayKey 更新');
  eq(r.totalDraws, 10, 'rollover: totalDraws 保留');

  // 同日:不变
  const same = rolloverIfNeeded(r, new Date('2026-09-01T12:00:00'));
  eq(same.todayDraws, 0, 'rollover: 同日不变');
  eq(same.todayKey, '2026-09-01', 'rollover: 同日 key 不变');
}

// ───────────────────────────────────────────────────────────
// 5. normalizePoem:诗泉结构(content 数组 + 嵌套 author/dynasty/type)
// ───────────────────────────────────────────────────────────
{
  const poem = {
    id: 12345,
    title: '静夜思',
    content: ['床前明月光', '疑是地上霜'],
    author: { name: '李白' },
    dynasty: { name: '唐' },
    type: { name: '五言绝句' },
  };
  const n = normalizePoem(poem);
  eq(n.id, 12345, 'normalizePoem: id 保留');
  eq(n.title, '静夜思', 'normalizePoem: title 保留');
  eq(n.author, '李白', 'normalizePoem: 嵌套 author.name');
  eq(n.dynasty, '唐', 'normalizePoem: 嵌套 dynasty.name');
  eq(n.type, '五言绝句', 'normalizePoem: 嵌套 type.name');
  eq(n.content, ['床前明月光', '疑是地上霜'], 'normalizePoem: content 数组');
  eq(n.source, 'remote', 'normalizePoem: 默认 source=remote');
}

// 6. normalizePoem:本地结构(content 字符串 + 平铺 author)
// ───────────────────────────────────────────────────────────
{
  const local = {
    id: 'local-1',
    title: '咏鹅',
    content: '鹅鹅鹅\n曲项向天歌\n白毛浮绿水\n红掌拨清波',
    author: '骆宾王',
    dynasty: '唐',
    source: 'local',
  };
  const n = normalizePoem(local);
  eq(n.author, '骆宾王', 'normalizePoem: 平铺 author');
  eq(n.source, 'local', 'normalizePoem: source=local 保留');
  truthy(Array.isArray(n.content) && n.content.length >= 2, 'normalizePoem: content 字符串 → 数组(按行)');
}

// 7. normalizePoem:坏数据兜底
// ───────────────────────────────────────────────────────────
{
  eq(normalizePoem(null), null, 'normalizePoem: null → null');
  eq(normalizePoem(undefined), null, 'normalizePoem: undefined → null');
  eq(normalizePoem('x'), null, 'normalizePoem: 非对象 → null');
  const noTitle = normalizePoem({ content: ['a', 'b'] });
  eq(noTitle.title, '无题', 'normalizePoem: 缺 title → "无题"');
}

// 8. assertPoemShape
// ───────────────────────────────────────────────────────────
{
  const good = { title: 'X', content: ['a'] };
  const r = assertPoemShape(good);
  eq(r.title, 'X', 'assertPoemShape: 通过');
  throws(() => assertPoemShape(null), TypeError, 'assertPoemShape: null 抛 TypeError');
  throws(() => assertPoemShape({}), TypeError, 'assertPoemShape: 缺 title 抛 TypeError');
  // title 数字会被 String() 强转,不会抛
  const coerced = assertPoemShape({ title: 123 });
  eq(coerced.title, '123', 'assertPoemShape: title 数字 → 字符串化');
}

// ───────────────────────────────────────────────────────────
// 9. stats store(注入 Map 适配器,绕过 localStorage)
// ───────────────────────────────────────────────────────────
{
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null),
               setItem: (k, v) => mem.set(k, String(v)) };
  const stats = createStatsStore(ls);

  // 初始
  eq(stats.summary(), { totalDraws: 0, todayDraws: 0, todayKey: '' }, 'stats: 初始 summary');
  eq(stats.topDynasties(3), [], 'stats: 初始 topDynasties 空');
  eq(stats.topImagery(3), [], 'stats: 初始 topImagery 空');

  // 第 1 次抽
  const r1 = stats.onDraw({ dynasty: '唐' }, ['moonlight']);
  eq(r1.totalDraws, 1, 'stats: 第 1 次 totalDraws=1');
  eq(r1.todayDraws, 1, 'stats: 第 1 次 todayDraws=1');
  eq(r1.dynastyCounter, { '唐': 1 }, 'stats: 朝代分布累加');
  eq(r1.imageryCounter, { moonlight: 1 }, 'stats: 意象分布累加');

  // 第 2 次抽
  stats.onDraw({ dynasty: '唐' }, ['moonlight', 'mountain']);
  const r2 = stats.summary();
  eq(r2.totalDraws, 2, 'stats: totalDraws=2');

  // TOP N 按 count 降序
  eq(stats.topDynasties(2), [{ key: '唐', count: 2 }], 'stats: topDynasties=2');
  eq(stats.topImagery(3), [
    { key: 'moonlight', count: 2 },
    { key: 'mountain',  count: 1 },
  ], 'stats: topImagery 排序');

  // 缺 dynasty 不抛
  stats.onDraw({}, []);
  eq(stats.summary().totalDraws, 3, 'stats: 缺字段也能累加 totalDraws');

  // get 返回深拷贝(改原对象不影响 store)
  const snap = stats.get();
  snap.dynastyCounter['唐'] = 999;
  eq(stats.summary().totalDraws, 3, 'stats: get 深拷贝隔离');

  // reset
  stats.reset();
  eq(stats.summary(), { totalDraws: 0, todayDraws: 0, todayKey: '' }, 'stats: reset 后归零');
}

// ───────────────────────────────────────────────────────────
// 10. history store
// ───────────────────────────────────────────────────────────
{
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null),
               setItem: (k, v) => mem.set(k, String(v)) };
  const history = createHistoryStore(ls);

  // 初始
  eq(history.list(), [], 'history: 初始空');
  eq(history.size(), 0, 'history: size=0');

  // push 一首
  const poem = { id: 1, title: '静夜思', author: { name: '李白' }, dynasty: { name: '唐' }, content: ['a'] };
  const e1 = history.push(poem);
  truthy(e1 && e1.title === '静夜思' && e1.drawnAt > 0, 'history: push 返回 entry');
  eq(history.size(), 1, 'history: size=1');
  eq(history.list()[0].title, '静夜思', 'history: list 包含条目');

  // push 本地诗结构(content 字符串)
  const localPoem = { id: 'L2', title: '咏鹅', author: '骆宾王', dynasty: '唐',
                      content: '鹅鹅鹅\n曲项向天歌', source: 'local' };
  history.push(localPoem);
  eq(history.size(), 2, 'history: push 本地诗也累加');

  // 滚动队列:连推 200 条只保留 200
  for (let i = 0; i < 200; i++) history.push({ id: i, title: 't' + i, content: ['x'] });
  eq(history.size(), 200, 'history: 容量上限 200');

  // 再 push 一条,弹出最旧
  history.push({ id: 999, title: 'newest', content: ['x'] });
  eq(history.size(), 200, 'history: 滚动后仍是 200');
  eq(history.list()[0].title, 'newest', 'history: 最新在前');

  // clear
  history.clear();
  eq(history.list(), [], 'history: clear 后空');

  // null poem 不写
  eq(history.push(null), null, 'history: push(null) 返回 null');
  eq(history.push('x'), null, 'history: push 非对象 返回 null');
}

// ───────────────────────────────────────────────────────────
// 11. 工厂校验
// ───────────────────────────────────────────────────────────
{
  throws(() => createStatsStore(null), TypeError, 'createStatsStore(null) 抛错');
  throws(() => createHistoryStore(null), TypeError, 'createHistoryStore(null) 抛错');
  throws(() => createStatsStore({}), TypeError, 'createStatsStore 缺 getItem 抛错');
}

// ───────────────────────────────────────────────────────────
// 12. favorites store
// ───────────────────────────────────────────────────────────
{
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null),
               setItem: (k, v) => mem.set(k, String(v)) };
  const fav = createFavoritesStore(ls);

  // 初始
  eq(fav.list(), [], 'favorites: 初始空');
  eq(fav.size(), 0, 'favorites: size=0');
  eq(fav.has(1), false, 'favorites: has(不存在) false');

  // add 一首
  const p1 = { id: 1, title: '静夜思', author: { name: '李白' }, dynasty: { name: '唐' }, content: ['a'] };
  const e1 = fav.add(p1);
  eq(e1.title, '静夜思', 'favorites: add 返回 entry');
  eq(fav.size(), 1, 'favorites: size=1');
  eq(fav.has(1), true, 'favorites: has(存在) true');

  // add 已存在 → 置顶 + 更新 favoritedAt
  const oldTime = e1.favoritedAt;
  // 等 2ms 保证时间戳不同
  await new Promise((r) => setTimeout(r, 2));
  const e1b = fav.add(p1);
  eq(fav.size(), 1, 'favorites: 重复 add 仍是 1 条');
  truthy(e1b.favoritedAt >= oldTime, 'favorites: 重复 add 更新 favoritedAt');
  eq(fav.list()[0].id, 1, 'favorites: 置顶');

  // toggle 未收藏 → 收藏
  const p2 = { id: 2, title: '咏鹅', author: '骆宾王', dynasty: '唐', content: 'x', source: 'local' };
  const r1 = fav.toggle(p2);
  eq(r1.favorited, true, 'favorites: toggle 未收藏 → 收藏');
  eq(r1.count, 2, 'favorites: toggle 后 count=2');
  eq(fav.has(2), true, 'favorites: has(2) true');

  // toggle 已收藏 → 取消
  const r2 = fav.toggle(p2);
  eq(r2.favorited, false, 'favorites: toggle 已收藏 → 取消');
  eq(r2.count, 1, 'favorites: toggle 取消后 count=1');

  // remove 不存在 → false
  eq(fav.remove(999), false, 'favorites: remove 不存在 → false');

  // remove 存在 → true
  eq(fav.remove(1), true, 'favorites: remove 存在 → true');
  eq(fav.size(), 0, 'favorites: remove 后 0 条');

  // 容量上限
  for (let i = 0; i < LIMITS.favorites; i++) {
    fav.add({ id: i, title: 't' + i, content: ['x'] });
  }
  eq(fav.size(), LIMITS.favorites, 'favorites: 容量上限 200');
  let capErr;
  try { fav.add({ id: 999, title: 'overflow', content: ['x'] }); }
  catch (e) { capErr = e; }
  truthy(capErr?.name === 'CapacityError', 'favorites: 超限抛 CapacityError');

  // toggle 超限不会抛,会返回 error 字段
  const r3 = fav.toggle({ id: 1000, title: 'x', content: ['x'] });
  truthy(r3.error && r3.favorited === false, 'favorites: toggle 超限返回 error');

  // clear
  fav.clear();
  eq(fav.list(), [], 'favorites: clear 后空');

  // 缺 id
  throws(() => fav.add({ title: 'x' }), TypeError, 'favorites: add 缺 id 抛 TypeError');
  eq(fav.toggle({ title: 'x' }).error, '缺少 poem.id', 'favorites: toggle 缺 id 返回 error 字段');
}

// ───────────────────────────────────────────────────────────
// 汇总
// ───────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n[test-store] ${passed}/${total} 通过`);
if (failed) {
  console.error(`\n[test-store] ${failed} 失败:`);
  for (const f of failures) {
    console.error(`  ✗ ${f.label}`);
    console.error(`    实际: ${f.actual}`);
    console.error(`    期望: ${f.expected}`);
  }
  process.exit(1);
}
console.log('[test-store] 全部通过 ✅');