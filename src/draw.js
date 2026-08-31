export function draw(pool, history = [], opts = {}) {
  const { recentWindow = 10 } = opts;
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const recentIds = new Set(history.slice(-recentWindow).map(h => h && h.id).filter(Boolean));
  const candidates = pool.filter(p => !recentIds.has(p.id));
  const list = candidates.length > 0 ? candidates : pool;
  return list[Math.floor(Math.random() * list.length)];
}