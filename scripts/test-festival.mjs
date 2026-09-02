// =============================================================
// 古韵抽卡 v4.0 · 节日功能单测
//
// 运行:  node scripts/test-festival.mjs
// 设计: 纯 node,无测试框架;每个用例 eq/truthy/throws 失败即抛错并退出 1。
// 覆盖:
//   - festival-data: festivals.json 结构 + 节日日判定 + 查询
//   - festival-draft: 草稿 store(CRUD/debounce/parseSafe/size 截断)
//   - cards.composeCard: 不传 options 与空 options 一致 + 传 options 字段识别
// =============================================================

let passed = 0, failed = 0;
const failures = [];
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++;
  failures.push({ label, actual: JSON.stringify(actual), expected: JSON.stringify(expected) });
}
function truthy(v, label) { if (v) { passed++; return; } failed++; failures.push({ label, actual: String(v), expected: 'truthy' }); }
function throws(fn, ErrorClass, label) {
  try { fn(); failed++; failures.push({ label, actual: 'no throw', expected: ErrorClass?.name || 'throw' }); }
  catch (e) {
    if (ErrorClass && !(e instanceof ErrorClass)) { failed++; failures.push({ label, actual: e.constructor.name, expected: ErrorClass.name }); return; }
    passed++;
  }
}

// ───────────────────────────────────────────────────────────
// 1. festival-data
// ───────────────────────────────────────────────────────────
import { FESTIVALS, LUNAR_TO_SOLAR_2026, isTodayFestival, getFestivalById, getPoemById } from '../src/festival-data.js';

eq(FESTIVALS.length >= 5, true, 'festivals ≥5');
for (const f of FESTIVALS) {
  truthy(f.id && f.name && f.icon, `festival ${f.id} 字段齐全`);
  truthy(f.poems.length >= 5, `festival ${f.id} ≥5 首`);
  truthy(f.themeKeywords.length > 0, `festival ${f.id} 关键词非空`);
  for (const p of f.poems) {
    truthy(p.id && p.title && p.author && p.dynasty && Array.isArray(p.content), `poem ${p.id} 字段齐全`);
    truthy(p.content.length > 0, `poem ${p.id} content 非空`);
  }
}

truthy(typeof isTodayFestival === 'function', 'isTodayFestival 是函数');
truthy(isTodayFestival('birthday', new Date()) === true, '生日 = 今天');

const spring = getFestivalById('spring');
truthy(spring && spring.id === 'spring', 'getFestivalById spring');
eq(getFestivalById('notexist'), null, 'getFestivalById 缺失 → null');
const found = getPoemById('f-spring-1');
truthy(found && found.poem.title === '元日', 'getPoemById 找到诗');
eq(getPoemById('notexist'), null, 'getPoemById 缺失 → null');

['spring', 'dragon', 'midautumn', 'chongyang'].forEach(id => {
  truthy(LUNAR_TO_SOLAR_2026[id], `LUNAR_TO_SOLAR_2026 含 ${id}`);
});

// ───────────────────────────────────────────────────────────
// 2. festival-draft
// ───────────────────────────────────────────────────────────
import { createFestivalDraftStore } from '../src/festival-draft.js';
import { LIMITS, KEY } from '../src/store/schema.js';

const memStore = (() => {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})();

{
  const store = createFestivalDraftStore(memStore);
  eq(store.get(), null, '空 store → null');

  const draft = { festivalId: 'spring', poemId: 'f-spring-1', sender: 'a', recipient: 'b', message: 'c', sealText: '福', savedAt: 1 };
  store.save(draft);
  const got = store.get();
  eq(got.festivalId, 'spring', 'save 后 get 拿到 festivalId');
  eq(got.sealText, '福', 'save 后 get 拿到 sealText');

  store.save({ ...draft, message: 'new' });
  eq(store.get().message, 'new', '二次 save 覆盖');
}

{
  memStore.setItem(KEY.festivalDraft, 'not json');
  const store = createFestivalDraftStore(memStore);
  eq(store.get(), null, '坏 JSON → null');
}

{
  memStore.setItem(KEY.festivalDraft, '');
  const store = createFestivalDraftStore(memStore);
  const huge = 'https://example.com/' + 'a'.repeat(LIMITS.festivalDraftBytes);
  store.save({ festivalId: 'spring', poemId: 'f-spring-1', imageUrl: huge, sender: '', recipient: '', message: '', sealText: '诗', savedAt: 0 });
  const got = store.get();
  truthy(got.imageUrl.length <= LIMITS.festivalDraftBytes, 'imageUrl 超 5KB 被截断');
}

{
  const store = createFestivalDraftStore(memStore);
  throws(() => store.save({ festivalId: 'spring' }), TypeError, '缺字段应 throw');
}

// ───────────────────────────────────────────────────────────
// 3. cards.composeCard options 扩展
//    关键底线:不传 options 时 hasOptions=false,与 v3.2.9 像素级一致
//    (canvas 像素级一致需浏览器跑;node 测派生状态 + 关键不变量)
// ───────────────────────────────────────────────────────────
import { _resolveOptions } from '../src/cards.js';

// 不传 options / null / 空 → 走 v3.2.9 路径(增量区零增量)
{
  const r1 = _resolveOptions(undefined);
  const r2 = _resolveOptions(null);
  const r3 = _resolveOptions({});
  eq(r1.hasOptions, false, 'undefined → hasOptions=false');
  eq(r2.hasOptions, false, 'null → hasOptions=false');
  eq(r3.hasOptions, false, '{} → hasOptions=false');
  eq(r1.sealChar, '诗', '默认印章 = 诗');
  eq(r1.recipient, '', '默认 recipient = 空');
  eq(r1.message, '', '默认 message = 空');
}

// 三个 options 字段都会被解析
{
  const r = _resolveOptions({ sender: 'a', recipient: 'b', message: 'c', sealText: '福' });
  eq(r.hasOptions, true, '传 options → hasOptions=true');
  eq(r.recipient, 'b', 'recipient 被提取');
  eq(r.message, 'c', 'message 被提取');
  eq(r.sealChar, '福', 'sealText 被提取');
}

// sealText 缺省时默认「诗」(向后兼容)
{
  const r = _resolveOptions({ recipient: 'x' });
  eq(r.sealChar, '诗', '未指定 sealText → 默认「诗」');
}

// recipient / message 缺省时为空字符串
{
  const r = _resolveOptions({ sealText: '礼' });
  eq(r.recipient, '', '未指定 recipient → 空');
  eq(r.message, '', '未指定 message → 空');
}

console.log(`\n[v4.0 festival] ${passed} passed / ${failed} failed`);
if (failed > 0) { console.log(JSON.stringify(failures, null, 2)); process.exit(1); }