// =============================================================
// 美图 API 多源守护
// 目标：给一首诗配一张「贴题意象」的图，且必须带 CORS 头
//       （否则 Canvas 会被污染，无法导出 PNG）。
//
// 源优先级：
//   ① Pollinations AI —— 按诗意提示词生成，最贴合；CORS: *
//   ② LoremFlickr     —— 按风景关键词搜索，次之选；CORS: *
//   ③ Picsum          —— seed 稳定随机，带 Origin 请求时返回 CORS 头
//   ④ CSS 渐变        —— 纯本地兜底，任何情况都有底
//
// 实测（2026-09）：Unsplash Source (source.unsplash.com) 已于 2024 年下线，
// 切勿再用；本项目已全面移除。
// =============================================================

// ── 意象 → 主题词 ────────────────────────────────────────
// 从诗词正文里提取意象，映射到英文主题词。
// 顺序即优先级：越靠前越具体，命中就用它。
// 注意：单字意象极易误伤（如「二月花」的「月」不是月亮、「读书」的「书」不是书法），
// 因此凡涉及常用单字的一律要求「有修饰词」或「成词」，宁可漏判不可错判。
const IMAGERY = [
  // 月：必须带修饰词或成词，避开「二月/岁月/日月」
  { re: /(?:明|秋|夜|山|江|海|孤|残|皓|弯|冷|清|晓|望|新|纤)月|月(?:光|色|明|华|影|夜|圆|缺)|蟾宫|素娥|玉兔|清辉|婵娟|望舒/, key: 'moonlight' },
  { re: /雪|霜|冰|霰|琼枝|玉尘/, key: 'winter' },
  { re: /春|东风|柳絮|柳|燕|桃红|芳草|莺|杏/, key: 'spring' },
  { re: /秋|西风|落叶|霜叶|梧桐|砧|枫/, key: 'autumn' },
  { re: /夏|荷|莲|蝉|芰/, key: 'summer' },
  { re: /梅|兰|菊|竹|松|柏|岁寒/, key: 'bamboo' },
  { re: /落英|缤纷|花/, key: 'flower' },
  { re: /山|峰|岭|岳|峦|峨眉|蜀道|石径/, key: 'mountain' },
  { re: /江|河|水|溪|泉|湖|海|波|涛|潮|沧/, key: 'river' },
  { re: /雨|霖|露|淅沥/, key: 'rain' },
  { re: /云|雾|霞|霭|烟岚/, key: 'cloud' },
  { re: /舟|船|帆|楫|篷|钓/, key: 'boat' },
  { re: /雁|鹤|鸥|鹊|莺|鸟|雀/, key: 'bird' },
  { re: /夕阳|斜阳|暮|落日|黄昏|残照|晚照/, key: 'sunset' },
  { re: /夜|宵|漏|烛|星|河汉|北斗/, key: 'night' },
  { re: /寺|禅|僧|钟声|塔|梵|古刹/, key: 'temple' },
  { re: /桥|亭|楼|台|阁|榭|轩/, key: 'pavilion' },
  { re: /酒|醉|樽|觞|酌/, key: 'wine' },
  { re: /琴|棋|画|墨|砚|笔|笺|书法/, key: 'ink' },
  { re: /风|萧瑟|凄/, key: 'wind' },
];

// 主题词 → Pollinations 提示词片段
const PROMPT_WORDS = {
  moonlight:  'moonlit night with mountains',
  winter:     'winter snow covered mountains',
  spring:     'spring cherry blossom valley',
  autumn:     'autumn red maple forest',
  summer:     'summer lotus pond',
  bamboo:     'bamboo and plum grove',
  flower:     'spring flower meadow',
  mountain:   'misty mountain peaks',
  river:      'serene river flowing through mountains',
  rain:       'rainy misty mountain landscape',
  cloud:      'cloudy foggy mountain',
  boat:       'small boat on calm lake',
  bird:       'birds flying over mountains',
  sunset:     'golden sunset over mountains',
  night:      'starry night sky',
  temple:     'ancient temple on mountain',
  pavilion:   'chinese pavilion by lake',
  wine:       'chinese garden with pavilion',
  ink:        'chinese ink wash landscape',
  wind:       'windy grassland hills',
};

// 主题词 → LoremFlickr 风景标签（始终带 landscape / nature，避免街景/人像）
const FLICKR_TAGS = {
  moonlight:  ['landscape', 'moonlight', 'night', 'nature'],
  winter:     ['landscape', 'winter', 'snow', 'nature'],
  spring:     ['landscape', 'spring', 'blossom', 'nature'],
  autumn:     ['landscape', 'autumn', 'fall', 'nature'],
  summer:     ['landscape', 'summer', 'lotus', 'nature'],
  bamboo:     ['landscape', 'bamboo', 'nature'],
  flower:     ['landscape', 'spring', 'flowers', 'nature'],
  mountain:   ['landscape', 'mountain', 'peak', 'nature'],
  river:      ['landscape', 'river', 'water', 'nature'],
  rain:       ['landscape', 'rain', 'mist', 'nature'],
  cloud:      ['landscape', 'clouds', 'fog', 'nature'],
  boat:       ['landscape', 'lake', 'boat', 'nature'],
  bird:       ['landscape', 'nature', 'bird', 'mountain'],
  sunset:     ['landscape', 'sunset', 'dusk', 'nature'],
  night:      ['landscape', 'night', 'stars', 'nature'],
  temple:     ['landscape', 'temple', 'mountain', 'nature'],
  pavilion:   ['landscape', 'pavilion', 'garden', 'nature'],
  wine:       ['landscape', 'garden', 'pavilion', 'nature'],
  ink:        ['landscape', 'ink', 'painting', 'nature'],
  wind:       ['landscape', 'nature', 'hills', 'wind'],
};

