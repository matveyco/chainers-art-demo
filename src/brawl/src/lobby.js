// Lobby: pick a brawler, a difficulty and a render style, then play. The picked brawler stands
// on the blue spawn pad in 3D; the roster cards carry pixel portraits composed from each
// outfit's face texels plus a front view of its hat.
import { BRAWLERS, ROSTER } from './config.js';
import { HATS } from './avatar.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 44 x 64 px pixel portrait: face texels + hat boxes seen from the front + 1 px outline
export function portrait(faces, index, hat) {
  const W = 44, H = 64, ox = 4, oy = 8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(faces, index * 36, 0, 36, 56, ox, oy, 36, 56);
  if (hat) {
    const boxes = HATS[hat]().slice().sort((a, b) => (a.c[2] + a.s[2] / 2) - (b.c[2] + b.s[2] / 2));
    for (const b of boxes) {
      const x0 = Math.round((b.c[0] - b.s[0] / 2 + 4.5) * 4) + ox, x1 = Math.round((b.c[0] + b.s[0] / 2 + 4.5) * 4) + ox;
      const y0 = Math.round((47.5 - (b.c[1] + b.s[1] / 2)) * 4) + oy, y1 = Math.round((47.5 - (b.c[1] - b.s[1] / 2)) * 4) + oy;
      const [r, gg, bb] = b.tint.map((v) => Math.round(v * 255));
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.fillRect(x0, y0, x1 - x0, 1);
    }
  }
  // outline
  const id = g.getImageData(0, 0, W, H);
  const d = id.data, out = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (d[k + 3] > 0) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (d[(yy * W + xx) * 4 + 3] > 0) { edge = true; break; }
    }
    if (edge) { out[k] = 22; out[k + 1] = 16; out[k + 2] = 34; out[k + 3] = 255; }
  }
  g.putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}

function stat(label, v, max, text) {
  const f = Math.max(0.06, Math.min(1, v / max));
  return `<div class="stat"><span>${label}</span><div class="sbar"><i style="width:${(f * 100).toFixed(0)}%"></i></div><b>${text}</b></div>`;
}

export class Lobby {
  constructor({ faces, icons, onPick, onPlay }) {
    this.el = $('lobby');
    this.faces = faces;
    this.icons = icons || {};
    this.onPick = onPick;
    this.onPlay = onPlay;
    this.pick = 'gaptooth';
    this.portraits = {};
    const roster = $('roster');
    roster.textContent = '';
    ROSTER.forEach((id, i) => {
      const def = BRAWLERS[id];
      const p = portrait(faces, i, def.hat);
      this.portraits[id] = p;
      const b = document.createElement('button');
      b.className = 'card';
      b.setAttribute('role', 'radio');
      b.dataset.id = id;
      b.style.setProperty('--c', def.accent);
      const icon = this.icons[def.weapon];
      b.innerHTML = `<span class="face"></span><span class="card-txt"><b>${esc(def.name)}</b><small>${esc(def.role)}</small></span>` +
        (icon ? `<img class="wpn" alt="" src="${icon}">` : '');
      b.querySelector('.face').appendChild(p.cloneNode ? this._copy(p) : p);
      b.addEventListener('click', () => this.select(id, true));
      roster.appendChild(b);
    });
    $('btn-play').addEventListener('click', () => this.onPlay && this.onPlay(this.pick));
    this.select('gaptooth', false);
  }

  _copy(c) {
    const n = document.createElement('canvas');
    n.width = c.width; n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  select(id, user) {
    this.pick = id;
    const def = BRAWLERS[id];
    document.querySelectorAll('#roster .card').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === id)));
    const a = def.attack, s = def.super;
    const dmg = a.kind === 'burst' ? a.damage * a.count : a.kind === 'spread' ? a.damage * a.count : a.damage;
    const dmgTxt = a.kind === 'burst' ? `${a.count} × ${a.damage}` : a.kind === 'spread' ? `${a.count} × ${a.damage}` : `${a.damage} splash`;
    $('bio').style.setProperty('--c', def.accent);
    $('bio').innerHTML = `
      <div class="bio-head"><h2>${esc(def.name)}</h2><span class="role">${esc(def.role)}</span></div>
      <p class="blurb">${esc(def.blurb)}</p>
      <div class="stats-grid">
        ${stat('Health', def.hp, 5000, def.hp)}
        ${stat('Damage', dmg, 1700, dmgTxt)}
        ${stat('Range', a.range, 11, a.range.toFixed(1) + ' m')}
        ${stat('Speed', def.speed - 2.6, 1.4, def.speed.toFixed(2) + ' m/s')}
      </div>
      <p class="super"><span>Super</span><b>${esc(s.name)}</b></p>`;
    if (this.onPick) this.onPick(id, user);
  }

  show(on) { this.el.hidden = !on; }
}
