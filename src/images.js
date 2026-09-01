// =============================================================
// 美图 API 多源守护
// 目标：给一首诗配一张「贴题意象」的图，且必须带 CORS 头
//       （否则 Canvas 会被污染，无法导出 PNG）。
//
// 源优先级：
//   ① LoremFlickr —— 支持关键词搜索（能贴合诗意），Access-Control-Allow-Origin: *
//   ② Picsum      —— seed 稳定随机，带 Origin 请求时返回 CORS 头
//   ③ CSS 渐变     —— 纯本地兜底，任何情况都有底
//
// 实测（2026-09）：Unsplash Source (source.unsplash.com) 已于 2024 年下线，
// 切勿再用；本项目已全面移除。
// =============================================================

// ── 意象 → 英文搜索词 ────────────────────────────────────
// 从诗词正文里提取意象，映射到 Flickr 上的英文标签。
// 顺序即优先级：越靠前越具体，命中就用它。
// 注意：单字意象极易误伤（如「二月花」的「月」不是月亮、「读书」的「书」不是书法），
// 因此凡涉及常用单字的一律要求「有修饰词」或「成词」，宁可漏判不可错判。
const IMAGERY = [
  // 月：必须带修饰词或成词，避开「二月/岁月/日月」
  { re: /(?:明|秋|夜|山|江|海|孤|残|皓|弯|冷|清|晓|望|新|纤)月|月(?:光|色|明|华|影|夜|圆|缺)|蟾宫|素娥|玉兔|清辉|婵娟|望舒/, tags: ['moon', 'moonlight'] },
  { re: /雪|霜|冰|霰|琼枝|玉尘/,              tags: ['snow', 'winter'] },
  { re: /春|东风|柳絮|柳|燕|桃红|芳草|莺|杏/,  tags: ['spring', 'blossom'] },
  { re: /秋|西风|落叶|霜叶|梧桐|砧|枫/,        tags: ['autumn', 'fall'] },
  { re: /夏|荷|莲|蝉|芰/,                     tags: ['summer', 'lotus'] },
  { re: /梅|兰|菊|竹|松|柏|岁寒/,              tags: ['plum', 'bamboo'] },
  { re: /落英|缤纷|花/,                       tags: ['flower', 'petals'] },
  { re: /山|峰|岭|岳|峦|峨眉|蜀道|石径/,       tags: ['mountain', 'peak'] },
  { re: /江|河|水|溪|泉|湖|海|波|涛|潮|沧/,    tags: ['river', 'water'] },
  { re: /雨|霖|露|淅沥/,                      tags: ['rain', 'mist'] },
  { re: /云|雾|霞|霭|烟岚/,                   tags: ['cloud', 'fog'] },
  { re: /舟|船|帆|楫|篷|钓/,                  tags: ['boat', 'sailboat'] },
  { re: /雁|鹤|鸥|鹊|莺|鸟/,                  tags: ['bird', 'crane'] },
  { re: /夕阳|斜阳|暮|落日|黄昏|残照|晚照/,     tags: ['sunset', 'dusk'] },
  { re: /夜|宵|漏|烛|星|河汉|北斗/,            tags: ['night', 'stars'] },
  { re: /寺|禅|僧|钟声|塔|梵|古刹/,            tags: ['temple', 'pagoda'] },
  { re: /桥|亭|楼|台|阁|榭|轩/,               tags: ['pavilion', 'bridge'] },
  { re: /酒|醉|樽|觞|酌/,                     tags: ['wine', 'teahouse'] },
  { re: /琴|棋|画|墨|砚|笔|笺|书法/,           tags: ['calligraphy', 'ink'] },
  { re: /风|萧瑟|凄/,                         tags: ['wind', 'serene'] },
];

// 兜底：永远返回「意境向」的通用词，避免配到不搭调的人像/街景
const FALLBACK_TAGS = ['landscape', 'chinese'];
const MOOD_SUFFIX = 'scenic';   // 追加一个「风景」限定词，过滤掉纯人像

