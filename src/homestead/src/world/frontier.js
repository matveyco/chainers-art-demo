// The frontier: one big stretch of wild land beyond the gate. Four zones around their trail forks, a set piece
// at every place of interest, and the parties themselves: you watch them walk out, work and carry the haul home.
import { pc, ent, walk } from './engine.js';
import { Island } from './island.js';
import { Avatar } from './avatar.js';
import { TILE, REGIONS, POI_TYPES, TRANSPORT, ACTIVITIES, CHAINER_SCALE } from '../data/config.js';
import { FRONTIER, SITES, ZONE_GEO, ZONE_ORDER, POND_TILES, zoneAt, pointOn, pathTo, trailTiles, toWorld } from '../data/frontier.js';
import { mulberry32, weighted, clamp } from '../core/util.js';

const hash01 = (x, z, s) => {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 362437)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const BIG = /tower|den|cave|arch|tree|mine|cabin|circle|trader|pier|bandit|watch/;

export class FrontierWorld {
  constructor(engine, game, fx) {
    this.engine = engine; this.game = game; this.fx = fx;
    this.active = false;
    this.pois = new Map();        // poi id -> { poi, node, anim }
    this.parties = new Map();     // expedition id -> party view
    this._markers = [];
    const S = FRONTIER.size, M = FRONTIER.margin;
    this.origin = new pc.Vec3(FRONTIER.origin[0], FRONTIER.origin[1], FRONTIER.origin[2]);
    this.island = new Island(engine, { grid: S, margin: M, origin: this.origin, seed: 77 });
    this.root = this.island.root;
    this.anim = { spin: [], bob: [], sway: [], glow: [] };
    this._paint();
    this._dress();
    this._syncPois();
    this._syncParties();
    const bus = game.bus;
    bus.on('pois', () => this._syncPois());
    bus.on('exp:launch', (e) => { this._syncParties(); this._syncPois(); if (this.active) { const p = this.partyPos(e.id); if (p) fx.depart(p.x, p.z, 0, 1); } });
    bus.on('exp:claimed', () => { this._syncParties(); this._syncPois(); });
    bus.on('exp:change', () => this._syncParties());
    bus.on('exp:phase', (e, ph) => {
      if (!this.active) return;
      const p = this.partyPos(e.id);
      if (!p) return;
      if (ph === 'work') { fx.poof(p.x, p.z, 1.3); fx.ring(p.x, this.origin.y + 0.1, p.z, 0.5, 2.6, { life: 0.4 }); }
      if (ph === 'back') { fx.burst('sparkle', p.x, 1.0, p.z, 12, 1.4, { shape: 'fountain', radius: 1, angle: 10, delay: 0.4, speed: 2.2 }); fx.depart(p.x, p.z, 0, -1); }
      if (ph === 'home') { fx.arrive(p.x, p.z); }
    });
    if (engine.seasons) engine.seasons.onSwap((fade) => engine.seasons.defer(() => this.island.repaint(fade && this.active)));
    engine.onUpdate((dt, t) => this.update(dt, t));
  }
  w(x, z) { const p = toWorld(x, z); return { x: p.x, z: p.z }; }          // frontier tile -> metres, local to the map

