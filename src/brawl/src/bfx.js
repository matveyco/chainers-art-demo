// Brawl effects built on the shared sprite/debris system: projectiles, hits, wall breaks, rocket
// blasts, heals, spawns, knockouts and gems. Everything is sized for a camera 20 m away.
import { CELL, MODE } from './vfx.js';

const pc = window.pc;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (base, n = 4) => base + Math.floor(Math.random() * n);
const V = (x = 0, y = 0, z = 0) => new pc.Vec3(x, y, z);

export class BrawlFX {
  constructor(fx) {
    this.fx = fx;
    this.S = fx.sprites;
    this._v = new pc.Vec3();
  }

  // ------------------------------------------------------------------ projectiles
  // a bolt that follows a shot: returns the sprites so the shot can move and kill them
  bolt(color, width = 0.1, len = 0.5) {
    // the core is only half additive so it keeps its body over the bright grass
    const core = this.S.spawn({ cell: CELL.STREAK, mode: MODE.STRETCH_SOLID, axis: V(0, 0, 1), pos: V(0, -50, 0), size: [width, width], aspect: len / width,
      color, add: 0.55, emis: 4, life: 99, fadeOut: 0 });
    const glow = this.S.spawn({ cell: CELL.GLOW, pos: V(0, -50, 0), size: [width * 2.6, width * 2.6], color, add: 1, emis: 1.5, alpha: 0.7, life: 99, fadeOut: 0 });
    return [core, glow, this.shadow(width * 1.6)];
  }

  // a soft dark blob on the ground under a projectile: shows where it really is
  shadow(size) {
    return this.S.spawn({ cell: CELL.GLOW, mode: MODE.FLAT, axis: V(0, 1, 0), pos: V(0, -50, 0), size: [size, size], color: [0, 0, 0], add: 0, emis: 0.001, alpha: 0.32, life: 99, fadeOut: 0, rot: 0 });
  }

  moveBolt(b, x, y, z, dx, dz, len) {
    const [core, glow, shade] = b;
    if (core) {
      core.pos.set(x - dx * len * 0.5, y, z - dz * len * 0.5);
      core.axis.set(dx, 0, dz);
    }
    if (glow) glow.pos.set(x, y, z);
    if (shade) shade.pos.set(x - dx * len * 0.3, 0.04, z - dz * len * 0.3);
  }

  killBolt(b) { for (const s of b) if (s) s.t = s.life; }

  pellet(color, size = 0.13) {
    return [this.S.spawn({ cell: CELL.STREAK, mode: MODE.STRETCH_SOLID, axis: V(0, 0, 1), pos: V(0, -50, 0), size: [size * 0.7, size * 0.7], aspect: 2.4,
      color, add: 0.55, emis: 4, life: 99, fadeOut: 0 }),
    this.S.spawn({ cell: CELL.GLOW, pos: V(0, -50, 0), size: [size * 2.4, size * 2.4], color, add: 1, emis: 1.4, alpha: 0.7, life: 99, fadeOut: 0 }),
    this.shadow(size * 1.8)];
  }

