// Voxel particle effects (pooled cubes) + squash-and-stretch tweens.
import { pc, ent } from './engine.js';
import { easeOutBack, easeOutCubic, lerp } from '../core/util.js';

const PRESETS = {
  smoke:    { colors: ['#ffffff', '#e9eef5', '#d5dbe6'], size: [0.25, 0.55], life: [1.6, 2.6], vy: [1.0, 1.8], spread: 0.35, grav: 0, grow: 1.6, fade: true },
  steam:    { colors: ['#ffffff', '#eaf6ff'], size: [0.18, 0.36], life: [1.0, 1.8], vy: [0.8, 1.4], spread: 0.3, grav: 0, grow: 1.4, fade: true },
  fire:     { colors: ['#ffb02e', '#ff7a2e', '#ffd75a'], size: [0.14, 0.3], life: [0.4, 0.8], vy: [1.2, 2.4], spread: 0.3, grav: 0, grow: 0.3, glow: true },
  sparkle:  { colors: ['#fff3a8', '#ffffff', '#ffd75a', '#b6c4ff'], size: [0.1, 0.2], life: [0.6, 1.2], vy: [0.4, 1.4], spread: 0.9, grav: 0, grow: 0.1, glow: true, spin: true },
  dust:     { colors: ['#d8c29a', '#c7ad82', '#efe0bf'], size: [0.2, 0.42], life: [0.5, 0.9], vy: [0.6, 1.6], spread: 2.4, grav: -2, grow: 1.3, fade: true },
  chips:    { colors: ['#7a4a1f', '#a27440', '#4c2f17'], size: [0.1, 0.2], life: [0.5, 0.9], vy: [2.5, 5], spread: 2.6, grav: -14, grow: 1, spin: true },
  pebbles:  { colors: ['#b9bcc4', '#7d808c', '#d3d6dc'], size: [0.1, 0.2], life: [0.5, 0.9], vy: [2.5, 5], spread: 2.6, grav: -14, grow: 1, spin: true },
  leaves:   { colors: ['#d5761a', '#dfa126', '#b85c14', '#62782a'], size: [0.1, 0.22], life: [0.7, 1.2], vy: [2, 4.5], spread: 2.4, grav: -9, grow: 1, spin: true },
  confetti: { colors: ['#c8321c', '#f2a93b', '#3f8fd6', '#6c7b25', '#fffbe8', '#d5761a', '#dfa126'], size: [0.12, 0.24], life: [1.0, 1.9], vy: [5, 10], spread: 4.5, grav: -11, grow: 1, spin: true, glow: true },
  coins:    { colors: ['#8c9eff', '#b6c4ff', '#ffffff', '#6f7fe8'], size: [0.14, 0.26], life: [0.8, 1.5], vy: [4, 8], spread: 3, grav: -10, grow: 1, spin: true, glow: true },
  hearts:   { colors: ['#f0705a', '#f08fb0', '#ff9eb5'], size: [0.14, 0.24], life: [0.9, 1.5], vy: [1.2, 2.2], spread: 0.8, grav: 0, grow: 0.6, glow: true },
  zzz:      { colors: ['#ffffff', '#cfe3fb'], size: [0.12, 0.2], life: [1.2, 1.8], vy: [0.5, 0.9], spread: 0.25, grav: 0, grow: 1.2, fade: true },
};

