// Voxel particle effects + squash-and-stretch tweens.
//
// Every particle is a box (a cube, a splinter, a flat card, one segment of a ring). All of them are written
// into ONE dynamic vertex buffer each frame and drawn in two calls: the lit ones (dust, smoke, chips: they
// take the season's light) and the glowing ones (fire, sparkles, confetti: unlit, palette colours as they are).
// Nothing is transparent: a particle arrives with a pop and leaves by shrinking.
//
//   fx.burst(kind, x, y, z, count = 10, scale = 1, opts)      one-shot
//       opts.shape   'burst' (default: outwards on the ground plane) | 'ring' | 'cone' | 'fountain' | 'disc'
//       opts.radius  ring / disc radius         opts.dir [x, y, z] + opts.angle (degrees) for a cone
//       opts.delay   seconds the particles are staggered over        opts.colors  override the kind's colours
//       opts.speed / opts.life / opts.up   multipliers
//   fx.ring(x, y, z, r0, r1, opts)                            hard-edged shockwave ring on the ground
//   fx.emitter(kind, entity, rate, scale, offset, opts)       continuous; returns { on, stop() }
//   fx.pop / squash / settle / land / shrinkAway              scale tweens (one per entity, the newest wins)
//   fx.thump / built / chop / fell / loot / cheer / poof / arrive / depart / cannons      the game's moments
import { pc, ent } from './engine.js';
import { windAt } from './seasons.js';
import { easeOutBack, easeOutCubic, lerp, clamp } from '../core/util.js';

// in: share of life spent popping in (with overshoot) · grow: size multiplier reached by the end (eased out)
// out: share of life after which it shrinks away · drag: 1/s · wind: how fast it takes the wind · flat/long: box ratios
const PRESETS = {
  smoke:    { colors: ['#e4d9c2', '#d6cab1', '#c8baa0'], to: '#9b8d7c', size: [0.15, 0.26], life: [2.2, 3.2], vy: [1.25, 1.75], spread: 0.2, drag: 0.6, wind: 0.95, in: 0.1, grow: 1.9, out: 0.4, turn: 28 },
  steam:    { colors: ['#fffbe8', '#f1ead8'], size: [0.18, 0.32], life: [1.0, 1.7], vy: [0.8, 1.4], spread: 0.25, drag: 0.6, wind: 0.6, in: 0.12, grow: 1.7, out: 0.3, turn: 40 },
  fire:     { ramp: ['#ffe58a', '#ffc94a', '#f2a93b', '#e8742a', '#c8321c', '#7a2a14'], size: [0.15, 0.28], life: [0.42, 0.8], vy: [1.5, 2.6], spread: 0.34, drag: 1.4, in: 0.08, grow: 0.75, out: 0.2, glow: true, turn: 120, also: ['ember', 0.1] },
  ember:    { ramp: ['#ffe9a8', '#f2a93b', '#e8742a', '#c8321c'], size: [0.05, 0.09], life: [0.9, 1.7], vy: [1.8, 3.2], spread: 0.5, drag: 0.5, wind: 0.5, flutter: 1.6, in: 0.05, grow: 1, out: 0.6, glow: true },
  sparkle:  { colors: ['#fffbe8', '#ffe9a8', '#f2a93b', '#ffd75a', '#ffe9a8'], size: [0.11, 0.21], life: [0.55, 1.05], vy: [0.6, 1.8], spread: 0.9, drag: 2.2, in: 0.14, grow: 1, out: 0.45, glow: true, long: [1, 1, 0.3], tilt: 45, turn: 520, blink: 9 },      // a diamond plate spinning on its point: it winks as it turns edge-on
  dust:     { colors: ['#c9a876', '#b08f5e', '#dcc296', '#bf9d6a'], snow: ['#f3efe6', '#dedad6', '#cdb58a'], size: [0.07, 0.19], life: [0.45, 0.9], vy: [0.3, 1.1], spread: 2.4, speed: [2.2, 4.2], grav: -0.6, drag: 3.6, in: 0.1, grow: 1.45, out: 0.3, turn: 50, long: [1, 0.72, 1] },
  chips:    { colors: ['#e0b478', '#c8935a', '#8a5a2c', '#efd09c', '#5a3518'], size: [0.12, 0.23], life: [0.7, 1.1], vy: [3, 5.5], spread: 2.6, speed: [4, 6.5], grav: -15, drag: 0.3, bounce: 0.35, in: 0.05, out: 0.7, long: [1.9, 0.55, 0.8], spin: 620 },
  pebbles:  { colors: ['#c3c6ce', '#8a8d99', '#dfe1e6', '#5e616c'], size: [0.12, 0.23], life: [0.7, 1.1], vy: [3, 5.5], spread: 2.6, speed: [4, 6.5], grav: -17, drag: 0.2, bounce: 0.42, in: 0.05, out: 0.7, spin: 540 },
  leaves:   { colors: ['#d5761a', '#dfa126', '#b85c14', '#62782a'], size: [0.16, 0.28], life: [1.1, 1.9], vy: [2, 4.5], spread: 2.2, speed: [3, 5], grav: -5.5, drag: 1.7, wind: 0.5, flutter: 2.2, lie: true, in: 0.06, out: 0.75, long: [1, 0.14, 0.72], spin: 300 },
  confetti: { colors: ['#c8321c', '#f2a93b', '#fffbe8', '#6c7b25', '#4d5a8c', '#dfa126', '#e0563c'], size: [0.18, 0.3], life: [1.3, 2.1], vy: [5, 9], spread: 3.5, speed: [6.5, 10.5], grav: -9.5, drag: 1.5, flutter: 2.6, lie: true, in: 0.04, out: 0.8, long: [1, 0.12, 0.6], spin: 520, glow: true },
  coins:    { colors: ['#8c9eff', '#c9d2ff', '#fffbe8', '#6f7fe8'], size: [0.16, 0.26], life: [0.9, 1.5], vy: [4, 8], spread: 3, speed: [5, 8.5], grav: -11, drag: 0.5, bounce: 0.5, in: 0.05, out: 0.75, long: [1, 0.3, 1], spin: 560, glow: true },
  hearts:   { colors: ['#c8321c', '#e0563c', '#f08f7a'], size: [0.15, 0.24], life: [0.9, 1.5], vy: [1.3, 2.3], spread: 0.8, drag: 1.2, flutter: 1.2, in: 0.16, grow: 1.15, out: 0.55, glow: true, tilt: 45 },
  zzz:      { colors: ['#fffbe8', '#e6e2f0'], size: [0.12, 0.2], life: [1.3, 1.9], vy: [0.5, 0.9], spread: 0.22, drag: 0.3, flutter: 0.8, in: 0.15, grow: 1.5, out: 0.5 },
  // a hard little dash of light on water
  glint:    { colors: ['#fffbe8', '#ffffff', '#fff3c4'], size: [0.2, 0.38], life: [0.5, 1.0], vy: [0, 0], spread: 0, in: 0.25, out: 0.5, glow: true, long: [2.6, 0.05, 0.55], blink: 5 },
  // what you just earned, tossed up before the icons fly to the counters
  loot:     { colors: ['#f2a93b', '#dfa126', '#fffbe8'], size: [0.2, 0.3], life: [0.55, 0.85], vy: [5.5, 7.5], spread: 1.1, speed: [6, 8], grav: -15, drag: 0.4, in: 0.1, out: 0.55, spin: 480 },
};
const LOOT_COLORS = {
  wood: ['#b9773f', '#8f5a2c', '#d19a5b'], stone: ['#b9bcc4', '#8f93a0', '#d3d6dc'], bio: ['#6c7b25', '#8a9a3a', '#c8321c'],
  ore: ['#8a6f9e', '#6b557d', '#b9a3c9'], crystal: ['#3fd1c8', '#8fe8e0', '#fffbe8'], planks: ['#d19a5b', '#e6b877', '#b9773f'],
  bricks: ['#d8684f', '#b9523b', '#e88a72'], ingot: ['#9fb0c4', '#c9d4e0', '#7f8fa3'], eth: ['#8c9eff', '#c9d2ff', '#fffbe8'],
};

