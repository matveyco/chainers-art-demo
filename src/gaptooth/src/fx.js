// Game effects. Two layers:
//  - sprites (vfx.js): muzzle flashes, tracers, impact stars, sparks, dust, smoke, fireballs,
//    flames, shock rings. Hand-drawn toon elements that erode away as they age.
//  - solid debris on GPU instancing: brass, shells, wood splinters, paper flakes, concrete and
//    steel chunks. They tumble, bounce and settle, one draw call per material.
// Plus one shared flash light for muzzle and explosion flashes, and the camera shake budget.
import { Sprites, CELL, MODE } from './vfx.js';

const pc = window.pc;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (base, n = 4) => base + Math.floor(Math.random() * n);
const G = 18;

function lit(color, opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = color;
  m.useMetalness = true;
  m.metalness = opts.metal ?? 0;
  m.gloss = opts.gloss ?? 0.3;
  if (opts.emissive) { m.emissive = opts.emissive; m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  m.update();
  return m;
}

const GEO = {};
function geometry(device, kind) {
  if (!GEO[kind]) {
    if (kind === 'cyl') GEO[kind] = pc.Mesh.fromGeometry(device, new pc.CylinderGeometry({ radius: 0.5, height: 1, heightSegments: 1, capSegments: 8 }));
    else GEO[kind] = pc.Mesh.fromGeometry(device, new pc.BoxGeometry());
  }
  return GEO[kind];
}

class Instancer {
  constructor(device, parent, name, material, capacity, geo = 'box') {
    this.cap = capacity;
    this.n = 0;
    this.data = new Float32Array(capacity * 16);
    this.vb = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), capacity, { usage: pc.BUFFER_DYNAMIC, data: this.data });
    this.mi = new pc.MeshInstance(geometry(device, geo), material);
    this.mi.setInstancing(this.vb);
    this.mi.instancingCount = 0;
    this.mi.cull = false;
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [this.mi], castShadows: false, receiveShadows: true });
    parent.addChild(e);
    this.live = 0;
  }
  push(m) { if (this.n < this.cap) { this.data.set(m.data, this.n * 16); this.n++; } }
  flush() {
    this.mi.instancingCount = this.n;
    if (this.n) this.vb.setData(this.data);
    this.n = 0;
  }
}

// solid debris kinds: material, capacity, geometry
const SOLIDS = {
  brass: [() => lit(new pc.Color(0.86, 0.64, 0.24), { metal: 0.85, gloss: 0.62 }), 128, 'cyl'],
  shell: [() => lit(new pc.Color(0.78, 0.2, 0.14), { gloss: 0.45 }), 32, 'cyl'],
  splinter: [() => lit(new pc.Color(0.74, 0.5, 0.25)), 160],
  splinterDark: [() => lit(new pc.Color(0.47, 0.3, 0.15)), 96],
  paper: [() => lit(new pc.Color(0.93, 0.9, 0.82)), 160],
  paperInk: [() => lit(new pc.Color(0.06, 0.18, 0.46)), 128],
  card: [() => lit(new pc.Color(0.66, 0.5, 0.32)), 96],
  concrete: [() => lit(new pc.Color(0.62, 0.6, 0.56)), 160],
  steel: [() => lit(new pc.Color(0.5, 0.53, 0.58), { metal: 0.5, gloss: 0.45 }), 128],
  redChip: [() => lit(new pc.Color(0.78, 0.22, 0.14), { gloss: 0.45 }), 128],
  soot: [() => lit(new pc.Color(0.12, 0.11, 0.11)), 128],
  gold: [() => lit(new pc.Color(1, 0.78, 0.2), { metal: 0.7, gloss: 0.7, emissive: new pc.Color(0.5, 0.33, 0.05) }), 96],
};
// legacy names used by callers
const ALIAS = { chunkWood: 'splinter', chunkStraw: 'paper', chunkRed: 'redChip', chunkDark: 'soot', chunkGrey: 'concrete', redshell: 'shell' };

// surface dust colours (linear-ish multipliers for the white smoke sprite, lit by the sun)
const DUST = {
  floor: [0.6, 0.56, 0.5], metal: [0.52, 0.54, 0.57], wall: [0.5, 0.51, 0.53], wood: [0.62, 0.5, 0.36],
  dummy: [0.74, 0.7, 0.62], barrel: [0.42, 0.38, 0.36],
};

