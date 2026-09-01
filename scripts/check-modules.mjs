// =============================================================
// 古韵抽卡 v3.1 · M1 模块加载冒烟
// 不模拟浏览器,只验证 ESM import 链路 + 关键符号可解析
//
// 运行:  node scripts/check-modules.mjs
// =============================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { pathToFileURL } from 'url';

const ok = [];
const fail = [];

async function checkImport(label, url) {
  try {
    const mod = await import(url);
    ok.push(label);
    console.log(`  ✓ ${label}`);
    return mod;
  } catch (e) {
    fail.push({ label, err: e.message });
    console.error(`  ✗ ${label}\n    ${e.message}`);
  }
}

console.log('[check-modules] ESM 链路冒烟');

// 项目根 = 本脚本所在目录的上一级
import { fileURLToPath } from 'url';
const here = fileURLToPath(import.meta.url);
const projectRoot = require('path').resolve(require('path').dirname(here), '..');
const base = 'file://' + projectRoot.replace(/\\/g, '/');

await checkImport('store/schema.js',     `${base}/src/store/schema.js`);
const statsMod   = await checkImport('store/stats.js',    `${base}/src/store/stats.js`);
const historyMod = await checkImport('store/history.js',  `${base}/src/store/history.js`);

// 关键符号存在性
const required = [
  ['stats.createStatsStore',   statsMod?.createStatsStore],
  ['history.createHistoryStore', historyMod?.createHistoryStore],
];
for (const [label, v] of required) {
  if (typeof v === 'function') { ok.push(label); console.log(`  ✓ ${label}`); }
  else { fail.push({ label, err: 'missing export' }); console.error(`  ✗ ${label}`); }
}

// images.js 的 extractThemes 现在应可导出
const imagesMod = await checkImport('images.js(extractThemes)', `${base}/src/images.js`);
if (typeof imagesMod?.extractThemes === 'function') {
  ok.push('images.extractThemes exported');
  console.log('  ✓ images.extractThemes exported');
  // 跑一下,确认能正确命中
  const themes = imagesMod.extractThemes({
    title: '静夜思',
    content: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
  });
  if (themes.includes('moonlight')) {
    ok.push('extractThemes: 命中 moonlight');
    console.log('  ✓ extractThemes: 命中 moonlight → ' + JSON.stringify(themes));
  } else {
    fail.push({ label: 'extractThemes: 命中 moonlight', err: '实际 ' + JSON.stringify(themes) });
    console.error('  ✗ extractThemes: 未命中 moonlight, 实际=' + JSON.stringify(themes));
  }
}

console.log(`\n[check-modules] ${ok.length} 通过 / ${fail.length} 失败`);
if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f.label}: ${f.err}`);
  process.exit(1);
}
console.log('[check-modules] 全部通过 ✅');