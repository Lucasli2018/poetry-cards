import fs from 'node:fs';
import path from 'node:path';
const file = path.resolve('data/poetry.json');
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
const errors = [];
const ids = new Set();
for (const p of data.poems) {
  if (!p.id || ids.has(p.id)) errors.push(`重复或缺失 id: ${p.id}`);
  ids.add(p.id);
  for (const k of ['title', 'author', 'dynasty', 'category', 'content']) {
    if (!p[k] || (Array.isArray(p[k]) && p[k].length === 0)) errors.push(`${p.id} 缺字段 ${k}`);
  }
}
console.log(`poems: ${data.poems.length}, errors: ${errors.length}`);
errors.forEach(e => console.log(' -', e));
process.exit(errors.length ? 1 : 0);