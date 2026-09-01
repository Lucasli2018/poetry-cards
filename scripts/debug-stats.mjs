// =============================================================
// 古韵抽卡 v3.2 · 模拟一次抽卡 → 写出 stats 看 dynasty counter 是否正确
// =============================================================
import { createStatsStore } from '../src/store/stats.js';
import { normalizePoem } from '../src/store/schema.js';

const mem = new Map();
const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null),
             setItem: (k, v) => mem.set(k, String(v)) };
const stats = createStatsStore(ls);

// 模拟本地诗库的一条样本
const localPoem = {
  id: 900001, title: '登鹳雀楼',
  content: ['白日依山尽', '黄河入海流'],
  author: { id: 9001, name: '王之涣' },
  dynasty: { id: 6, name: '唐' },
  type: { id: 11, name: '五言绝句' },
};
const remotePoem = {
  id: 12345, title: '静夜思',
  content: ['床前明月光'],
  author: { name: '李白' },
  dynasty: { name: '唐' },
  type: { name: '五言绝句' },
};

const n1 = normalizePoem(localPoem);
const n2 = normalizePoem(remotePoem);

stats.onDraw(n1, []);
stats.onDraw(n2, []);

const s = stats.get();
console.log('after 2 draws:');
console.log('  totalDraws:', s.totalDraws);
console.log('  todayDraws:', s.todayDraws);
console.log('  dynastyCounter:', JSON.stringify(s.dynastyCounter));
console.log('  topDynasties:', JSON.stringify(stats.topDynasties(5)));

// 故意挑一首 dynasty 是字符串而不是 {id,name} 的诗
const stringPoem = { id: 999, title: '测试字符串朝代', content: ['x'], dynasty: '宋' };
const n3 = normalizePoem(stringPoem);
console.log('\nnormalizePoem(stringPoem).dynasty =', JSON.stringify(n3.dynasty));
stats.onDraw(n3, []);
console.log('after 3rd draw dynastyCounter:', JSON.stringify(stats.get().dynastyCounter));

// 模拟 refreshMemoryPanel 传给 renderers 的对象
const snapshot = {
  favorites: { items: [] },
  history:   { items: [] },
  stats: {
    totalDraws:   stats.get().totalDraws,
    todayDraws:   stats.get().todayDraws,
    topDynasties: stats.topDynasties(5),
    topImagery:   stats.topImagery(5),
  },
};
console.log('\n传给 renderers 的 snapshot:');
console.log(JSON.stringify(snapshot, null, 2));

// 模拟「真乱码」场景:counter 里是 object 而不是 string
const broken = new Map();
const ls2 = { getItem: (k) => (broken.has(k) ? broken.get(k) : null),
              setItem: (k, v) => broken.set(k, String(v)) };
const stats2 = createStatsStore(ls2);
// 直接塞入非字符串 counter(模拟数据污染)
ls2.setItem('pc_v3_stats_meta', JSON.stringify({
  version: 1, totalDraws: 3, todayDraws: 3, todayKey: '',
  dynastyCounter: { '唐': 2, '[object Object]': 1 },
  imageryCounter: {},
}));
console.log('\n污染场景下 topDynasties:');
console.log(JSON.stringify(stats2.topDynasties(5)));