// The homestead: terrain, buildings, crops, clearables, living Chainers, the gate to the frontier, picking and placement.
import { pc, ent, walk } from './engine.js';
import { Island } from './island.js';
import { Avatar } from './avatar.js';
import { TILE, GRID, BUILDINGS, CROPS, CLEARABLES, ACTIVITIES, CHAINER_SCALE, LAND } from '../data/config.js';
import { mulberry32, clamp, lerp, rand, pick, easeOutCubic, easeInOut } from '../core/util.js';

const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // tile direction a building faces for rot 0..3
// Home is cosy, not a race: a Chainer with nothing to do strolls, one with somewhere to be jogs.
// Cosmetic only (no rule is timed by it); the gaits in avatar.js follow whatever speed this gives.
const STROLL_SPEED = 1.05, JOG_SPEED = 2.6;
const hash01 = (x, z, s) => {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 362437)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

export class HomeWorld {
  constructor(engine, game, fx) {
    this.engine = engine; this.game = game; this.fx = fx;
    this.cb = {};                       // set by main: tapBuilding, tapChainer, loot, toast, sfx
    this.origin = new pc.Vec3(0, 0, 0);
    this.island = new Island(engine, { grid: GRID, margin: 5, origin: this.origin, seed: (game.s.seed % 1000) + 1 });
    this.root = this.island.root;
    this.bviews = new Map(); this.cviews = new Map(); this.aviews = new Map();
    this.selected = null;               // id of the Chainer the player has picked
    this._up = { t: -1, ok: new Set() };
    this.place = null;
    this.active = true;
    this._tiles = [];
    this._markers = [];
    this._dress();
    this.rebuildGround();
    for (const b of game.s.buildings) this._addBuilding(b, false);
    for (const c of game.s.clearables) this._addClearable(c, false);
    for (const c of game.s.chainers) this._addAvatar(c, false);
    this._landSigns();
    this._bind();
    if (engine.seasons) engine.seasons.onSwap((fade) => this.rebuildGround(fade));
    engine.onUpdate((dt, t) => this.update(dt, t));
  }

  // ------------------------------------------------------------------------------------------
  // coordinates
  // ------------------------------------------------------------------------------------------
  tx(x) { return (x - GRID / 2) * TILE; }
  center(b) { const [w, d] = this.game.footprint(b); return { x: this.tx(b.x + w / 2), z: this.tx(b.z + d / 2), w, d }; }
  tileOf(wx, wz) { return { x: Math.floor(wx / TILE + GRID / 2), z: Math.floor(wz / TILE + GRID / 2) }; }
  frontSpot(b, dist = 0.9) {
    const c = this.center(b), f = FRONT[b.rot % 4];
    return { x: c.x + f[0] * (c.w * TILE / 2 + dist), z: c.z + f[1] * (c.d * TILE / 2 + dist), fx: -f[0], fz: -f[1] };
  }

