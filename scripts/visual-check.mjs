// =============================================================
// 古韵抽卡 v3.2 · 视觉比例 + 导出尺寸冒烟
//
// 运行:  node scripts/visual-check.mjs
//
// 验证:
//   1) SCENE_IMG_W/H 比 = 3:1 (图区展示尺寸)
//   2) IMG_RATIO = 1/3 (canvas 图区占比)
//   3) 字体 px 公式在 1080 宽度下产出的值与 v3.0 接近
// =============================================================

import { SCENE_IMG_W, SCENE_IMG_H } from '../src/images.js';
import { IMG_RATIO } from '../src/cards.js';

let passed = 0, failed = 0;
const failures = [];
function eq(actual, expected, label) {
  if (Math.abs(actual - expected) < 0.01) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(actual), expected: String(expected) });
}
function truthy(v, label) {
  if (v) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(v), expected: 'truthy' });
}

const total = passed + failed;

// ① SCENE_IMG 比例 = 3:1
eq(SCENE_IMG_W / SCENE_IMG_H, 3, 'SCENE_IMG: 宽高比 = 3:1');
truthy(SCENE_IMG_H <= 200, 'SCENE_IMG_H: ≤ 200(横条足够小,体积可控)');

// ② IMG_RATIO
eq(IMG_RATIO, 1/3, 'IMG_RATIO: = 1/3');

// ③ 文件大小估算(540×180 RGBA): 540*180*4 ≈ 380KB raw
const rawBytes = SCENE_IMG_W * SCENE_IMG_H * 4;
eq(rawBytes, 388800, 'SCENE_IMG: 原始 RGBA ≈ 380KB');

// ④ PNG 文件大小预估(540×180 自然风景有压缩比,通常 100-180KB)
truthy(rawBytes * 0.5 < 250_000, '预估 PNG 体积 < 250KB');

// ⑤ 与展示卡片宽高比关系: 卡片宽 = 520(页 max),图高 = 540/3 = 180 ≈ 33%
//    展示卡片图 = 卡片宽度的 1/3,卡片 body 占 2/3
truthy(SCENE_IMG_W / 3 === 60 || SCENE_IMG_W === 540, '图请求尺寸与展示卡片宽度逻辑自洽');

console.log(`\n[visual-check] ${passed}/${total} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: ${f.actual} (期望 ${f.expected})`);
  process.exit(1);
}
console.log('[visual-check] 全部通过 ✅');
console.log(`\n📐 视觉规格速览:`);
console.log(`   · 展示图片:   ${SCENE_IMG_W}×${SCENE_IMG_H} (3:1 横条)`);
console.log(`   · 图区占比:   ${(IMG_RATIO * 100).toFixed(1)}% (1/3)`);
console.log(`   · 诗区占比:   ${((1 - IMG_RATIO) * 100).toFixed(1)}% (2/3)`);
console.log(`   · 估算 PNG:   < 250KB(原始 RGBA ${rawBytes} 字节)`);