  // the mine coughs up a gem: purple flash, sparks and a ring
  minePop(pos) {
    const S = this.S;
    S.spawn({ cell: CELL.GLOW, pos: V(pos.x, 0.5, pos.z), size: [0.4, 1.6], color: [0.75, 0.35, 1], add: 1, emis: 2.4, alpha: 0.85, life: 0.25, fadeOut: 0.9 });
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.06, pos.z), size: [0.3, 1.5], sizeEase: 'out', color: [0.7, 0.35, 1], add: 1, emis: [3, 1], life: 0.4, fadeOut: 0.8 });
    for (let i = 0; i < 10; i++) {
      const v = V(rnd(-1, 1), rnd(1, 2.4), rnd(-1, 1)).normalize().mulScalar(rnd(2.5, 5));
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x, 0.3, pos.z), vel: v, size: [0.1, 0.03], color: [0.85, 0.5, 1], add: 1, emis: 2.5, life: rnd(0.4, 0.7), grav: 0.6, drag: 1.5, fadeOut: 0.5 });
    }
  }

  trailPuff(pos, color = [0.85, 0.85, 0.85], size = 0.16) {
    this.fx.puff(pos, 'smoke', size, rnd(0.45, 0.7), V(rnd(-0.2, 0.2), rnd(0.2, 0.5), rnd(-0.2, 0.2)), { color, alpha: 0.6, drag: 2, erodeStart: 0.1, soft: 0.2 });
  }

  // ------------------------------------------------------------------ firing and hits
  muzzle(pos, dir, kind, scale = 1.5) {
    this.fx.muzzle(pos, dir, scale, kind);
    this.fx.muzzleSmoke(pos, dir, 0.6);
  }

  hit(pos, color, strength = 1) {
    const S = this.S;
    S.spawn({ cell: CELL.IMPACT_STAR, pos, size: [0.3 * strength, 0.62 * strength], color: [1, 1, 1], add: 1, emis: 3, life: 0.12, fadeOut: 0.6, camOffset: 0.4 });
    S.spawn({ cell: CELL.GLOW, pos, size: [0.25, 0.7 * strength], color, add: 1, emis: 2.4, alpha: 0.8, life: 0.16, fadeOut: 0.8, camOffset: 0.3 });
    const n = Math.round(5 * strength);
    for (let i = 0; i < n; i++) {
      const v = V(rnd(-1, 1), rnd(0.2, 1.3), rnd(-1, 1)).normalize().mulScalar(rnd(3, 7));
      S.spawn({ cell: CELL.STREAK, mode: MODE.STRETCH, stretch: 0.04, pos: pos.clone(), vel: v, size: [0.035, 0.015], color: [1, 0.95, 0.8], color1: color,
        add: 1, emis: [5, 2], life: rnd(0.18, 0.34), grav: 0.6, drag: 2, fadeOut: 0.5 });
    }
  }

  wallHit(pos, normal, type) {
    this.fx.impact(pos, normal, type === 'crate' ? 'wood' : 'wall', 0.7);
  }

  fizzle(pos, color) {
    this.S.spawn({ cell: CELL.GLOW, pos, size: [0.15, 0.4], color, add: 1, emis: 1.6, alpha: 0.6, life: 0.14, fadeOut: 0.8 });
    this.fx.puff(pos, 'smoke', 0.14, 0.4, V(0, 0.4, 0), { color: [0.9, 0.88, 0.84], alpha: 0.5, drag: 2 });
  }

  wallBreak(x, z, type) {
    const fx = this.fx;
    const c = V(x, 0.55, z);
    if (type === 'crate') {
      fx.debris(c, 'splinter', 14, 6.5, 0.14, null, 'splinter');
      fx.debris(c, 'splinterDark', 8, 5.5, 0.1, null, 'splinter');
    } else {
      fx.debris(c, 'concrete', 16, 6, 0.16, null, 'shard');
    }
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      fx.puff(V(x + Math.cos(a) * 0.35, rnd(0.2, 0.8), z + Math.sin(a) * 0.35), 'dust', rnd(0.35, 0.55), rnd(0.8, 1.2),
        V(Math.cos(a) * 1.4, rnd(0.3, 0.9), Math.sin(a) * 1.4), { color: type === 'crate' ? [0.66, 0.52, 0.36] : [0.58, 0.6, 0.64], alpha: 0.75, drag: 2.6, erodeStart: 0.2, soft: 0.3 });
    }
    fx.addShake(0.25);
  }

  // compact rocket blast: flash, fireball, smoke, ground ring, dust wave, sparks
  boom(pos, radius = 1.4, big = 1) {
    const S = this.S, fx = this.fx;
    const up = V(pos.x, 0.5, pos.z);
    const R = radius / 1.5;
    S.spawn({ cell: CELL.GLOW, pos: up, size: [1.2 * R, 2.4 * R], color: [1, 0.78, 0.5], add: 1, emis: 2.6, alpha: 0.85, life: 0.14, fadeOut: 1, camOffset: 0.5 });
    S.spawn({ cell: CELL.FLARE, pos: up, size: [0.8 * R, 1.7 * R], add: 0.4, emis: [6, 3], life: 0.1, fadeOut: 0.7, camOffset: 0.5 });
    const n = Math.round(10 * big);
    for (let i = 0; i < n; i++) {
      const v = V(rnd(-1, 1), rnd(0.1, 1), rnd(-1, 1)).normalize().mulScalar(R * rnd(2, 4));
      const s = R * rnd(0.5, 0.85);
      S.spawn({ cell: pick(CELL.FIRE), pos: V(up.x + rnd(-0.25, 0.25) * R, up.y + rnd(-0.1, 0.3) * R, up.z + rnd(-0.25, 0.25) * R), vel: v,
        size: [s * 0.4, s * 1.1], sizeEase: 'out3', grow: 0.3, add: 0.05, emis: [3.4, 1.0], life: rnd(0.6, 0.9), heat: [0, 1], ramp: 1,
        erode: [0, 1], erodeStart: 0.45, drag: 7.5, grav: -0.12, rot: rnd(-0.5, 0.5), spin: rnd(-0.8, 0.8), soft: 0.4, fadeOut: 0.08, delay: i < 4 ? 0 : rnd(0.01, 0.06) });
    }
    for (let i = 0; i < Math.round(4 * big); i++) {
      const v = V(rnd(-0.6, 0.6) * R, rnd(1.2, 2.4) * R, rnd(-0.6, 0.6) * R);
      fx.puff(V(up.x + rnd(-0.4, 0.4) * R, up.y + rnd(0.1, 0.6) * R, up.z + rnd(-0.4, 0.4) * R), 'dark', R * rnd(0.7, 1.0), rnd(1.3, 1.9), v,
        { color: [0.22, 0.2, 0.2], color1: [0.52, 0.5, 0.49], alpha: 0.72, drag: 1.4, erodeStart: 0.1, delay: rnd(0.2, 0.35), grow: 0.5, soft: 0.5, fadeIn: 0.1 });
    }
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.06, pos.z), size: [0.3, radius * 1.25], sizeEase: 'out',
      color: [1, 0.85, 0.6], add: 1, emis: [3, 1], life: 0.3, fadeOut: 0.8 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rnd(0, 0.3);
      const d = V(Math.cos(a), 0, Math.sin(a));
      fx.puff(V(pos.x + d.x * 0.5, 0.14, pos.z + d.z * 0.5), 'dust', rnd(0.3, 0.5) * R, rnd(0.7, 1.0), d.mulScalar(radius * rnd(1.6, 2.2)).add(V(0, rnd(0.1, 0.3), 0)),
        { color: [0.62, 0.56, 0.46], alpha: 0.65, drag: 3.6, erodeStart: 0.2, delay: rnd(0, 0.05), soft: 0.3 });
    }
    for (let i = 0; i < 14; i++) {
      const v = V(rnd(-1, 1), rnd(0.3, 1.2), rnd(-1, 1)).normalize().mulScalar(rnd(5, 11));
      S.spawn({ cell: CELL.STREAK, mode: MODE.STRETCH, stretch: 0.05, pos: up, vel: v, size: [0.035, 0.012], color: [1, 0.85, 0.5], color1: [1, 0.35, 0.08],
        add: 1, emis: [6, 2.5], life: rnd(0.4, 0.9), grav: 0.8, drag: 0.8, bounce: 0.3, fadeOut: 0.4 });
    }
    fx.flashLight(V(pos.x, 1.4, pos.z), 9 * big, 0.35, new pc.Color(1, 0.7, 0.45));
    fx.addShake(0.35 * big);
  }

  // ------------------------------------------------------------------ brawler events
  heal(pos, radius, color = [0.45, 1, 0.55]) {
    const S = this.S;
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.08, pos.z), size: [0.4, radius * 1.05], sizeEase: 'out',
      color, add: 1, emis: [3, 1], life: 0.5, fadeOut: 0.7 });
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.1, pos.z), size: [0.2, radius * 0.8], sizeEase: 'out',
      color: [1, 1, 0.8], add: 1, emis: [2, 0.5], life: 0.4, fadeOut: 0.8, delay: 0.08 });
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x + Math.cos(a) * r, rnd(0.1, 0.6), pos.z + Math.sin(a) * r), vel: V(0, rnd(1.2, 2.4), 0),
        size: [0.12, 0.05], color, add: 1, emis: 2.2, life: rnd(0.6, 1.0), fadeOut: 0.6, delay: rnd(0, 0.25) });
    }
  }

  healTick(pos, color = [0.45, 1, 0.55]) {
    for (let i = 0; i < 3; i++) {
      this.S.spawn({ cell: CELL.GLOW, pos: V(pos.x + rnd(-0.35, 0.35), rnd(0.4, 1.6), pos.z + rnd(-0.35, 0.35)), vel: V(0, rnd(0.8, 1.4), 0),
        size: [0.1, 0.03], color, add: 1, emis: 2, life: rnd(0.5, 0.8), fadeOut: 0.6, delay: rnd(0, 0.2) });
    }
  }

  haste(pos, color) {
    this.S.spawn({ cell: CELL.GLOW, pos: V(pos.x + rnd(-0.3, 0.3), rnd(0.1, 0.4), pos.z + rnd(-0.3, 0.3)), vel: V(0, 0.6, 0),
      size: [0.14, 0.04], color, add: 1, emis: 2, life: 0.4, fadeOut: 0.7 });
  }

  spawnBeam(pos, color) {
    const S = this.S;
    for (let i = 0; i < 6; i++) {
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x, 0.4 + i * 0.5, pos.z), size: [0.9, 0.2], color, add: 1, emis: 2.2, alpha: 0.7, life: 0.5, fadeOut: 0.8, delay: i * 0.02 });
    }
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.08, pos.z), size: [0.2, 1.6], sizeEase: 'out', color, add: 1, emis: [3, 1], life: 0.45, fadeOut: 0.8 });
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x + Math.cos(a) * 0.4, 0.3, pos.z + Math.sin(a) * 0.4), vel: V(Math.cos(a) * 0.6, rnd(2, 4), Math.sin(a) * 0.6),
        size: [0.12, 0.04], color, add: 1, emis: 2.4, life: rnd(0.5, 0.8), fadeOut: 0.6 });
    }
  }

  knockout(pos, color) {
    const fx = this.fx, S = this.S;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.puff(V(pos.x + Math.cos(a) * 0.3, rnd(0.3, 1.3), pos.z + Math.sin(a) * 0.3), 'smoke', rnd(0.35, 0.6), rnd(0.8, 1.2),
        V(Math.cos(a) * 1.3, rnd(0.6, 1.6), Math.sin(a) * 1.3), { color: [0.95, 0.94, 0.92], alpha: 0.85, drag: 2.6, erodeStart: 0.25, soft: 0.3 });
    }
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.08, pos.z), size: [0.3, 2.2], sizeEase: 'out', color, add: 1, emis: [3, 1], life: 0.4, fadeOut: 0.8 });
    for (let i = 0; i < 16; i++) {
      const v = V(rnd(-1, 1), rnd(0.4, 1.5), rnd(-1, 1)).normalize().mulScalar(rnd(3, 7));
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x, 1, pos.z), vel: v, size: [0.12, 0.04], color, add: 1, emis: 2.5, life: rnd(0.5, 0.9), grav: 0.5, drag: 1.5, fadeOut: 0.5 });
    }
  }

  superCast(pos, color) {
    const S = this.S;
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.1, pos.z), size: [0.3, 1.9], sizeEase: 'out', color, add: 1, emis: [4, 1], life: 0.35, fadeOut: 0.8 });
    S.spawn({ cell: CELL.GLOW, pos: V(pos.x, 1.2, pos.z), size: [0.6, 2.0], color, add: 1, emis: 2.2, alpha: 0.7, life: 0.2, fadeOut: 0.9 });
  }

  superReady(pos, color) {
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      this.S.spawn({ cell: CELL.GLOW, pos: V(pos.x + Math.cos(a) * 0.55, 0.2, pos.z + Math.sin(a) * 0.55), vel: V(0, rnd(2, 3), 0),
        size: [0.14, 0.05], color, add: 1, emis: 2.6, life: 0.6, fadeOut: 0.6 });
    }
  }

  // gems
  gemGlow(pos, kind = 'gem') {
    const color = kind === 'cube' ? [0.35, 1, 0.4] : [0.78, 0.38, 1];
    return this.S.spawn({ cell: CELL.GLOW, pos: pos.clone(), size: [0.9, 0.9], color, add: 1, emis: 1.5, alpha: 0.6, life: 99, fadeOut: 0 });
  }

  sparkle(pos, kind = 'gem') {
    this.S.spawn({ cell: CELL.FLARE, pos: V(pos.x + rnd(-0.18, 0.18), pos.y + rnd(-0.1, 0.25), pos.z + rnd(-0.18, 0.18)), size: [0.02, 0.22], color: kind === 'cube' ? [0.8, 1, 0.8] : [1, 0.9, 1],
      add: 1, emis: 3, life: 0.3, fadeOut: 0.6, camOffset: 0.3 });
  }

  gemPickup(pos, kind = 'gem') {
    const S = this.S;
    const c0 = kind === 'cube' ? [0.4, 1, 0.45] : [0.8, 0.45, 1], c1 = kind === 'cube' ? [0.5, 1, 0.5] : [0.85, 0.5, 1];
    S.spawn({ cell: CELL.GLOW, pos: pos.clone(), size: [0.3, 1.1], color: c0, add: 1, emis: 2.4, alpha: 0.8, life: 0.22, fadeOut: 0.9 });
    for (let i = 0; i < 8; i++) {
      const v = V(rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1)).normalize().mulScalar(rnd(2, 4));
      S.spawn({ cell: CELL.GLOW, pos: pos.clone(), vel: v, size: [0.1, 0.03], color: c1, add: 1, emis: 2.5, life: rnd(0.3, 0.5), drag: 2, fadeOut: 0.5 });
    }
  }

  // power up: a green column and rising sparks round the brawler
  powerUp(pos) {
    const S = this.S;
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: V(pos.x, 0.08, pos.z), size: [0.2, 1.4], sizeEase: 'out', color: [0.4, 1, 0.45], add: 1, emis: [3, 1], life: 0.35, fadeOut: 0.8 });
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      S.spawn({ cell: CELL.GLOW, pos: V(pos.x + Math.cos(a) * 0.45, 0.2, pos.z + Math.sin(a) * 0.45), vel: V(0, rnd(2.5, 3.5), 0),
        size: [0.12, 0.04], color: [0.45, 1, 0.5], add: 1, emis: 2.5, life: 0.55, fadeOut: 0.6 });
    }
  }

  boxHit(pos) {
    this.fx.impact(pos, new pc.Vec3(0, 1, 0), 'wood', 0.5);
  }
}
