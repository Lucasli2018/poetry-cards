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

// ── 意境（情感 / 时令 / 时段 / 诗人风格）提取 ───────────────
// 在「具体物象」(IMAGERY) 之外，进一步抽取诗词的**意境**：
//   · 情感基调 mood   —— 孤寂 / 愁思 / 思念 / 豪迈 / 旷达 / 喜悦 / 闲适
//   · 时令 season     —— 春 / 夏 / 秋 / 冬（取主导一项，避免春+秋矛盾同框）
//   · 时段 time       —— 拂晓 / 白昼 / 黄昏 / 夜
//   · 诗人风格 authorStyle（可选）—— 王维清幽、李白浪漫、苏轼旷达……
// 这些维度共同决定 AI 出图的「氛围」，让图真正贴着诗的意，而不只贴物象。

// 情感基调：顺序即优先级；按命中次数取主导一项，无则默认 serene
const MOODS = [
  { re: /孤|独|寂|寥|幽|静|恬|泊/,         key: 'solitude',   prompt: 'solitary, quiet, contemplative atmosphere', flickr: ['calm', 'mist'] },
  { re: /愁|悲|怨|凄|怅|惘|泪|憔悴|断肠|泣/, key: 'melancholy', prompt: 'melancholic, wistful, sorrowful mood',      flickr: ['mist', 'fog'] },
  { re: /思|忆|念|怀|梦|故|乡|归雁|望乡/,   key: 'longing',    prompt: 'longing, nostalgic, tender mood',           flickr: ['mist', 'fog'] },
  { re: /豪|壮|狂|志|剑|征|战|铁|疆|戈/,     key: 'heroic',     prompt: 'grand, heroic, dynamic energy',            flickr: ['mountain', 'dramatic'] },
  { re: /旷|达|豁|逍|遥|仙|羽|忘机|醉|酌|倾杯/, key: 'free',     prompt: 'free-spirited, transcendent, ethereal mood', flickr: ['clouds', 'sky'] },
  { re: /喜|欢|笑|乐|悦|歌|舞/,             key: 'joy',        prompt: 'joyful, bright, lively mood',              flickr: ['blossom', 'bright'] },
  { re: /闲|田|农|渔|樵|归隐|耦/,           key: 'pastoral',   prompt: 'leisurely, pastoral, peaceful mood',        flickr: ['meadow', 'calm'] },
];

// 时令：取主导一项（避免一首诗同时出现春+秋导致画面矛盾）
const SEASONS = [
  { re: /春|东风|柳|燕|桃|杏|莺|芳草|暖/, key: 'spring', prompt: ', springtime', flickr: ['spring', 'blossom'] },
  { re: /夏|荷|莲|蝉|薰|溽/,           key: 'summer', prompt: ', summer',    flickr: ['summer', 'lotus'] },
  { re: /秋|西风|落叶|枫|霜叶|梧桐/,     key: 'autumn', prompt: ', autumn',    flickr: ['autumn', 'maple'] },
  { re: /雪|冰|寒|凛|梅|岁寒/,          key: 'winter', prompt: ', winter',    flickr: ['winter', 'snow'] },
];

// 时段：取主导一项
const TIMES = [
  { re: /朝|晨|晓|旭|旦|黎明|拂晓/,         key: 'dawn', prompt: ', dawn light',   flickr: ['dawn', 'mist'] },
  { re: /午|日中|正午|晴|霁/,               key: 'day',  prompt: ', daytime',     flickr: ['daylight'] },
  { re: /暮|昏|夕|落日|斜阳|残照|晚照|向晚/, key: 'dusk', prompt: ', dusk glow',   flickr: ['sunset', 'dusk'] },
  { re: /夜|宵|星|河汉|漏|烛|望月|明月/,     key: 'night', prompt: ', night',      flickr: ['night', 'moon'] },
];

