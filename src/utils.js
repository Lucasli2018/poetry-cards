export function formatTime(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function randomInt(max) {
  return Math.floor(Math.random() * max);
}

export function safeJSONParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}