// =============================================================
// 古韵抽卡 v4.0 · 浏览器冒烟清单(13 项)
//
// 运行:  node scripts/test-festival-smoke.mjs http://localhost:8080/
// 设计: 静态可达性检查 + 关键资源校验
//   (交互类 6-9 / 11-13 项需要真浏览器手工验收,见 README v4.0.0 段落)
// =============================================================

const URL_BASE = process.argv[2] || 'http://localhost:8080/';

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`✅ ${label}`); return; }
  failed++; failures.push(label); console.log(`❌ ${label}`);
}

async function probe(path) {
  try {
    const res = await fetch(URL_BASE + path);
    const body = await res.text();
    return { status: res.status, body, len: res.headers.get('content-length') };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function main() {
  console.log(`[v4.0 smoke] probing ${URL_BASE}\n`);

  // ── 冒烟 1:主页可达 + 含 🎋 按钮 ──
  const home = await probe('');
  ok(home.status === 200, '冒烟 1: 主页 200');
  ok(home.body.includes('pc-festival-open'), '冒烟 1: header 含 🎋 入口按钮');

  // ── 冒烟 2:贺卡屏容器存在 ──
  ok(home.body.includes('pc-festival-screen'), '冒烟 2: 贺卡屏容器已挂载(默认 hidden)');

  // ── 冒烟 3:5 节日数据齐全 ──
  const fjson = await probe('src/festivals.json');
  ok(fjson.status === 200, '冒烟 3: festivals.json 200');
  const fdata = JSON.parse(fjson.body);
  ok(fdata.festivals.length === 5, '冒烟 3: 5 个节日齐全');
  for (const f of fdata.festivals) {
    ok(f.poems.length >= 5, `冒烟 3: ${f.id} ≥5 首 (实际 ${f.poems.length})`);
  }

  // ── 冒烟 4:festival-ui.js + festival-data.js + festival-draft.js 模块 200 ──
  for (const m of ['festival-data.js', 'festival-ui.js', 'festival-draft.js']) {
    const r = await probe('src/' + m);
    ok(r.status === 200, `冒烟 4: ${m} 200`);
  }

  // ── 冒烟 5:main.js 包含 festival-ui import ──
  const main = await probe('src/main.js');
  ok(main.body.includes('mountFestivalUI'), '冒烟 5: main.js 已接入 mountFestivalUI');

  // ── 冒烟 6:styles.css 含贺卡屏样式 ──
  const css = await probe('styles.css');
  ok(css.body.includes('.pc-festival-chip'), '冒烟 6: styles.css 含 .pc-festival-chip');
  ok(css.body.includes('.pc-festival-fields'), '冒烟 6: styles.css 含 .pc-festival-fields');

  // ── 冒烟 7:switch 经典诗词按钮仍在(零侵入底线) ──
  ok(home.body.includes('pc-local-first'), '冒烟 7: 抽卡屏「经典诗词」按钮未动(零侵入)');

  // ── 冒烟 8:记忆按钮仍在 ──
  ok(home.body.includes('pc-memory-open'), '冒烟 8: 抽卡屏「记忆」按钮未动(零侵入)');

  // ── 冒烟 9:POEMS 数据完整性 ──
  let totalPoems = 0;
  for (const f of fdata.festivals) totalPoems += f.poems.length;
  ok(totalPoems >= 25 && totalPoems <= 50, `冒烟 9: 精选诗总数 ${totalPoems} 在 25~50 区间`);

  // ── 剩余 4 项需真浏览器交互 ──
  console.log(`\n[v4.0 smoke] ${passed} passed / ${failed} failed (静态项)`);
  console.log(`\nℹ  剩余 4 项需真浏览器手工验收(见 README v4.0.0 段落):`);
  console.log(`   • 点 🎋 → 贺卡屏加载`);
  console.log(`   • 节日胶囊切换 / 换一首循环`);
  console.log(`   • 输入字段实时绑定 + 印章切换`);
  console.log(`   • 下载 PNG 含 4 字段 + 分享降级文案`);

  if (failed > 0) { console.log(`\n失败项:\n  - ${failures.join('\n  - ')}`); process.exit(1); }
}

main();