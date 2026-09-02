// =============================================================
// 古韵抽卡 v4.1 · 浏览器冒烟清单(独立页架构)
//
// 运行:  node scripts/test-festival-smoke.mjs http://localhost:8080/
// 设计: 静态可达性检查 + 关键资源校验
//   v4.1 起, 贺卡模式 = festival.html 独立页
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
  console.log(`[v4.1 smoke] probing ${URL_BASE}\n`);

  // ── 冒烟 1:主页 + 贺卡页 都可达 ──
  const home = await probe('');
  ok(home.status === 200, '冒烟 1: 主页 200');
  ok(home.body.includes('pc-festival-open'), '冒烟 1: 主屏含 🎴 入口');
  ok(home.body.includes('festival.html'), '冒烟 1: 主屏入口指向 festival.html 独立页');

  const fpage = await probe('festival.html');
  ok(fpage.status === 200, '冒烟 1: festival.html 200 (v4.1 独立页)');
  ok(fpage.body.includes('pc-festival-back'), '冒烟 1: festival.html 含 ← 抽卡 链接');
  ok(fpage.body.includes('./index.html'), '冒烟 1: 返回链接指向 index.html');

  // ── 冒烟 2:贺卡页 main 容器已挂载(无需 hidden, 直接渲染) ──
  ok(fpage.body.includes('pc-festival-main'), '冒烟 2: festival.html 含 .pc-festival-main 容器');

  // ── 冒烟 3:5 节日数据齐全 ──
  const fjson = await probe('src/festivals.json');
  ok(fjson.status === 200, '冒烟 3: festivals.json 200');
  const fdata = JSON.parse(fjson.body);
  ok(fdata.festivals.length === 5, '冒烟 3: 5 个节日齐全');
  for (const f of fdata.festivals) {
    ok(f.poems.length >= 5, `冒烟 3: ${f.id} ≥5 首 (实际 ${f.poems.length})`);
  }

  // ── 冒烟 4:贺卡页相关模块 200 ──
  for (const m of ['festival-data.js', 'festival-ui.js', 'festival-draft.js', 'festival-main.js', 'images.js']) {
    const r = await probe('src/' + m);
    ok(r.status === 200, `冒烟 4: ${m} 200`);
  }

  // ── 冒烟 5:主 main.js 不再 mountFestivalUI(已迁出) ──
  const main = await probe('src/main.js');
  ok(!main.body.includes('mountFestivalUI'), '冒烟 5: 主 main.js 不再挂载贺卡 UI(已迁出)');
  ok(fpage.body.includes('festival-main.js'), '冒烟 5: festival.html 独立 entry');

  // ── 冒烟 6:styles.css 含贺卡页样式 ──
  const css = await probe('styles.css');
  ok(css.body.includes('.pc-festival-app'), '冒烟 6: styles.css 含 .pc-festival-app');
  ok(css.body.includes('.pc-festival-fields'), '冒烟 6: styles.css 含 .pc-festival-fields');
  ok(css.body.includes('.pc-festival-selects'), '冒烟 6: styles.css 含 .pc-festival-selects');

  // ── 冒烟 7:抽卡屏 零侵入 ──
  ok(home.body.includes('pc-local-first'), '冒烟 7: 抽卡屏「经典诗词」按钮未动(零侵入)');
  ok(home.body.includes('pc-memory-open'), '冒烟 7: 抽卡屏「记忆」按钮未动(零侵入)');

  // ── 冒烟 8:总诗数 ──
  let totalPoems = 0;
  for (const f of fdata.festivals) totalPoems += f.poems.length;
  ok(totalPoems >= 25 && totalPoems <= 50, `冒烟 8: 精选诗总数 ${totalPoems} 在 25~50 区间`);

  // ── 总结 ──
  console.log(`\n[v4.1 smoke] ${passed} passed / ${failed} failed (静态项)`);
  console.log(`\nℹ  剩余 5 项需真浏览器交互:`);
  console.log(`   • 主屏「🎴 贺卡」按钮 → 跳 festival.html`);
  console.log(`   • 贺卡页字段输入 + 印章下拉 + 节日下拉`);
  console.log(`   • 贺卡页「← 抽卡」返回主页`);
  console.log(`   • 草稿跨页保存(主页编辑后跳贺卡页继续)`);
  console.log(`   • 下载 PNG 含 4 字段`);

  if (failed > 0) { console.log(`\n失败项:\n  - ${failures.join('\n  - ')}`); process.exit(1); }
}

main();
