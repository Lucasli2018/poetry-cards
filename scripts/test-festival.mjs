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
// ───────────────────────────────────────────────────────────
import { composeCard, _snapshot } from '../src/cards.js';

const samplePoem = {
  title: '静夜思',
  content: ['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。'],
  author: { name: '李白' },
  dynasty: { name: '唐' },
  type: { name: '五言绝句' },
};

const baseHash1 = _snapshot(samplePoem, null, null);
const baseHash2 = _snapshot(samplePoem, null, null, {});
eq(baseHash1, baseHash2, '无 options 与空 options 输出一致');

const optHash = _snapshot(samplePoem, null, null, {
  sender: '老友', recipient: '小王', message: '新春快乐', sealText: '福',
});
truthy(optHash !== baseHash1, '传 options 时输出变化');

const optHash2 = _snapshot(samplePoem, null, null, { sender: '', recipient: '', message: '', sealText: '礼' });
truthy(optHash2 !== optHash, 'sealText 变化 → hash 变');

const optHash3 = _snapshot(samplePoem, null, null, { sender: '', recipient: '张三', message: '', sealText: '诗' });
truthy(optHash3 !== optHash2, 'recipient 变化 → hash 变');

const optHash4 = _snapshot(samplePoem, null, null, { sender: '', recipient: '', message: '中秋团圆', sealText: '诗' });
truthy(optHash4 !== optHash2, 'message 变化 → hash 变');

// 回归:传 options 时仍能成功 composeCard(无 throw)
{
  const cv = composeCard(samplePoem, null, null, { recipient: 'x', message: 'y', sealText: '福' });
  truthy(cv && cv.tagName === 'CANVAS', '传 options 时 composeCard 返回 canvas');
}

console.log(`\n[v4.0 festival] ${passed} passed / ${failed} failed`);
if (failed > 0) { console.log(JSON.stringify(failures, null, 2)); process.exit(1); }