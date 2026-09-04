// =============================================================
// 古韵抽卡 v4.6.1 · 意境提取契约测试
//
// 验证 (images.js 的意境维度):
//   ① extractConception(poem) — 物象 + 情感 + 时令 + 时段 + 诗人风格
//   ② poemPrompt(poem)        — 意境注入提示词(v4.4 契约子串保持)
//   ③ loremFlickrUrl(poem)    — 意境标签编织进搜索词
//   ④ 边界安全                — 空诗 / imageTags 透传 / 单一真相
//
// 设计原则(与 IMAGERY 一致): 宁可漏判不可错判。
//   情感/时令/时段各取「命中次数最多」的**单一**结果, 避免矛盾同框。
//
// 运行:  node scripts/test-images-v46-conception.mjs
// =============================================================

import {
  extractConception, poemPrompt, loremFlickrUrl,
} from '../src/images.js';

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

// ── 语料 ────────────────────────────────────────────────
const jingyesi = {
  title: '静夜思',
  content: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
  author: { name: '李白' },
};
const jiangxue = {
  title: '江雪',
  content: ['千山鸟飞绝', '万径人踪灭', '孤舟蓑笠翁', '独钓寒江雪'],
  author: { name: '柳宗元' },
};
const chunxiao = {
  title: '春晓',
  content: ['春眠不觉晓', '处处闻啼鸟', '夜来风雨声', '花落知多少'],
  author: { name: '孟浩然' },
};
const qiuxi = {
  title: '天净沙·秋思',
  content: ['枯藤老树昏鸦', '小桥流水人家', '古道西风瘦马', '夕阳西下', '断肠人在天涯'],
  author: { name: '马致远' },
};

// ── ① 静夜思 —— 月夜·思乡 ──
const cJing = extractConception(jingyesi);
truthy(cJing.imagery.includes('moonlight'), '静夜思: 物象含 moonlight', 'includes("moonlight")');
ok(cJing.mood, 'longing', '静夜思: 情感 = longing(思乡)');
ok(cJing.time, 'night', '静夜思: 时段 = night');
truthy(cJing.authorStyle, '静夜思: 李白命中诗人风格偏置', 'authorStyle truthy');

// ── ② 江雪 —— 冬·孤寂·寒江 ──
const cJiang = extractConception(jiangxue);
truthy(cJiang.imagery.includes('winter'), '江雪: 物象含 winter', 'includes("winter")');
truthy(cJiang.imagery.includes('river'), '江雪: 物象含 river', 'includes("river")');
ok(cJiang.mood, 'solitude', '江雪: 情感 = solitude(孤舟独钓)');
ok(cJiang.season, 'winter', '江雪: 时令 = winter(寒江雪)');
ok(cJiang.time, null, '江雪: 无时段线索 → null');
ok(cJiang.authorStyle, null, '江雪: 柳宗元未收录 → authorStyle=null');

// ── ③ 春晓 —— 春·拂晓 · 无强烈情感 ──
const cChun = extractConception(chunxiao);
truthy(cChun.imagery.includes('spring'), '春晓: 物象含 spring', 'includes("spring")');
ok(cChun.season, 'spring', '春晓: 时令 = spring');
ok(cChun.time, 'dawn', '春晓: 时段 = dawn(晓)');
ok(cChun.mood, 'serene', '春晓: 无明显情感词 → 默认 serene');

// ── ④ 秋思 —— 秋·黄昏·羁旅愁思 ──
const cQiu = extractConception(qiuxi);
ok(cQiu.season, 'autumn', '秋思: 时令 = autumn(秋/西风)');
ok(cQiu.time, 'dusk', '秋思: 时段 = dusk(昏鸦/夕阳)');
ok(cQiu.mood, 'melancholy', '秋思: 情感 = melancholy(断肠; 与 longing 同分时按词表优先级)');

// ── ⑤ poemPrompt —— v4.4 契约保持 + 意境注入 ──
const pJing = poemPrompt(jingyesi);
truthy(pJing.includes('ancient Chinese'), 'poemPrompt: 含古代风格前缀(v4.4 契约)', 'includes("ancient Chinese")');
truthy(pJing.includes('Song dynasty'), 'poemPrompt: 含宋代山水风格(v4.4 契约)', 'includes("Song dynasty")');
truthy(pJing.includes('moonlit'), 'poemPrompt: 含物象场景词(v4.4 契约)', 'includes("moonlit")');
truthy(pJing.includes('masterpiece'), 'poemPrompt: 含 masterpiece 后缀(v4.4 契约)', 'includes("masterpiece")');
truthy(pJing.includes('longing'), 'poemPrompt: 注入情感 mood 短语', 'includes("longing")');
truthy(pJing.includes(', night'), 'poemPrompt: 注入时段 time 短语', 'includes(", night")');

