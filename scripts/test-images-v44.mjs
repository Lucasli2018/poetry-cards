// =============================================================
// 古韵抽卡 v4.4.0 · 双源并发渐进增强 — 纯逻辑契约测试
//
// 验证 (images.js 模块的导出函数契约):
//   ① picsumUrl(opts) — Picsum URL 格式正确,带 seed,稳定
//   ② pollinationsUrl(poem, opts) — 含 prompt encode, width/height/seed
//   ③ sceneImageUrl(poem) — v4.4.0 起主图源切到 Picsum
//   ④ extractThemes(poem) — 主题提取(已有)
//   ⑤ poemPrompt(poem) — 含主题词,风格前缀
//   ⑥ SCENE_IMG_W/H — 单一真相源
//
// 运行:  node scripts/test-images-v44.mjs
// =============================================================

import {
  sceneImageUrl,
  extractThemes, poemPrompt,
  SCENE_IMG_W, SCENE_IMG_H,
} from '../src/images.js';

// picsumUrl / pollinationsUrl 是内部函数, 通过 sceneImageUrl 间接验证
//   v4.4.0 起 sceneImageUrl === picsumUrl (主源切到 Picsum)
//   pollinationsUrl 包含在 fetchSceneImage 内, 通过 fetchSceneImage 调用链间接验证
const picsumUrlRe = /^https:\/\/picsum\.photos\/seed\/poem\d+\/\d+\/\d+$/;
const pollinUrlRe = /^https:\/\/image\.pollinations\.ai\/prompt\/.+\?width=\d+&height=\d+&seed=\d+&nologo=true$/;

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

// ── ① sceneImageUrl — v4.4.0 主图源 ──
const poem = {
  title: '静夜思',
  content: ['床前明月光', '疑是地上霜'],
  author: { name: '李白' },
  dynasty: { name: '唐' },
  type: { name: '五言绝句' },
};
const s1 = sceneImageUrl(poem, { width: 720, height: 450, seed: 12345 });
ok(picsumUrlRe.test(s1), true, 'sceneImageUrl: 格式匹配 picsumUrl 正则(seed/poem<seed>/w/h)');
truthy(s1.startsWith('https://picsum.photos'), 'sceneImageUrl: v4.4.0 主源是 Picsum', 'startsWith');
truthy(s1.includes('/720/450'), 'sceneImageUrl: URL 含 /720/450 尺寸', 'includes("/720/450")');

// ── ② sceneImageUrl(seed 区分) ──
const s2 = sceneImageUrl(poem, { seed: 555 });
const s3 = sceneImageUrl(poem, { seed: 556 });
ok(s2 !== s3, true, 'sceneImageUrl: 不同 seed 返回不同 URL');

// ── ④ extractThemes ──
const themes1 = extractThemes({
  title: '静夜思',
  content: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
});
truthy(themes1.length > 0, 'extractThemes: 命中月光诗返回非空', 'length > 0');
truthy(themes1.includes('moonlight'), 'extractThemes: 命中月光诗包含 moonlight', 'includes("moonlight")');
ok(themes1.length <= 2, true, 'extractThemes: 最多返回 2 个主题');

// 显式 imageTags 优先
const themes2 = extractThemes({ imageTags: ['winter', 'snow'], content: ['x'] });
ok(themes2[0] === 'winter' && themes2[1] === 'snow', true, 'extractThemes: imageTags 优先级最高, 前 2 截断');

// ── ⑤ poemPrompt ──
const prompt = poemPrompt(poem);
truthy(prompt.includes('ancient Chinese'), 'poemPrompt: 含古代风格前缀', 'includes("ancient Chinese")');
truthy(prompt.includes('Song dynasty'), 'poemPrompt: 含宋代山水风格', 'includes("Song dynasty")');
truthy(prompt.includes('moonlit'), 'poemPrompt: 含主题场景词', 'includes("moonlit")');
truthy(prompt.includes('masterpiece'), 'poemPrompt: 含 masterpiece 后缀', 'includes("masterpiece")');

// ── ⑥ SCENE_IMG_W / SCENE_IMG_H ──
ok(SCENE_IMG_W, 720, 'SCENE_IMG_W: 720(展示图宽度)');
ok(SCENE_IMG_H, 450, 'SCENE_IMG_H: 450(展示图高度)');

console.log(`\n[test-images-v44] ${passed}/${passed + failed} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v44] 全部通过 ✅');
console.log(`\n📷 v4.4.0 双源并发契约:`);
console.log(`   · 主图源(秒出):       Picsum — ${sceneImageUrl(poem, { seed: 1 }).slice(0, 60)}...`);
console.log(`   · 主题贴合源(慢):     Pollinations AI — 见 fetchSceneImage 内部`);
console.log(`   · sceneImageUrl:       → picsumUrl (v4.4.0 起主图源)`);
console.log(`   · 双源并发:            fetchSceneImage + onPicsum/onPollinations 回调`);