export class Fx {
  constructor(engine, max = 420) {
    this.engine = engine;
    this.root = ent('fx');
    engine.app.root.addChild(this.root);
    this.pool = [];
    this.live = [];
    this.tweens = [];
    this.emitters = new Set();
    for (let i = 0; i < max; i++) {
      const e = ent('p');
      e.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
      e.enabled = false;
      this.root.addChild(e);
      this.pool.push(e);
    }
    engine.onUpdate((dt) => this.update(dt));
  }
  /** Leaf bursts (bushes, harvests) take the colours of the season. */
  setLeaves(colors) { if (colors && colors.length) PRESETS.leaves.colors = colors; }
  _mat(hex, glow) { return this.engine.flatMaterial(hex, glow ? { emissive: hex, intensity: 1.4 } : {}); }
  burst(kind, x, y, z, count = 10, scale = 1) {
    const P = PRESETS[kind];
    if (!P) return;
    for (let i = 0; i < count; i++) {
      const e = this.pool.pop();
      if (!e) return;
      const hex = P.colors[(Math.random() * P.colors.length) | 0];
      e.render.material = this._mat(hex, P.glow);
      const s = lerp(P.size[0], P.size[1], Math.random()) * scale;
      const a = Math.random() * Math.PI * 2, sp = Math.random() * P.spread * scale;
      const p = {
        e, s, life: lerp(P.life[0], P.life[1], Math.random()), t: 0,
        x: x + Math.cos(a) * 0.15 * scale, y, z: z + Math.sin(a) * 0.15 * scale,
        vx: Math.cos(a) * sp, vy: lerp(P.vy[0], P.vy[1], Math.random()) * (P.grav ? scale : 1), vz: Math.sin(a) * sp,
        grav: P.grav, grow: P.grow, spin: P.spin ? (Math.random() - 0.5) * 720 : 0, rot: Math.random() * 360, fade: P.fade,
      };
      e.enabled = true;
      e.setPosition(p.x, p.y, p.z);
      e.setLocalScale(s, s, s);
      this.live.push(p);
    }
  }
  /** Continuous emitter attached to an entity (e.g. chimney smoke). Returns a handle with .stop(). */
  emitter(kind, entity, rate = 2, scale = 1, offset = [0, 0, 0]) {
    const em = { kind, entity, rate, scale, offset, acc: Math.random(), on: true };
    this.emitters.add(em);
    em.stop = () => this.emitters.delete(em);
    return em;
  }
  /** Simple tween: fn(t01) each frame, done() at the end. */
  tween(dur, fn, done) { const t = { dur, fn, done, t: 0 }; this.tweens.push(t); return t; }
  /** Bouncy pop-in / tap feedback for an entity. */
  pop(entity, from = 0.6, dur = 0.35, base = 1) {
    this.tween(dur, (t) => {
      if (!entity.parent) return;
      const k = lerp(from, 1, easeOutBack(t)) * base;
      const sq = 1 + Math.sin(t * Math.PI) * 0.12 * (from < 1 ? 1 : -1);
      entity.setLocalScale(k / Math.sqrt(sq), k * sq, k / Math.sqrt(sq));
    }, () => entity.parent && entity.setLocalScale(base, base, base));
  }
  squash(entity, amt = 0.14, dur = 0.28, base = 1) {
    this.tween(dur, (t) => {
      if (!entity.parent) return;
      const w = Math.sin(t * Math.PI * 2.2) * (1 - t) * amt;
      entity.setLocalScale(base * (1 + w), base * (1 - w), base * (1 + w));
    }, () => entity.parent && entity.setLocalScale(base, base, base));
  }
  update(dt) {
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dt;
      if (p.t >= p.life) { p.e.enabled = false; this.pool.push(p.e); live[i] = live[live.length - 1]; live.pop(); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.grav && p.y < 0.05) { p.y = 0.05; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      const k = p.t / p.life;
      const s = p.s * lerp(1, p.grow, k) * (p.fade ? 1 - k * k : (k > 0.75 ? 1 - (k - 0.75) * 4 : 1));
      p.e.setPosition(p.x, p.y, p.z);
      p.e.setLocalScale(s, s, s);
      if (p.spin) { p.rot += p.spin * dt; p.e.setEulerAngles(p.rot, p.rot * 0.7, 0); }
    }
    for (const em of this.emitters) {
      if (!em.on || !em.entity.enabled || !em.entity.parent) continue;
      em.acc += dt * em.rate;
      while (em.acc >= 1) {
        em.acc -= 1;
        const w = em.entity.getPosition();
        this.burst(em.kind, w.x + em.offset[0], w.y + em.offset[1], w.z + em.offset[2], 1, em.scale);
      }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); t.done && t.done(); }
    }
  }
}
export { easeOutCubic };
