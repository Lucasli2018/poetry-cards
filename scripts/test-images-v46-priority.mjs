// =============================================================
// 古韵抽卡 v4.7.0 · 双源并发(LoremFlickr 优先 + Picsum 兜底) — 优先级契约测试
//
// 验证 fetchSceneImage(poem, opts) 的「采用优先级」裁决逻辑:
//   ① LoremFlickr 成功 → 采用(即使 Picsum 更早到也不覆盖, 主源优先)
//   ② LoremFlickr 失败/超时 → Picsum(已并发, 秒级就绪)
//   ③ 全失败 → {null,null,'none'}
//
// 用 mock 的全局 Image 模拟浏览器行为(项目零依赖, 无 jsdom):
//   按 URL 关键字(loremflickr / picsum)决定延迟与成败,
//   与 images.js#loadImage 的 crossOrigin + onload/onerror 契约对接。
//
// 运行:  node scripts/test-images-v46-priority.mjs
// =============================================================

// ── Mock Image ───────────────────────────────────────────────
const MOCK = {
  loremflickr: { latency: 0, fail: false },
  picsum:      { latency: 0, fail: false },
};
function kindOf(url) {
  if (url.includes('loremflickr')) return 'loremflickr';
  if (url.includes('picsum')) return 'picsum';
  return 'unknown';
}
class MockImage {
  constructor() { this.crossOrigin = null; this.onload = null; this.onerror = null; }
  set src(v) {
    this._src = v;
    const kind = kindOf(v);
    const cfg = MOCK[kind] || { latency: 0, fail: false };
    setTimeout(() => {
      if (cfg.fail) { if (this.onerror) this.onerror(new Error(kind + ' failed')); }
      else { if (this.onload) this.onload(); }
    }, cfg.latency);
  }
  get src() { return this._src; }
}
globalThis.Image = MockImage;

// ── 引入被测函数 ─────────────────────────────────────────────
const { fetchSceneImage } = await import('../src/images.js');

const poem = {
  title: '静夜思',
  content: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
  author: { name: '李白' },
  dynasty: { name: '唐' },
  type: { name: '五言绝句' },
};

// ── 最简断言 ────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function eq(actual, expected, label) {
  if (actual === expected) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(actual), expected: String(expected) });
}
async function scenario(name, cfg, expectSource, expectCb) {
  Object.assign(MOCK, cfg);
  let cbLorem = false, cbPicsum = false;
  const r = await fetchSceneImage(poem, {
    seed: 1,
    onLoremFlickr: () => { cbLorem = true; },
    onPicsum: () => { cbPicsum = true; },
  });
  eq(r && r.source, expectSource, `${name}: source 应为 ${expectSource}`);
  const fired = cbLorem ? 'LoremFlickr' : (cbPicsum ? 'Picsum' : 'none');
  eq(fired, expectCb, `${name}: 采用源回调应触发(${expectCb})`);
  // 回调恰好触发一次 + 只触发被采用的源
  eq(cbLorem && cbPicsum, false, `${name}: 两个回调不应同时触发`);
}

// 场景 A: LoremFlickr 快返回 → 采用 LoremFlickr(主源优先)
await scenario('A loremflickr 快', {
  loremflickr: { latency: 200,  fail: false },
  picsum:      { latency: 100,  fail: false },
}, 'LoremFlickr', 'LoremFlickr');

// 场景 B: LoremFlickr 失败 → 降级 Picsum(已并发就绪)
await scenario('B loremflickr 失败', {
  loremflickr: { latency: 100, fail: true },
  picsum:      { latency: 300, fail: false },
}, 'Picsum', 'Picsum');

// 场景 C: LoremFlickr 慢但成功(仍在 4s 超时内) → 仍采用 LoremFlickr(主源即便慢也优先)
await scenario('C loremflickr 慢', {
  loremflickr: { latency: 3500, fail: false },
  picsum:      { latency: 300,  fail: false },
}, 'LoremFlickr', 'LoremFlickr');

// 场景 D: LoremFlickr + Picsum 全失败 → none
await scenario('D 全失败', {
  loremflickr: { latency: 100, fail: true },
  picsum:      { latency: 100, fail: true },
}, 'none', 'none');

console.log(`\n[test-images-v46-priority] ${passed}/${(passed + failed)} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v46-priority] 全部通过 ✅');
console.log('\n🌸 v4.7.0 双源优先级链:');
console.log('   ① LoremFlickr  (主源, 主题贴合, 4s 超时)');
console.log('   ② Picsum        (LoremFlickr 失败 → 稳定兜底)');
console.log('   ③ 全失败        → none (保留原图 / 水墨底纹)');
