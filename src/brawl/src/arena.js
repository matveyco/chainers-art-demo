// Arena logic: the tile grid, collision against walls and water, grid ray casts for bullets and
// line of sight, bushes, breakable walls, and A* paths for the bots. Rendering lives in arenaview.js.
// World frame: the arena is centred on the origin, x to the right, z towards the camera (the
// blue base is at +z, the bottom of the screen). Tile (tx, tz) has its centre at
// (tx + 0.5 - W/2, tz + 0.5 - H/2).
import { MAP_QUADRANT } from './config.js';

export const T = { GROUND: 0, CRATE: 1, STONE: 2, BUSH: 3, WATER: 4, MINE: 5, BOX: 6 };
const CODE = { '.': T.GROUND, '#': T.CRATE, S: T.STONE, B: T.BUSH, W: T.WATER, M: T.MINE, P: T.BOX, 1: T.GROUND, 2: T.GROUND };

export function expandMap(q) {
  const rows = q.map((r) => r + r.slice(0, -1).split('').reverse().join(''));
  const all = rows.concat(rows.slice(0, -1).reverse());
  const mid = (all.length - 1) / 2;
  return all.map((r, z) => (z > mid ? r.replace(/2/g, '1') : r));
}

export class Arena {
  constructor(quadrant = MAP_QUADRANT, opts = {}) {
    this.boxHpMax = opts.boxHp || 1500;
    this.rows = expandMap(quadrant);
    this.H = this.rows.length;
    this.W = this.rows[0].length;
    this.grid = new Uint8Array(this.W * this.H);
    this.halfW = this.W / 2;
    this.halfH = this.H / 2;
    this.onBreak = null;                  // (tx, tz, type) when a wall is destroyed
    this.version = 0;                     // bumps when walls change (nav caches)
    this.reset();
  }