// 诗人风格（仅对少数耳熟能详的诗人做风格偏置，未命中则不追加）
const AUTHOR_STYLE = {
  '王维':   'zen monastic tranquility',
  '李白':   'romantic expansive celestial grandeur',
  '杜甫':   'solemn humane realism',
  '苏轼':   'open-minded philosophical ease',
  '李清照': 'delicate introspective grace',
  '陶渊明': 'pastoral serenity and simplicity',
  '白居易': 'gentle lucid warmth',
};

// 各维度的英文短语映射（供 poemPrompt / flickrTags 拼接）
const MOOD_PROMPT = Object.fromEntries(MOODS.map((m) => [m.key, m.prompt]));
const SEASON_PROMPT = Object.fromEntries(SEASONS.map((s) => [s.key, s.prompt]));
const TIME_PROMPT = Object.fromEntries(TIMES.map((t) => [t.key, t.prompt]));
const SEASON_FLICKR = Object.fromEntries(SEASONS.map((s) => [s.key, s.flickr]));
const TIME_FLICKR = Object.fromEntries(TIMES.map((t) => [t.key, t.flickr]));
const MOOD_FLICKR = Object.fromEntries(MOODS.map((m) => [m.key, m.flickr]));

const DEFAULT_MOOD = 'serene';
const DEFAULT_MOOD_PROMPT = 'serene, harmonious, balanced mood';

/**
 * 在词表里按「命中次数最多」取主导一项（单一真相，避免矛盾同框）。
 * @returns {string|null}
 */
function detectDominant(lexicon, text) {
  let best = null, bestN = 0;
  for (const e of lexicon) {
    const n = countMatches(e.re, text);
    if (n > bestN) { bestN = n; best = e.key; }
  }
  return best;
}

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
 * 抽取一首诗的「意境」——在 物象(imagery) 之外，补充
 * 情感(mood) / 时令(season) / 时段(time) / 诗人风格(authorStyle)。
 * 这是 v4.6.1 对图像贴合度的核心优化：让 AI 出图按「氛围」而非只按「物」生成。
 * @param {{title?:string, content?:string[], author?:{name?:string}|string, imageTags?:string[]}} poem
 * @returns {{imagery:string[], mood:string, season:string|null, time:string|null, authorStyle:string|null}}
 */
export function extractConception(poem) {
  const text = [poem?.title || '', ...(poem?.content || [])].join('');
  const authorName = (typeof poem?.author === 'string') ? poem.author : (poem?.author?.name || '');
  const imagery = extractThemes(poem);
  const mood = detectDominant(MOODS, text) || DEFAULT_MOOD;
  const season = detectDominant(SEASONS, text);
  const time = detectDominant(TIMES, text);
  const authorStyle = AUTHOR_STYLE[authorName] || null;
  return { imagery, mood, season, time, authorStyle };
}

/**
 * 为 Pollinations AI 生成英文提示词。
 * 风格统一偏向「古代中国画」：水墨/青绿山水、宋人山水意境、低饱和、留白。
 *
 * v4.6.1 起按「意境」编织：物象(imagery) + 时令(season) + 时段(time) +
 * 情感基调(mood) + 诗人风格(authorStyle)，让画面贴着诗的氛围而非只贴物。
 */
export function poemPrompt(poem) {
  const c = extractConception(poem);
  const scenes = c.imagery.length
    ? c.imagery.map((k) => PROMPT_WORDS[k] || k).join(', ')
    : 'serene chinese landscape';
  const seasonPhrase = c.season ? SEASON_PROMPT[c.season] : '';
  const timePhrase = c.time ? TIME_PROMPT[c.time] : '';
  const moodPhrase = MOOD_PROMPT[c.mood] || DEFAULT_MOOD_PROMPT;
  const authorPhrase = c.authorStyle ? `, ${c.authorStyle}` : '';
  // 古代风格前缀 + 物象 + 时令/时段 + 情感 + 诗人风格 + 古画风格后缀
  return `ancient Chinese traditional painting, ${scenes}${seasonPhrase}${timePhrase}, ${moodPhrase}${authorPhrase}, ` +
         `classical Song dynasty landscape art style, traditional ink wash and mineral-green shanshui, ` +
         `serene, elegant, muted earth tones, fine brushwork, masterpiece`;
}