  // ------------------------------------------------------------------------------------------
  // terrain
  // ------------------------------------------------------------------------------------------
  rebuildGround(fade = false) {
    const g = this.game;
    const season = this.engine.seasons ? this.engine.seasons.def : null;
    const grassAt = season ? season.grass : 0.6;       // spring and summer let the grass take more of the yard
    const yard = new Set();                 // pale packed earth under and in front of buildings
    for (const b of g.s.buildings) {
      const d = BUILDINGS[b.type];
      if (d.cat === 'decor' && b.type !== 'decor_campfire') continue;
      const [w, dd] = g.footprint(b);
      for (let i = 0; i < w; i++) for (let j = 0; j < dd; j++) yard.add((b.x + i) + ',' + (b.z + j));
      if (b.type === 'home' || b.type === 'camp' || b.type === 'pool_shrine' || b.type === 'balloon_dock' || b.type === 'workshop') {
        const f = FRONT[b.rot % 4];
        for (let i = -1; i <= w; i++) for (let j = -1; j <= dd; j++) {
          const fx = b.x + i, fz = b.z + j;
          const inFront = (f[0] && (f[0] > 0 ? i === w : i === -1) && j >= 0 && j < dd) || (f[1] && (f[1] > 0 ? j === dd : j === -1) && i >= 0 && i < w);
          if (inFront) yard.add(fx + ',' + fz);
        }
      }
    }
    const cg = GRID / 2, hh = g.half();
    for (let j = hh - 3; j <= hh + 2; j++) { yard.add((cg - 1) + ',' + (cg + j)); yard.add(cg + ',' + (cg + j)); }      // the way out to the frontier
    const seed = g.s.seed % 977;
    // olive grass in soft patches a few tiles wide (smoothed value noise)
    const lat = (x, z) => hash01(x, z, seed);
    const patch = (x, z) => {
      const fx = x / 3.2, fz = z / 3.2, ix = Math.floor(fx), iz = Math.floor(fz), wx = fx - ix, wz = fz - iz;
      const a = lat(ix, iz), b = lat(ix + 1, iz), c = lat(ix, iz + 1), d = lat(ix + 1, iz + 1);
      return a + (b - a) * wx + (c - a) * wz + (a - b - c + d) * wx * wz;
    };
    const kind = (x, z) => {
      if (yard.has(x + ',' + z)) return 'sand';
      if (!g.inGrid(x, z)) return (Math.max(-x, -z, x - GRID + 1, z - GRID + 1) <= 3 && patch(x, z) > 0.64) ? 'grass' : 'floor';
      if (!g.isUnlocked(x, z)) return 'floor';      // forest floor beyond your fence
      return patch(x, z) > grassAt ? 'grass' : 'dirt';
    };
    this.island.rebuild(kind, null, fade);
    this._border();
    this._litter(kind, season);
  }
  /** Rail fence with mossy stone pillars around the land you own. The front has the gate to the frontier;
   *  the right side has a gap where the land sign stands while there is land left to claim. */
  _border() {
    const h = this.game.half();
    if (this._edgeHalf === h) return;
    this._edgeHalf = h;
    if (this._edge) this._edge.destroy();
    const e = ent('edge');
    this.root.addChild(e);
    this._edge = e;
    const eng = this.engine, n = h * 2, H = h * TILE;
    const canGrow = !!this.game.landCost();
    const put = (name, x, z, rot) => {
      if (!eng.hasModel(name)) return null;
      const m = eng.model(name);
      m.setLocalPosition(x, 0, z); m.setLocalEulerAngles(0, rot, 0);
      e.addChild(m);
      return m;
    };
    // side 0: z = +H (front), 1: x = +H (right), 2: z = -H (back), 3: x = -H (left)
    for (let side = 0; side < 4; side++) {
      const gate = side === 0 || (canGrow && side === 1);
      for (let i = 0; i < n; i++) {
        const t = -H + (i + 0.5) * TILE, t0 = -H + i * TILE;
        const isGate = gate && (i === h - 1 || i === h);
        const pillar = i % 4 === 0 || (gate && (i === h - 1 || i === h + 1));
        const px = side === 0 ? t0 : side === 2 ? -t0 : side === 1 ? H : -H;
        const pz = side === 0 ? H : side === 2 ? -H : side === 1 ? -t0 : t0;
        if (pillar && !(side === 0 && eng.hasModel('gate_arch') && (i === h - 1 || i === h + 1))) put('fence_pillar', px, pz, (i * 37 + side * 90) % 360);
        if (isGate) continue;
        const x = side === 0 ? t : side === 2 ? -t : side === 1 ? H : -H;
        const z = side === 0 ? H : side === 2 ? -H : side === 1 ? -t : t;
        put((i + side) % 3 === 0 ? 'fence_b' : 'fence_a', x, z, [0, 90, 180, 270][side]);
      }
    }
    // the gate: parties leave for the frontier through it and come home through it
    this.gate = { x: 0, z: H };
    const arch = put('gate_arch', 0, H, 0);
    if (arch) { this._gateAnim = { spin: [], bob: [], sway: [], glow: [] }; this._collectAnim(arch, this._gateAnim); }
  }
  gateSpot() { return this.gate || { x: 0, z: this.game.half() * TILE }; }
  /** Season litter on free ground (not interactive): fallen leaves, petals and flowers, ferns, snow drifts. */
  _litter(kind, season) {
    if (this._lit) this._lit.destroy();
    const node = ent('litter');
    this.root.addChild(node);
    this._lit = node;
    const g = this.game, eng = this.engine, occ = g.occupancy();
    const seed = (g.s.seed % 613) + 3;
    const M = this.island.margin;
    const table = season ? season.litter : { floor: [['leaf_litter_a', 0.1], ['leaf_litter_b', 0.1]], dirt: [['leaf_litter_c', 0.13]], grass: [['leaf_litter_b', 0.1]], sand: [] };
    const put = (name, x, z, shadow) => {
      const m = eng.model(name, { castShadows: shadow });
      const r2 = hash01(z, x, seed + 9);
      m.setLocalPosition(this.tx(x + 0.5) + (r2 - 0.5) * 0.9, 0, this.tx(z + 0.5) + (hash01(x, z, seed + 5) - 0.5) * 0.9);
      m.setLocalEulerAngles(0, r2 * 360, 0);
      node.addChild(m);
      return m;
    };
    for (let x = -M; x < GRID + M; x++) for (let z = -M; z < GRID + M; z++) {
      if (occ.has(x + ',' + z)) continue;
      const list = table[kind(x, z)];
      if (!list) continue;
      let r = hash01(x, z, seed), name = null;
      for (const [n, p] of list) { if (r < p) { name = n; break; } r -= p; }
      if (name && eng.hasModel(name)) put(name, x, z, false);
    }
    // winter: somebody built a snowman on the first free patch in front of the house
    if (season && season.snowman && eng.hasModel('snowman')) {
      const h = g.first('home');
      if (h) {
        const f = this.frontSpot(h, 3.2), t0 = this.tileOf(f.x, f.z);
        let best = null, bd = 1e9;
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const x = t0.x + dx, z = t0.z + dz;
          if (!g.inGrid(x, z) || !g.isUnlocked(x, z) || occ.has(x + ',' + z) || kind(x, z) === 'sand') continue;
          const d = Math.hypot(dx + 1.5, dz) + hash01(x, z, seed + 21) * 0.5;      // a little to the side of the path
          if (d < bd) { bd = d; best = [x, z]; }
        }
        if (best) {
          const m = eng.model('snowman');
          m.setLocalPosition(this.tx(best[0] + 0.5), 0, this.tx(best[1] + 0.5));
          m.setLocalEulerAngles(0, 36, 0);                                           // faces the camera's side of the yard
          node.addChild(m);
        }
      }
    }
  }
  _dress() {
    // the yard is a clearing in a forest that never ends: big trees crowd the fence on the far sides,
    // a low meadow lies on the camera side so nothing stands between you and the yard
    const e = this.engine, r = mulberry32(4242), RING = 3;
    const far = ['tree_big', 'tree_big_b', 'tree_big', 'tree_c', 'tree_a', 'tree_b', 'tree_pine'];
    const mid = ['tree_a', 'tree_b', 'tree_pine', 'bush_a', 'fern', 'rock_a', 'stump'];
    const low = ['bush_a', 'bush_berry', 'fern', 'grass_tuft', 'rock_a', 'stump', 'log', 'mushrooms'];
    const node = ent('dress');
    this.root.addChild(node);
    for (let x = -RING; x < GRID + RING; x++) for (let z = -RING; z < GRID + RING; z++) {
      if (x >= 0 && z >= 0 && x < GRID && z < GRID) continue;
      const back = x < 0 || z < 0;                 // the camera sits towards +x / +z
      const corner = (x < 0 || x >= GRID) && (z < 0 || z >= GRID);
      const roll = r();
      let k = null, big = false;
      if (back && !(x >= GRID - 2 || z >= GRID - 2)) {
        if (roll < 0.3) { k = pick(far, r); big = k.startsWith('tree_big'); } else if (roll < 0.52) k = pick(mid, r); else if (roll < 0.7) k = pick(low, r);
      } else if (roll < 0.1 && !corner) k = pick(mid, r); else if (roll < 0.44) k = pick(low, r);
      if (!k || !e.hasModel(k)) continue;
      const m = e.model(k);
      m.setLocalPosition(this.tx(x + 0.5) + (r() - 0.5) * 0.8, 0, this.tx(z + 0.5) + (r() - 0.5) * 0.8);
      m.setLocalEulerAngles(0, r() * 360, 0);
      const s = big ? 0.8 + r() * 0.3 : 0.8 + r() * 0.45; m.setLocalScale(s, s, s);
      node.addChild(m);
      this._collectAnim(m, (this._dressAnim = this._dressAnim || { spin: [], bob: [], sway: [], glow: [] }));
    }
    // beyond that ring the low-detail forest takes over and runs into the haze
    const inner = (GRID / 2 + RING) * TILE;
    this.island.forest({ inner, radius: 120, clearAt: (x, z) => (x > inner - 1 || z > inner - 1) && Math.max(x, z) < inner + 9 });
  }
  /** Amber strip on the ground: the tiles the next expansion would add. */
  showExpand(on) {
    if (this._exp) { this._exp.destroy(); this._exp = null; }
    if (!on || !this.game.landCost()) return;
    const h = this.game.half(), n = h + 1, e = ent('expand');
    // drawn over everything (no depth test): tree crowns would otherwise hide most of the strip from this camera
    if (!this._expMat) { const m0 = this.engine.flatMaterial('#ffb21e', { unlit: true, opacity: 0.72 }).clone(); m0._canon = true; m0.depthTest = false; m0.depthWrite = false; m0.update(); this._expMat = m0; }
    const mat = this._expMat;
    const strip = (x0, z0, x1, z1) => {      // tiles from the centre
      const q = ent('s');
      q.addComponent('render', { type: 'plane', material: mat, castShadows: false, receiveShadows: false, layers: [pc.LAYERID_UI] });      // after the world, so nothing covers it
      q.setLocalScale((x1 - x0) * TILE, 1, (z1 - z0) * TILE);
      q.setLocalPosition((x0 + x1) / 2 * TILE, 0.09, (z0 + z1) / 2 * TILE);
      e.addChild(q);
    };
    strip(-n, -n, n, -h); strip(-n, h, n, n); strip(-n, -h, -h, h); strip(h, -h, n, h);
    this.root.addChild(e);
    this._exp = e;
    // pull back until the whole yard and its new strip are in view, above the sheet (a portrait phone sees a narrow slice)
    const cv = this.engine.canvas, tall = cv.height > cv.width;
    this.engine.focus(this.origin.x, this.origin.z + n * TILE * (tall ? 0.9 : 0.55), clamp(n * TILE * (tall ? 7 : 3.4), 40, 104));
  }
  _landSigns() {
    if (this._signs) for (const s of this._signs) s.destroy();
    this._signs = [];
    this._signPos = [];
    if (!this.game.landCost()) return;
    const h = this.game.half(), c = GRID / 2;
    const spots = [[c + h + 0.5, c - 0.5]];
    for (const [x, z] of spots) {
      const wx = this.tx(x + 0.5), wz = this.tx(z + 0.5);
      this._signPos.push({ x: wx, z: wz });
      if (!this.engine.hasModel('land_sign')) continue;
      const m = this.engine.model('land_sign');
      m.setLocalPosition(wx, 0, wz);
      this.root.addChild(m);
      this._signs.push(m);
    }
  }

  // ------------------------------------------------------------------------------------------
  // animated sub-parts of models
  // ------------------------------------------------------------------------------------------
  _collectAnim(root, into, fxList) {
    walk(root, (n) => {
      const nm = n.name || '';
      if (nm.startsWith('spinX_')) into.spin.push({ n, ax: 0 });
      else if (nm.startsWith('spinY_')) into.spin.push({ n, ax: 2 });
      else if (nm.startsWith('spinZ_')) into.spin.push({ n, ax: 1 });
      else if (nm.startsWith('bob_')) into.bob.push({ n, y: n.getLocalPosition().y, ph: Math.random() * 6 });
      else if (nm.startsWith('sway_')) into.sway.push({ n, ph: Math.random() * 6, r: n.getLocalEulerAngles().clone() });
      else if (nm.startsWith('glow_')) this.engine.glowOf(n, into.glow);
      else if (fxList && nm.startsWith('fx_')) {
        const kind = nm.startsWith('fx_smoke') ? 'smoke' : nm.startsWith('fx_fire') ? 'fire' : nm.startsWith('fx_sparkle') ? 'sparkle' : null;
        if (kind) fxList.push(this.fx.emitter(kind, n, kind === 'smoke' ? 2.6 : kind === 'fire' ? 9 : 2.2, kind === 'sparkle' ? 1.2 : kind === 'smoke' && n.getPosition().y < 3 ? 0.62 : 1));      // a campfire smokes less than a chimney
      }
    });
  }
  _animate(set, dt, t, speed = 1) { this.engine.animate(set, dt, t, speed); }

  // ------------------------------------------------------------------------------------------
  // buildings
  // ------------------------------------------------------------------------------------------
  _addBuilding(b, pop = true) {
    const v = { b, root: ent('b_' + b.type), model: null, site: null, key: '', anim: { spin: [], bob: [], sway: [], glow: [] }, fx: [], crops: [], cropKey: '', slots: [] };
    this.root.addChild(v.root);
    this.bviews.set(b.id, v);
    this._refreshBuilding(v, pop);
    return v;
  }
  _refreshBuilding(v, pop = false) {
    const b = v.b, d = BUILDINGS[b.type], e = this.engine;
    const c = this.center(b);
    v.root.setLocalPosition(c.x, 0, c.z);
    v.root.setLocalEulerAngles(0, 90 * (b.rot % 4), 0);
    const building = b.state === 'building';
    const lvl = Math.max(1, b.level);
    let modelName = d.models[Math.min(d.models.length, lvl) - 1];
    if (!e.hasModel(modelName) && d.alt) modelName = d.alt;
    const key = (building ? 'site' : modelName) + (b.state === 'upgrading' ? '+up' : '');
    if (key === v.key) return;
    v.key = key;
    for (const f of v.fx) f.stop();
    v.fx = []; v.anim = { spin: [], bob: [], sway: [], glow: [] }; v.slots = [];
    if (v.model) { v.model.destroy(); v.model = null; }
    if (v.site) { v.site.destroy(); v.site = null; }
    for (const cr of v.crops) cr.destroy();
    v.crops = []; v.cropKey = '';
    const size = d.size;
    if (!building) {
      v.model = e.model(modelName, { size: [size[0] * TILE - 0.4, 2.2, size[1] * TILE - 0.4], color: '#d9a066' });
      v.root.addChild(v.model);
      this._collectAnim(v.model, v.anim, v.fx);
      if (b.type === 'decor_pond') v.fx.push(this.fx.emitter('glint', v.model, 2.4, 0.42, [0, 0.16, 0], { shape: 'disc', radius: Math.min(size[0], size[1]) * TILE * 0.3 }));      // the sun on the water
      walk(v.model, (n) => { const m = /^slot_(\d+)/.exec(n.name || ''); if (m) v.slots[+m[1]] = n; });
      if (pop) this.fx.pop(v.model, 0.3, 0.5);
    }
    if (building || b.state === 'upgrading') {
      v.site = e.model('site', { size: [1.6, 1.4, 1.6], color: '#e9b23f' });
      const sx = size[0] * TILE / 2 * (building ? 1 : 0.5), sz = size[1] * TILE / 2 * (building ? 1 : 0.5);
      v.site.setLocalScale(sx, Math.min(1.5, Math.max(sx, sz) * 0.8 + 0.3), sz);
      if (!building) v.site.setLocalPosition(size[0] * TILE / 2 - 0.9, 0, size[1] * TILE / 2 - 0.4);
      v.root.addChild(v.site);
      if (pop) this.fx.pop(v.site, 0.4, 0.35, 1);
    }
  }
  _removeBuilding(b) {
    const v = this.bviews.get(b.id);
    if (!v) return;
    for (const f of v.fx) f.stop();
    const c = this.center(b);
    this.fx.burst('dust', c.x, 0.4, c.z, 14, 1.3, { shape: 'ring', radius: Math.max(c.w, c.d) * TILE * 0.3, up: 1.5 });
    v.root.destroy();
    this.bviews.delete(b.id);
  }
  _updateCrops(v, now) {
    const b = v.b;
    if (b.type !== 'farm_plot' || !v.model) return;
    let key = '';
    let stage = 0, k = 0;
    if (b.crop) {
      k = clamp((now - b.plantedAt) / Math.max(1, b.readyAt - b.plantedAt), 0, 1);
      stage = k < 0.3 ? 1 : k < 1 ? 2 : 3;
      key = b.crop + stage;
    }
    if (key !== v.cropKey) {
      v.cropKey = key;
      for (const cr of v.crops) cr.destroy();
      v.crops = [];
      if (b.crop) {
        const name = stage === 1 ? 'crop_sprout' : CROPS[b.crop].model;
        for (let i = 0; i < 4; i++) {
          const m = this.engine.model(name, { size: [0.9, 0.6, 0.9], color: '#5fa83c' });
          const slot = v.slots[i];
          const p = slot ? slot.getLocalPosition() : new pc.Vec3((i % 2 ? 0.93 : -0.93), 0.24, (i < 2 ? -0.93 : 0.93));
          m.setLocalPosition(p.x, p.y, p.z);
          m.setLocalEulerAngles(0, (i * 90 + 15) % 360, 0);
          v.model.addChild(m);
          v.crops.push(m);
          if (stage === 3) this.fx.pop(m, 0.7, 0.4);
        }
        if (stage === 3) { const c = this.center(b); this.fx.burst('sparkle', c.x, 0.9, c.z, 8, 1, { shape: 'fountain', radius: 0.9, angle: 10, delay: 0.3 }); }
      }
    }
    if (b.crop && stage === 2) { const s = lerp(0.42, 0.92, (k - 0.3) / 0.7); for (const m of v.crops) m.setLocalScale(s, s, s); }
    if (b.crop && stage === 3) { const s = 1 + Math.sin(now * 4 + b.x) * 0.04; for (const m of v.crops) m.setLocalScale(s, 1 / s, s); }
  }

  // ------------------------------------------------------------------------------------------
  // clearables
  // ------------------------------------------------------------------------------------------
  _addClearable(c, pop = true) {
    const e = this.engine;
    const m = e.model(c.type, { size: [1.2, 1.6, 1.2], color: c.type.startsWith('rock') ? '#b9bcc4' : '#5fa83c' });
    m.setLocalPosition(this.tx(c.x + 0.5), 0, this.tx(c.z + 0.5));
    m.setLocalEulerAngles(0, c.rot * 90 + (c.sc * 100) % 40, 0);
    m.setLocalScale(c.sc, c.sc, c.sc);
    this.root.addChild(m);
    const v = { c, m, anim: { spin: [], bob: [], sway: [], glow: [] }, hit: 0 };
    this._collectAnim(m, v.anim);
    this.cviews.set(c.id, v);
    if (pop) this.fx.pop(m, 0.2, 0.5, c.sc);
  }
  _removeClearable(c, burst = true) {
    const v = this.cviews.get(c.id);
    if (!v) return;
    const p = v.m.getLocalPosition();
    if (burst) {
      const kind = c.type.startsWith('rock') ? 'pebbles' : c.type.startsWith('bush') ? 'leaves' : 'chips', tall = c.type.startsWith('tree');
      this.fx.fell(kind, p.x, p.z, tall, c.sc);
      this.cviews.delete(c.id);
      this.fx.shrinkAway(v.m, tall ? 0.5 : 0.36);      // it shrinks out of the world (and destroys itself) instead of blinking off
      return;
    }
    v.m.destroy();
    this.cviews.delete(c.id);
  }

  // ------------------------------------------------------------------------------------------
  // Chainer avatars + behaviour
  // ------------------------------------------------------------------------------------------
  _addAvatar(c, arrive = true) {
    if (!this.engine.containers.has('chainer')) return;
    const av = new Avatar(this.engine, c);
    this.root.addChild(av.entity);
    const v = { c, av, x: c.px ?? 0, z: c.pz ?? 0, yaw: 180, path: null, wait: rand(0.5, 3), mode: '', emoteT: rand(6, 16), hitT: 0, zT: 0 };
    if (arrive && !c.owned) {
      // wanderers stroll in from the edge of the land
      const h = this.game.half() * TILE;
      v.x = clamp(c.px + rand(-6, 6), -h, h); v.z = h + 2.5;
      v.path = [{ x: c.px, z: c.pz }];
    }
    av.entity.setLocalPosition(v.x, 0, v.z);
    // a ring on the ground tells yours from visitors at a glance: solid amber = yours, dashed cream = a Wanderer
    const ring = ent('ring');
    ring.addComponent('render', { type: 'plane', material: this._ringMat(c.owned), castShadows: false, receiveShadows: false });
    ring.setLocalScale(1.75, 1, 1.75); ring.setLocalPosition(0, 0.06, 0);
    av.entity.addChild(ring);
    v.ring = ring; v.ringOwned = c.owned;
    if (c.status === 'expedition') { v.gone = true; av.entity.enabled = false; }
    this.aviews.set(c.id, v);
    if (arrive) this.fx.pop(av.entity, 0.4, 0.4);
    return v;
  }
  _ringMat(owned) {
    this._rings = this._rings || {};
    const key = owned ? 'own' : 'guest';
    if (this._rings[key]) return this._rings[key];
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.translate(64, 64);
    if (owned) {
      g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.lineWidth = 15; g.strokeStyle = '#343c6d'; g.stroke();
      g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.lineWidth = 8; g.strokeStyle = '#f2a93b'; g.stroke();
    } else {
      g.setLineDash([17, 12]); g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.lineWidth = 9; g.strokeStyle = '#fffbe8'; g.stroke();
    }
    const tex = new pc.Texture(this.engine.app.graphicsDevice, { width: 128, height: 128, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    tex.setSource(cv);
    const m = new pc.StandardMaterial();
    m.useLighting = false; m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 1, 1); m.emissiveMap = tex;
    m.opacityMap = tex; m.opacityMapChannel = 'a'; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.useFog = false;
    m.update();
    this._rings[key] = m;
    return m;
  }
  _removeAvatar(c, how) {
    const v = this.aviews.get(c.id);
    if (!v) return;
    if (how === 'thanks') this.fx.burst('hearts', v.x, 1.6, v.z, 10, 1, { shape: 'fountain', angle: 30, delay: 0.3 });
    this.fx.poof(v.x, v.z);
    v.av.destroy();
    this.aviews.delete(c.id);
  }
  _walkable() {
    const occ = this.game.occupancy();
    return (x, z) => this.game.inGrid(x, z) && !occ.has(x + ',' + z);
  }
  _path(fx, fz, tx, tz) {
    // A* over the tile grid, 8 neighbours, no corner cutting. Returns world waypoints.
    const free = this._walkable();
    const s = this.tileOf(fx, fz), g = this.tileOf(tx, tz);
    s.x = clamp(s.x, 0, GRID - 1); s.z = clamp(s.z, 0, GRID - 1); g.x = clamp(g.x, 0, GRID - 1); g.z = clamp(g.z, 0, GRID - 1);
    const key = (x, z) => x * 64 + z;
    const open = [{ x: s.x, z: s.z, g: 0, f: 0 }], came = new Map(), cost = new Map([[key(s.x, s.z), 0]]);
    const goal = key(g.x, g.z);
    let found = false, guard = 0;
    while (open.length && guard++ < 2500) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (key(cur.x, cur.z) === goal) { found = true; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cur.x + dx, nz = cur.z + dz, nk = key(nx, nz);
        if (nk !== goal && !free(nx, nz)) continue;
        if (dx && dz && (!free(cur.x + dx, cur.z) || !free(cur.x, cur.z + dz))) continue;
        const ng = cur.g + (dx && dz ? 1.41 : 1);
        if (cost.has(nk) && cost.get(nk) <= ng) continue;
        cost.set(nk, ng); came.set(nk, cur);
        open.push({ x: nx, z: nz, g: ng, f: ng + Math.hypot(g.x - nx, g.z - nz) });
      }
    }
    const pts = [{ x: tx, z: tz }];
    if (found) {
      let cur = came.get(goal);
      while (cur && !(cur.x === s.x && cur.z === s.z)) { pts.unshift({ x: this.tx(cur.x + 0.5), z: this.tx(cur.z + 0.5) }); cur = came.get(key(cur.x, cur.z)); }
    }
    return pts;
  }
  _goto(v, x, z) { v.path = this._path(v.x, v.z, x, z); }
  _anchor(c) {
    const g = this.game;
    const b = c.owned ? g.first('home') : (g.first('camp') || g.first('home'));
    if (!b) return { x: 0, z: 4 };
    const f = this.frontSpot(b, 2.2);
    return { x: f.x, z: f.z };
  }
  _updateAvatar(v, dt, t, now) {
    const c = v.c, av = v.av, g = this.game;
    if (v.ringOwned !== c.owned) { v.ringOwned = c.owned; v.ring.render.material = this._ringMat(c.owned); }
    if (v.ring) { const k = this.selected === c.id ? 1.9 + Math.sin(t * 6) * 0.14 : 1.75; v.ring.setLocalScale(k, 1, k); }
    const away = c.status === 'expedition', gate = this.gateSpot();
    if (!away && v.gone) {
      // home from the frontier: step back in through the gate
      v.gone = false; v.x = gate.x + rand(-1.2, 1.2); v.z = gate.z + 0.6; v.path = null; v.mode = '';
      av.entity.enabled = true; this.fx.pop(av.entity, 0.4, 0.4); this.fx.poof(v.x, v.z, 0.9);
    }
    if (v.gone) return;
    let want = 'idle', tool = null, face = null, dest = null;
    if (away) {
      // setting off: walk to the gate and out of sight
      if (v.mode !== 'toGate') { v.mode = 'toGate'; this._goto(v, gate.x + rand(-0.8, 0.8), gate.z + 1.2); }
      if (!v.path || Math.hypot(v.x - gate.x, v.z - gate.z) < 1.5) { v.gone = true; av.entity.enabled = false; if (this.active !== false) this.fx.depart(v.x, v.z, 0, 1); return; }
    } else if (c.status === 'build') {
      const b = g.building(c.jobAt);
      if (b) {
        const tgt = this.frontSpot(b, 0.9);
        if (Math.hypot(v.x - tgt.x, v.z - tgt.z) > 1.3) { if (v.mode !== 'toBuild:' + b.id) { v.mode = 'toBuild:' + b.id; this._goto(v, tgt.x, tgt.z); } }
        else { v.path = null; want = 'work'; tool = 'tool_hammer'; face = this.center(b); }
      }
    } else if (c.status === 'clearing') {
      const cl = g.s.clearables.find(x => x.id === c.target);
      if (cl) {
        const wx = this.tx(cl.x + 0.5), wz = this.tx(cl.z + 0.5);
        const d = Math.hypot(v.x - wx, v.z - wz);
        if (d > 1.9 && now < cl.endsAt - 0.5) { if (v.mode !== 'toClear:' + cl.id) { v.mode = 'toClear:' + cl.id; const a = Math.atan2(v.x - wx, v.z - wz); this._goto(v, wx + Math.sin(a) * 1.5, wz + Math.cos(a) * 1.5); } }
        else { v.path = null; want = 'work'; tool = ACTIVITIES[CLEARABLES[cl.type].act].tool; face = { x: wx, z: wz }; this._strike(v, cl, dt); }
      }
    } else if (c.status === 'job') {
      const b = g.building(c.jobAt);
      if (b) {
        const tgt = this.frontSpot(b, 0.8);
        if (Math.hypot(v.x - tgt.x, v.z - tgt.z) > 1.2) { if (v.mode !== 'toJob:' + b.id) { v.mode = 'toJob:' + b.id; this._goto(v, tgt.x, tgt.z); } }
        else {
          v.path = null;
          const busy = b.type === 'farm_plot' ? !!b.crop : (b.queue > 0 || (b.jobs && b.jobs.length > 0));
          want = busy ? 'work' : 'idle'; tool = busy ? ACTIVITIES[BUILDINGS[b.type].job].tool : null;
          face = this.center(b);
        }
      }
    } else if (c.status === 'rest') {
      const lodge = g.first('rest_lodge');
      const spot = lodge ? this.frontSpot(lodge, 1.0) : this._anchor(c);
      const ox = ((c.look % 7) - 3) * 0.5;
      if (Math.hypot(v.x - spot.x - ox, v.z - spot.z) > 1.4) { if (v.mode !== 'toRest') { v.mode = 'toRest'; this._goto(v, spot.x + ox, spot.z); } }
      else { v.path = null; want = 'sit'; v.zT -= dt; if (v.zT <= 0) { v.zT = 1.3; this.fx.burst('zzz', v.x + 0.3, 2.0, v.z, 1); } }
    } else if (c.status === 'train') {
      const a = g.first('arena');
      if (a) {
        const cc = this.center(a);
        if (Math.hypot(v.x - cc.x, v.z - cc.z - 1.2) > 1.3) { if (v.mode !== 'toArena') { v.mode = 'toArena'; this._goto(v, cc.x, cc.z + 1.2); } }
        else { v.path = null; want = 'work'; tool = 'tool_sword'; face = { x: cc.x, z: cc.z - 2 }; }
      }
    } else {
      // idle: potter about near home / camp, greet now and then
      if (v.mode && v.mode !== 'wander') { v.mode = 'wander'; v.wait = rand(0.3, 1.5); }
      v.mode = 'wander';
      if (!v.path) {
        v.wait -= dt;
        v.emoteT -= dt;
        if (!c.owned && !c.fed) want = (Math.floor(t / 3) % 2) ? 'wave' : 'idle';
        else if (v.emoteT < 1.6) { want = v.emoteKind || 'wave'; if (v.emoteT <= 0) { v.emoteT = rand(9, 22); v.emoteKind = pick(['wave', 'cheer', 'wave']); } }
        if (v.wait <= 0) {
          v.wait = rand(2.5, 7);
          const a = this._anchor(c), free = this._walkable();
          for (let i = 0; i < 8; i++) {
            const x = a.x + rand(-7, 7), z = a.z + rand(-5, 7);
            const tl = this.tileOf(x, z);
            if (free(tl.x, tl.z) && this.game.isUnlocked(tl.x, tl.z)) { dest = { x, z }; break; }
          }
          if (dest && !(!c.owned && !c.fed)) this._goto(v, dest.x, dest.z);
        }
      }
    }
    // movement along the path
    if (v.path && v.path.length) {
      const p = v.path[0];
      const dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz);
      // facing lags the path at a corner: slow down while the body is still turning, so it steps round instead of skating sideways
      const off = Math.abs(((Math.atan2(dx, dz) * 180 / Math.PI - v.yaw + 540) % 360) - 180);
      const step = (v.mode === 'wander' || v.mode === 'toRest' ? STROLL_SPEED : JOG_SPEED) * clamp(1.3 - off / 100, 0.6, 1) * dt;      // never below 0.6: a jog must stay a jog (avatar.js would swap to the walk clip for a moment)
      if (d <= step) { v.x = p.x; v.z = p.z; v.path.shift(); if (!v.path.length) v.path = null; }
      else { v.x += dx / d * step; v.z += dz / d * step; }
      face = { x: v.x + dx, z: v.z + dz };
      want = 'walk'; tool = null;
    }
    if (face) {
      const ty = Math.atan2(face.x - v.x, face.z - v.z) * 180 / Math.PI;
      let dy = ((ty - v.yaw + 540) % 360) - 180;
      v.yaw += dy * Math.min(1, dt * 10);
    }
    av.play(want);
    av.setTool(tool);
    av.entity.setLocalPosition(v.x, 0, v.z);
    av.entity.setLocalEulerAngles(0, v.yaw, 0);
    c.px = v.x; c.pz = v.z;
  }
  /** A Chainer is clearing something: chips, the prop's flinch and the sound land on the frame the swing lands. */
  _strike(v, cl, dt) {
    v.strike = cl.id; v.strikeAt = performance.now();
    if (!v.av.onHit) v.av.onHit = () => { if (v.c.status === 'clearing' && performance.now() - (v.strikeAt || 0) < 400) this._blow(v); };
    // safety net: if the swing clip is missing (so no hit frame ever comes), still strike about once a second
    v.hitT -= dt;
    if (v.hitT > 0) return;
    v.hitT = 1.6;
    if (performance.now() - (v.blowAt || 0) > 1500) this._blow(v);
  }
  _blow(v) {
    const cl = this.game.s.clearables.find((x) => x.id === v.strike), cv = cl && this.cviews.get(cl.id);
    if (!cv) return;
    v.blowAt = performance.now();
    const p = cv.m.getLocalPosition();
    const kind = cl.type.startsWith('rock') ? 'pebbles' : cl.type.startsWith('bush') ? 'leaves' : 'chips';
    // chips fly from where the tool lands: the side the Chainer stands on, at the height of the thing
    const d = Math.hypot(v.x - p.x, v.z - p.z) || 1, off = Math.min(0.32, d * 0.3), low = /^(log|stump)/.test(cl.type);
    this.fx.chop(kind, p.x + (v.x - p.x) / d * off, low ? 0.6 : kind === 'pebbles' ? 0.95 : 1.15, p.z + (v.z - p.z) / d * off, cl.type.startsWith('tree'));
    this.fx.squash(cv.m, 0.1, 0.25, cl.sc);
    this.cb.sfx && this.cb.sfx(kind === 'pebbles' ? 'clink' : 'chop');
  }

  // ------------------------------------------------------------------------------------------
  // events from the rules
  // ------------------------------------------------------------------------------------------
  _bind() {
    const bus = this.game.bus, sfx = (n) => this.cb.sfx && this.cb.sfx(n);
    bus.on('building:add', (b) => { const v = this._addBuilding(b); this.rebuildGround(); const c = this.center(b); this.fx.land(v.site || v.model); this.fx.thump(c.x, c.z, c.w * TILE / 2, c.d * TILE / 2); sfx('place'); });
    bus.on('building:change', (b) => { const v = this.bviews.get(b.id); if (v) this._refreshBuilding(v, true); });
    bus.on('building:move', (b) => {
      const v = this.bviews.get(b.id);
      if (v) { const c = this.center(b); v.root.setLocalPosition(c.x, 0, c.z); v.root.setLocalEulerAngles(0, 90 * (b.rot % 4), 0); this.fx.land(v.root, 0.16, 0.36); this.fx.thump(c.x, c.z, c.w * TILE / 2, c.d * TILE / 2, 0.75); }
      this.rebuildGround(); sfx('place');
    });
    bus.on('building:done', (b, isNew) => {
      const v = this.bviews.get(b.id);
      if (v) this._refreshBuilding(v, true);
      const c = this.center(b);
      const small = b.type === 'farm_plot' || BUILDINGS[b.type].cat === 'decor';
      this.fx.built(c.x, c.z, c.w * TILE / 2, c.d * TILE / 2, isNew, small ? 1.6 : 3.2);
      if (v && v.model) this.fx.settle(v.model, isNew ? 0.55 : 0.8, 0.75);      // up out of the site, past its size, and down to rest
      sfx(isNew ? 'built' : 'upgrade');
    });
    bus.on('building:remove', (b) => { this._removeBuilding(b); this.rebuildGround(); });
    bus.on('land', () => { this._edgeHalf = -1; this.rebuildGround(); this._landSigns(); this.fx.shake(0.4); const h = this.game.half() * TILE; for (let i = 0; i < 4; i++) { const x = [h, -h, 0, 0][i], z = [0, 0, h, -h][i]; this.fx.burst('confetti', x, 1.2, z, 18, 1.3, { shape: 'fountain', angle: 30, delay: 0.3 }); this.fx.ring(x, 0.1, z, 1, 6, { life: 0.6, width: 0.3, delay: i * 0.06 }); } sfx('upgrade'); });
    bus.on('clear:spawn', (c) => this._addClearable(c));
    bus.on('clear:done', (c, got) => {
      const v = this.cviews.get(c.id);
      const p = v ? v.m.getLocalPosition().clone() : new pc.Vec3(this.tx(c.x + 0.5), 0, this.tx(c.z + 0.5));
      this._removeClearable(c);
      this.cb.loot && this.cb.loot({ x: p.x, y: 1.6, z: p.z }, got);
      sfx('collect');
    });
    bus.on('guest:arrive', (c) => { this._addAvatar(c, true); sfx('arrive'); });
    bus.on('chainer:leave', (c, how) => this._removeAvatar(c, how));
    bus.on('guest:fed', (c, auto) => { const v = this.aviews.get(c.id); if (v) { this.fx.burst('hearts', v.x, 2.0, v.z, 9, 1, { shape: 'fountain', angle: 30, delay: 0.4 }); v.emoteT = 1.5; v.emoteKind = 'cheer'; } sfx('yum'); if (auto) this.cb.toast && this.cb.toast(`${c.name} was fed by Auto-feed`, 'good', 'item_food_bowl'); });
    bus.on('chainer:recruited', (c) => { const v = this.aviews.get(c.id); if (v) { this.fx.cheer(v.x, 2.4, v.z); this.fx.burst('confetti', v.x, 2.2, v.z, 26, 1.2, { shape: 'fountain', angle: 34, delay: 0.14 }); v.emoteT = 1.6; v.emoteKind = 'cheer'; } sfx('fanfare'); });
    bus.on('chainer:levelup', (c) => { const v = this.aviews.get(c.id); if (v && v.av.entity.enabled) { this.fx.cheer(v.x, 2.4, v.z); v.emoteT = 1.5; v.emoteKind = 'cheer'; } });
    bus.on('chainer:trained', (c) => { const v = this.aviews.get(c.id); if (v) { this.fx.cheer(v.x, 2.4, v.z); v.emoteT = 1.5; v.emoteKind = 'cheer'; } sfx('upgrade'); });
    bus.on('farm:plant', (b, auto) => { const c = this.center(b); this.fx.burst('dust', c.x, 0.4, c.z, 8, 1, { shape: 'ring', radius: 0.8, speed: 0.45 }); this.bounce(b.id); if (!auto) sfx('plant'); });
    bus.on('farm:harvest', (b, got) => { const c = this.center(b); this.fx.burst('leaves', c.x, 0.7, c.z, 18, 1.35, { shape: 'fountain', angle: 55, radius: 1 }); this.fx.burst('dust', c.x, 0.4, c.z, 8, 1, { shape: 'ring', radius: 1.2, speed: 0.5 }); this.bounce(b.id); this.cb.loot && this.cb.loot({ x: c.x, y: 1.4, z: c.z }, got); sfx('harvest'); });
    bus.on('exp:launch', () => sfx('depart'));
    bus.on('exp:back', () => { const g = this.gateSpot(); if (this.active !== false) this.fx.arrive(g.x, g.z); });
    bus.on('supply:stored', (b, got) => { const c = this.center(b); this.cb.loot && this.cb.loot({ x: c.x, y: 2.6, z: c.z }, got); sfx('supply'); });
    bus.on('chainer:change', (c) => { if (c.status === 'build') { const v = this.aviews.get(c.id); if (v) v.mode = ''; } });
    bus.on('pool:deposit', () => { const p = this.game.first('pool_shrine'); if (p) { const c = this.center(p); this.fx.burst('coins', c.x, 2.6, c.z, 16, 1.1, { shape: 'fountain', angle: 26, delay: 0.2 }); this.fx.burst('sparkle', c.x, 3.2, c.z, 10, 1.5, { delay: 0.3 }); this.fx.ring(c.x, 0.1, c.z, 0.8, 3.4, { color: '#c9d2ff' }); } });
    bus.on('pool:payout', () => { const p = this.game.first('pool_shrine'); if (p) { const c = this.center(p); this.fx.burst('coins', c.x, 3, c.z, 40, 1.4, { shape: 'fountain', angle: 30, delay: 0.5 }); this.fx.burst('confetti', c.x, 3, c.z, 34, 1.3, { shape: 'fountain', angle: 38, delay: 0.25 }); this.fx.ring(c.x, 0.1, c.z, 1, 5, { color: '#c9d2ff', width: 0.3, life: 0.55 }); this.fx.ring(c.x, 0.1, c.z, 0.6, 3.6, { delay: 0.16 }); this.fx.shake(0.4); } });
  }

  // ------------------------------------------------------------------------------------------
  // picking
  // ------------------------------------------------------------------------------------------
  _rayBox(o, d, mn, mx) {
    let t0 = 0, t1 = 1e9;
    for (const ax of ['x', 'y', 'z']) {
      const inv = 1 / (d[ax] || 1e-9);
      let a = (mn[ax] - o[ax]) * inv, b = (mx[ax] - o[ax]) * inv;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    return t0;
  }
  pick(sx, sy) {
    const eng = this.engine;
    // 1) Chainers (screen-space, generous)
    let best = null, bd = 44;
    for (const v of this.aviews.values()) {
      if (!v.av.entity.enabled) continue;
      const p = eng.toScreen(v.x, 1.25 * CHAINER_SCALE, v.z);
      if (!p) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) return { type: 'chainer', c: best.c };
    const { o, d } = eng.ray(sx, sy);
    let hit = null, ht = 1e9;
    for (const v of this.bviews.values()) {
      const c = this.center(v.b), dcat = BUILDINGS[v.b.type].cat;
      const h = v.b.type === 'farm_plot' ? 1.0 : dcat === 'decor' ? 2.2 : 4.2;
      const t = this._rayBox(o, d, { x: c.x - c.w, y: 0, z: c.z - c.d }, { x: c.x + c.w, y: h, z: c.z + c.d });
      if (t >= 0 && t < ht) { ht = t; hit = { type: 'building', b: v.b }; }
    }
    for (const v of this.cviews.values()) {
      const p = v.m.getLocalPosition();
      const tall = v.c.type.startsWith('tree') ? 3.8 : 1.4;
      const t = this._rayBox(o, d, { x: p.x - 0.95, y: 0, z: p.z - 0.95 }, { x: p.x + 0.95, y: tall, z: p.z + 0.95 });
      if (t >= 0 && t < ht) { ht = t; hit = { type: 'clearable', c: v.c }; }
    }
    if (hit) return hit;
    const g = eng.groundAt(sx, sy, 0);
    if (g) { const tl = this.tileOf(g.x, g.z); return { type: 'ground', x: tl.x, z: tl.z, wx: g.x, wz: g.z }; }
    return null;
  }
  bounce(bid) { const v = this.bviews.get(bid); if (v && v.model) this.fx.squash(v.model, 0.08, 0.3); }
  /** Mark a Chainer as picked (its ring pulses). */
  select(cid) { this.selected = cid || null; if (cid) { const v = this.aviews.get(cid); if (v && v.av.entity.enabled) this.fx.squash(v.av.entity, 0.1, 0.3); } }
  focusBuilding(b, dist) { const c = this.center(b); this.engine.focus(c.x, c.z, dist); }
  focusChainer(c) { const v = this.aviews.get(c.id); if (v) this.engine.focus(v.x, v.z); }

  // ------------------------------------------------------------------------------------------
  // placement mode (new building or moving one)
  // ------------------------------------------------------------------------------------------
  /** ptr: the last pointer {x, y, type}. With a mouse the ghost appears under the cursor and follows it until the first click. */
  beginPlace(type, moveId = null, ptr = null) {
    this.cancelPlace();
    const g = this.game, d = BUILDINGS[type];
    const mb = moveId ? g.building(moveId) : null;
    const modelName = d.models[Math.min(d.models.length, mb ? Math.max(1, mb.level) : 1) - 1];
    const ghost = ent('ghost');
    const m = this.engine.model(modelName, { size: [d.size[0] * TILE - 0.4, 2.2, d.size[1] * TILE - 0.4], color: '#f4ab1b' });
    ghost.addChild(m);
    this.root.addChild(ghost);
    const t = this.tileOf(this.engine.rig.target.x, this.engine.rig.target.z);
    this.place = { type, moveId, ghost, m, x: mb ? mb.x : t.x, z: mb ? mb.z : t.z, rot: mb ? mb.rot : 0, ok: false, tiles: [] };
    const p0 = this.place;
    const under = ptr && ptr.type === 'mouse' ? this.engine.groundAt(ptr.x, ptr.y, 0) : null;
    if (mb) { const v = this.bviews.get(moveId); if (v) v.root.enabled = false; }
    else if (under) { const tl = this.tileOf(under.x, under.z); this.placeAt(tl.x, tl.z); p0.follow = true; }
    else this._nudgePlace();
    this._layoutPlace();
    if (!p0.follow) { const a = this.placeAnchor(); this.engine.focus(a.x, a.z); }      // touch: bring the site to the middle of the screen
    this.engine.input.onMove = (sx, sy) => {
      const p = this.place;
      if (!p || !p.follow) return;
      const gpt = this.engine.groundAt(sx, sy, 0);
      if (!gpt) return;
      const tl = this.tileOf(gpt.x, gpt.z), [w, dd] = g.sizeOf(p.type, p.rot);
      const nx = tl.x - Math.floor(w / 2), nz = tl.z - Math.floor(dd / 2);
      if (nx !== p.x || nz !== p.z) { p.x = nx; p.z = nz; this._layoutPlace(); }
    };
    this.engine.input.onDragStart = (sx, sy) => {
      const gpt = this.engine.groundAt(sx, sy, 0);
      if (!gpt || !this.place) return false;
      const p = this.place, [w, dd] = g.sizeOf(p.type, p.rot);
      const tl = this.tileOf(gpt.x, gpt.z);
      if (tl.x >= p.x - 2 && tl.x <= p.x + w + 1 && tl.z >= p.z - 2 && tl.z <= p.z + dd + 1) { p.follow = false; p.grab = { dx: clamp(tl.x - p.x, 0, w - 1), dz: clamp(tl.z - p.z, 0, dd - 1) }; return true; }
      return false;
    };
    this.engine.input.onDrag = (sx, sy) => {
      const gpt = this.engine.groundAt(sx, sy, 0), p = this.place;
      if (!gpt || !p || !p.grab) return;
      const tl = this.tileOf(gpt.x, gpt.z);
      const nx = tl.x - p.grab.dx, nz = tl.z - p.grab.dz;
      if (nx !== p.x || nz !== p.z) { p.x = nx; p.z = nz; this._layoutPlace(); this.cb.sfx && this.cb.sfx('tick'); }
    };
    this.engine.input.onDragEnd = () => { if (this.place) this.place.grab = null; };
    return this.place;
  }
  _nudgePlace() {
    // find the nearest valid spot to the camera focus so the ghost starts somewhere useful
    const p = this.place, g = this.game;
    for (let r = 0; r < 12; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (g.canPlace(p.type, p.x + dx, p.z + dz, p.rot)) { p.x += dx; p.z += dz; return; }
    }
  }
  placeAt(tx, tz) {
    const p = this.place;
    if (!p) return;
    const [w, d] = this.game.sizeOf(p.type, p.rot);
    p.x = tx - Math.floor(w / 2); p.z = tz - Math.floor(d / 2);
    this._layoutPlace();
  }
  rotatePlace() { const p = this.place; if (!p) return; p.rot = (p.rot + 1) % 4; this._layoutPlace(); this.fx.squash(p.m, 0.06, 0.2); }
  _layoutPlace() {
    const p = this.place, g = this.game;
    const [w, d] = g.sizeOf(p.type, p.rot);
    p.ok = g.canPlace(p.type, p.x, p.z, p.rot, p.moveId);
    p.why = '';
    p.ghost.setLocalPosition(this.tx(p.x + w / 2), 0.15, this.tx(p.z + d / 2));
    p.ghost.setLocalEulerAngles(0, 90 * p.rot, 0);
    for (const t of p.tiles) t.destroy();
    p.tiles = [];
    p.h = 1.4 + Math.max(w, d) * 0.45;      // roughly how tall the thing is: the Build here pill floats above it
    const occ = g.occupancy(p.moveId);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const tx = p.x + i, tz = p.z + j;
      const mine = g.inGrid(tx, tz) && g.isUnlocked(tx, tz);
      const free = mine && !occ.has(tx + ',' + tz);
      if (!mine) p.why = 'Outside your fence'; else if (!free && !p.why) p.why = 'Something is in the way';
      const q = ent('tile');
      q.addComponent('render', { type: 'plane', material: this.engine.flatMaterial(free ? '#7dff6a' : '#ff5a4a', { unlit: true, opacity: 0.55 }), castShadows: false, receiveShadows: false });
      q.setLocalScale(TILE * 0.94, 1, TILE * 0.94);
      q.setLocalPosition(this.tx(tx + 0.5), 0.07, this.tx(tz + 0.5));
      this.root.addChild(q);
      p.tiles.push(q);
    }
  }
  placeAnchor() { const p = this.place; if (!p) return null; const pos = p.ghost.getPosition(); return { x: pos.x, y: pos.y + (p.h || 3), z: pos.z, y0: pos.y }; }
  cancelPlace() {
    const p = this.place;
    if (!p) return;
    for (const t of p.tiles) t.destroy();
    p.ghost.destroy();
    if (p.moveId) { const v = this.bviews.get(p.moveId); if (v) v.root.enabled = true; }
    this.place = null;
    this.engine.input.onDragStart = null; this.engine.input.onDrag = null; this.engine.input.onDragEnd = null; this.engine.input.onMove = null;
  }
  confirmPlace() {
    const p = this.place, g = this.game;
    if (!p) return { ok: false };
    if (!p.ok) return { ok: false, why: p.why || 'Something is in the way' };
    let res;
    if (p.moveId) { const id = p.moveId, x = p.x, z = p.z, rot = p.rot; this.cancelPlace(); res = { ok: g.move(id, x, z, rot) }; }
    else { const { type, x, z, rot } = p; this.cancelPlace(); res = g.build(type, x, z, rot); }
    return res;
  }

  // ------------------------------------------------------------------------------------------
  // world-anchored UI markers (the UI layer turns these into DOM bubbles)
  // ------------------------------------------------------------------------------------------
  markers() {
    const out = this._markers; out.length = 0;
    const g = this.game, now = g.now();
    // which buildings could be upgraded right now (checked twice a second, not every frame)
    if (now - this._up.t > 0.5 || now < this._up.t) {
      this._up.t = now; this._up.ok.clear();
      for (const b of g.s.buildings) if (b.state === 'ready' && BUILDINGS[b.type].maxLevel > 1 && g.checkUpgrade(b).ok) this._up.ok.add(b.id);
    }
    const near = this.engine.rig.curDist < 82;
    for (const v of this.bviews.values()) {
      const b = v.b, d = BUILDINGS[b.type], c = this.center(b);
      const top = b.type === 'farm_plot' ? 1.6 : d.cat === 'decor' ? 2.4 : d.size[0] >= 3 ? 5.6 : 4.4;
      const n0 = out.length;
      if (near && d.maxLevel > 1 && b.level >= 1) out.push({ key: 'lv' + b.id, kind: 'lvl', x: c.x + c.w * TILE / 2 - 0.3, y: b.type === 'farm_plot' ? 0.5 : 1.1, z: c.z + c.d * TILE / 2 - 0.2, level: b.level, max: b.level >= d.maxLevel, id: b.id });
      if (b.state === 'building' || b.state === 'upgrading') {
        const tot = Math.max(1, b.doneAt - b.startAt);
        out.push({ key: 'bld' + b.id, kind: 'timer', x: c.x, y: Math.min(top, 3.6), z: c.z, p: clamp(1 - (b.doneAt - now) / tot, 0, 1), left: b.doneAt - now, icon: 'item_hammer', help: !!b.builder });
        continue;
      }
      if (b.type === 'farm_plot') {
        if (!b.crop) out.push({ key: 'plant' + b.id, kind: 'action', x: c.x, y: top, z: c.z, icon: 'crop_sprout', act: 'plant', id: b.id, pulse: true, label: 'Plant' });
        else if (now >= b.readyAt) out.push({ key: 'harv' + b.id, kind: 'action', x: c.x, y: top + 0.4, z: c.z, icon: 'res_bio', act: 'harvest', id: b.id, bounce: true, label: Math.floor(g.s.res.bio) >= g.capOf('bio') ? 'Storage full' : 'Harvest +' + g.farmYield(b) });
        else out.push({ key: 'grow' + b.id, kind: 'timer', x: c.x, y: top, z: c.z, p: clamp((now - b.plantedAt) / (b.readyAt - b.plantedAt), 0, 1), left: b.readyAt - now, icon: CROPS[b.crop].model, small: true });
      } else if (d.recipe) {
        if (b.stored > 0) out.push({ key: 'col' + b.id, kind: 'action', x: c.x, y: top, z: c.z, icon: 'res_' + Object.keys(d.recipe.out)[0].replace('ingot', 'ingot'), act: 'collect', id: b.id, bounce: true, label: 'Collect ' + b.stored * Object.values(d.recipe.out)[0] });
        else if (b.queue > 0) out.push({ key: 'wrk' + b.id, kind: 'timer', x: c.x, y: top, z: c.z, p: clamp((now - b.batchStart) / Math.max(0.1, b.batchEnd - b.batchStart), 0, 1), left: b.batchEnd - now + (b.queue - 1) * g.batchTime(b), icon: 'res_' + Object.keys(d.recipe.out)[0], small: true });
      } else if (b.type === 'workshop') {
        const done = Object.entries(b.done || {}).filter(([, n]) => n > 0);
        if (done.length) out.push({ key: 'crt' + b.id, kind: 'action', x: c.x, y: top, z: c.z, icon: 'item_crate_' + done[0][0].slice(-1), act: 'collect', id: b.id, bounce: true, label: 'Collect ' + done.reduce((a, [, n]) => a + n, 0) });
        else if (b.jobs && b.jobs.length) { const j = b.jobs[0]; out.push({ key: 'wrk' + b.id, kind: 'timer', x: c.x, y: top, z: c.z, p: clamp((now - j.start) / Math.max(0.1, j.end - j.start), 0, 1), left: b.jobs[b.jobs.length - 1].end - now, icon: 'item_crate_' + j.key.slice(-1), small: true }); }
      } else if (b.type === 'pool_shrine') {
        out.push({ key: 'pool' + b.id, kind: 'pool', x: c.x, y: top + 0.6, z: c.z, left: g.epochLeft(), id: b.id });
      } else if (b.type === 'camp') {
        if (g.guests().length < g.guestSlots() && g.s.guestTimer > now) out.push({ key: 'camp' + b.id, kind: 'timer', x: c.x, y: top - 1.2, z: c.z, p: 0, left: g.s.guestTimer - now, icon: 'item_flag', small: true, noBar: true, pre: 'Visitor in' });
      }
      // nothing else to do here, and it can be upgraded: say so
      if (this._up.ok.has(b.id) && !out.slice(n0).some(m => m.kind === 'action')) out.push({ key: 'up' + b.id, kind: 'action', x: c.x, y: top + (out.length - n0 > 1 ? 1.5 : 0), z: c.z, icon: 'item_arrow_up', alt: 'item_star', act: 'building', id: b.id, up: true, small: true, label: 'Upgrade' });
    }
    for (const v of this.aviews.values()) {
      const c = v.c;
      if (!v.av.entity.enabled) continue;
      const y = 2.75 * CHAINER_SCALE;
      // everyone wears a name tag: navy with a level for yours, cream with "Wanderer" for visitors
      out.push({ key: 'n' + c.id, kind: 'tag', x: v.x, y: y - 0.1, z: v.z, text: c.name, rarity: c.rarity, act: 'chainer', id: c.id, mood: g.mood(c), owned: c.owned, level: c.level, sel: this.selected === c.id, left: c.owned ? 0 : c.leavesAt - now, hungry: !c.owned && !c.fed });
      if (!c.owned && !c.fed) out.push({ key: 'g' + c.id, kind: 'action', x: v.x, y: y + 1.1, z: v.z, icon: 'item_food_bowl', act: 'chainer', id: c.id, bounce: true, alert: true, label: 'Feed' });
      else if (c.status === 'rest') out.push({ key: 'r' + c.id, kind: 'timer', x: v.x, y: y + 0.7, z: v.z, p: clamp((now - (c.restFrom || now)) / Math.max(1, c.restUntil - (c.restFrom || now)), 0, 1), left: c.restUntil - now, icon: 'item_hourglass', small: true });
      else if (c.status === 'train') out.push({ key: 't' + c.id, kind: 'timer', x: v.x, y: y + 0.7, z: v.z, p: 0, left: c.busyUntil - now, icon: 'item_dumbbell', small: true, noBar: true });
    }
    for (const v of this.cviews.values()) {
      const c = v.c;
      if (c.by && now >= c.workAt) { const p = v.m.getLocalPosition(); out.push({ key: 'cl' + c.id, kind: 'timer', x: p.x, y: 2.6, z: p.z, p: clamp((now - c.workAt) / Math.max(0.1, c.endsAt - c.workAt), 0, 1), left: c.endsAt - now, icon: ACTIVITIES[CLEARABLES[c.type].act].icon, small: true }); }
    }
    // parties that are back wait at the gate with their chest
    const gate = this.gateSpot();
    let bi = 0;
    for (const e of g.s.expeditions) if (now >= e.endAt) { out.push({ key: 'chest' + e.id, kind: 'action', x: gate.x + (bi - 0.5) * 2.4, y: 3.4, z: gate.z - 1.2, icon: 'chest_wood', alt: 'item_chest', act: 'claim', id: e.id, bounce: true, alert: true, label: 'Claim loot' }); bi++; }
    if (g.first('balloon_dock') && !bi) out.push({ key: 'gate', kind: 'action', x: gate.x, y: 4.6, z: gate.z, icon: 'item_compass', act: 'frontier', id: 'gate', small: true, label: 'Frontier' });
    if (this._signPos && g.landCost()) for (let i = 0; i < this._signPos.length; i++) { const s = this._signPos[i]; out.push({ key: 'land' + i, kind: 'action', x: s.x, y: 2.4, z: s.z, icon: 'item_flag', act: 'land', id: 'land', label: 'Expand' }); }
    return out;
  }

  // ------------------------------------------------------------------------------------------
  update(dt, t) {
    const g = this.game, now = g.now();
    if (this._dressAnim) this._animate(this._dressAnim, dt, t);
    for (const v of this.bviews.values()) {
      const b = v.b, d = BUILDINGS[b.type];
      const busy = d.recipe ? b.queue > 0 : b.type === 'workshop' ? (b.jobs && b.jobs.length > 0) : true;
      this._animate(v.anim, dt, t, busy ? 1 : 0.12);
      for (const f of v.fx) f.on = busy || !(d.recipe || b.type === 'workshop');
      this._updateCrops(v, now);
      if (v.site && Math.random() < dt * 1.5) { const c = this.center(b); this.fx.burst('dust', c.x + rand(-1, 1), 0.6, c.z + rand(-1, 1), 2); }
    }
    for (const v of this.cviews.values()) this._animate(v.anim, dt, t);
    for (const v of this.aviews.values()) this._updateAvatar(v, dt, t, now);
    if (this._gateAnim) this._animate(this._gateAnim, dt, t);
    if (this.place) { const p = this.place; const y = 0.15 + Math.sin(t * 5) * 0.06; const pos = p.ghost.getLocalPosition(); p.ghost.setLocalPosition(pos.x, y, pos.z); }
  }
}
