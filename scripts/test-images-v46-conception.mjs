// =============================================================
// 古韵抽卡 v4.7.0 · 意境提取 + 单 tag 随机池 契约测试
//
// 验证 (images.js 的意境维度):
//   ① extractConception(poem) — 物象 + 情感 + 时令 + 时段
//   ② tagPool(poem)           — 意境 tag 候选池(物象+时令+时段+情感)
//   ③ flickrTags / loremFlickrUrl — 每次只随机取 1 个 tag, 且必在池内
//   ④ 边界安全                — 空诗 / imageTags 透传 / 单一真相
//
// 设计原则(与 IMAGERY 一致): 宁可漏判不可错判。
//   情感/时令/时段各取「命中次数最多」的**单一**结果, 避免矛盾同框。
//   v4.7.0 起意境维度只用于构建 LoremFlickr 的随机 tag 池(Pollinations 已移除)。
//
// 运行:  node scripts/test-images-v46-conception.mjs
// =============================================================

import {
  extractConception, loremFlickrUrl, tagPool, flickrTags,
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
ok('authorStyle' in cJing, false, '静夜思: v4.7.0 起不再含 authorStyle 字段');

// ── ② 江雪 —— 冬·孤寂·寒江 ──
const cJiang = extractConception(jiangxue);
truthy(cJiang.imagery.includes('winter'), '江雪: 物象含 winter', 'includes("winter")');
truthy(cJiang.imagery.includes('river'), '江雪: 物象含 river', 'includes("river")');
ok(cJiang.mood, 'solitude', '江雪: 情感 = solitude(孤舟独钓)');
ok(cJiang.season, 'winter', '江雪: 时令 = winter(寒江雪)');
ok(cJiang.time, null, '江雪: 无时段线索 → null');

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

// ── ⑤ tagPool —— 意境 tag 候选池 ──
const poolJing = tagPool(jingyesi);
truthy(poolJing.length > 0, 'tagPool(静夜思): 候选池非空', 'length > 0');
truthy(poolJing.includes('moonlight') || poolJing.includes('night'), 'tagPool(静夜思): 含物象/情感 tag', 'includes');
truthy(poolJing.join(',').includes('mist') || poolJing.join(',').includes('fog'), 'tagPool(静夜思): 含情感 longing 标签 mist/fog', 'includes');

// ── ⑥ loremFlickrUrl / flickrTags —— 单 tag 随机池(每次只取 1 个) ──
const uJing = loremFlickrUrl(jingyesi, { seed: 1 });
truthy(uJing.startsWith('https://loremflickr.com/'), 'loremFlickrUrl: 域名正确', 'startsWith');
const mJing = uJing.match(/loremflickr\.com\/\d+\/\d+\/([^?]+)\?lock=\d+/);
const jingTag = mJing ? mJing[1] : null;
ok(jingTag && jingTag.includes(','), false, 'loremFlickrUrl(静夜思): 单 tag, 不含逗号');
truthy(poolJing.includes(jingTag), 'loremFlickrUrl(静夜思): 返回 tag 必在 tagPool 内', 'pool.includes(tag)');

const uJiang = loremFlickrUrl(jiangxue, { seed: 1 });
truthy(uJiang.startsWith('https://loremflickr.com/'), 'loremFlickrUrl(江雪): 域名正确', 'startsWith');

// flickrTags 恒返回恰好 1 个 tag, 且必在 tagPool 内(多轮验证随机取)
for (let i = 0; i < 30; i++) {
  const tags = flickrTags(jingyesi);
  ok(tags.length, 1, 'flickrTags: 恒返回恰好 1 个 tag');
  truthy(poolJing.includes(tags[0]), 'flickrTags: 返回 tag 必在 tagPool 内', 'pool.includes(tag)');
}

// ── ⑦ 边界安全 ──
const cEmpty = extractConception({});
ok(cEmpty.imagery.length, 0, 'extractConception({}): imagery 为空数组');
ok(cEmpty.mood, 'serene', 'extractConception({}): mood 默认 serene');
ok(cEmpty.season, null, 'extractConception({}): season 为 null');
ok(cEmpty.time, null, 'extractConception({}): time 为 null');

const cTags = extractConception({ imageTags: ['winter', 'snow'], content: ['x'] });
ok(cTags.imagery[0] === 'winter' && cTags.imagery[1] === 'snow', true, 'extractConception: imageTags 透传为 imagery');

// 单一真相: season/time 必须是字符串或 null, 绝不返回数组/多值
const cStr = extractConception(qiuxi);
ok(typeof cStr.season === 'string' || cStr.season === null, true, 'extractConception: season 单一真相(string|null)');
ok(typeof cStr.time === 'string' || cStr.time === null, true, 'extractConception: time 单一真相(string|null)');
ok(typeof cStr.mood === 'string', true, 'extractConception: mood 恒为字符串(永不落空)');

// 无物象无意象 → flickrTags 兜底 FALLBACK_TAGS(单 tag 取其一)
const emptyTags = flickrTags({ title: 'xyz', content: ['qwerty'] });
ok(emptyTags.length, 1, 'flickrTags(无意象): 兜底也只返回 1 个 tag');

// ── 汇总 ──
const total = passed + failed;
console.log(`\n[test-images-v46-conception] ${passed}/${total} 通过`);
if (failed) {
  for (const f of failures) console.error(`  ✗ ${f.label}: 实际 ${f.actual}, 期望 ${f.expected}`);
  process.exit(1);
}
console.log('[test-images-v46-conception] 全部通过 ✅');
console.log(`\n🎨 v4.7.0 意境提取维度:`);
console.log(`   · 物象 imagery:  ${JSON.stringify(cJing.imagery)}  (沿用 IMAGERY 词表, top2)`);
console.log(`   · 情感 mood:     ${cJing.mood}     (孤寂/愁思/思念/豪迈/旷达/喜悦/闲适, 默认 serene)`);
console.log(`   · 时令 season:   ${cJiang.season || 'null'}  (春夏秋冬取主导, 避免矛盾同框)`);
console.log(`   · 时段 time:     ${cJing.time}      (拂晓/白昼/黄昏/夜)`);
console.log(`\n   静夜思 tag 池(${poolJing.length}): ${JSON.stringify(poolJing)}`);
console.log(`   静夜思本次随机 tag: ${jingTag}`);