export class FX {
  constructor(app, camera, tex) {
    this.app = app;
    this.camera = camera;
    this.root = new pc.Entity('FX');
    app.root.addChild(this.root);
    this.items = [];
    this.props = [];
    this.tracers = [];
    this.shake = 0;
    this._floorAt = () => 0;
    this.onSound = null;
    this.sprites = new Sprites(app, camera, tex.vfx, tex.vfxField);
    this.inst = {};
    for (const [k, [mk, cap, geo]] of Object.entries(SOLIDS)) this.inst[k] = new Instancer(app.graphicsDevice, this.root, 'fx_' + k, mk(), cap, geo);
    this.light = new pc.Entity('FlashLight');
    this.light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.8, 0.45), intensity: 0, range: 7, castShadows: false });
    this.root.addChild(this.light);
    this.lightT = 0; this.lightDur = 0.06; this.lightPeak = 0;
    this.lightScale = 1;                 // comic lighting bands would blow a full-strength flash out
    this._m = new pc.Mat4(); this._q = new pc.Quat(); this._s = new pc.Vec3(); this._p = new pc.Vec3();
    this._v = new pc.Vec3();
    this.burnAcc = new Map();
  }

  set floorAt(f) { this._floorAt = f; this.sprites.floorAt = f; }
  get floorAt() { return this._floorAt; }

  // ================================================================ building blocks
  _solid(k, pos, scale, props = {}) {
    k = ALIAS[k] || k;
    const ins = this.inst[k];
    if (!ins || ins.live >= ins.cap) return null;
    ins.live++;
    const it = Object.assign({ k, pos: pos.clone(), s: scale, eul: null, vel: null, spin: null, t: 0, life: 1 }, props);
    if (!it.eul) it.eul = new pc.Vec3(Math.random() * 360, Math.random() * 360, Math.random() * 360);
    this.items.push(it);
    return it;
  }

  static _randDir(out, upBias = 0) {
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out.set(r * Math.cos(a), z, r * Math.sin(a));
    if (upBias) { out.y = Math.abs(out.y) * upBias + out.y * (1 - upBias); out.normalize(); }
    return out;
  }

  // random direction in a cone around dir (half-angle in radians)
  static _cone(dir, half, out = new pc.Vec3()) {
    const up = Math.abs(dir.y) > 0.95 ? pc.Vec3.RIGHT : pc.Vec3.UP;
    const r = new pc.Vec3().cross(dir, up).normalize();
    const u = new pc.Vec3().cross(r, dir).normalize();
    const a = Math.random() * Math.PI * 2, t = Math.tan(half) * Math.sqrt(Math.random());
    return out.copy(dir).add(r.mulScalar(Math.cos(a) * t)).add(u.mulScalar(Math.sin(a) * t)).normalize();
  }

  glow(pos, size, color, life = 0.08, emis = 1.5, alpha = 1) {
    return this.sprites.spawn({ cell: CELL.GLOW, pos, size: [size, size * 1.15], color, add: 1, emis, alpha, life, fadeOut: 1 });
  }

  // velocity-stretched spark streaks
  sparks(pos, normal, n = 6, opts = {}) {
    const S = this.sprites, v = this._v;
    for (let i = 0; i < n; i++) {
      FX._cone(normal, opts.cone ?? 1.0, v);
      v.mulScalar(rnd(opts.speed?.[0] ?? 3, opts.speed?.[1] ?? 8));
      if (opts.up) v.y += rnd(0, opts.up);
      S.spawn({
        cell: CELL.STREAK, mode: MODE.STRETCH, stretch: opts.stretch ?? 0.09, pos, vel: v,
        size: [opts.width ?? 0.016, 0.004], sizeEase: 'lin', color: [1, 0.86, 0.55], color1: [1, 0.45, 0.12],
        add: 1, emis: [opts.emis ?? 6, 2], life: rnd(opts.life?.[0] ?? 0.18, opts.life?.[1] ?? 0.42),
        grav: opts.grav ?? 0.9, drag: opts.drag ?? 1.2, bounce: opts.bounce ?? 0.35, fadeOut: 0.5,
      });
    }
  }

  // toon dust / smoke puff (lit by the scene)
  puff(pos, kind = 'smoke', size = 0.3, life = 1.0, vel = null, opts = {}) {
    const col = opts.color || (kind === 'dust' ? DUST.floor : kind === 'dark' ? [0.26, 0.25, 0.25] : [0.72, 0.72, 0.74]);
    return this.sprites.spawn({
      cell: pick(CELL.SMOKE), pos, vel: vel || new pc.Vec3(rnd(-0.15, 0.15), rnd(0.4, 0.8), rnd(-0.15, 0.15)),
      size: [size * (opts.start ?? 0.35), size], sizeEase: 'out3', grow: opts.grow ?? 0.6, color: col, color1: opts.color1 || null,
      alpha: opts.alpha ?? 0.9, fadeIn: opts.fadeIn ?? 0.04, fadeOut: opts.fadeOut ?? 0.25,
      erode: [0, 1], erodeStart: opts.erodeStart ?? 0.35, life, drag: opts.drag ?? 2.2, grav: opts.grav ?? 0,
      rot: rnd(-0.35, 0.35), spin: rnd(-0.25, 0.25), soft: opts.soft ?? 0.25, delay: opts.delay || 0,
    });
  }

  flashLight(pos, peak, dur, color) {
    peak *= this.lightScale;
    this.light.setPosition(pos);
    this.light.light.color = color || new pc.Color(1, 0.78, 0.45);
    this.lightPeak = Math.max(peak, this.light.light.intensity);
    this.lightT = 0;
    this.lightFresh = true;
    this.lightDur = dur;
    this.light.light.range = peak > 10 ? 14 : 9;
  }

  // ================================================================ weapons
  // kind: pistol | smg | shotgun | launcher
  muzzle(pos, dir, size = 1, kind = 'pistol') {
    const S = this.sprites;
    const big = kind === 'shotgun', rocket = kind === 'launcher';
    const k = big ? 1.9 : kind === 'smg' ? 0.8 + Math.random() * 0.35 : rocket ? 1.5 : 1.05;
    // side flame: a toon flame spike along the barrel
    const len = (big ? 0.36 : 0.2) * k;
    S.spawn({
      cell: big ? CELL.BLAST_SIDE : CELL.MUZZLE_SIDE, mode: MODE.STRETCH, axis: dir,
      pos: pos.clone().add(dir.clone().mulScalar(len * 0.95)), size: [0.06 * k * (big ? 1.45 : 1), 0.07 * k], aspect: big ? 2.3 : 3.3,
      color: [1, 1, 1], add: 0.35, emis: [3.4, 2], life: big ? 0.07 : 0.05, fadeOut: 0.6, erode: [0, 0.5], camOffset: 0.12,
    });
    // front star + round flare (reads from behind, drawn in front of the gun), and a wide glow that
    // spills past the shooter's silhouette
    S.spawn({ cell: kind === 'smg' && Math.random() < 0.5 ? CELL.FLARE : CELL.MUZZLE_STAR, pos: pos.clone().add(dir.clone().mulScalar(0.05)),
      size: [0.15 * k, 0.19 * k], add: 0.55, emis: [3.6, 2], life: 0.05, fadeOut: 0.5, erode: [0, 0.4], rot: rnd(-0.5, 0.5), camOffset: 0.3 });
    this.sprites.spawn({ cell: CELL.GLOW, pos: pos.clone().add(dir.clone().mulScalar(0.08)), size: [0.75 * k, 0.85 * k], color: [1, 0.6, 0.28], add: 1, emis: 2.2, alpha: 0.85, life: 0.08, fadeOut: 1, camOffset: 0.3 });
    // hot sparks out of the barrel
    const ns = big ? 10 : kind === 'smg' ? 1 : 3;
    this.sparks(pos, dir, ns, { cone: big ? 0.3 : 0.18, speed: big ? [7, 16] : [5, 11], life: [0.08, 0.2], grav: 0.3, width: 0.012, bounce: 0, stretch: 0.03 });
    if (big) {   // unburnt powder: glowing grains that drift and die
      for (let i = 0; i < 8; i++) {
        const v = FX._cone(dir, 0.45).mulScalar(rnd(2, 6));
        S.spawn({ cell: CELL.GLOW, pos, vel: v, size: [0.03, 0.012], color: [1, 0.55, 0.2], add: 1, emis: 5, life: rnd(0.15, 0.4), drag: 4, grav: 0.2 });
      }
    }
    this.flashLight(pos.clone().add(dir.clone().mulScalar(0.12)), (big ? 9 : rocket ? 8 : 5.5) * (kind === 'smg' ? 0.8 : 1), big ? 0.09 : 0.065);
  }

  muzzleSmoke(pos, dir, amount = 1) {
    const heavy = amount >= 3;
    const n = heavy ? amount + 1 : amount;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().mulScalar(rnd(0.6, 1.4) * (heavy ? 2.4 : 1)).add(new pc.Vec3(rnd(-0.12, 0.12), rnd(0.2, 0.4), rnd(-0.12, 0.12)));
      this.puff(pos.clone().add(dir.clone().mulScalar(0.06 + i * 0.07)), 'smoke', (heavy ? 0.24 : 0.1) * rnd(0.8, 1.2), rnd(0.6, 0.9) * (heavy ? 1.5 : 1), v,
        { alpha: heavy ? 0.45 : 0.24, color: [0.62, 0.62, 0.64], drag: 2.8, erodeStart: 0.1, soft: 0.12, start: 0.3 });
    }
  }

  // rocket launcher back-blast (from the rear of the tube)
  backBlast(pos, dir) {
    const S = this.sprites;
    const back = dir.clone().mulScalar(-1);
    for (let i = 0; i < 5; i++) {
      const v = FX._cone(back, 0.35).mulScalar(rnd(2.5, 5));
      S.spawn({ cell: pick(CELL.FIRE), pos, vel: v, size: [0.12, 0.34], color: [1, 1, 1], add: 0.1, emis: [2.6, 1.2], life: rnd(0.18, 0.3),
        heat: [0, 0.9], ramp: 1, erode: [0, 1], erodeStart: 0.3, drag: 7, soft: 0.2 });
    }
    const side = new pc.Vec3().cross(back, pc.Vec3.UP).normalize();
    for (let i = 0; i < 6; i++) {
      const v = FX._cone(back, 0.4).mulScalar(rnd(1.5, 3.5)).add(side.clone().mulScalar(rnd(-3, 3))).add(new pc.Vec3(0, rnd(-0.6, 0.3), 0));
      this.puff(pos.clone().add(back.clone().mulScalar(0.15 + i * 0.08)), 'smoke', rnd(0.26, 0.42), rnd(0.9, 1.4), v,
        { alpha: 0.55, color: [0.62, 0.62, 0.64], drag: 3.4, delay: rnd(0, 0.05), soft: 0.25, start: 0.3, erodeStart: 0.15 });
    }
    // dust kicked off the ground behind the shooter
    const fl = this.floorAt(pos);
    if (pos.y - fl < 1.8) {
      const at = new pc.Vec3(pos.x + back.x * 0.8, fl + 0.08, pos.z + back.z * 0.8);
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = new pc.Vec3(Math.cos(a) * rnd(1.5, 3) + back.x * 2, rnd(0.2, 0.6), Math.sin(a) * rnd(1.5, 3) + back.z * 2);
        this.puff(at, 'dust', rnd(0.25, 0.42), rnd(0.8, 1.2), v, { color: DUST.floor, alpha: 0.6, drag: 3.5, soft: 0.3, erodeStart: 0.2 });
      }
    }
  }

  // moving tracer: a hot streak with a glowing head that races from the muzzle to the hit point.
  // Seen from behind the shooter a real-scale tracer is a couple of pixels, so its width grows
  // with distance from the camera (roughly constant on screen) and the streak is long.
  tracer(from, to, thick = 1) {
    const d = to.clone().sub(from);
    const len = d.length();
    if (len < 0.3) return;
    d.mulScalar(1 / len);
    const speed = 150, L = Math.min(4.5, len * 0.7);
    const tr = { from: from.clone(), dir: d, len, L, speed, width: 0.026 * thick };
    const cam = this.camera;
    const scale = (p) => Math.min(3.5, Math.max(1, cam.getPosition().distance(p) / 3.5));
    this.sprites.spawn({
      cell: CELL.STREAK, mode: MODE.STRETCH_SOLID, axis: d, pos: from, size: [tr.width, tr.width], aspect: 1,
      color: [1, 0.86, 0.56], add: 1, emis: 9, life: (len + L) / speed + 0.02, fadeOut: 0.12,
      onUpdate: (p) => {
        const h = Math.min(tr.len, p.t * tr.speed), tail = Math.max(0, p.t * tr.speed - tr.L);
        const half = Math.max(0.001, (h - tail) / 2);
        p.pos.copy(tr.from).add(this._v.copy(tr.dir).mulScalar(tail + half));
        const w = tr.width * scale(p.pos);
        p.size[0] = p.size[1] = w;
        p.aspect = Math.max(1, half / w);
      },
    });
    this.sprites.spawn({
      cell: CELL.GLOW, pos: from, size: [0.06 * thick, 0.06 * thick], color: [1, 0.8, 0.5], add: 1, emis: 4, life: len / speed + 0.01, fadeOut: 0.1,
      onUpdate: (p) => {
        p.pos.copy(tr.from).addScaled(tr.dir, Math.min(tr.len, p.t * tr.speed));
        p.size[0] = p.size[1] = 0.06 * thick * scale(p.pos);
      },
    });
  }

  casing(pos, dir, kind = 'brass', vel = null) {
    const shell = kind === 'shell';
    const s = shell ? new pc.Vec3(0.034, 0.075, 0.034) : new pc.Vec3(0.016, 0.034, 0.016);
    const v = vel || dir.clone().mulScalar(rnd(1.6, 2.4)).add(new pc.Vec3(rnd(-0.2, 0.2), rnd(1.4, 2.0), rnd(-0.2, 0.2)));
    this._solid(shell ? 'shell' : 'brass', pos, s, { life: 2.6, vel: v, spin: new pc.Vec3(rnd(0, 900), rnd(0, 900), 0), bounce: 0.35, sound: 'shell', fadeScale: true, halfExtent: 0.012 });
    // a wisp of smoke from the ejection port
    this.puff(pos, 'smoke', 0.08, 0.5, new pc.Vec3(rnd(-0.1, 0.1), 0.35, rnd(-0.1, 0.1)), { alpha: 0.25, color: [0.85, 0.85, 0.86], soft: 0.05 });
  }

  // ================================================================ impacts
  debris(pos, matName, n = 10, power = 5, size = 0.12, dir = null, shape = 'cube') {
    for (let i = 0; i < n; i++) {
      const s = size * rnd(0.5, 1.3);
      let v = new pc.Vec3(Math.random() - 0.5, rnd(0.6, 1.6), Math.random() - 0.5).normalize();
      if (dir) v.add(dir.clone().mulScalar(1.2)).normalize();
      v = v.mulScalar(power * rnd(0.4, 1.2));
      const scale = shape === 'splinter' ? new pc.Vec3(s * 0.28, s * 0.28, s * 1.6)
        : shape === 'flake' || shape === 'shard' ? new pc.Vec3(s, s * (shape === 'shard' ? 0.14 : 0.08), s * 0.8) : new pc.Vec3(s, s, s);
      this._solid(matName, pos.clone().add(new pc.Vec3(rnd(-0.1, 0.1), rnd(0, 0.1), rnd(-0.1, 0.1))), scale, {
        life: rnd(1.4, 2.6), vel: v, spin: new pc.Vec3(rnd(0, 700), rnd(0, 700), rnd(0, 700)),
        bounce: shape === 'flake' ? 0.1 : 0.3, fadeScale: true, halfExtent: shape === 'flake' ? 0.004 : s / 2,
        flutter: shape === 'flake', drag: shape === 'flake' ? 2.5 : 0,
      });
    }
  }

  // a paper target knocked down: the print tears off in flakes, cardboard bits, a puff of fibre
  knockdown(pos, dir) {
    this.debris(pos, 'paper', 10, 3.4, 0.06, dir, 'flake');
    this.debris(pos, 'paperInk', 6, 3.0, 0.05, dir, 'flake');
    this.debris(pos, 'card', 4, 2.6, 0.05, dir);
    for (let i = 0; i < 3; i++) {
      this.puff(pos.clone().add(new pc.Vec3(rnd(-0.2, 0.2), rnd(-0.3, 0.3), rnd(-0.2, 0.2))), 'dust', rnd(0.35, 0.5), rnd(0.8, 1.1),
        new pc.Vec3(rnd(-0.5, 0.5), rnd(0.3, 0.8), rnd(-0.5, 0.5)), { color: DUST.dummy, alpha: 0.7 });
    }
  }

  _impactFlash(p, normal, scale = 1, color = [1, 0.85, 0.55]) {
    this.sprites.spawn({ cell: CELL.IMPACT_STAR, pos: p, size: [0.1 * scale, 0.16 * scale], color, add: 1, emis: [5, 2], life: 0.06, fadeOut: 0.6 });
    this.glow(p, 0.22 * scale, [1, 0.6, 0.3], 0.08, 1.2, 0.6);
  }

  // surface-specific bullet impact (flashes grow with distance so far hits still read)
  impact(pos, normal, surface = 'metal', strength = 1) {
    const p = pos.clone().add(normal.clone().mulScalar(0.02));
    const far = Math.min(2.2, Math.max(1, this.camera.getPosition().distance(p) / 7));
    const k = (0.7 + strength * 0.3) * far;
    const out = (sp) => normal.clone().mulScalar(sp).add(new pc.Vec3(rnd(-0.3, 0.3), rnd(0.1, 0.5), rnd(-0.3, 0.3)));
    switch (surface) {
      case 'wood':
        this._impactFlash(p, normal, 0.6 * k, [1, 0.8, 0.5]);
        this.debris(p, 'splinter', Math.round(2 + strength * 3), 2.4, 0.05, normal, 'splinter');
        this.debris(p, 'splinterDark', Math.round(1 + strength), 2.0, 0.04, normal, 'splinter');
        this.puff(p.clone().add(normal.clone().mulScalar(0.05)), 'dust', 0.13 * k, 0.6, out(1.1), { color: DUST.wood, alpha: 0.75, start: 0.3, erodeStart: 0.15 });
        break;
      case 'dummy':
        this._impactFlash(p, normal, 0.55 * k, [1, 0.9, 0.7]);
        this.debris(p, 'paper', Math.round(3 + strength * 3), 2.2, 0.05, normal, 'flake');
        this.debris(p, 'paperInk', Math.round(1 + strength * 2), 2.0, 0.045, normal, 'flake');
        this.debris(p, 'card', 1, 1.6, 0.04, normal);
        this.puff(p.clone().add(normal.clone().mulScalar(0.05)), 'dust', 0.12 * k, 0.55, out(1.0), { color: DUST.dummy, alpha: 0.6, start: 0.3, erodeStart: 0.15 });
        break;
      case 'barrel':
        this._impactFlash(p, normal, 0.9 * k);
        this.sparks(p, normal, Math.round(5 + strength * 4), { speed: [3, 9], up: 1.5 });
        this.debris(p, 'redChip', 2, 2.2, 0.03, normal);
        this.puff(p.clone().add(normal.clone().mulScalar(0.05)), 'smoke', 0.12, 0.55, out(0.8), { color: DUST.barrel, alpha: 0.55, start: 0.3 });
        break;
      case 'floor':
      case 'wall': {
        this._impactFlash(p, normal, 0.7 * k);
        const col = surface === 'wall' ? DUST.wall : DUST.floor;
        this.debris(p, 'concrete', Math.round(2 + strength * 2), 2.4, 0.035, normal);
        for (let i = 0; i < 3; i++) {
          this.puff(p.clone().add(normal.clone().mulScalar(0.04 + i * 0.07)), 'dust', rnd(0.09, 0.15) * k * (1 + i * 0.35), rnd(0.55, 0.85), out(rnd(0.8, 1.8)),
            { color: col, alpha: 0.8, delay: i * 0.02, start: 0.3, erodeStart: 0.15 });
        }
        // a little crown of grit thrown out of the hole
        for (let i = 0; i < 5; i++) {
          const v = FX._cone(normal, 0.8).mulScalar(rnd(2, 4.5));
          this.sprites.spawn({ cell: CELL.GLOW, pos: p, vel: v, size: [0.018, 0.012], color: [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5], add: 0, alpha: 1, life: rnd(0.25, 0.45), grav: 1, fadeOut: 0.3 });
        }
        if (Math.random() < 0.5) this.sparks(p, normal, 2, { speed: [3, 6], life: [0.1, 0.2] });
        break;
      }
      default:                                                         // steel
        this._impactFlash(p, normal, 1.0 * k);
        this.sparks(p, normal, Math.round(5 + strength * 5), { speed: [3, 10], up: 1.2 });
        this.debris(p, 'steel', 1, 1.8, 0.025, normal);
        this.puff(p.clone().add(normal.clone().mulScalar(0.05)), 'dust', 0.1 * k, 0.45, out(0.9), { color: DUST.metal, alpha: 0.5, start: 0.3 });
    }
  }

  // ================================================================ explosions & fire
  // Barrel / rocket explosion, staged like a toon explosion: a white-hot flash, a fireball that
  // swells in a tenth of a second, holds, then cools through yellow, orange and red to soot while
  // it erodes; a smoke column that takes over as the fire dies; a shock ring and a dust wave
  // along the ground; sparks, smoking chunks and a few flames left licking the scorch mark.
  explosion(pos, radius = 3) {
    const S = this.sprites;
    const fl = this.floorAt(pos);
    const v = new pc.Vec3();
    const up = pos.clone().add(new pc.Vec3(0, 0.45, 0));
    const R = radius / 3;
    // 1. flash
    S.spawn({ cell: CELL.GLOW, pos: up, size: [1.5 * R, 2.3 * R], color: [1, 0.78, 0.5], add: 1, emis: 2.6, alpha: 0.85, life: 0.14, fadeOut: 1 });
    S.spawn({ cell: CELL.FLARE, pos: up, size: [0.9 * R, 1.6 * R], add: 0.4, emis: [6, 3], life: 0.1, fadeOut: 0.7 });
    // 2. fireball
    for (let i = 0; i < 16; i++) {
      FX._randDir(v, 0.6).mulScalar(R * rnd(2.2, 4.4));
      const at = up.clone().add(new pc.Vec3(rnd(-0.3, 0.3) * R, rnd(-0.1, 0.35) * R, rnd(-0.3, 0.3) * R));
      const s = R * rnd(0.55, 0.95);
      S.spawn({
        cell: pick(CELL.FIRE), pos: at, vel: v, size: [s * 0.4, s * 1.12], sizeEase: 'out3', grow: 0.3, color: [1, 1, 1],
        add: 0.05, emis: [3.4, 1.0], life: rnd(0.85, 1.2), heat: [0, 1], ramp: 1, erode: [0, 1], erodeStart: 0.45,
        drag: 7.5, grav: -0.12, rot: rnd(-0.5, 0.5), spin: rnd(-0.8, 0.8), soft: 0.45, fadeOut: 0.08, delay: i < 6 ? 0 : rnd(0.01, 0.07),
      });
    }
    // 3. smoke column: takes over as the fireball cools, rolls upward and thins out
    for (let i = 0; i < 8; i++) {
      FX._randDir(v, 0.85).mulScalar(rnd(0.4, 1.2) * R);
      v.y = rnd(1.4, 2.8) * R;
      const at = up.clone().add(new pc.Vec3(rnd(-0.45, 0.45) * R, rnd(0.1, 0.8) * R, rnd(-0.45, 0.45) * R));
      this.puff(at, 'dark', R * rnd(0.85, 1.25), rnd(1.9, 2.8), v.clone(),
        { color: [0.2, 0.19, 0.19], color1: [0.5, 0.49, 0.48], alpha: 0.78, drag: 1.3, erodeStart: 0.1, delay: rnd(0.28, 0.5), start: 0.45, grow: 0.5, soft: 0.6, fadeIn: 0.12 });
    }
    // 4. shock: a ring racing along the ground and a quick spherical ripple
    S.spawn({ cell: CELL.RING, mode: MODE.FLAT, axis: pc.Vec3.UP, pos: new pc.Vec3(pos.x, fl + 0.06, pos.z), size: [0.3, radius * 1.7], sizeEase: 'out',
      color: [1, 0.85, 0.6], add: 1, emis: [3, 1], life: 0.34, fadeOut: 0.8 });
    S.spawn({ cell: CELL.RING, pos: up, size: [0.3, radius * 1.0], sizeEase: 'out', color: [1, 0.92, 0.8], add: 1, emis: 1.5, alpha: 0.4, life: 0.2, fadeOut: 0.9 });
    // 5. dust wave along the ground
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd(0, 0.3);
      const d = new pc.Vec3(Math.cos(a), 0, Math.sin(a));
      this.puff(new pc.Vec3(pos.x + d.x * 0.6, fl + 0.14, pos.z + d.z * 0.6), 'dust', rnd(0.38, 0.62) * R, rnd(0.9, 1.3),
        d.mulScalar(radius * rnd(1.7, 2.4)).add(new pc.Vec3(0, rnd(0.1, 0.4), 0)), { color: DUST.floor, alpha: 0.7, drag: 3.6, erodeStart: 0.2, delay: rnd(0, 0.05), soft: 0.35 });
    }
    // 6. sparks and embers
    for (let i = 0; i < 28; i++) {
      FX._randDir(v, 0.65).mulScalar(rnd(6, 15));
      S.spawn({ cell: CELL.STREAK, mode: MODE.STRETCH, stretch: 0.05, pos: up, vel: v, size: [0.03, 0.01], color: [1, 0.85, 0.5], color1: [1, 0.35, 0.08],
        add: 1, emis: [6, 2.5], life: rnd(0.5, 1.3), grav: 0.8, drag: 0.8, bounce: 0.3, fadeOut: 0.4 });
    }
    // 7. flames left licking the scorch mark
    for (let i = 0; i < 9; i++) this._flameLick(new pc.Vec3(pos.x + rnd(-0.9, 0.9) * R, fl + 0.05, pos.z + rnd(-0.9, 0.9) * R), rnd(0.22, 0.45) * R, rnd(0.25, 1.4));
    // 8. chunks, some trailing smoke
    this.debris(up, 'soot', 8, 7.5, 0.1);
    for (let i = 0; i < 4; i++) {
      const c = this._solid('soot', up.clone(), new pc.Vec3(0.12, 0.12, 0.12), { life: rnd(1.6, 2.4), vel: FX._randDir(new pc.Vec3(), 0.8).mulScalar(rnd(6, 9)),
        spin: new pc.Vec3(rnd(0, 500), rnd(0, 500), 0), bounce: 0.3, fadeScale: true, halfExtent: 0.06, trail: 0.03 });
      if (c) c.trailT = 0;
    }
    this.flashLight(up.clone().add(new pc.Vec3(0, 0.6, 0)), 11, 0.45, new pc.Color(1, 0.7, 0.45));
    this.addShake(0.8);
  }

  // one flame tongue that licks up and burns out
  _flameLick(pos, size, delay = 0) {
    this.sprites.spawn({ cell: pick(CELL.FLAME), pos, vel: new pc.Vec3(rnd(-0.1, 0.1), rnd(0.6, 1.2), rnd(-0.1, 0.1)),
      size: [size * 0.5, size], color: [1, 1, 1], add: 0.1, emis: [2.8, 1.4], life: rnd(0.35, 0.6), heat: [0.05, 0.85], ramp: 0.85,
      erode: [0, 1], erodeStart: 0.25, rot: rnd(-0.25, 0.25), soft: 0.15, delay, fadeIn: 0.05, fadeOut: 0.2 });
  }

  // continuous fire for a burning barrel (call every frame while lit); key keeps each fire's rate
  burn(pos, dt, intensity = 1, key = pos) {
    let acc = (this.burnAcc.get(key) || 0) + dt * 26 * intensity;
    while (acc > 1) {
      acc -= 1;
      this._flameLick(pos.clone().add(new pc.Vec3(rnd(-0.18, 0.18), 0, rnd(-0.18, 0.18))), rnd(0.18, 0.32));
      if (Math.random() < 0.3) {
        this.puff(pos.clone().add(new pc.Vec3(rnd(-0.1, 0.1), 0.45, rnd(-0.1, 0.1))), 'dark', rnd(0.25, 0.4), rnd(1.0, 1.5),
          new pc.Vec3(rnd(-0.2, 0.2), rnd(1.2, 1.8), rnd(-0.2, 0.2)), { color: [0.22, 0.21, 0.21], alpha: 0.75, drag: 0.8, soft: 0.2 });
      }
      if (Math.random() < 0.25) {
        this.sprites.spawn({ cell: CELL.GLOW, pos: pos.clone().add(new pc.Vec3(rnd(-0.15, 0.15), 0.1, rnd(-0.15, 0.15))),
          vel: new pc.Vec3(rnd(-0.6, 0.6), rnd(1.5, 3), rnd(-0.6, 0.6)), size: [0.03, 0.01], color: [1, 0.5, 0.15], add: 1, emis: 5, life: rnd(0.5, 0.9), drag: 1.5 });
      }
    }
    this.burnAcc.set(key, acc);
  }

  rocketExhaust(pos, dir) {
    const S = this.sprites;
    const back = dir.clone().mulScalar(-1);
    S.spawn({ cell: CELL.MUZZLE_SIDE, mode: MODE.STRETCH, axis: back, pos: pos.clone().add(back.clone().mulScalar(0.12)), size: 0.05, aspect: 2.6,
      color: [1, 1, 1], add: 0.4, emis: 3, life: 0.03, fadeOut: 0 });
    this.glow(pos, 0.3, [1, 0.6, 0.3], 0.03, 1.4, 0.8);
  }

  rocketTrail(pos) {
    this.puff(pos, 'smoke', rnd(0.28, 0.42), rnd(1.1, 1.6), new pc.Vec3(rnd(-0.25, 0.25), rnd(0.15, 0.35), rnd(-0.25, 0.25)),
      { alpha: 0.72, color: [0.84, 0.84, 0.86], drag: 2.5, start: 0.25, erodeStart: 0.25, soft: 0.2 });
  }

  // physics prop from an existing render entity template (dropped magazines etc.)
  prop(template, worldMat, vel, life = 3, halfExtent = 0.03) {
    const e = template.clone();
    e.enabled = true;
    this.root.addChild(e);
    const pos = worldMat.getTranslation(new pc.Vec3());
    const rot = new pc.Quat().setFromMat4(worldMat);
    e.setPosition(pos); e.setRotation(rot); e.setLocalScale(1, 1, 1);
    this.props.push({ e, t: 0, life, vel, spin: new pc.Vec3(rnd(-60, 60), rnd(-30, 30), rnd(-60, 60)), bounce: 0.25, halfExtent });
  }

  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  clear() {
    this.sprites.clear();
    for (const it of this.items) this.inst[it.k].live--;
    this.items.length = 0;
  }

  // ================================================================ update
  _physics(it, dt, pos) {
    if (!it.vel) return;
    if (it.drag) it.vel.mulScalar(Math.max(0, 1 - it.drag * dt));
    if (it.bounce || it.grav) it.vel.y -= G * (it.grav ?? 1) * (it.flutter ? 0.35 : 1) * dt;
    pos.x += it.vel.x * dt; pos.y += it.vel.y * dt; pos.z += it.vel.z * dt;
    if (it.bounce) {
      const fl = this.floorAt(pos) + (it.halfExtent ?? 0.01);
      if (pos.y < fl) {
        pos.y = fl;
        if (it.vel.y < -1.2 && it.sound && this.onSound && !it.played) { this.onSound(it.sound); it.played = true; }
        it.vel.y = -it.vel.y * it.bounce;
        it.vel.x *= 0.6; it.vel.z *= 0.6;
        if (it.spin) it.spin.mulScalar(0.5);
        if (it.flutter) { it.spin && it.spin.set(0, 0, 0); it.eul.x = 0; it.eul.z = 0; }
      }
    }
  }

  update(dt) {
    if (this.lightPeak > 0) {
      if (this.lightFresh) this.lightFresh = false; else this.lightT += dt;
      const k = Math.max(0, 1 - this.lightT / this.lightDur);
      this.light.light.intensity = this.lightPeak * k * k;
      if (k <= 0) this.lightPeak = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const m = this._m, q = this._q, s = this._s;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        this.inst[it.k].live--;
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        continue;
      }
      this._physics(it, dt, it.pos);
      if (it.spin) { it.eul.x += it.spin.x * dt; it.eul.y += it.spin.y * dt; it.eul.z += it.spin.z * dt; }
      if (it.flutter && it.vel && it.pos.y > this.floorAt(it.pos) + 0.02) {   // paper: sways as it falls
        it.vel.x += Math.sin(it.t * 9 + i) * 2.2 * dt; it.vel.z += Math.cos(it.t * 7 + i) * 2.2 * dt;
      }
      if (it.trail !== undefined && it.t < it.life * 0.6) {                  // smoking debris
        it.trailT += dt;
        while (it.trailT > it.trail) {
          it.trailT -= it.trail;
          this.puff(it.pos, 'dark', rnd(0.09, 0.16), rnd(0.5, 0.8), new pc.Vec3(0, 0.3, 0), { color: [0.3, 0.29, 0.28], alpha: 0.55, drag: 2, erodeStart: 0.05, soft: 0.1 });
        }
      }
      let kx = 1, ky = 1, kz = 1;
      if (it.fadeScale && u > 0.8) { const k = (1 - u) / 0.2; kx = ky = kz = k; }
      q.setFromEulerAngles(it.eul.x, it.eul.y, it.eul.z);
      s.set(it.s.x * kx, it.s.y * ky, it.s.z * kz);
      m.setTRS(it.pos, q, s);
      this.inst[it.k].push(m);
    }
    for (const k in this.inst) this.inst[k].flush();
    this.sprites.update(dt);
    // entity props
    for (let i = this.props.length - 1; i >= 0; i--) {
      const it = this.props[i];
      it.t += dt;
      if (it.t >= it.life) { it.e.destroy(); this.props.splice(i, 1); continue; }
      const p = this._p.copy(it.e.getPosition());
      this._physics(it, dt, p);
      it.e.setPosition(p);
      const r = it.e.getLocalEulerAngles();
      it.e.setLocalEulerAngles(r.x + it.spin.x * dt, r.y + it.spin.y * dt, r.z + it.spin.z * dt);
      const u = it.t / it.life;
      if (u > 0.85) { const k = (1 - u) / 0.15; it.e.setLocalScale(k, k, k); }
    }
  }
}
