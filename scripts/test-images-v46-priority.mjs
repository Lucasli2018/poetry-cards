// =============================================================
// 古韵抽卡 v4.6 · 三源并发 + Pollinations 优先窗口 — 优先级契约测试
//
// 验证 fetchSceneImage(poem, opts) 的「采用优先级」裁决逻辑:
//   ① Pollinations 3s 内返回 → 采用(即使 LoremFlickr/Picsum 更早到也不覆盖)
//   ② Pollinations 超时/失败 → LoremFlickr(已并发)
//   ③ LoremFlickr 失败     → Picsum
//   ④ 全失败               → {null,null,'none'}
//
// 用 mock 的全局 Image 模拟浏览器行为(项目零依赖, 无 jsdom):
//   按 URL 关键字(pollinations / loremflickr / picsum)决定延迟与成败,
//   与 images.js#loadImage 的 crossOrigin + onload/onerror 契约对接。
//
// 运行:  node scripts/test-images-v46-priority.mjs
// =============================================================

// ── Mock Image ───────────────────────────────────────────────
// 行为由 MOCK 配置决定: 每个源可设 latency(ms) 与 fail(bool)
const MOCK = {
  pollinations: { latency: 0, fail: false },
  loremflickr:  { latency: 0, fail: false },
  picsum:      { latency: 0, fail: false },
};
function kindOf(url) {
  if (url.includes('pollinations')) return 'pollinations';
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
async function scenario(name, cfg, expectSource) {
  Object.assign(MOCK, cfg);
  const r = await fetchSceneImage(poem, { seed: 1 });
  eq(r && r.source, expectSource, `${name}: source 应为 ${expectSource}`);
}

// 场景 A: Pollinations 1s 返回(≤3s) → 采用 Pollinations
await scenario('A pollinations 快', {
  pollinations: { latency: 1000, fail: false },
  loremflickr:  { latency: 500,  fail: false },
  picsum:      { latency: 300,  fail: false },
}, 'Pollinations');

// 场景 B: Pollinations 超时(>3s) → 降级 LoremFlickr(已并发就绪)
await scenario('B pollinations 慢', {
  pollinations: { latency: 4000, fail: false }, // 超时(loadImage 3s 上限)
  loremflickr:  { latency: 500,  fail: false },
  picsum:      { latency: 300,  fail: false },
}, 'LoremFlickr');

// 场景 C: Pollinations 失败 + LoremFlickr 失败 → Picsum
await scenario('C poll+flickr 失败', {
  pollinations: { latency: 100, fail: true },
  loremflickr:  { latency: 100, fail: true },
  picsum:      { latency: 300, fail: false },
}, 'Picsum');

// 场景 D: 全失败 → none
await scenario('D 全失败', {
  pollinations: { latency: 100, fail: true },
  loremflickr:  { latency: 100, fail: true },
  picsum:      { latency: 100, fail: true },
}, 'none');

// 场景 E: Pollinations 恰好在 3s 窗口内(2.5s)返回 → 仍采用 Pollinations
await scenario('E pollinations 临界2.5s', {
  pollinations: { latency: 2500, fail: false },
  loremflickr:  { latency: 400,  fail: false },
  picsum:      { latency: 300,  fail: false },
}, 'Pollinations');

console.log(`\n[test-images-v46-priority] ${passed}/${(passed + failed)} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v46-priority] 全部通过 ✅');
console.log('\n🌸 v4.6 三源优先级链:');
console.log('   ① Pollinations  (3s 优先窗口, 主题最贴合)');
console.log('   ② LoremFlickr   (Pollinations 超时 → 风景贴合)');
console.log('   ③ Picsum        (LoremFlickr 失败 → 稳定兜底)');
console.log('   ④ 全失败        → none (保留原图 / 水墨底纹)');