const FALLBACK_TAGS = ['landscape', 'nature', 'scenery'];

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
 * 从诗词提取主导意象主题词。
 * 策略：统计每个意象的**命中次数**，按「次数降序 → 意象表优先级」取 top 2。
 * @param {{title?:string, content?:string[], imageTags?:string[]}} poem
 * @returns {string[]}
 */
export function extractThemes(poem) {
  if (Array.isArray(poem?.imageTags) && poem.imageTags.length) {
    return poem.imageTags.slice(0, 2);
  }
  const text = [poem?.title || '', ...(poem?.content || [])].join('');
  if (!text) return [];

  const scored = [];
  for (let i = 0; i < IMAGERY.length; i++) {
    const { re, key } = IMAGERY[i];
    const n = countMatches(re, text);
    if (n > 0) scored.push({ n, order: i, key });
  }
  if (!scored.length) return [];

  scored.sort((a, b) => (b.n - a.n) || (a.order - b.order));
  return scored.slice(0, 2).map((s) => s.key);
}

/**
 * 为 Pollinations AI 生成英文提示词。
 * 风格统一偏向「古代中国画」：水墨/青绿山水、宋人山水意境、低饱和、留白。
 */
export function poemPrompt(poem) {
  const themes = extractThemes(poem);
  const scenes = themes.length
    ? themes.map((k) => PROMPT_WORDS[k] || k).join(', ')
    : 'serene chinese landscape';
  // 古代风格前缀 + 场景 + 古画风格后缀
  return `ancient Chinese traditional painting, ${scenes}, classical Song dynasty landscape art style, ` +
         `traditional ink wash and mineral-green shanshui, serene, elegant, muted earth tones, ` +
         `fine brushwork, masterpiece`;
}

/**
 * 为 LoremFlickr 生成风景标签。
 */
function flickrTags(poem) {
  const themes = extractThemes(poem);
  if (!themes.length) return [...FALLBACK_TAGS];

  const set = new Set(['landscape', 'nature']);
  for (const k of themes) {
    const tags = FLICKR_TAGS[k] || [k];
    for (const t of tags) set.add(t);
  }
  return Array.from(set);
}

// ── 图片加载（带 CORS + 超时） ───────────────────────────

// 显示图尺寸:720×450（与展示卡片图区 300px 高严格匹配,接近 1.6:1）
//   - 宽 720 适合手机宽度 480px 显示且 2x 锐化足够
//   - 高 450 = 720 × 5/8,匹配展示 300px 高按比例缩放
//   - 体积:720×450×4 字节 ≈ 1.3MB 原始(AI 生成图 PNG 一般 < 500KB)
// 单次请求只取这一档；导出 Canvas 在 cards.js 里按 DOM 实际尺寸 + dpr 锐化。
export const SCENE_IMG_W = 720;
export const SCENE_IMG_H = 450;

// 图片加载:总超时缩短到 4s(原 8s),失败快速降级到 LoremFlickr / Picsum / 渐变
//   减少「点击换一张 → 长时间等待」的体感
const IMG_TIMEOUT_MS = 4000;
const AI_TIMEOUT_MS = 3500;   // Pollinations AI 慢,单独给 3.5s

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

function pollinationsUrl(poem, opts = {}) {
  const w = opts.width || SCENE_IMG_W;
  const h = opts.height || SCENE_IMG_H;
  const seed = opts.seed ?? Date.now();
  const prompt = poemPrompt(poem);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
}

function loremFlickrUrl(poem, opts = {}) {
  const w = opts.width || SCENE_IMG_W;
  const h = opts.height || SCENE_IMG_H;
  const seed = opts.seed ?? Date.now();
  const tags = flickrTags(poem);
  return `https://loremflickr.com/${w}/${h}/${encodeURIComponent(tags.join(','))}?lock=${seed}`;
}

function picsumUrl(opts = {}) {
  const w = opts.width || SCENE_IMG_W;
  const h = opts.height || SCENE_IMG_H;
  const seed = opts.seed ?? Date.now();
  return `https://picsum.photos/seed/poem${seed}/${w}/${h}`;
}

/**
 * 为一首诗取一张配图。多源依次尝试，任一成功即返回。
 * 顺序：Pollinations(6s) → LoremFlickr(8s) → Picsum(6s)
 * @param {object} poem
 * @param {{width?:number, height?:number, seed?:number}} opts
 * @returns {Promise<{img:HTMLImageElement|null, url:string|null, source:string}>}
 */
export async function fetchSceneImage(poem, opts = {}) {
  // ① Pollinations AI：按诗意生成，最贴合
  const aiUrl = pollinationsUrl(poem, opts);
  let img = await loadImage(aiUrl, AI_TIMEOUT_MS);
  if (img) return { img, url: aiUrl, source: 'Pollinations' };

  // ② LoremFlickr：风景关键词兜底
  const flickrUrl = loremFlickrUrl(poem, opts);
  img = await loadImage(flickrUrl, IMG_TIMEOUT_MS);
  if (img) return { img, url: flickrUrl, source: 'LoremFlickr' };

  // ③ Picsum：稳定随机兜底
  const pUrl = picsumUrl(opts);
  img = await loadImage(pUrl, 6000);
  if (img) return { img, url: pUrl, source: 'Picsum' };

  // ④ 都失败：返回 null，由调用方用 CSS 渐变兜底
  return { img: null, url: null, source: 'none' };
}

/**
 * 仅取主图源 URL（不预加载），用于 <img src> 直接展示。
 * 当前主图源为 Pollinations；导出时才走 fetchSceneImage 拿 CORS 版。
 */
export function sceneImageUrl(poem, opts = {}) {
  return pollinationsUrl(poem, opts);
}
