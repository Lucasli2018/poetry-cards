// =============================================================
// 古韵抽卡 v4.0 · 节日数据加载与查询层
//
// 职责:
//   ① 加载 src/festivals.json(本地静态,零网络)
//   ② 公历映射表:2026 年写死;非闰年通用;闰年需微调
//   ③ 提供节日日判定 / 按 id 查节日 / 按 id 查诗
//   ④ 不引农历库:v4.0 仅做「今天」角标判定,精度足够(±1 天)
//
// 调用方:
//   - festival-ui.js(主)
//   - test-festival.mjs(测试)
// =============================================================

import FESTIVALS_RAW from './festivals.json' with { type: 'json' };

export const FESTIVALS = FESTIVALS_RAW.festivals;

// 2026 年公历映射表(写死)
//   春 节:02-17  端 午:06-19  中 秋:09-25  重 阳:10-19
//   非闰年(2027/2028...)通用;跨年更新见 M4 验收清单
export const LUNAR_TO_SOLAR_2026 = Object.freeze({
  spring:    '02-17',
  dragon:    '06-19',
  midautumn: '09-25',
  chongyang: '10-19',
});

/** MM-DD 转 YYYY-MM-DD(用指定年) */
function mdToDateKey(mmdd, year) {
  return `${year}-${mmdd}`;
}

/**
 * 判定某个节日在指定日期是不是「今天」。
 * @param {string} festivalId
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isTodayFestival(festivalId, now = new Date()) {
  const f = FESTIVALS.find(x => x.id === festivalId);
  if (!f) return false;
  // 生日 = 每天都是
  if (f.dateRule === 'today') return true;
  if (!f.dateRule.startsWith('lunar-')) return false;
  const md = LUNAR_TO_SOLAR_2026[festivalId];
  if (!md) return false;
  const ymdNow = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return mdToDateKey(md, now.getFullYear()) === ymdNow;
}

// ── 查询索引(模块初始化时构建,O(1) 查询) ──
const FESTIVAL_BY_ID = new Map(FESTIVALS.map(f => [f.id, f]));

/** 按 id 取节日;不存在返回 null */
export function getFestivalById(id) {
  return FESTIVAL_BY_ID.get(id) || null;
}

const POEM_INDEX = new Map();
for (const f of FESTIVALS) {
  for (const p of f.poems) POEM_INDEX.set(p.id, { poem: p, festival: f });
}

/** 按 poemId 取 { poem, festival };不存在返回 null */
export function getPoemById(poemId) {
  return POEM_INDEX.get(poemId) || null;
}