export function filterByCategory(poems, category) {
  if (!Array.isArray(poems) || poems.length === 0) return [];
  if (category === 'all' || !category) return poems.slice();
  return poems.filter(p => p.category === category);
}

export function getCategories(meta, poems) {
  const set = new Set();
  for (const p of poems) {
    if (p && p.category) set.add(p.category);
  }
  return ['全部', ...[...set].sort()];
}