/** 统计某正则在文本中的命中次数（全局匹配） */
function countMatches(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let n = 0;
  while (g.exec(text) !== null) {
    n++;
    if (g.lastIndex === 0) break;   // 防空匹配死循环
  }
  return n;
}

/**
 * 从诗词提取搜索关键词。
 * 策略：统计每个意象的**命中次数**，按「次数降序 → 意象表优先级」取 top 2，
 * 这样整首诗的「主导意境」才会胜出（而非偶然先出现的那个字）。
 * @param {{title?:string, content?:string[], dynasty?:{name?:string}}} poem
 * @returns {string[]} 2~3 个英文标签
 */
export function keywordsFor(poem) {
  const text = [poem?.title || '', ...(poem?.content || [])].join('');
  if (!text) return [...FALLBACK_TAGS];

  const scored = [];
  for (let i = 0; i < IMAGERY.length; i++) {
    const { re, tags } = IMAGERY[i];
    const n = countMatches(re, text);
    if (n > 0) scored.push({ n, order: i, tag: tags[0] });
  }
  if (!scored.length) return [...FALLBACK_TAGS];

  scored.sort((a, b) => (b.n - a.n) || (a.order - b.order));
  const top = scored.slice(0, 2).map((s) => s.tag);
  return [...top, MOOD_SUFFIX];
}

// ── 图片加载（带 CORS + 超时） ───────────────────────────
const IMG_TIMEOUT_MS = 8000;

/**
 * 加载一张可用于 Canvas 导出的图片。
 * crossOrigin='anonymous' 是关键：不带它，canvas 会被 tainted，
 * toDataURL() 直接抛 SecurityError。
 * @returns {Promise<{img:HTMLImageElement, url:string, source:string}|null>}
 */
function loadImage(url, timeout = IMG_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // ← 导出功能的生命线
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = '';
      resolve(null);
    }, timeout);
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * 为一首诗取一张配图。多源依次尝试，任一成功即返回。
 * @param {object} poem
 * @param {{width?:number, height?:number, seed?:number}} opts
 * @returns {Promise<{img:HTMLImageElement|null, url:string|null, source:string}>}
 */
export async function fetchSceneImage(poem, opts = {}) {
  const w = opts.width || 1200;
  const h = opts.height || 1600;
  const seed = opts.seed ?? Date.now();
  const tags = keywordsFor(poem);

  // ① LoremFlickr：按意象搜图（逗号分隔 = OR 匹配，命中率高）
  //    lock 参数让同一 seed 稳定返回同一张，避免重复请求出不同图
  const flickrUrl =
    `https://loremflickr.com/${w}/${h}/${encodeURIComponent(tags.join(','))}?lock=${seed}`;
  let img = await loadImage(flickrUrl);
  if (img) return { img, url: flickrUrl, source: 'LoremFlickr' };

  // ② Picsum：不用关键词，但稳定、快
  const picsumUrl = `https://picsum.photos/seed/poem${seed}/${w}/${h}`;
  img = await loadImage(picsumUrl, 6000);
  if (img) return { img, url: picsumUrl, source: 'Picsum' };

  // ③ 都失败：返回 null，由调用方用 CSS 渐变兜底
  return { img: null, url: null, source: 'none' };
}

/**
 * 仅取 URL（不预加载），用于 <img src> 直接展示。
 * 导出时才走 fetchSceneImage 拿 CORS 版。
 */
export function sceneImageUrl(poem, opts = {}) {
  const w = opts.width || 1200;
  const h = opts.height || 1600;
  const seed = opts.seed ?? Date.now();
  const tags = keywordsFor(poem);
  return `https://loremflickr.com/${w}/${h}/${encodeURIComponent(tags.join(','))}?lock=${seed}`;
}