/**
 * 为 LoremFlickr 生成风景标签（v4.6.1 起同样融入意境维度）。
 * 始终带 landscape + nature 护栏，避免搜到街景 / 人像。
 */
function flickrTags(poem) {
  const c = extractConception(poem);
  const set = new Set(['landscape', 'nature']);
  if (!c.imagery.length) for (const t of FALLBACK_TAGS) set.add(t);
  for (const k of c.imagery) {
    for (const t of (FLICKR_TAGS[k] || [k])) set.add(t);
  }
  if (c.season) for (const t of SEASON_FLICKR[c.season]) set.add(t);
  if (c.time) for (const t of TIME_FLICKR[c.time]) set.add(t);
  if (c.mood && c.mood !== DEFAULT_MOOD) {
    for (const t of (MOOD_FLICKR[c.mood] || [])) set.add(t);
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

// 图片加载: 失败快速降级到 LoremFlickr / Picsum / 渐变
//   减少「点击换一张 → 长时间等待」的体感
const IMG_TIMEOUT_MS = 4000;            // loadImage 默认超时(兜底用)
const AI_TIMEOUT_MS = 6000;            // 独立 fetchPollinationsImage 用
const PIC_TIMEOUT_MS = 2000;           // Picsum 兜底(秒出, 失败立即降级)
const POLLIN_TIMEOUT_MS_MIN = 3000;    // 独立 fetchPollinationsImage 下限
const POLLIN_TIMEOUT_MS_MAX = 8000;    // 独立 fetchPollinationsImage 上限
// v4.6: 三源并发 + Pollinations 优先窗口(用户指定 3 秒)
const POLLIN_GATE_MS = 3000;           // Pollinations 3 秒内未返回图片 → 降级 LoremFlickr
const FLICKR_TIMEOUT_MS = 4000;        // LoremFlickr 兜底超时

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

/** 简单的延时 Promise, 用于 Pollinations 优先窗口计时 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pollinationsUrl(poem, opts = {}) {
  const w = opts.width || SCENE_IMG_W;
  const h = opts.height || SCENE_IMG_H;
  const seed = opts.seed ?? Date.now();
  const prompt = poemPrompt(poem);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
}

export function loremFlickrUrl(poem, opts = {}) {
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
 * v4.6 三源并发 + Pollinations 优先窗口
 * ──────────────────────────────────────────────────────────
 * 用户体验目标：主题最贴合的图优先, 但绝不傻等; 三源**同时发起请求**。
 *
 * 优先级链(用户 2026-09-04 指定):
 *   ① Pollinations  —— 按诗意 AI 生成, 最贴合; 给 3s 优先窗口
 *   ② LoremFlickr   —— 按风景关键词搜索; Pollinations 3s 内未返回则用它
 *   ③ Picsum        —— seed 稳定随机; LoremFlickr 无图(失败)时用它
 *
 * 流程:
 *   T+0ms   fetchSceneImage 同时发起三个独立请求(Pollinations / LoremFlickr / Picsum)
 *   T≤3s    Pollinations 返回图片 → 立即采用(回调 onPollinations), 结束
 *   T=3s    Pollinations 仍未返回(超时/失败) → 采用 LoremFlickr(已并发, 通常早已就绪)
 *           LoremFlickr 无图(失败) → 采用 Picsum(已并发, 秒级就绪)
 *   全失败  → {null, null, 'none'}, 调用方保留原图 / 显示水墨底纹
 *
 * 设计要点:
 *   - **同时发起**: 三源并发, 不串行; 仅在「决定采用哪张」时按优先级裁决
 *   - **3s 优先窗口**: Pollinations 是慢源, 但最贴合; 用户指定 3s 内未返回即降级,
 *     不在慢源上无限等待(对比旧 v4.4.0 的 8s 上限)
 *   - **失败不降级到底**: 任一失败不抛错; 全部失败才回 source='none'
 *   - **不重建**: 调用方用 updateImageOnly / updatePostcardImage 局部更新 <img src>
 *   - **回调只触发一次**: 仅在「采用该源」时触发对应回调, 避免低优先级源后到时
 *     错误地覆盖已采用的高优先级图
 *
 * @param {object} poem
 * @param {{width?:number, height?:number, seed?:number,
 *          totalBudgetMs?:number,
 *          onPicsum?:(r)=>void,
 *          onLoremFlickr?:(r)=>void,
 *          onPollinations?:(r)=>void}} opts
 *   onPicsum / onLoremFlickr / onPollinations 是回调, 仅在「采用该源」时触发一次
 * @returns {Promise<{img:HTMLImageElement|null, url:string|null, source:string}>}
 *   返回最终采用的图(优先级 Pollinations > LoremFlickr > Picsum); 全失败则 {null, null, 'none'}
 */
export async function fetchSceneImage(poem, opts = {}) {
  const aiUrl = pollinationsUrl(poem, opts);
  const fkUrl = loremFlickrUrl(poem, opts);
  const pcUrl = picsumUrl(opts);

  // 三源并发 — 同时发起请求。
  // 注意: 这里只在 .then 里做「结果映射」, **不**触发 UI 回调;
  //   回调只在下方「决定采用该源」时触发一次, 防止低优先级源后到覆盖高优先级图。
  const aiP = loadImage(aiUrl, POLLIN_GATE_MS)
    .then((img) => (img ? { img, url: aiUrl, source: 'Pollinations' } : null));
  const fkP = loadImage(fkUrl, FLICKR_TIMEOUT_MS)
    .then((img) => (img ? { img, url: fkUrl, source: 'LoremFlickr' } : null));
  const pcP = loadImage(pcUrl, PIC_TIMEOUT_MS)
    .then((img) => (img ? { img, url: pcUrl, source: 'Picsum' } : null));

  // ① Pollinations 优先: 3 秒窗口内返回即用
  const aiGate = await Promise.race([aiP, delay(POLLIN_GATE_MS).then(() => null)]);
  if (aiGate) {
    if (opts.onPollinations) opts.onPollinations(aiGate);
    return aiGate;
  }

  // ② Pollinations 超时/失败 → LoremFlickr(已并发, 可能早已就绪)
  const fk = await fkP;
  if (fk) {
    if (opts.onLoremFlickr) opts.onLoremFlickr(fk);
    return fk;
  }

  // ③ LoremFlickr 失败 → Picsum(已并发, 秒级就绪)
  const pc = await pcP;
  if (pc) {
    if (opts.onPicsum) opts.onPicsum(pc);
    return pc;
  }

  return { img: null, url: null, source: 'none' };
}

/**
 * 仅取主图源 URL（不预加载），用于 <img src> 直接展示。
 * 当前主图源为 Picsum（秒出稳定）；Pollinations 走 fetchSceneImage 并发追加。
 */
export function sceneImageUrl(poem, opts = {}) {
  return picsumUrl(opts);
}

// ── 向后兼容: 旧 API 仍可独立调用 ──
// v4.4.0 之前, fetchSceneImage 是串行(Pollinations → Picsum);
// 旧实现走 images.js 的 aiImgUrl / picsumUrl + 内部 Promise.race.
// 现拆成 fetchPicsumImage / fetchPollinationsImage 两个独立函数,
// 供需要在「一张图就够」场景下使用的调用方.
// 不破坏 _resolveOptions / 其他现有契约.
export async function fetchPicsumImage(opts = {}) {
  const url = picsumUrl(opts);
  const img = await loadImage(url, PIC_TIMEOUT_MS);
  return img ? { img, url, source: 'Picsum' } : { img: null, url: null, source: 'none' };
}

export async function fetchPollinationsImage(poem, opts = {}) {
  const url = pollinationsUrl(poem, opts);
  const timeout = Math.max(
    POLLIN_TIMEOUT_MS_MIN,
    Math.min(POLLIN_TIMEOUT_MS_MAX, opts.totalBudgetMs || AI_TIMEOUT_MS)
  );
  const img = await loadImage(url, timeout);
  return img ? { img, url, source: 'Pollinations' } : { img: null, url: null, source: 'none' };
}
