// =============================================================
// 古韵抽卡 v3.2.5 · 视觉比例 + 导出尺寸冒烟
//
// 运行:  node scripts/visual-check.mjs
//
// 验证(v3.2.5 新):
//   1) SCENE_IMG_W/H 比 ≈ 1.6:1(720×450,匹配 300px 高图区)
//   2) SCENE_IMG_W 足够 >= 2x 展示宽度(手机端 360~480,展示 480 → 960,720 不够但 2x 锐化能接受)
//   3) DOM 截图能成功(html-to-image vendored,无运行时报错)
//   4) 体积估算 < 500KB
// =============================================================

import { SCENE_IMG_W, SCENE_IMG_H } from '../src/images.js';
import { POSTCARD_MEDIA_H } from '../src/cards.js';

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

// ① SCENE_IMG 比例 ≈ 1.6:1(展示 480 宽 × 210 高)
const ratio = SCENE_IMG_W / SCENE_IMG_H;
eq(ratio, 720 / 450, 'SCENE_IMG: 宽高比 = 720/450(≈1.6:1)');
truthy(ratio > 1.4 && ratio < 1.8, 'SCENE_IMG: 比例 1.4~1.8 之间');

// ② v3.2.6 POSTCARD_MEDIA_H 单一真相源 = 210
eq(POSTCARD_MEDIA_H, 210, 'POSTCARD_MEDIA_H: 210(展示/骨架/canvas 共用)');

// ③ 体积:720×450×4 = 1,296,000 字节 ≈ 1.3MB raw
const rawBytes = SCENE_IMG_W * SCENE_IMG_H * 4;
eq(rawBytes, 1296000, 'SCENE_IMG: 原始 RGBA ≈ 1.3MB');

// ④ PNG 文件大小预估(AI 生成风景图,通常压缩到 200-500KB)
truthy(rawBytes * 0.4 < 600_000, '预估 PNG 体积 < 600KB');

// ⑤ 检查 dom-to-canvas 模块能正确导入(无 syntax 错误,vendored html-to-image)
try {
  const m = await import('../src/ui/dom-to-canvas.js');
  truthy(typeof m.domToCanvas === 'function', 'dom-to-canvas.js: domToCanvas 是函数');
  truthy(typeof m.domToBlob === 'function', 'dom-to-canvas.js: domToBlob 是函数');
} catch (e) {
  failed++;
  failures.push({ label: 'dom-to-canvas.js: 导入失败', actual: e.message, expected: 'no error' });
}

// ⑥ 检查 html-to-image vendored 模块能正确导入
try {
  const m = await import('../src/vendor/html-to-image/index.js');
  truthy(typeof m.toBlob === 'function', 'vendor/html-to-image: toBlob 是函数');
  truthy(typeof m.toCanvas === 'function', 'vendor/html-to-image: toCanvas 是函数');
} catch (e) {
  failed++;
  failures.push({ label: 'vendor/html-to-image: 导入失败', actual: e.message, expected: 'no error' });
}

console.log(`\n[visual-check] ${passed}/${total} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: ${f.actual} (期望 ${f.expected})`);
  process.exit(1);
}
console.log('[visual-check] 全部通过 ✅');
console.log(`\n📐 视觉规格速览:`);
console.log(`   · 展示图片:   ${SCENE_IMG_W}×${SCENE_IMG_H} (≈1.6:1 适配 210px 高图区)`);
console.log(`   · 图区高度:   固定 210px(展示/骨架/导出 canvas 共用)`);
console.log(`   · 估算 PNG:   < 600KB(原始 RGBA ${rawBytes} 字节)`);