  // restore every wall (a new match)
  reset() {
    this.spawns = [[], []];                // [team][i] = {x, z}, left to right
    this.mine = null;
    this.boxHp = new Map();                // tile index -> health of a power box
    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const ch = this.rows[z][x];
        this.grid[z * this.W + x] = CODE[ch] ?? T.GROUND;
        const w = this.center(x, z);
        if (ch === '1') this.spawns[0].push(w);
        if (ch === '2') this.spawns[1].push(w);
        if (ch === 'M') this.mine = w;
        if (ch === 'P') this.boxHp.set(z * this.W + x, this.boxHpMax);
      }
    }
    this.version++;
  }

  center(tx, tz) { return { x: tx + 0.5 - this.W / 2, z: tz + 0.5 - this.H / 2 }; }
  tileX(x) { return Math.floor(x + this.W / 2); }
  tileZ(z) { return Math.floor(z + this.H / 2); }
  inside(tx, tz) { return tx >= 0 && tz >= 0 && tx < this.W && tz < this.H; }
  at(tx, tz) { return this.inside(tx, tz) ? this.grid[tz * this.W + tx] : -1; }
  typeAt(x, z) { return this.at(this.tileX(x), this.tileZ(z)); }

  blocksMove(tx, tz) {
    const t = this.at(tx, tz);
    return t < 0 || t === T.CRATE || t === T.STONE || t === T.WATER || t === T.BOX;
  }
  blocksShot(tx, tz) {
    const t = this.at(tx, tz);
    return t === T.CRATE || t === T.STONE || t === T.BOX;
  }
  isWall(tx, tz) { const t = this.at(tx, tz); return t === T.CRATE || t === T.STONE || t === T.BOX; }
  isBox(tx, tz) { return this.at(tx, tz) === T.BOX; }

  // shots and blasts wear power boxes down; returns true when the box breaks
  damageBox(tx, tz, amount) {
    const k = tz * this.W + tx;
    if (!this.isBox(tx, tz)) return false;
    const hp = (this.boxHp.get(k) ?? this.boxHpMax) - amount;
    this.boxHp.set(k, hp);
    if (hp > 0) return false;
    this.boxHp.delete(k);
    return this.breakWall(tx, tz);
  }
  boxHealth(tx, tz) { return (this.boxHp.get(tz * this.W + tx) ?? 0) / this.boxHpMax; }
  isBushAt(x, z) { return this.typeAt(x, z) === T.BUSH; }
  outOfBounds(x, z, margin = 0) { return Math.abs(x) > this.halfW + margin || Math.abs(z) > this.halfH + margin; }

  breakWall(tx, tz) {
    if (!this.isWall(tx, tz)) return false;
    const type = this.at(tx, tz);
    this.grid[tz * this.W + tx] = T.GROUND;
    this.boxHp.delete(tz * this.W + tx);
    this.version++;
    if (this.onBreak) this.onBreak(tx, tz, type);
    return true;
  }

  // ------------------------------------------------------------------ collision
  // Push a circle out of every blocking tile it overlaps (two passes settle corners).
  resolveCircle(p, r) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const x0 = this.tileX(p.x - r), x1 = this.tileX(p.x + r);
      const z0 = this.tileZ(p.z - r), z1 = this.tileZ(p.z + r);
      for (let tz = z0; tz <= z1; tz++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.blocksMove(tx, tz)) continue;
          const minX = tx - this.W / 2, minZ = tz - this.H / 2;
          const cx = Math.max(minX, Math.min(p.x, minX + 1));
          const cz = Math.max(minZ, Math.min(p.z, minZ + 1));
          let dx = p.x - cx, dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          hit = true;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2), push = r - d;
            p.x += (dx / d) * push; p.z += (dz / d) * push;
          } else {
            // centre inside the tile: leave through the nearest side
            const l = p.x - minX, rr = minX + 1 - p.x, t = p.z - minZ, b = minZ + 1 - p.z;
            const m = Math.min(l, rr, t, b);
            if (m === l) p.x = minX - r; else if (m === rr) p.x = minX + 1 + r;
            else if (m === t) p.z = minZ - r; else p.z = minZ + 1 + r;
          }
        }
      }
    }
    const lx = this.halfW - r, lz = this.halfH - r;
    if (p.x < -lx) { p.x = -lx; hit = true; } else if (p.x > lx) { p.x = lx; hit = true; }
    if (p.z < -lz) { p.z = -lz; hit = true; } else if (p.z > lz) { p.z = lz; hit = true; }
    return hit;
  }

  // Grid walk (Amanatides-Woo) from (ox, oz) along the unit direction (dx, dz). Returns the
  // distance to the first tile that stops bullets (or maxDist) and that tile.
  raycast(ox, oz, dx, dz, maxDist, blocks = (tx, tz) => this.blocksShot(tx, tz)) {
    let tx = this.tileX(ox), tz = this.tileZ(oz);
    const res = { dist: maxDist, tx: -1, tz: -1, nx: 0, nz: 0, hit: false };
    if (blocks(tx, tz)) { res.dist = 0; res.tx = tx; res.tz = tz; res.hit = true; return res; }
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const fx = ox + this.W / 2, fz = oz + this.H / 2;
    let tMaxX = dx !== 0 ? ((dx > 0 ? Math.floor(fx) + 1 - fx : fx - Math.floor(fx)) / Math.abs(dx)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? Math.floor(fz) + 1 - fz : fz - Math.floor(fz)) / Math.abs(dz)) : Infinity;
    const tDX = dx !== 0 ? 1 / Math.abs(dx) : Infinity, tDZ = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    let t = 0;
    for (let i = 0; i < 200; i++) {
      let nx = 0, nz = 0;
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; tx += stepX; nx = -stepX; }
      else { t = tMaxZ; tMaxZ += tDZ; tz += stepZ; nz = -stepZ; }
      if (t > maxDist) break;
      if (!this.inside(tx, tz)) break;
      if (blocks(tx, tz)) { res.dist = t; res.tx = tx; res.tz = tz; res.nx = nx; res.nz = nz; res.hit = true; return res; }
    }
    return res;
  }

  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    return !this.raycast(ax, az, dx / d, dz / d, d).hit;
  }

  // a body of radius r can walk the straight segment a -> b
  walkable(ax, az, bx, bz, r = 0.42) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const ux = dx / d, uz = dz / d, px = -uz * r, pz = ux * r;
    const blocks = (tx, tz) => this.blocksMove(tx, tz);
    for (const s of [0, 1, -1]) {
      if (this.raycast(ax + px * s, az + pz * s, ux, uz, d, blocks).hit) return false;
    }
    return true;
  }

  // nearest free (walkable, not water) spot around (x, z), searching outwards
  freeSpot(x, z, rng = Math.random) {
    for (let ring = 0; ring < 5; ring++) {
      const cands = [];
      const cx = this.tileX(x), cz = this.tileZ(z);
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (!this.blocksMove(cx + dx, cz + dz)) cands.push(this.center(cx + dx, cz + dz));
      }
      if (cands.length) return cands[Math.floor(rng() * cands.length)];
    }
    return { x, z };
  }

  // ------------------------------------------------------------------ navigation
  // A* over tiles, 8-connected without cutting corners; returns world waypoints (string-pulled).
  path(ax, az, bx, bz, r = 0.42) {
    const W = this.W, Hh = this.H;
    let sx = this.tileX(ax), sz = this.tileZ(az);
    let gx = this.tileX(bx), gz = this.tileZ(bz);
    if (this.blocksMove(gx, gz)) { const f = this.freeSpot(bx, bz, () => 0.5); gx = this.tileX(f.x); gz = this.tileZ(f.z); bx = f.x; bz = f.z; }
    if (this.blocksMove(sx, sz)) { const f = this.freeSpot(ax, az, () => 0.5); sx = this.tileX(f.x); sz = this.tileZ(f.z); }
    const N = W * Hh;
    const g = this._g || (this._g = new Float32Array(N));
    const came = this._came || (this._came = new Int32Array(N));
    const closed = this._closed || (this._closed = new Uint8Array(N));
    g.fill(Infinity); came.fill(-1); closed.fill(0);
    const start = sz * W + sx, goal = gz * W + gx;
    const open = [start];
    const f = new Map([[start, 0]]);
    g[start] = 0;
    const h = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    let found = false, guard = 0;
    while (open.length && guard++ < 4000) {
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) { const v = f.get(open[i]); if (v < bf) { bf = v; bi = i; } }
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (this.blocksMove(nx, nz)) continue;
        if (dx && dz && (this.blocksMove(cx + dx, cz) || this.blocksMove(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (closed[ni]) continue;
        // bushes cost a little extra so paths only use them when it helps
        const cost = (dx && dz ? 1.414 : 1) + (this.grid[ni] === T.BUSH ? 0.15 : 0);
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          if (g[ni] === Infinity) open.push(ni);
          g[ni] = ng; came[ni] = cur; f.set(ni, ng + h(ni));
        }
      }
    }
    if (!found) return null;
    const tiles = [];
    for (let i = goal; i !== -1 && i !== start; i = came[i]) tiles.push(i);
    tiles.reverse();
    const pts = tiles.map((i) => this.center(i % W, (i / W) | 0));
    if (pts.length) pts[pts.length - 1] = { x: bx, z: bz };
    // string pulling: skip waypoints that can be reached in a straight walk
    const out = [];
    let from = { x: ax, z: az };
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (this.walkable(from.x, from.z, pts[j].x, pts[j].z, r * 0.95)) { far = j; break; }
      }
      out.push(pts[far]);
      from = pts[far];
      k = far + 1;
    }
    return out;
  }
}
