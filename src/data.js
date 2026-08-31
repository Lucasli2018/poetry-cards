let cache = null;

export function initCache(data) { cache = data; }

export async function loadPoems() {
  if (cache) return cache;
  try {
    const res = await fetch('./data/poetry.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cache = await res.json();
    return cache;
  } catch (e) {
    console.error('Failed to load poems:', e);
    throw e;
  }
}

export function getById(id) {
  if (!cache) return null;
  return cache.poems.find(p => p.id === id) || null;
}

export function getAll() {
  return cache ? cache.poems : [];
}

export function getMeta() {
  return cache ? cache.meta : { version: '0', count: 0, dynasty: [] };
}