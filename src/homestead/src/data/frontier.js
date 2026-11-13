// The frontier: one big stretch of wild land beyond your gate. Rules and the 3D map share this geometry:
// four zones around their hubs, fixed sites where places of interest can appear, and the trails to them.
// Everything is in frontier tiles (x to the right, z towards the camera); the gate is on the near edge.
import { TILE } from './config.js';
import { mulberry32 } from '../core/util.js';

export const FRONTIER = {
  size: 46,                 // tiles across (92 m)
  margin: 4,                // forest floor around the playable square
  origin: [-1400, 0, -1400],
  gate: { x: 23, z: 44.4 },
};
// hubs: where each zone's trail forks. The woods lie between the gate and everything else.
export const ZONE_GEO = {
  woods:   { c: [23, 33], sites: 9 },
  ridge:   { c: [37, 16], sites: 7 },
  ruins:   { c: [9, 17],  sites: 7 },
  outpost: { c: [23, 7.5], sites: 7 },
};
export const ZONE_ORDER = ['woods', 'ridge', 'ruins', 'outpost'];

export function zoneAt(x, z) {
  let best = 'woods', bd = 1e9;
  for (const id of ZONE_ORDER) {
    const c = ZONE_GEO[id].c;
    const d = Math.hypot(x - c[0], z - c[1]) * (id === 'woods' ? 0.9 : 1);      // the woods reach a little further
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// ---- sites: fixed, the same for every player ---------------------------------------------------
function makeSites() {
  const r = mulberry32(90210), out = [], S = FRONTIER.size;
  for (const zone of ZONE_ORDER) {
    const want = ZONE_GEO[zone].sites, hub = ZONE_GEO[zone].c;
    let made = 0;
    for (let tries = 0; tries < 4000 && made < want; tries++) {
      const x = 3.5 + r() * (S - 7), z = 3.5 + r() * (S - 8.5);
      if (zoneAt(x, z) !== zone) continue;
      if (Math.hypot(x - hub[0], z - hub[1]) < 4.2) continue;                     // keep the fork itself clear
      if (Math.hypot(x - FRONTIER.gate.x, z - FRONTIER.gate.z) < 7) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 5.7)) continue;
      // not right on a zone border: the place should clearly belong to its zone
      if ([[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([dx, dz]) => zoneAt(x + dx, z + dz) !== zone)) continue;
      out.push({ id: out.length, zone, x: +x.toFixed(2), z: +z.toFixed(2) });
      made++;
    }
  }
  return out;
}
export const SITES = makeSites();

// ---- trails ------------------------------------------------------------------------------------
const mid = (a, b, bend, k) => ({ x: (a.x + b.x) / 2 + (b.z - a.z) * bend * k, z: (a.z + b.z) / 2 - (b.x - a.x) * bend * k });
/** Way-points (tiles) from the gate to a site: gate -> woods fork -> zone fork -> the place. Gently bent. */
export function pathTo(siteId) {
  const s = SITES[siteId];
  const gate = FRONTIER.gate, wh = { x: ZONE_GEO.woods.c[0], z: ZONE_GEO.woods.c[1] };
  const pts = [gate, mid(gate, wh, 0.12, 1), wh];
  if (s.zone !== 'woods') {
    const zh = { x: ZONE_GEO[s.zone].c[0], z: ZONE_GEO[s.zone].c[1] };
    pts.push(mid(wh, zh, 0.1, s.zone === 'ruins' ? -1 : 1), zh);
  }
  const last = pts[pts.length - 1];
  pts.push(mid(last, s, 0.14, siteId % 2 ? 1 : -1), { x: s.x, z: s.z });
  return pts;
}
const LEN = new Map();
/** Trail length in metres. */
export function pathLen(siteId) {
  if (LEN.has(siteId)) return LEN.get(siteId);
  const p = pathTo(siteId);
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  d *= TILE;
  LEN.set(siteId, d);
  return d;
}
/** Position (tiles) and heading at fraction t of the trail (0 = gate, 1 = the place). */
export function pointOn(siteId, t) {
  const p = pathTo(siteId);
  const seg = [];
  let tot = 0;
  for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); seg.push(l); tot += l; }
  let d = Math.min(1, Math.max(0, t)) * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0, a = p[i], b = p[i + 1];
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, dx: b.x - a.x, dz: b.z - a.z };
    }
    d -= seg[i];
  }
  return { x: p[0].x, z: p[0].z, dx: 0, dz: -1 };
}
/** Tiles covered by any trail (for painting them on the ground). */
export function trailTiles() {
  const set = new Set();
  for (const s of SITES) {
    const p = pathTo(s.id);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
      for (let k = 0; k <= n; k++) set.add(Math.floor(a.x + (b.x - a.x) * k / n) + ',' + Math.floor(a.z + (b.z - a.z) * k / n));
    }
  }
  return set;
}
// ---- water: a few places sit by a pond. Fishing piers and flooded gardens only turn up there ----
const WATER_PICK = { woods: [1, 4, 7], ruins: [0, 3, 5] };       // which of a zone's sites (by order) have a pond
const POND_DIRS = [[-1, 0], [-0.82, 0.57], [-0.82, -0.57]];      // the pond lies on the far-left side, as the camera sees it
const hash = (x, z) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
function makePonds() {
  const trail = trailTiles(), tiles = new Set(), S = FRONTIER.size;
  for (const zone of Object.keys(WATER_PICK)) {
    const zs = SITES.filter((s) => s.zone === zone);
    for (const i of WATER_PICK[zone]) {
      const s = zs[i];
      if (!s) continue;
      let best = null;
      for (const [dx, dz] of POND_DIRS) {
        const cx = s.x + dx * 2.1, cz = s.z + dz * 2.1, set = [];
        let bad = 0;
        for (let x = Math.floor(cx - 4); x <= cx + 4; x++) for (let z = Math.floor(cz - 4); z <= cz + 4; z++) {
          if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > 2.3 + (hash(x, z) - 0.5) * 0.9) continue;
          if (x < 2 || z < 2 || x >= S - 2 || z >= S - 2) { bad += 2; continue; }
          if (trail.has(x + ',' + z)) { bad += 1; continue; }
          if (SITES.some((o) => o !== s && Math.hypot(o.x - x - 0.5, o.z - z - 0.5) < 2.6)) { bad += 2; continue; }
          set.push(x + ',' + z);
        }
        if (!best || bad < best.bad) best = { bad, set, dx, dz };
      }
      s.water = true;
      s.pond = [best.dx, best.dz];                                 // which way the water lies from the place
      for (const k of best.set) tiles.add(k);
    }
  }
  return tiles;
}
/** Tiles under the ponds beside the water sites ("x,z"). */
export const POND_TILES = makePonds();

/** Frontier tile -> metres from the centre of the map. */
export const toWorld = (x, z) => ({ x: (x - FRONTIER.size / 2) * TILE, z: (z - FRONTIER.size / 2) * TILE });