  // ------------------------------------------------------------------------------------------
  // ground: each zone's own earth, ponds in the ruins, sandy trails from the gate to every site
  // ------------------------------------------------------------------------------------------
  _paint() {
    const S = FRONTIER.size, R = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
    const trail = this.trail = trailTiles();
    const lat = (x, z, s) => hash01(x, z, s);
    const patch = (x, z, s) => {
      const fx = x / 2.6, fz = z / 2.6, ix = Math.floor(fx), iz = Math.floor(fz), wx = fx - ix, wz = fz - iz;
      const a = lat(ix, iz, s), b = lat(ix + 1, iz, s), c = lat(ix, iz + 1, s), d = lat(ix + 1, iz + 1, s);
      return a + (b - a) * wx + (c - a) * wz + (a - b - c + d) * wx * wz;
    };
    const nearSite = (x, z, d) => SITES.some((s) => Math.hypot(s.x - x - 0.5, s.z - z - 0.5) < d);
    this.kindAt = (x, z) => {
      if (z >= S - 2 && Math.abs(x + 0.5 - FRONTIER.gate.x) < 1.1) return 'sand';      // the road home, past the gate
      if (x < 1 || z < 1 || x >= S - 1 || z >= S - 1) return 'floor';
      if (trail.has(x + ',' + z)) return 'sand';
      if (POND_TILES.has(x + ',' + z)) return 'water';      // the ponds beside the water sites (piers, flooded gardens)
      const zid = zoneAt(x + 0.5, z + 0.5), G = R[zid].ground;
      const v = patch(x, z, 31 + ZONE_ORDER.indexOf(zid) * 7);
      if (v > 1 - G.altP * 1.25) {
        if (G.alt === 'water' && (nearSite(x, z, 2.4) || trail.has((x + 1) + ',' + z) || trail.has((x - 1) + ',' + z) || trail.has(x + ',' + (z + 1)) || trail.has(x + ',' + (z - 1)))) return G.base;
        return G.alt;
      }
      return G.base;
    };
    this.shadeAt = (x, z) => {
      if (x < 2 || z < 2 || x >= S - 2 || z >= S - 2) return null;
      return R[zoneAt(x + 0.5, z + 0.5)].ground.shade;
    };
    this.island.rebuild(this.kindAt, this.shadeAt);
    // where the water is (metres, flat x,z pairs): the sun glints on it
    this._water = [];
    for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) if (this.kindAt(x, z) === 'water') { const p = this.w(x + 0.5, z + 0.5); this._water.push(p.x, p.z); }
  }
  _collect(root, into) {
    walk(root, (n) => {
      const nm = n.name || '';
      if (nm.startsWith('sway_')) into.sway.push({ n, ph: Math.random() * 6, r: n.getLocalEulerAngles().clone() });
      else if (nm.startsWith('spinX_')) into.spin.push({ n, ax: 0 });
      else if (nm.startsWith('spinY_')) into.spin.push({ n, ax: 2 });
      else if (nm.startsWith('spinZ_')) into.spin.push({ n, ax: 1 });
      else if (nm.startsWith('bob_')) into.bob.push({ n, y: n.getLocalPosition().y, ph: Math.random() * 6 });
      else if (nm.startsWith('glow_')) this.engine.glowOf(n, into.glow);
      else if (nm.startsWith('fx_')) { const kind = nm.startsWith('fx_smoke') ? 'smoke' : nm.startsWith('fx_fire') ? 'fire' : null; if (kind) (into.fx = into.fx || []).push(this.fx.emitter(kind, n, kind === 'smoke' ? 2.4 : 8)); }
    });
  }
  _dress() {
    const eng = this.engine, S = FRONTIER.size, r = mulberry32(8811);
    const R = Object.fromEntries(REGIONS.map((x) => [x.id, x]));
    const node = ent('dress');
    this.root.addChild(node);
    const nearSite = (x, z, d) => SITES.some((s) => Math.hypot(s.x - x - 0.5, s.z - z - 0.5) < d);
    const nearTrail = (x, z) => this.trail.has(x + ',' + z) || this.trail.has((x + 1) + ',' + z) || this.trail.has((x - 1) + ',' + z) || this.trail.has(x + ',' + (z + 1)) || this.trail.has(x + ',' + (z - 1));
    for (let x = -2; x < S + 2; x++) for (let z = -2; z < S + 2; z++) {
      const roll = r(), jx = r(), jz = r(), rot = r(), sc = r();
      const k0 = this.kindAt(x, z);
      if (k0 === 'water') { if (roll < 0.3 && eng.hasModel('lilypad')) { const p = this.w(x + 0.5, z + 0.5), m = eng.model('lilypad'); m.setLocalPosition(p.x, 0.04, p.z); node.addChild(m); } continue; }
      if (this.trail.has(x + ',' + z)) continue;
      // pond banks: reeds instead of the zone's scatter, so no tree ends up standing in the water
      if (POND_TILES.has((x + 1) + ',' + z) || POND_TILES.has((x - 1) + ',' + z) || POND_TILES.has(x + ',' + (z + 1)) || POND_TILES.has(x + ',' + (z - 1))) {
        if (roll < 0.4 && !nearSite(x, z, 1.7) && eng.hasModel('reeds')) {
          const p = this.w(x + 0.25 + jx * 0.5, z + 0.25 + jz * 0.5), m = eng.model('reeds');
          m.setLocalPosition(p.x, 0, p.z); m.setLocalEulerAngles(0, rot * 360, 0);
          const s = 0.8 + sc * 0.4; m.setLocalScale(s, s, s);
          node.addChild(m); this._collect(m, this.anim);
        }
        continue;
      }
      if (nearSite(x, z, 2.7)) continue;
      if (Math.hypot(x - FRONTIER.gate.x, z - FRONTIER.gate.z) < 3.4) continue;
      if (Math.abs(x + 0.5 - FRONTIER.gate.x) < 7.6 && z > FRONTIER.gate.z - 1.2) continue;      // your yard behind the gate
      const zid = zoneAt(x + 0.5, z + 0.5), reg = R[zid];
      // thinner along the camera side so the trails stay readable, thicker deep in each zone
      const dens = (nearTrail(x, z) ? 0.1 : 0.27) * (z > S - 6 ? 0.5 : 1);
      if (roll > dens) continue;
      let k = weighted(reg.scatter, r);
      if (nearTrail(x, z) && k.startsWith('tree')) k = 'bush_a';
      if (!eng.hasModel(k)) continue;
      const p = this.w(x + 0.2 + jx * 0.6, z + 0.2 + jz * 0.6), m = eng.model(k);
      m.setLocalPosition(p.x, 0, p.z);
      m.setLocalEulerAngles(0, Math.floor(rot * 4) * 90 + rot * 30, 0);
      const s = (k.startsWith('tree') ? 0.75 : 0.85) + sc * 0.4; m.setLocalScale(s, s, s);
      node.addChild(m);
      this._collect(m, this.anim);
    }
    // waymarkers: a sign at every fork, the gate itself on the near edge
    const put = (name, tx, tz, rot, sc = 1) => { if (!eng.hasModel(name)) return null; const p = this.w(tx, tz), m = eng.model(name); m.setLocalPosition(p.x, 0, p.z); m.setLocalEulerAngles(0, rot, 0); m.setLocalScale(sc, sc, sc); node.addChild(m); this._collect(m, this.anim); return m; };
    for (const id of ZONE_ORDER) { const c = ZONE_GEO[id].c; put(eng.hasModel('trail_sign') ? 'trail_sign' : 'decor_signpost', c[0] + 1.1, c[1] + 0.6, 200, 1.2); }
    put(eng.hasModel('gate_arch') ? 'gate_arch' : 'decor_arch', FRONTIER.gate.x, FRONTIER.gate.z, 0, 1);
    const g = this.w(FRONTIER.gate.x, FRONTIER.gate.z);
    this.gatePos = { x: g.x, z: g.z };
    // ---- behind the gate: a corner of your own yard, so the trail visibly starts at home -------------------------
    const gx = FRONTIER.gate.x, gz = FRONTIER.gate.z, YW = 7, YD = 9;
    for (let i = -YW; i < YW; i++) {
      if (i % 4 === 0 && Math.abs(i) > 1) put('fence_pillar', gx + i, gz, i * 37);
      if (i === -1 || i === 0) continue;                                    // the arch stands here
      put((i & 1) ? 'fence_a' : 'fence_b', gx + i + 0.5, gz, 0);
    }
    for (let j = 0; j < YD; j++) {
      put(j % 3 ? 'fence_a' : 'fence_b', gx - YW, gz + j + 0.5, 270); put(j % 3 ? 'fence_a' : 'fence_b', gx + YW, gz + j + 0.5, 90);
      if (j % 4 === 0) { put('fence_pillar', gx - YW, gz + j, j * 53); put('fence_pillar', gx + YW, gz + j, j * 91); }
    }
    put('home_1', gx - 3.4, gz + 4.6, 0); put('camp_1', gx + 3.6, gz + 5.2, 0); put('farm_plot', gx - 4.6, gz + 1.6, 0);
    put('decor_lantern', gx - 1.3, gz + 1.2, 0); put('decor_lantern', gx + 1.3, gz + 1.2, 0); put('decor_bench', gx + 2.2, gz + 2.4, 200); put('well', gx + 5.2, gz + 1.8, 0);
    // ---- and around it low growth instead of bare ground: bushes, ferns, stumps, logs, a few small trees ------------
    const LOW = ['bush_a', 'bush_a', 'fern', 'fern', 'grass_tuft', 'grass_tuft', 'stump', 'log', 'mushrooms', 'bush_berry', 'rock_a', 'leaf_litter_a', 'leaf_litter_b', 'leaf_litter_c'];
    const r2 = mulberry32(4407);
    for (let x = gx - 26; x < gx + 30; x++) for (let z = S - 3; z < S + 30; z++) {
      const roll = r2(), jx = r2(), jz = r2(), rot = r2(), sc = r2();
      if (x >= -2 && x < S + 2 && z < S + 2) continue;                                              // the map itself is dressed above
      if (Math.abs(x + 0.5 - gx) < YW + 0.6 && z > gz - 1.2 && z < gz + YD + 0.6) continue;         // the yard
      const far = Math.hypot(x - gx, z - gz);
      let k = null;
      if (roll < 0.03 && far > 11) k = ['tree_a', 'tree_b', 'tree_c'][Math.floor(rot * 3)];         // sparse and small: they must not hide the map
      else if (roll < 0.26) k = LOW[Math.floor(sc * LOW.length)];
      if (!k || !eng.hasModel(k)) continue;
      const p = this.w(x + 0.15 + jx * 0.7, z + 0.15 + jz * 0.7), m = eng.model(k, { group: eng.farGroup });
      m.setLocalPosition(p.x, 0, p.z); m.setLocalEulerAngles(0, rot * 360, 0);
      const q = (k.startsWith('tree') ? 0.7 : 0.85) + jx * 0.35; m.setLocalScale(q, q, q);
      node.addChild(m);
    }
    // the wilds carry on to the horizon; only a narrow strip on the camera side of the gate stays free of tall forest
    // (the camera hangs over that corner when you look at the trailhead)
    this.island.forest({ radius: 128, clearAt: (x, z) => z > g.z - 4 && x > g.x - 22 && x < g.x + 44 && z < g.z + 46 });
  }

  // ------------------------------------------------------------------------------------------
  // places of interest
  // ------------------------------------------------------------------------------------------
  sitePos(siteId) { const s = SITES[siteId]; return this.w(s.x, s.z); }
  _syncPois() {
    const eng = this.engine, list = this.game.allPois();
    const keep = new Set(list.map((p) => p.id));
    for (const e of this.game.s.expeditions) keep.add(e.poi.id);
    for (const [id, pv] of this.pois) if (!keep.has(id)) { for (const f of (pv.anim.fx || [])) f.stop(); pv.node.destroy(); this.pois.delete(id); }
    for (const poi of [...list, ...this.game.s.expeditions.map((e) => e.poi)]) {
      if (this.pois.has(poi.id)) continue;
      const T = POI_TYPES[poi.type];
      const node = ent('poi');
      const p = this.sitePos(poi.site);
      node.setLocalPosition(p.x, 0, p.z);
      this.root.addChild(node);
      const name = eng.hasModel(T.prop) ? T.prop : (T.alt && eng.hasModel(T.alt) ? T.alt : T.prop);
      const prop = eng.model(name, { size: [1.8, 2, 1.8], color: '#b0305c' });
      const big = BIG.test(name) ? 1.3 : 1.7;      // places are landmarks: drawn larger than life
      prop.setLocalScale(big, big, big);
      const pond = T.water && SITES[poi.site].pond;
      // set pieces face the camera side; a pier turns its boat (its +x side) to the water
      prop.setLocalEulerAngles(0, pond ? Math.atan2(-pond[1], pond[0]) * 180 / Math.PI : 180 + ((poi.seed % 5) - 2) * 14, 0);
      node.addChild(prop);
      if (eng.hasModel('poi_flag')) { const flag = eng.model('poi_flag'); flag.setLocalPosition(2.3, 0, 1.7); node.addChild(flag); }
      const pv = { poi, node, anim: { spin: [], bob: [], sway: [], glow: [] } };
      this._collect(node, pv.anim);
      this.pois.set(poi.id, pv);
      if (this.active) this.fx.pop(node, 0.3, 0.5);
    }
  }

  // ------------------------------------------------------------------------------------------
  // parties
  // ------------------------------------------------------------------------------------------
  _syncParties() {
    const g = this.game, eng = this.engine;
    const keep = new Set(g.s.expeditions.map((e) => e.id));
    for (const [id, pv] of this.parties) if (!keep.has(id)) { for (const a of pv.avatars) a.av.destroy(); if (pv.cart) pv.cart.destroy(); if (pv.camp) pv.camp.destroy(); this.parties.delete(id); }
    if (!eng.containers.has('chainer')) return;
    for (const e of g.s.expeditions) {
      if (this.parties.has(e.id)) continue;
      const pv = { e, avatars: [], cart: null, camp: null, x: 0, z: 0 };
      for (const id of e.team) {
        const c = g.chainer(id);
        if (!c) continue;
        const av = new Avatar(eng, c);
        this.root.addChild(av.entity);
        pv.avatars.push({ av, c, yaw: 0 });
      }
      const V = TRANSPORT[e.transport];
      if (V && V.model && eng.hasModel(V.model)) { pv.cart = eng.model(V.model, { batch: false }); this.root.addChild(pv.cart); }
      if (eng.hasModel('party_camp')) { pv.camp = eng.model('party_camp', { batch: false }); pv.camp.enabled = false; this.root.addChild(pv.camp); }
      this.parties.set(e.id, pv);
      this._placeParty(pv, 0, 0);
    }
  }
  _placeParty(pv, dt, t) {
    const g = this.game, e = pv.e, ph = g.expPhase(e);
    const T = POI_TYPES[e.poi.type], A = ACTIVITIES[T.act];
    const pt = pointOn(e.poi.site, ph.along), wp = this.w(pt.x, pt.z);
    let hx = pt.dx, hz = pt.dz;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    if (ph.phase === 'back') { hx = -hx; hz = -hz; }
    pv.x = wp.x; pv.z = wp.z; pv.phase = ph.phase;
    const n = pv.avatars.length, site = this.sitePos(e.poi.site);
    pv.avatars.forEach((m, i) => {
      let x, z, yaw, anim, tool = null;
      if (ph.phase === 'work') {
        // spread around the set piece, facing it, tools out
        const a = (i / Math.max(1, n)) * Math.PI * 1.3 + 0.9;
        x = site.x + Math.sin(a) * 2.5; z = site.z + Math.cos(a) * 2.5;
        yaw = Math.atan2(site.x - x, site.z - z) * 180 / Math.PI;
        anim = 'work'; tool = A.tool;
      } else if (ph.phase === 'home') {
        x = this.gatePos.x + (i - (n - 1) / 2) * 1.2; z = this.gatePos.z - 1.6;
        yaw = 0; anim = Math.floor(t / 2 + i) % 3 === 0 ? 'cheer' : 'idle';
      } else {
        // single file with a little side step, the leader on the point of the trail
        const back = i * 1.25, side = (i % 2 ? 0.45 : -0.45) * (i ? 1 : 0);
        x = wp.x - hx * back + hz * side; z = wp.z - hz * back - hx * side;
        yaw = Math.atan2(hx, hz) * 180 / Math.PI;
        anim = ph.phase === 'back' && m.av.clips.has('carry') ? 'carry' : 'walk';
      }
      const dy = ((yaw - m.yaw + 540) % 360) - 180;
      m.yaw += dt > 0 ? dy * Math.min(1, dt * 8) : dy;
      m.av.entity.setLocalPosition(x, 0, z);
      m.av.entity.setLocalEulerAngles(0, m.yaw, 0);
      m.av.play(anim);
      m.av.setTool(tool);
    });
    if (pv.cart) {
      const walking = ph.phase === 'out' || ph.phase === 'back';
      const back = n * 1.25 + 1.4;
      const x = walking ? wp.x - hx * back : ph.phase === 'work' ? site.x - 3.2 : this.gatePos.x + 2.6;
      const z = walking ? wp.z - hz * back : ph.phase === 'work' ? site.z + 2.2 : this.gatePos.z - 2.2;
      pv.cart.setLocalPosition(x, 0, z);
      pv.cart.setLocalEulerAngles(0, walking ? Math.atan2(hx, hz) * 180 / Math.PI : 150, 0);
    }
    // the place is alive while they work: chips fly at a grove, pebbles at a quarry, dust in a fight
    if (ph.phase === 'work' && dt > 0 && this.active) {
      pv.fxT = (pv.fxT || 0) - dt;
      if (pv.fxT <= 0) {
        pv.fxT = 0.9 + Math.random() * 0.8;
        const kind = { lumber: 'chips', mining: 'pebbles', forage: 'leaves', fight: 'dust', explore: 'sparkle', craft: 'chips' }[T.act] || 'dust';
        const fxx = this.origin.x + site.x + (Math.random() - 0.5) * 2, fxz = this.origin.z + site.z + 1.6;
        if (kind === 'chips' || kind === 'pebbles') this.fx.chop(kind, fxx, 1.1, fxz);
        else if (kind === 'dust') this.fx.burst('dust', fxx, 0.5, fxz, 9, 1.3, { shape: 'ring', radius: 0.4, up: 1.6 });
        else this.fx.burst(kind, fxx, 1.1, fxz, 5, 1, { shape: 'fountain', angle: 40 });
      }
    }
    if (pv.camp) {
      const on = ph.phase === 'work';
      if (pv.camp.enabled !== on) pv.camp.enabled = on;
      if (on) pv.camp.setLocalPosition(site.x + 2.6, 0, site.z + 2.4);
    }
  }
  /** Mark the trail from the gate to a site with a row of dots (null clears it). */
  showRoute(siteId) {
    if (this._routeSite === siteId) return;
    this._routeSite = siteId;
    if (this._route) { this._route.destroy(); this._route = null; }
    if (siteId === null || siteId === undefined) return;
    const node = ent('route');
    this.root.addChild(node);
    this._route = node;
    const mat = this.engine.flatMaterial('#343c6d', { emissive: '#4d5a8c', intensity: 0.9 });
    const n = Math.max(8, Math.round(pathTo(siteId).length * 7));
    for (let i = 1; i < n; i++) {
      const pt = pointOn(siteId, i / n), p = this.w(pt.x, pt.z);
      const d = ent('dot');
      d.addComponent('render', { type: 'cylinder', material: mat, castShadows: false, receiveShadows: false });
      d.setLocalScale(0.5, 0.06, 0.5);
      d.setLocalPosition(p.x, 0.09, p.z);
      node.addChild(d);
    }
  }
  /** World position of a party (for effects and the camera), or null. */
  partyPos(eid) { const pv = this.parties.get(eid); if (!pv) return null; return { x: this.origin.x + pv.x, y: this.origin.y, z: this.origin.z + pv.z }; }
  poiPos(pid) { const pv = this.pois.get(pid); if (!pv) return null; const p = pv.node.getLocalPosition(); return { x: this.origin.x + p.x, y: this.origin.y, z: this.origin.z + p.z }; }

  // ------------------------------------------------------------------------------------------
  show() {
    this.active = true;
    this.engine.setCameraHome(this.origin, FRONTIER.size * TILE / 2 - 4, 66, false);
    // start on the near half: the gate and the woods
    const p = this.w(FRONTIER.gate.x, FRONTIER.gate.z - 9);
    this.engine.focus(this.origin.x + p.x, this.origin.z + p.z, 66);
  }
  hide() { this.active = false; }
  focusPoi(pid, dist = 46) { const p = this.poiPos(pid); if (p) this.engine.focus(p.x, p.z, dist); }
  focusParty(eid, dist = 40) { const p = this.partyPos(eid); if (p) this.engine.focus(p.x, p.z, dist); }
  focusZone(rid) { const c = ZONE_GEO[rid].c, p = this.w(c[0], c[1]); this.engine.focus(this.origin.x + p.x, this.origin.z + p.z, 62); }

  /** Tap on the map: a place or a party under the pointer. */
  pick(sx, sy) {
    const eng = this.engine;
    let best = null, bd = 56;
    for (const [id, pv] of this.parties) {
      const p = eng.toScreen(this.origin.x + pv.x, 1.3, this.origin.z + pv.z);
      if (!p) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = { type: 'party', id }; }
    }
    if (best) return best;
    bd = 70;
    for (const [id, pv] of this.pois) {
      const lp = pv.node.getLocalPosition(), p = eng.toScreen(this.origin.x + lp.x, 1.6, this.origin.z + lp.z);
      if (!p) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = { type: 'poi', id }; }
    }
    return best;
  }

  markers() {
    const out = this._markers; out.length = 0;
    if (!this.active) return out;
    const g = this.game, now = g.now(), o = this.origin;
    const busy = new Map(g.s.expeditions.map((e) => [e.poi.id, e]));
    for (const pv of this.pois.values()) {
      if (busy.has(pv.poi.id)) continue;
      const p = pv.node.getLocalPosition();
      const reg = REGIONS.find((r) => r.id === pv.poi.region);
      out.push({ key: 'poi' + pv.poi.id, kind: 'poi', x: o.x + p.x, y: 4.8, z: o.z + p.z, poi: pv.poi, id: pv.poi.id, locked: !g.regionOpen(reg), left: pv.poi.expires - now });
    }
    for (const [id, pv] of this.parties) {
      const ph = g.expPhase(pv.e, now);
      out.push({ key: 'party' + id, kind: 'party', x: o.x + pv.x, y: 3.5, z: o.z + pv.z, exp: pv.e, id, phase: ph.phase, p: ph.p, left: ph.left });
    }
    out.push({ key: 'home', kind: 'action', x: o.x + this.gatePos.x, y: 5.2, z: o.z + this.gatePos.z, icon: 'home_1', act: 'home', id: 'home', small: true, label: 'Homestead' });
    for (const reg of REGIONS) {
      const c = ZONE_GEO[reg.id].c, p = this.w(c[0], c[1]);
      out.push({ key: 'zone' + reg.id, kind: 'zone', x: o.x + p.x, y: 0.4, z: o.z + p.z, reg, open: g.regionOpen(reg) });
    }
    return out;
  }

  update(dt, t) {
    if (!this.active) return;
    this.engine.animate(this.anim, dt, t);
    for (const pv of this.pois.values()) this.engine.animate(pv.anim, dt, t);
    for (const pv of this.parties.values()) this._placeParty(pv, dt, t);
    // glints on open water near the camera (a few a second; ice only winks now and then)
    const W = this._water, nW = W.length >> 1;
    if (nW) {
      const r = this.engine.rig, o = this.origin, reach = r.curDist * 0.75, ice = this.engine.seasons && this.engine.seasons.def.water === 'ice';
      for (let k = Math.random() < dt * nW * (ice ? 0.06 : 0.3) ? 3 : 0; k > 0; k--) {
        const i = ((Math.random() * nW) | 0) * 2, x = o.x + W[i] + (Math.random() - 0.5) * TILE * 0.8, z = o.z + W[i + 1] + (Math.random() - 0.5) * TILE * 0.8;
        if (Math.abs(x - r.cur.x) < reach && Math.abs(z - r.cur.z) < reach) this.fx.burst('glint', x, o.y + 0.07, z, 1, 1, { zoom: 0.5 });
      }
    }
  }
}