const MAX = 420;                 // particle budget (boxes)
// a vertex is 20 bytes: position 3 x f32, normal 4 x i8, colour 4 x u8
const RING_N = 24;               // segments of a shockwave ring (14 showed its corners on the big stamps)
const RING_HALF = Math.tan(Math.PI / RING_N) * 1.03;      // half a segment per unit of radius: they just close the ring
// box faces: [normal axis, sign, u axis, v axis] and how bright an unlit box paints each one (so it still reads as a cube)
const FACES = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
const FACE_SHADE = [0.86, 0.7, 1, 0.6, 0.78, 0.92];
const DEG = Math.PI / 180;
const rgbCache = new Map();
function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, c); }
  return c;
}
const ONE = [1, 1, 1];

export class Fx {
  constructor(engine, max = MAX) {
    this.engine = engine;
    this.max = max;
    this.live = [];
    this.free = [];
    this.tweens = [];
    this.emitters = new Set();
    this._scale = new Map();        // entity -> its running scale tween
    this._ax = new Float32Array(9); // scratch: the three half-axes of the box being written
    this._nx = new Float32Array(9); // ... and its unit axes
    this.calm = false;              // prefers-reduced-motion: no camera shake
    try { const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); this.calm = mq.matches; mq.addEventListener('change', (e) => { this.calm = e.matches; }); } catch (e) { /* ignore */ }
    this._build();
    engine.onUpdate((dt) => this.update(dt));
  }
  _build() {
    const app = this.engine.app, dev = app.graphicsDevice, max = this.max;
    const fmt = new pc.VertexFormat(dev, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
      { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
    ]);
    this.vb = new pc.VertexBuffer(dev, fmt, max * 24, { usage: pc.BUFFER_DYNAMIC });
    const idx = new Uint16Array(max * 36);
    for (let q = 0, o = 0; q < max * 6; q++) { const b = q * 4; idx[o++] = b; idx[o++] = b + 1; idx[o++] = b + 2; idx[o++] = b; idx[o++] = b + 2; idx[o++] = b + 3; }
    const ib = new pc.IndexBuffer(dev, pc.INDEXFORMAT_UINT16, idx.length, pc.BUFFER_STATIC, idx.buffer);
    const material = (glow) => {
      const m = new pc.StandardMaterial();
      m.name = glow ? 'fx_glow' : 'fx_lit';
      m.vertexColorGamma = true;                       // colours are written as sRGB bytes
      m.cull = pc.CULLFACE_NONE;
      m.gloss = 0.05; m.metalness = 0; m.useMetalness = true;
      if (glow) { m.useLighting = false; m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 1, 1); m.emissiveVertexColor = true; m.emissiveVertexColorChannel = 'rgb'; m.emissiveIntensity = 1.12; }
      else { m.diffuse = new pc.Color(1, 1, 1); m.diffuseVertexColor = true; m.diffuseVertexColorChannel = 'rgb'; m.emissive = new pc.Color(1, 1, 1); m.emissiveVertexColor = true; m.emissiveVertexColorChannel = 'rgb'; m.emissiveIntensity = 0.16; }
      m.update();
      return m;
    };
    const node = this.root = ent('fx');
    const mk = (glow) => {
      const mesh = new pc.Mesh(dev);
      mesh.vertexBuffer = this.vb;
      mesh.indexBuffer[0] = ib;
      mesh.primitive[0] = { type: pc.PRIMITIVE_TRIANGLES, base: 0, count: 0, indexed: true };
      mesh.aabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(1e5, 1e5, 1e5));
      const mi = new pc.MeshInstance(mesh, material(glow), node);
      mi.cull = false; mi.castShadow = false; mi.receiveShadow = false; mi.visible = false;
      return mi;
    };
    this.miLit = mk(false); this.miGlow = mk(true);
    node.addComponent('render', { type: 'asset', meshInstances: [this.miLit, this.miGlow], castShadows: false, receiveShadows: false });
    app.root.addChild(node);
    this._views();
  }
  _views() {
    const buf = this.vb.lock();
    this._buf = buf; this._f32 = new Float32Array(buf); this._u32 = new Uint32Array(buf);      // a vertex is 5 words: x, y, z, packed normal, packed colour
    this.vb.unlock();
  }

  /** Leaf bursts (bushes, harvests) take the colours of the season. */
  setLeaves(colors) { if (colors && colors.length) PRESETS.leaves.colors = colors; }
  /** Camera shake that respects prefers-reduced-motion. */
  shake(a) { if (!this.calm) this.engine.shake(a); }
  /** Effects are sized for a close camera; from far away they are drawn a little larger so a reward still reads. */
  _zoom() { return clamp(this.engine.rig.curDist / 48, 1, 1.5); }      // at the phone's default distance a chip must stay a chip next to a 50 px Chainer
  _snowy() { const s = this.engine.seasons; return !!s && s.def.snow > 0.3; }

  // ------------------------------------------------------------------------------------------
  // particles
  // ------------------------------------------------------------------------------------------
  burst(kind, x, y, z, count = 10, scale = 1, opts = null) {
    const P = PRESETS[kind];
    if (!P) return;
    const o = opts || ONE_OPTS;
    const shape = o.shape || 'burst';
    const zk = 1 + (this._zoom() - 1) * (o.zoom === undefined ? 1 : +o.zoom), zv = Math.sqrt(zk);      // opts.zoom: 0..1, how much of the far-camera boost it takes
    const cols = o.colors || (P.snow && this._snowy() ? P.snow : P.colors);
    const speedK = (o.speed || 1) * zv, lifeK = o.life || 1, upK = o.up === undefined ? 1 : o.up;
    const floor = this.engine.rig.origin.y + 0.05;
    const radius = (o.radius || 0), a0 = Math.random() * Math.PI * 2;
    let dx = 0, dy = 1, dz = 0, cone = 0;
    if (shape === 'cone' || shape === 'fountain') {
      if (o.dir) { const l = Math.hypot(o.dir[0], o.dir[1], o.dir[2]) || 1; dx = o.dir[0] / l; dy = o.dir[1] / l; dz = o.dir[2] / l; }
      cone = (o.angle === undefined ? (shape === 'fountain' ? 16 : 26) : o.angle) * DEG;
    }
    for (let i = 0; i < count; i++) {
      if (this.live.length >= this.max) return;
      const p = this.free.pop() || {};
      const s = lerp(P.size[0], P.size[1], Math.random()) * scale * zk * (o.size || 1);
      const a = shape === 'ring' ? a0 + (i + Math.random() * 0.6) / count * Math.PI * 2 : Math.random() * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      let px = x, py = y, pz = z, vx, vy, vz;
      if (shape === 'cone' || shape === 'fountain') {
        // a direction inside the cone: tilt `dir` by a random angle around a random perpendicular
        const sp = lerp(P.speed ? P.speed[0] : P.vy[0], P.speed ? P.speed[1] : P.vy[1], Math.random()) * speedK * (P.grav ? scale : 1);
        const t = Math.sqrt(Math.random()) * cone, st = Math.sin(t), ct = Math.cos(t);
        // any vector not parallel to dir gives a perpendicular basis
        let ux = dz, uy = 0, uz = -dx; let ul = Math.hypot(ux, uz);
        if (ul < 1e-3) { ux = 1; uy = 0; uz = 0; ul = 1; }
        ux /= ul; uz /= ul;
        const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
        vx = (dx * ct + (ux * ca + wx * sa) * st) * sp; vy = (dy * ct + (uy * ca + wy * sa) * st) * sp; vz = (dz * ct + (uz * ca + wz * sa) * st) * sp;
        if (radius) { const r = Math.sqrt(Math.random()) * radius, b = Math.random() * Math.PI * 2; px += Math.cos(b) * r; pz += Math.sin(b) * r; }
      } else if (shape === 'ring') {
        const sp = lerp(P.speed ? P.speed[0] : P.spread * 0.6, P.speed ? P.speed[1] : P.spread, Math.random()) * speedK;
        px += ca * radius; pz += sa * radius;
        vx = ca * sp; vz = sa * sp; vy = lerp(P.vy[0], P.vy[1], Math.random()) * upK * (P.grav ? scale : 1);
      } else {
        const sp = Math.random() * P.spread * scale * speedK;
        const r0 = shape === 'disc' ? Math.sqrt(Math.random()) * radius : 0.15 * scale;
        px += ca * r0; pz += sa * r0;
        vx = ca * sp; vz = sa * sp; vy = lerp(P.vy[0], P.vy[1], Math.random()) * upK * (P.grav ? scale * zv : 1);
      }
      p.K = P; p.ring = 0; p.rest = 0;
      p.glow = !!P.glow;
      p.s = s; p.life = lerp(P.life[0], P.life[1], Math.random()) * lifeK;
      p.t = o.delay ? -Math.random() * o.delay : 0;
      p.x = px; p.y = py; p.z = pz; p.vx = vx; p.vy = vy; p.vz = vz;
      p.fy = Math.min(floor, py);
      p.ph = Math.random() * 6.283;
      const L = P.long || ONE;
      p.lx = L[0]; p.ly = L[1]; p.lz = L[2];
      // rotation: tumbling things spin on all axes, puffs only turn slowly about the vertical
      if (P.spin) { p.rx = Math.random() * 6.283; p.ry = Math.random() * 6.283; p.rz = Math.random() * 6.283; p.wx = (Math.random() - 0.5) * 2 * P.spin * DEG; p.wy = (Math.random() - 0.5) * 2 * P.spin * DEG; p.wz = (Math.random() - 0.5) * P.spin * DEG; }
      else { p.rx = 0; p.rz = (P.tilt || 0) * DEG; p.ry = P.turn || P.tilt ? Math.random() * 6.283 : 0; p.wx = 0; p.wz = 0; p.wy = P.turn ? (Math.random() < 0.5 ? -1 : 1) * P.turn * DEG * (0.6 + Math.random() * 0.8) : 0; }
      const c = rgb(cols ? cols[(Math.random() * cols.length) | 0] : P.ramp[0]);
      p.r = c[0]; p.g = c[1]; p.b = c[2];
      this.live.push(p);
      if (P.also && Math.random() < P.also[1]) this.burst(P.also[0], x, y, z, 1, scale, opts);
    }
  }
  /** A hard-edged ring that runs out along the ground and thins to nothing: the stamp of an impact. */
  ring(x, y, z, r0 = 0.6, r1 = 2.4, opts = null) {
    const o = opts || ONE_OPTS;
    const c = rgb(o.color || (this._snowy() ? '#ffdf9a' : '#fffbe8'));      // cream would be lost on snow: winter stamps in warm gold
    const life = o.life || 0.42, w = (o.width || 0.2) * this._zoom(), a0 = Math.random() * 6.283;
    for (let i = 0; i < RING_N; i++) {
      if (this.live.length >= this.max) return;
      const p = this.free.pop() || {};
      p.K = null; p.ring = 1; p.rest = 0; p.glow = o.lit ? false : true;
      p.t = -(o.delay || 0); p.life = life;
      p.x = x; p.y = y; p.z = z; p.a = a0 + i / RING_N * Math.PI * 2;
      p.r0 = r0; p.r1 = r1; p.s = w; p.h = o.height || 0.07;
      p.r = c[0]; p.g = c[1]; p.b = c[2];
      this.live.push(p);
    }
  }
  /** Continuous emitter attached to an entity (e.g. chimney smoke). Returns a handle with .on and .stop().
   *  opts are burst opts; opts.radius scatters the particles over a disc (water glints). */
  emitter(kind, entity, rate = 2, scale = 1, offset = [0, 0, 0], opts = null) {
    const em = { kind, entity, rate, scale, offset, opts: { zoom: 0.45, ...opts }, acc: Math.random(), on: true };      // ambient things grow only a little with distance
    this.emitters.add(em);
    em.stop = () => this.emitters.delete(em);
    return em;
  }

  // ------------------------------------------------------------------------------------------
  // tweens
  // ------------------------------------------------------------------------------------------
  /** Simple tween: fn(t01) each frame, done() at the end. */
  tween(dur, fn, done) { const t = { dur, fn, done, t: 0 }; this.tweens.push(t); return t; }
  /** After `sec` seconds. */
  later(sec, fn) { return this.tween(sec, NOOP, fn); }
  // One scale tween per entity: a new one takes over from the one that is running and inherits its rest scale.
  // The rest scale is the entity's own (so non-uniform things keep their shape) unless `base` says otherwise.
  _scaleTween(entity, base, dur, fn, done) {
    const old = this._scale.get(entity);
    if (old && old.lock) return null;
    let b;
    if (old) { b = old.base; old.dead = true; }
    else if (base !== 1 && base !== undefined) b = new pc.Vec3(base, base, base);
    else { b = entity.getLocalScale().clone(); if (b.x < 1e-3 || b.y < 1e-3 || b.z < 1e-3) b.set(1, 1, 1); }
    const t = this.tween(dur, (k) => { if (entity.parent) fn(k, b); }, () => {
      if (this._scale.get(entity) === t) this._scale.delete(entity);
      if (done) done(); else if (entity.parent) entity.setLocalScale(b.x, b.y, b.z);
    });
    t.base = b;
    this._scale.set(entity, t);
    fn(0, b);
    return t;
  }
  /** Bouncy pop-in / tap feedback for an entity. */
  pop(entity, from = 0.6, dur = 0.35, base = 1) {
    this._scaleTween(entity, base, dur, (t, b) => {
      const k = lerp(from, 1, easeOutBack(t));
      const sq = 1 + Math.sin(t * Math.PI) * 0.12 * (from < 1 ? 1 : -1), w = k / Math.sqrt(sq);
      entity.setLocalScale(b.x * w, b.y * k * sq, b.z * w);
    });
  }
  squash(entity, amt = 0.14, dur = 0.28, base = 1) {
    this._scaleTween(entity, base, dur, (t, b) => {
      const w = Math.sin(t * Math.PI * 2.2) * (1 - t) * amt;
      entity.setLocalScale(b.x * (1 + w), b.y * (1 - w), b.z * (1 + w));
    });
  }
  /** Something finished: it jumps up from `from`, overshoots, and rings down like a struck jelly. */
  settle(entity, from = 0.7, dur = 0.7, base = 1) {
    this._scaleTween(entity, base, dur, (t, b) => {
      const e = Math.exp(-6.5 * t), osc = Math.cos(t * 17) * e;           // damped spring around 1
      const y = 1 + (from - 1) * osc, w = 1 - (from - 1) * 0.45 * Math.cos(t * 17 + 0.9) * e;
      const a = Math.min(1, t * 9);                                        // the first frames grow out of `from`
      entity.setLocalScale(b.x * lerp(from, w, a), b.y * lerp(from, y, a), b.z * lerp(from, w, a));
    });
  }
  /** Set down with a thump: tall and thin on the way in, flat on impact, then one small rebound. */
  land(entity, amt = 0.22, dur = 0.42, base = 1) {
    this._scaleTween(entity, base, dur, (t, b) => {
      let y;
      if (t < 0.22) y = lerp(1 + amt * 0.8, 1 - amt, (t / 0.22) ** 2);                    // falls, hits
      else { const u = (t - 0.22) / 0.78; y = 1 - amt * Math.cos(u * Math.PI * 2.5) * Math.exp(-4.2 * u); }
      const w = 1 / Math.sqrt(Math.max(0.3, y));
      entity.setLocalScale(b.x * w, b.y * y, b.z * w);
    });
  }
  /** Leaves the world by shrinking (a short swell first), then done() — which normally destroys it. */
  shrinkAway(entity, dur = 0.38, done = null, turn = 50) {
    const yaw = entity.getLocalEulerAngles().clone();
    const t = this._scaleTween(entity, 1, dur, (k, b) => {
      let s, y;
      if (k < 0.24) { const u = k / 0.24; s = 1 + 0.07 * Math.sin(u * Math.PI * 0.5); y = 1 - 0.1 * Math.sin(u * Math.PI * 0.5); }
      else { const u = (k - 0.24) / 0.76; s = 1.07 * (1 - u * u * u); y = 0.9 * (1 - u * u); }
      s = Math.max(0.001, s); y = Math.max(0.001, y);
      entity.setLocalScale(b.x * s, b.y * y, b.z * s);
      entity.setLocalEulerAngles(yaw.x, yaw.y + turn * k * k, yaw.z);
    }, () => { if (done) done(); else if (entity.parent) entity.destroy(); });
    if (t) t.lock = true; else if (done) done();
    return t;
  }

  // ------------------------------------------------------------------------------------------
  // the game's moments (recipes built from the pieces above)
  // ------------------------------------------------------------------------------------------
  /** A building (or its site) is set down: dust kicks out of the footprint corners. hw / hd are half sizes in metres. */
  thump(x, z, hw = 1, hd = 1, power = 1) {
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1;
      this.burst('dust', x + sx * hw, 0.22, z + sz * hd, Math.round(7 * power), 1.2, { shape: 'cone', dir: [sx, 0.5, sz], angle: 32, speed: 0.95 });
    }
    const r = Math.max(hw, hd);
    this.ring(x, 0.09, z, r * 0.9, r * 1.5 + 0.7, { color: this._snowy() ? '#f3efe6' : '#efe0bf', lit: true, width: 0.24, life: 0.36 });
    this.shake(0.1 * power);
  }
  /** A building is finished (isNew) or upgraded: dust rolls out, a ring stamps the ground, sparkles climb, a little confetti. */
  built(x, z, hw = 1.5, hd = 1.5, isNew = true, top = 3) {
    const r = Math.max(hw, hd);
    this.burst('dust', x, 0.25, z, 26, 1.25, { shape: 'ring', radius: r * 0.85, speed: 0.9 });
    this.ring(x, 0.09, z, r * 0.7, r * 2 + 1, { width: 0.26, life: 0.5 });
    this.burst('sparkle', x, 0.8, z, 14, 1.5, { shape: 'fountain', radius: r * 0.8, angle: 8, delay: 0.55, speed: 2.4, life: 1.2 });
    if (isNew) this.burst('confetti', x, top, z, 20, 1.1, { shape: 'fountain', angle: 34, delay: 0.1 });
    else {
      // an upgrade is a second, amber stamp and a taller column of light instead of a party
      this.ring(x, 0.1, z, r * 0.4, r * 1.6 + 0.6, { color: '#f2a93b', width: 0.22, life: 0.5, delay: 0.14 });
      this.burst('sparkle', x, top * 0.5, z, 12, 1.7, { shape: 'ring', radius: r * 0.75, up: 2.6, speed: 0.25, delay: 0.3, life: 1.3, colors: ['#f2a93b', '#ffe9a8', '#fffbe8'] });
      this.burst('confetti', x, top, z, 10, 1, { shape: 'fountain', angle: 30, delay: 0.1, colors: ['#f2a93b', '#fffbe8', '#dfa126'] });
    }
    this.shake(0.2);
  }
  /** One blow of an axe or a pick. kind: chips | pebbles | leaves. */
  chop(kind, x, y, z, tall = false) {
    this.burst(kind, x, y, z, 6, 1, { shape: 'cone', dir: [0, 1, 0], angle: 55, speed: 0.75 });
    if (tall && kind === 'chips') this.burst('leaves', x, 3.2, z, 2, 1, { shape: 'disc', radius: 0.9, up: 0.1, speed: 0.3 });   // the crown shudders and lets a leaf go
  }
  /** The last blow: the thing comes apart in its own material. */
  fell(kind, x, z, tall = false, scale = 1) {
    this.burst(kind, x, 0.9, z, 16, 1.2 * scale, { shape: 'fountain', angle: 50 });
    if (tall) this.burst('leaves', x, 3, z, 14, 1.2, { shape: 'disc', radius: 1.1, up: 0.5 });
    else if (kind === 'chips') this.burst('leaves', x, 0.6, z, 4, 1);
    this.burst('dust', x, 0.22, z, 14, 1.1, { shape: 'ring', radius: 0.5, speed: 0.7 });
    this.ring(x, 0.09, z, 0.5, 2.1, { color: this._snowy() ? '#f3efe6' : '#efe0bf', lit: true, life: 0.34 });
  }
  /** What you just earned jumps out of the ground in its own colours (the icons then fly to the counters). */
  loot(x, y, z, got) {
    let n = 0;
    for (const k in got) {
      if (k.startsWith('_') || !got[k] || n >= 3) continue;
      n++;
      this.burst('loot', x, y - 0.4, z, clamp(2 + Math.ceil(Math.log2(got[k] + 1) / 2), 3, 6), 1, { shape: 'fountain', angle: 20, colors: LOOT_COLORS[k] || LOOT_COLORS.wood, delay: 0.08 });
    }
    if (n) this.ring(x, 0.09, z, 0.3, 1.5, { life: 0.3, width: 0.16 });
  }
  /** A Chainer levels up or finishes training: an amber ring at the feet and a column of sparkles winding up. */
  cheer(x, y, z) {
    this.ring(x, 0.1, z, 0.4, 1.9, { color: '#f2a93b', life: 0.45 });
    this.burst('sparkle', x, 0.5, z, 14, 1.4, { shape: 'ring', radius: 0.7, up: 2.4, speed: 0.2, delay: 0.5, life: 1.25 });
    this.burst('sparkle', x, y, z, 6, 1.6, { shape: 'fountain', angle: 40, speed: 1.6 });
  }
  /** Somebody appears or is gone: a quick puff of dust around the feet. */
  poof(x, z, scale = 1) {
    this.burst('dust', x, 0.3, z, 14, scale, { shape: 'ring', radius: 0.35, speed: 0.55, up: 1.6 });
  }
  /** A party is back at the gate. */
  arrive(x, z) {
    this.ring(x, 0.1, z, 0.6, 3, { life: 0.5 });
    this.burst('sparkle', x, 0.6, z, 14, 1.5, { shape: 'fountain', radius: 1.2, angle: 10, delay: 0.5, speed: 2.2, life: 1.2 });
    this.burst('confetti', x, 2.2, z, 14, 1.1, { shape: 'fountain', angle: 32, delay: 0.1 });
  }
  /** A party sets off: dust from under their feet, blown back along the way they go (dx, dz). */
  depart(x, z, dx = 0, dz = -1) {
    this.burst('dust', x, 0.3, z, 16, 1.2, { shape: 'cone', dir: [-dx, 0.35, -dz], angle: 38, speed: 0.8 });
    this.ring(x, 0.09, z, 0.4, 1.8, { color: this._snowy() ? '#f3efe6' : '#efe0bf', lit: true, life: 0.34 });
  }
  /** Two party poppers either side of what the camera looks at (celebration cards cover the middle). */
  cannons(count = 22) {
    const r = this.engine.rig, y = r.curYaw * DEG;
    const rx = Math.cos(y), rz = -Math.sin(y);                      // the camera's "right" on the ground
    // inside the frame on any screen: 0.6 of the way from the middle to the edge (a portrait phone sees a narrow strip)
    const cv = this.engine.canvas, halfW = r.curDist * Math.tan(15 * DEG) * (cv.width / Math.max(1, cv.height));
    const d = clamp(halfW * 0.6, 2.5, 22), k = clamp(r.curDist / 30, 1, 2.4);
    for (const s of [-1, 1]) {
      this.burst('confetti', r.cur.x + rx * d * s, r.cur.y + 0.6, r.cur.z + rz * d * s, count, 1.5 * k, { shape: 'cone', dir: [-rx * s * 0.4, 1, -rz * s * 0.4], angle: 24, delay: 0.18, speed: 0.75, zoom: 0 });
      this.ring(r.cur.x + rx * d * s, r.cur.y + 0.1, r.cur.z + rz * d * s, 0.4 * k, 2.2 * k, { life: 0.35, width: 0.2 * k });
    }
  }

  // ------------------------------------------------------------------------------------------
  update(dt) {
    const eng = this.engine;
    // emitters first, so what they make is drawn this frame
    if (this.emitters.size) {
      const cur = eng.rig.cur, reach = eng.rig.curDist + 70;
      for (const em of this.emitters) {
        if (!em.on || !em.entity.enabled || !em.entity.parent) continue;
        em.acc += dt * em.rate;
        if (em.acc < 1) continue;
        const w = em.entity.getPosition();
        if (Math.abs(w.x - cur.x) > reach || Math.abs(w.z - cur.z) > reach) { em.acc = 0; continue; }      // nobody is looking (the other location)
        while (em.acc >= 1) { em.acc -= 1; this.burst(em.kind, w.x + em.offset[0], w.y + em.offset[1], w.z + em.offset[2], 1, em.scale, em.opts); }
      }
    }
    this._simulate(dt);
    const tw = this.tweens;
    for (let i = tw.length - 1; i >= 0; i--) {
      const t = tw[i];
      if (t.dead) { tw.splice(i, 1); continue; }
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) { tw.splice(tw.indexOf(t), 1); t.done && t.done(); }
    }
  }
  _simulate(dt) {
    const live = this.live;
    if (!live.length) { if (this.miLit.visible) { this.miLit.visible = false; this.miGlow.visible = false; } return; }
    const wind = windAt(this.engine), wx = wind * 0.92, wz = wind * 0.38;
    // pass 1: move, retire, count the lit ones (they are written first, the glowing ones after them)
    let nLit = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dt;
      if (p.t >= p.life) { this.free.push(p); live[i] = live[live.length - 1]; live.pop(); continue; }
      if (!p.glow) nLit++;
      if (p.t < 0 || p.ring || p.rest) continue;
      const K = p.K;
      if (K.grav) p.vy += K.grav * dt;
      if (K.drag) { const d = Math.max(0, 1 - K.drag * dt); p.vx *= d; p.vy *= K.grav ? 1 - (1 - d) * 0.35 : d; p.vz *= d; }
      if (K.wind) { const k = Math.min(1, K.wind * dt); p.vx += (wx - p.vx) * k; p.vz += (wz - p.vz) * k; }
      if (K.flutter) { const f = K.flutter * dt, a = p.ph + p.t * 5.2; p.vx += Math.cos(a) * f; p.vz += Math.sin(a * 0.83) * f; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if ((K.grav || K.lie) && p.y < p.fy && p.vy < 0) {
        p.y = p.fy;
        if (K.bounce && p.vy < -1.2) { p.vy *= -K.bounce; p.vx *= 0.6; p.vz *= 0.6; p.wx *= 0.6; p.wy *= 0.6; p.wz *= 0.6; }
        else { p.rest = 1; if (K.lie) { p.rx = 0; p.rz = 0; p.y = p.fy - 0.02; } }      // cards come to rest flat on the ground
        continue;
      }
      p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
    }
    const n = live.length;
    if (!n) { this.miLit.visible = false; this.miGlow.visible = false; return; }
    // pass 2: write the boxes
    if (this.vb.storage && this.vb.storage !== this._buf) this._views();
    this.vb.lock();
    let iLit = 0, iGlow = nLit;
    const A = this._ax, N = this._nx;
    for (let i = 0; i < n; i++) {
      const p = live[i];
      const slot = p.glow ? iGlow++ : iLit++;
      if (p.t < 0) { this._hide(slot); continue; }
      const k = p.t / p.life;
      let hx, hy, hz, r = p.r, g = p.g, b = p.b, x = p.x, y = p.y, z = p.z;
      if (p.ring) {
        const e = 1 - (1 - k) * (1 - k) * (1 - k), rad = lerp(p.r0, p.r1, e);
        const ca = Math.cos(p.a), sa = Math.sin(p.a);
        x += ca * rad; z += sa * rad;
        hx = rad * RING_HALF;
        hy = p.h * 0.5; hz = p.s * 0.5 * (1 - k) * (1 - k * k) + 0.004;
        N[0] = -sa; N[1] = 0; N[2] = ca; N[3] = 0; N[4] = 1; N[5] = 0; N[6] = ca; N[7] = 0; N[8] = sa;
      } else {
        const K = p.K;
        // size over life: pop in with a little overshoot, grow, shrink away
        const tin = K.in || 0.08, tout = K.out === undefined ? 0.6 : K.out;
        let s = p.s;
        if (k < tin) s *= Math.max(0, easeOutBack(k / tin));
        if (K.grow !== undefined && K.grow !== 1) s *= 1 + (K.grow - 1) * (1 - (1 - k) * (1 - k) * (1 - k));
        if (k > tout) { const u = (k - tout) / (1 - tout); s *= 1 - u * u; }
        if (K.blink) s *= Math.sin(p.ph + p.t * K.blink * 6.283) > -0.2 ? 1 : 0.45;      // a hard twinkle, not a pulse
        hx = s * 0.5 * p.lx; hy = s * 0.5 * p.ly; hz = s * 0.5 * p.lz;
        // colour over life: stepped along the ramp (fire), or the particle's own colour drifting to `to` (smoke)
        if (K.ramp) { const R = K.ramp, c = rgb(R[Math.min(R.length - 1, (Math.min(0.999, k + (p.ph - 3.14) * 0.03) * R.length) | 0)] || R[0]); r = c[0]; g = c[1]; b = c[2]; }
        else if (K.to) { const c = rgb(K.to), u = k * k; r += (c[0] - r) * u; g += (c[1] - g) * u; b += (c[2] - b) * u; }
        const rx = p.rx, ry = p.ry, rz = p.rz;
        if (rx === 0 && rz === 0) {
          if (ry === 0) { N[0] = 1; N[1] = 0; N[2] = 0; N[3] = 0; N[4] = 1; N[5] = 0; N[6] = 0; N[7] = 0; N[8] = 1; }
          else { const c = Math.cos(ry), s2 = Math.sin(ry); N[0] = c; N[1] = 0; N[2] = -s2; N[3] = 0; N[4] = 1; N[5] = 0; N[6] = s2; N[7] = 0; N[8] = c; }
        } else {
          const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
          N[0] = cy * cz + sy * sx * sz; N[1] = cx * sz; N[2] = -sy * cz + cy * sx * sz;
          N[3] = -cy * sz + sy * sx * cz; N[4] = cx * cz; N[5] = sy * sz + cy * sx * cz;
          N[6] = sy * cx; N[7] = -sx; N[8] = cy * cx;
        }
      }
      A[0] = N[0] * hx; A[1] = N[1] * hx; A[2] = N[2] * hx; A[3] = N[3] * hy; A[4] = N[4] * hy; A[5] = N[5] * hy; A[6] = N[6] * hz; A[7] = N[7] * hz; A[8] = N[8] * hz;
      this._box(slot, x, y, z, r, g, b, p.glow);
    }
    this.vb.unlock();
    const nGlow = n - nLit;
    this.miLit.mesh.primitive[0].count = nLit * 36; this.miLit.visible = nLit > 0;
    this.miGlow.mesh.primitive[0].base = nLit * 36; this.miGlow.mesh.primitive[0].count = nGlow * 36; this.miGlow.visible = nGlow > 0;
  }
  /** Write one box (24 vertices) into slot `slot` from the scratch axes. */
  _box(slot, x, y, z, r, g, b, glow) {
    const f32 = this._f32, u32 = this._u32, A = this._ax, N = this._nx;
    let o = slot * 120;                                   // 24 vertices x 5 words
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], a = F[0] * 3, sg = F[1], u = F[2] * 3, w = F[3] * 3;
      const cx = x + A[a] * sg, cy = y + A[a + 1] * sg, cz = z + A[a + 2] * sg;
      const ux = A[u], uy = A[u + 1], uz = A[u + 2], wx = A[w], wy = A[w + 1], wz = A[w + 2];
      // normal and colour go in as one 32-bit word each (little-endian bytes: x y z 0 / r g b a)
      const nrm = (((N[a] * sg * 127) & 255) | (((N[a + 1] * sg * 127) & 255) << 8) | (((N[a + 2] * sg * 127) & 255) << 16)) >>> 0;
      const sh = glow ? FACE_SHADE[f] : 1;
      const col = (((r * sh) & 255) | (((g * sh) & 255) << 8) | (((b * sh) & 255) << 16) | 0xff000000) >>> 0;
      f32[o] = cx - ux - wx; f32[o + 1] = cy - uy - wy; f32[o + 2] = cz - uz - wz; u32[o + 3] = nrm; u32[o + 4] = col;
      f32[o + 5] = cx + ux - wx; f32[o + 6] = cy + uy - wy; f32[o + 7] = cz + uz - wz; u32[o + 8] = nrm; u32[o + 9] = col;
      f32[o + 10] = cx + ux + wx; f32[o + 11] = cy + uy + wy; f32[o + 12] = cz + uz + wz; u32[o + 13] = nrm; u32[o + 14] = col;
      f32[o + 15] = cx - ux + wx; f32[o + 16] = cy - uy + wy; f32[o + 17] = cz - uz + wz; u32[o + 18] = nrm; u32[o + 19] = col;
      o += 20;
    }
  }
  /** A particle that has not started yet (staggered bursts): collapse its slot to a point. */
  _hide(slot) {
    const f32 = this._f32;
    for (let v = slot * 24, e = v + 24; v < e; v++) { const o = v * 5; f32[o] = 0; f32[o + 1] = -9999; f32[o + 2] = 0; }
  }
}
const ONE_OPTS = {};
const NOOP = () => {};
export { easeOutCubic };
