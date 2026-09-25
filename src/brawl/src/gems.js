// Pickups: faceted purple gems that pop out of the mine (Gem Grab) and glowing green power cubes
// that break out of power boxes (Showdown). They arc, bounce, bob and sparkle until a brawler
// walks over them; a knocked-out brawler spills everything it carried.
import { chamferBoxes } from './props.js';

const pc = window.pc;
const G = 16;

function gemMesh(device) {
  // elongated octahedron with a bevel ring: 8 upper + 8 lower facets
  const pos = [], nrm = [], idx = [];
  const N = 6, R = 0.13, top = 0.24, mid = 0.0, bot = -0.2;
  const tri = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c); nrm.push(...n, ...n, ...n); idx.push(i, i + 1, i + 2);
  };
  const ring = [];
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; ring.push([Math.cos(a) * R, mid, Math.sin(a) * R]); }
  const inner = ring.map(([x, y, z]) => [x * 0.55, top - 0.05, z * 0.55]);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(ring[i], inner[i], inner[j]); tri(ring[i], inner[j], ring[j]);
    tri(inner[i], [0, top, 0], inner[j]);
    tri(ring[i], ring[j], [0, bot, 0]);
  }
  const m = new pc.Mesh(device);
  m.setPositions(pos); m.setNormals(nrm); m.setIndices(idx);
  m.update();
  return m;
}

export class Gems {
  constructor(app, arena, bfx, sfx) {
    this.app = app;
    this.arena = arena;
    this.bfx = bfx;
    this.sfx = sfx;
    this.list = [];
    this.root = new pc.Entity('Gems');
    app.root.addChild(this.root);
    this.mesh = gemMesh(app.graphicsDevice);
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(0.62, 0.28, 1);
    m.emissive = new pc.Color(0.5, 0.18, 0.95);
    m.emissiveIntensity = 0.85;
    m.useMetalness = true; m.metalness = 0.15; m.gloss = 0.9;
    m.update();
    this.mat = m;
    const cm = new pc.StandardMaterial();
    cm.diffuse = new pc.Color(0.3, 0.95, 0.35);
    cm.emissive = new pc.Color(0.22, 0.9, 0.28);
    cm.emissiveIntensity = 0.9;
    cm.useMetalness = true; cm.metalness = 0.1; cm.gloss = 0.8;
    cm.update();
    this.cubeMat = cm;
    this.cubeMesh = chamferBoxes(app.graphicsDevice, [
      { c: [0, 0, 0], s: [0.26, 0.26, 0.26], b: 0.04, tint: [1, 1, 1] },
    ]);
    this.pools = { gem: [], cube: [] };
    this.pool = this.pools.gem;
    this.time = 0;
    this.onPickup = null;     // (unit, gem)
  }

  _entity(kind) {
    let e = this.pools[kind].pop();
    if (!e) {
      e = new pc.Entity(kind === 'cube' ? 'PowerCube' : 'Gem');
      const mi = kind === 'cube' ? new pc.MeshInstance(this.cubeMesh, this.cubeMat) : new pc.MeshInstance(this.mesh, this.mat);
      e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: false });
      const k = kind === 'cube' ? 1.5 : 1.75;
      e.setLocalScale(k, k, k);
      this.root.addChild(e);
    }
    e.enabled = true;
    return e;
  }

  // launch a pickup from (x, z) with a horizontal velocity; it arcs, bounces and settles
  spawn(x, z, vx, vz, vy = 5.5, y = 0.5, kind = 'gem') {
    const g = { kind, x, y, z, vx, vy, vz, air: true, t: 0, e: this._entity(kind), phase: Math.random() * 6, glow: null, sparkT: Math.random() };
    g.glow = this.bfx.gemGlow(new pc.Vec3(x, y, z), kind);
    this.list.push(g);
    return g;
  }

  fromMine() {
    const m = this.arena.mine;
    const a = Math.random() * Math.PI * 2, s = 1.3 + Math.random() * 1.4;
    this.spawn(m.x, m.z, Math.cos(a) * s, Math.sin(a) * s, 6.5, 0.2);
    this.bfx.minePop(m);
    if (this.onPop) this.onPop(m);
  }

  // spill n pickups around a knocked-out carrier (or a broken power box)
  spill(x, z, n, kind = 'gem') {
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.6, s = (n === 1 ? 0.4 : 1.2) + Math.random() * 1.8;
      this.spawn(x, z, Math.cos(a) * s, Math.sin(a) * s, 5 + Math.random() * 2, 0.9, kind);
    }
  }

  clear() {
    for (const g of this.list) this._free(g);
    this.list.length = 0;
  }

  _free(g) {
    g.e.enabled = false;
    this.pools[g.kind].push(g.e);
    if (g.glow) g.glow.t = g.glow.life;
  }

  count() { return this.list.length; }

  update(dt, units) {
    this.time += dt;
    const A = this.arena;
    const p = { x: 0, z: 0 };
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.t += dt;
      if (g.air) {
        g.vy -= G * dt;
        const ox = g.x, oz = g.z;
        g.x += g.vx * dt; g.z += g.vz * dt; g.y += g.vy * dt;
        p.x = g.x; p.z = g.z;
        if (A.resolveCircle(p, 0.18)) {                // hit a wall or the edge: drop straight down
          g.x = p.x; g.z = p.z; g.vx *= -0.25; g.vz *= -0.25;
        }
        const ground = A.typeAt(g.x, g.z) === 4 ? -0.1 : 0.35;   // water: sink a little, still collectable
        void ox; void oz;
        if (g.y <= ground && g.vy < 0) {
          if (Math.abs(g.vy) > 2.5) { g.vy = -g.vy * 0.35; g.vx *= 0.5; g.vz *= 0.5; }
          else { g.y = ground; g.air = false; g.vx = g.vz = g.vy = 0; }
        }
      }
      const bob = g.air ? 0 : Math.sin(this.time * 3 + g.phase) * 0.07;
      const y = (g.air ? g.y : 0.52) + bob;
      g.e.setPosition(g.x, y, g.z);
      g.e.setEulerAngles(0, (this.time * 90 + g.phase * 50) % 360, 0);
      if (g.glow) g.glow.pos.set(g.x, y, g.z);
      g.sparkT -= dt;
      if (g.sparkT <= 0) { g.sparkT = 0.35 + Math.random() * 0.5; this.bfx.sparkle(new pc.Vec3(g.x, y, g.z), g.kind); }
      // pickup
      if (g.t < 0.35) continue;
      for (const u of units) {
        if (!u.alive) continue;
        const dx = u.pos.x - g.x, dz = u.pos.z - g.z;
        if (dx * dx + dz * dz < 0.95 * 0.95) {
          this.bfx.gemPickup(new pc.Vec3(g.x, y, g.z), g.kind);
          if (this.onPickup) this.onPickup(u, g);
          this._free(g);
          this.list.splice(i, 1);
          break;
        }
      }
    }
  }
}
