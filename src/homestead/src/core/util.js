// Small shared helpers: seeded RNG, formatting, event bus.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b, r = Math.random) => a + (b - a) * r();
export const randInt = (a, b, r = Math.random) => Math.floor(a + (b - a + 1) * r());
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
export function weighted(pairs, r = Math.random) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let x = r() * total;
  for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
let _uid = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(_uid++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}
export function fmtEth(v, digits = 4) {
  if (!v) return '0';
  if (v < 0.0001) return v.toFixed(6).replace(/0+$/, '');
  return v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class Bus {
  constructor() { this.map = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.map.get(ev).delete(fn); }
  emit(ev, ...args) {
    const s = this.map.get(ev);
    if (s) for (const fn of [...s]) { try { fn(...args); } catch (e) { console.error('[bus]', ev, e); } }
  }
}
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
