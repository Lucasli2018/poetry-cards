// 直接用 fetch 探测三个图源 + 用 URL 而不靠 Image()
const PROMPTS = [
  'mid-autumn moon rabbit lotus',
  'spring festival lantern red plum blossom',
  'mountain misty landscape',
];
const TESTS = [
  { name: 'Pollinations', build: (p) => `https://image.pollinations.ai/prompt/${encodeURIComponent('ancient Chinese painting, '+p)}?width=720&height=450&seed=1&nologo=true`, timeout: 5000 },
  { name: 'LoremFlickr', build: () => `https://loremflickr.com/720/450/landscape,nature?lock=1`, timeout: 5000 },
  { name: 'Picsum', build: () => `https://picsum.photos/seed/poem1/720/450`, timeout: 5000 },
];
for (const t of TESTS) {
  const url = t.build(PROMPTS[0]);
  console.log(`[probe] ${t.name}`);
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), t.timeout);
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(timer);
    console.log(`  STATUS=${r.status} ms=${Date.now()-t0} ctype=${r.headers.get('content-type')}`);
  } catch (e) {
    console.log(`  ERR ${e.name} ms=${Date.now()-t0} msg=${e.message}`);
  }
}