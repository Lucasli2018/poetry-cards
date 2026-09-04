// =============================================================
// 古韵抽卡 v4.7.0 · 配图模块纯逻辑契约测试
//
// 验证 (images.js 模块的导出函数契约):
//   ① sceneImageUrl(poem, opts) — 主图源: LoremFlickr, 单 tag, 带 seed
//   ② loremFlickrUrl(poem, opts) — 单 tag 编码进 URL, 带 lock=seed
//   ③ extractThemes(poem) — 物象主题提取
//   ④ extractConception / tagPool / flickrTags — 意境维度 + 单 tag 随机池
//   ⑤ SCENE_IMG_W/H — 单一真相源
//
// 运行:  node scripts/test-images-v44.mjs
// =============================================================

import {
  sceneImageUrl,
  loremFlickrUrl,
  extractThemes,
  extractConception,
  tagPool,
  flickrTags,
  SCENE_IMG_W, SCENE_IMG_H,
} from '../src/images.js';

const loremUrlRe = /^https:\/\/loremflickr\.com\/\d+\/\d+\/.+\?lock=\d+$/;

let passed = 0, failed = 0;
const failures = [];
function ok(actual, expected, label) {
  if (actual === expected) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(actual), expected: String(expected) });
}
function truthy(v, label, hint = 'truthy') {
  if (v) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(v), expected: hint });
}

const poem = {
  title: '静夜思',
  content: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
  author: { name: '李白' },
  dynasty: { name: '唐' },
  type: { name: '五言绝句' },
};

// ── ① sceneImageUrl — 主图源 LoremFlickr ──
const s1 = sceneImageUrl(poem, { width: 720, height: 450, seed: 12345 });
ok(loremUrlRe.test(s1), true, 'sceneImageUrl: 格式匹配 loremFlickr 正则(w/h/tag?lock=seed)');
truthy(s1.startsWith('https://loremflickr.com'), 'sceneImageUrl: 主图源是 LoremFlickr', 'startsWith');
truthy(s1.includes('/720/450'), 'sceneImageUrl: URL 含 /720/450 尺寸', 'includes("/720/450")');

// ── ② sceneImageUrl(seed 区分) ──
const s2 = sceneImageUrl(poem, { seed: 555 });
const s3 = sceneImageUrl(poem, { seed: 556 });
ok(s2 !== s3, true, 'sceneImageUrl: 不同 seed 返回不同 URL');

// ── ③ extractThemes ──
const themes1 = extractThemes(poem);
truthy(themes1.length > 0, 'extractThemes: 命中月光诗返回非空', 'length > 0');
truthy(themes1.includes('moonlight'), 'extractThemes: 命中月光诗包含 moonlight', 'includes("moonlight")');
ok(themes1.length <= 2, true, 'extractThemes: 最多返回 2 个主题');

// 显式 imageTags 优先
const themes2 = extractThemes({ imageTags: ['winter', 'snow'], content: ['x'] });
ok(themes2[0] === 'winter' && themes2[1] === 'snow', true, 'extractThemes: imageTags 优先级最高, 前 2 截断');

// ── ④ extractConception / tagPool / flickrTags ──
const c = extractConception(poem);
truthy(c.imagery.includes('moonlight'), 'extractConception: 物象含 moonlight', 'imagery includes moonlight');
ok(c.mood, 'longing', 'extractConception(静夜思): 情感 = longing(思/故乡)');
ok(c.season, null, 'extractConception(静夜思): 仅「霜」未命中时令词表 → season=null');
ok(c.time, 'night', 'extractConception(静夜思): 时段 = night(夜/明月)');
ok('authorStyle' in c, false, 'extractConception: v4.7.0 起不再含 authorStyle 字段');

const pool = tagPool(poem);
truthy(pool.length > 0, 'tagPool(静夜思): 候选池非空', 'length > 0');
truthy(pool.includes('moonlight') || pool.includes('night'), 'tagPool(静夜思): 含物象/情感 tag', 'includes moonlight|night');

// flickrTags 每次只返回 1 个 tag, 且必在 pool 内(或空池兜底)
for (let i = 0; i < 30; i++) {
  const tags = flickrTags(poem);
  ok(tags.length, 1, 'flickrTags: 恒返回恰好 1 个 tag');
  truthy(pool.includes(tags[0]), 'flickrTags: 返回 tag 必在 tagPool 内', 'pool.includes(tag)');
}

// ── ⑤ SCENE_IMG_W / SCENE_IMG_H ──
ok(SCENE_IMG_W, 720, 'SCENE_IMG_W: 720(展示图宽度)');
ok(SCENE_IMG_H, 450, 'SCENE_IMG_H: 450(展示图高度)');

// 兜底: 无物象无意象 → flickrTags 也从兜底标签随机取 1 个(遵循「单 tag」规则)
const emptyTags = flickrTags({ title: 'xyz', content: ['qwerty'] });
ok(emptyTags.length, 1, 'flickrTags(无意象): 兜底也只返回 1 个 tag');
truthy(typeof emptyTags[0] === 'string' && emptyTags[0].length > 0, 'flickrTags(无意象): 返回非空字符串 tag', 'non-empty string');

console.log(`\n[test-images-v44] ${passed}/${passed + failed} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v44] 全部通过 ✅');
console.log(`\n📷 v4.7.0 双源并发契约:`);
console.log(`   · 主图源(主题贴合): LoremFlickr — ${sceneImageUrl(poem, { seed: 1 }).slice(0, 70)}...`);
console.log(`   · 稳定兜底:         Picsum — 见 fetchSceneImage 内部`);
console.log(`   · 单 tag 随机池:     tagPool = 物象 + 时令 + 时段 + 情感`);