const pJiang = poemPrompt(jiangxue);
truthy(pJiang.includes('solitary'), 'poemPrompt(江雪): 注入 solitude 情感', 'includes("solitary")');
truthy(pJiang.includes('winter'), 'poemPrompt(江雪): 含 winter 时令', 'includes("winter")');

const pChun = poemPrompt(chunxiao);
truthy(pChun.includes('springtime'), 'poemPrompt(春晓): 注入 springtime', 'includes("springtime")');
truthy(pChun.includes('dawn light'), 'poemPrompt(春晓): 注入 dawn light', 'includes("dawn light")');

// ── ⑥ loremFlickrUrl —— 意境标签编织 ──
const uJing = loremFlickrUrl(jingyesi, { seed: 1 });
truthy(uJing.includes('moonlight'), 'loremFlickrUrl(静夜思): 含物象标签 moonlight', 'includes("moonlight")');
truthy(uJing.includes('mist'), 'loremFlickrUrl(静夜思): 含情感标签 mist(longing)', 'includes("mist")');
truthy(uJing.includes('landscape'), 'loremFlickrUrl: 始终带 landscape 护栏', 'includes("landscape")');
truthy(uJing.includes('nature'), 'loremFlickrUrl: 始终带 nature 护栏', 'includes("nature")');

const uJiang = loremFlickrUrl(jiangxue, { seed: 1 });
truthy(uJiang.includes('winter'), 'loremFlickrUrl(江雪): 含时令标签 winter', 'includes("winter")');
truthy(uJiang.includes('snow'), 'loremFlickrUrl(江雪): 含时令标签 snow', 'includes("snow")');

// ── ⑦ 边界安全 ──
const cEmpty = extractConception({});
ok(cEmpty.imagery.length, 0, 'extractConception({}): imagery 为空数组');
ok(cEmpty.mood, 'serene', 'extractConception({}): mood 默认 serene');
ok(cEmpty.season, null, 'extractConception({}): season 为 null');
ok(cEmpty.time, null, 'extractConception({}): time 为 null');
ok(cEmpty.authorStyle, null, 'extractConception({}): authorStyle 为 null');

const cTags = extractConception({ imageTags: ['winter', 'snow'], content: ['x'] });
ok(cTags.imagery[0] === 'winter' && cTags.imagery[1] === 'snow', true, 'extractConception: imageTags 透传为 imagery');

// 单一真相: season/time 必须是字符串或 null, 绝不返回数组/多值
const cStr = extractConception(qiuxi);
ok(typeof cStr.season === 'string' || cStr.season === null, true, 'extractConception: season 单一真相(string|null)');
ok(typeof cStr.time === 'string' || cStr.time === null, true, 'extractConception: time 单一真相(string|null)');
ok(typeof cStr.mood === 'string', true, 'extractConception: mood 恒为字符串(永不落空)');

// ── 汇总 ──
const total = passed + failed;
console.log(`\n[test-images-v46-conception] ${passed}/${total} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v46-conception] 全部通过 ✅');
console.log(`\n🎨 v4.6.1 意境提取维度:`);
console.log(`   · 物象 imagery:  ${JSON.stringify(cJing.imagery)}  (沿用 IMAGERY 词表, top2)`);
console.log(`   · 情感 mood:     ${cJing.mood}     (孤寂/愁思/思念/豪迈/旷达/喜悦/闲适, 默认 serene)`);
console.log(`   · 时令 season:   ${cJian_s(cJiang)}  (春夏秋冬取主导, 避免矛盾同框)`);
console.log(`   · 时段 time:     ${cJing.time}      (拂晓/白昼/黄昏/夜)`);
console.log(`   · 诗人风格:      ${cJing.authorStyle}`);
console.log(`\n   静夜思提示词: ${pJing}`);
console.log(`   静夜思图标签: ${loremFlickrUrl(jingyesi, { seed: 1 }).split('/').pop()}`);

function cJian_s(c) { return c && c.season ? c.season : 'null'; }
