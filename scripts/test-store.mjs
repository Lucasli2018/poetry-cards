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