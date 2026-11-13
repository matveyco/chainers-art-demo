// Terrain of a location: one pixel-art ground canvas (the look of the Chainers Farm yard: a calm base, ground
// kinds meeting along soft wobbling borders with a ragged pixel fringe, dark trodden strips and wheel ruts,
// big fallen leaves; art/TEXTURE_DIRECTION.md) set in open land that runs to the horizon: the same forest floor carries on
// far beyond the canvas, a low-detail forest stands on it, and distance haze closes the view. No edges.
import { pc, ent } from './engine.js';
import { TILE } from '../data/config.js';
import { mulberry32 } from '../core/util.js';

const TEX_M = 4;        // ground textures: one 64px tile covers 4 m
const OUTER = 760;      // metres of forest floor around the canvas (the haze hides its end)
const FAR = ['tree_far_a', 'tree_far_b', 'tree_far_c', 'forest_clump_a', 'forest_clump_b'];
const FAR_FALLBACK = ['tree_a', 'tree_b', 'tree_c', 'tree_pine'];
const PPT = 32;         // ground pixels per tile (16 px per metre, like the reference ground)
const FRINGE = 0.42;    // how far (in share of a tile's pull) the ragged pixel fringe reaches across a border: about 6 px
const RUT_AT = 0.44, RUT_W = 0.021;      // the twin ruts of a trail: 7 px either side of its middle, 3 px wide
const WORN_AT = 0.63;   // how much of the open earth is trodden dark (higher = less)
const WORN = '#6e645e';                  // the dark packed earth under the ochre (reference: ruts and worn yard)
// Big fallen leaves, painted into the ground at 16 px per metre. a = leaf, b = its lit half, c = stem.
const LEAF_SHAPES = [
  ['...a..a...', '.a.aa.aa.a', '.aaaaaaaaa', 'aaaabbaaa.', '.aabbbbaaa', 'aaabbbbba.', '.aaabbbaa.', '..a.abb...', '......c...'],
  ['..a..a..', 'a.aa.aa.', 'aaaaaaaa', '.aabbaa.', 'aaabbbaa', '.aabbaa.', '.a.ab...', '....c...'],
  ['.a..a..', 'aaa.aa.', 'aaabbaa', '.abbba.', 'aaabaa.', '.a.c...'],
  ['.aa.', 'aaba', '.abc'],
  ['aa', 'ab'],
];
// (stored as albedo: the warm sun turns these into the reference's oranges, see tools/process_textures4.py)
const FALLEN = { amount: 1, colors: [['#af7529', '#c5913a'], ['#a06129', '#b67835'], ['#bfa136', '#d7b846'], ['#856349', '#9a724e']] };
const LEAF_DENSITY = [0.1, 0.42, 0.07, 0.03, 0.03, 0, 0];      // per ground kind, in the order of KIND_TEX
const KIND_TEX = { dirt: 'dirt', floor: 'floor', grass: 'grass', sand: 'sand', stone: 'rock', soil: 'soil', water: 'floor' };

function texMat(engine, texName, opts = {}) {
  const m = new pc.StandardMaterial();
  const t = engine.tex(texName);
  if (t) m.diffuseMap = t;
  m.diffuse = new pc.Color().fromString(opts.tint || '#ffffff');
  m.diffuseVertexColor = !!opts.vertexColor;
  m.gloss = opts.gloss ?? 0.05; m.useMetalness = true; m.metalness = 0;
  if (opts.tiling) m.diffuseMapTiling = new pc.Vec2(opts.tiling[0], opts.tiling[1]);
  if (opts.emissive) { m.emissive = new pc.Color().fromString(opts.emissive); m.emissiveIntensity = opts.intensity ?? 0.2; }
  m.update();
  return m;
}

const hash2 = (x, z, s) => {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 362437)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

const PIX = new Map();
/** 64x64 RGBA pixels of a loaded texture. */
function pixelsOf(engine, name) {
  if (PIX.has(name)) return PIX.get(name);
  const t = engine.tex(name);
  let data = null;
  if (t) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d', { willReadFrequently: true });
    try { g.drawImage(t.getSource(), 0, 0, 64, 64); data = g.getImageData(0, 0, 64, 64).data; } catch (e) { data = null; }
  }
  if (!data) { data = new Uint8ClampedArray(64 * 64 * 4); for (let i = 0; i < data.length; i += 4) { data[i] = 173; data[i + 1] = 116; data[i + 2] = 57; data[i + 3] = 255; } }
  PIX.set(name, data);
  return data;
}

export class Island {
  /** opts: grid (tiles), margin (tiles), origin (Vec3), cliff (m), seed */
  constructor(engine, opts) {
    this.engine = engine;
    this.grid = opts.grid; this.margin = opts.margin ?? 2; this.cliff = opts.cliff ?? 5;
    this.origin = opts.origin ? opts.origin.clone() : new pc.Vec3();
    this.seed = opts.seed ?? 1;
    this.root = ent('island');
    this.root.setPosition(this.origin);
    engine.app.root.addChild(this.root);
    const dev = engine.app.graphicsDevice;
    const T = this.grid + this.margin * 2;
    this.size = T * PPT;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size; this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.groundTex = new pc.Texture(dev, {
      width: this.size, height: this.size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, anisotropy: 8,
    });
    const gm = new pc.StandardMaterial();
    gm.diffuseMap = this.groundTex; gm.gloss = 0.03; gm.useMetalness = true; gm.metalness = 0;
    gm.update();
    this.groundMat = gm;
    engine.islands.add(this);
    const W = T * TILE, h = W / 2;
    const mesh = new pc.Mesh(dev);
    mesh.setPositions([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
    mesh.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
    mesh.setIndices(new Uint16Array([0, 2, 1, 0, 3, 2]));
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    this.groundMesh = mesh;
    const ground = ent('ground');
    ground.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, gm)], castShadows: false, receiveShadows: true });
    this.root.addChild(ground);
    this.mats = { water: texMat(engine, 'water', { gloss: 0.5, emissive: '#2a6590', intensity: 0.16 }) };
    this.waterNode = ent('water');
    this.root.addChild(this.waterNode);
    this.half = (this.grid / 2 + this.margin) * TILE;
    // the land beyond the canvas: one huge sheet of forest floor, just under the painted ground
    this.outerMat = texMat(engine, 'floor', { tiling: [OUTER / TEX_M, OUTER / TEX_M] });
    this._outerName = 'floor';
    const om = new pc.Mesh(dev), oh = OUTER / 2;
    om.setPositions([-oh, 0, -oh, oh, 0, -oh, oh, 0, oh, -oh, 0, oh]);
    om.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    om.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
    om.setIndices(new Uint16Array([0, 2, 1, 0, 3, 2]));
    om.update(pc.PRIMITIVE_TRIANGLES);
    const outer = ent('outer');
    outer.addComponent('render', { meshInstances: [new pc.MeshInstance(om, this.outerMat)], castShadows: false, receiveShadows: true });
    outer.setLocalPosition(0, -0.04, 0);
    this.root.addChild(outer);
    this._t = 0;
    engine.onUpdate((dt) => {
      if (!this.waterNode.render || this.frozen) return;
      this._t += dt;
      const w = this.mats.water;
      w.diffuseMapOffset = new pc.Vec2((this._t * 0.035) % 1, (this._t * 0.02) % 1);
      w.update();
    });
  }
  tileCenter(x, z, out = new pc.Vec3()) {
    out.set(this.origin.x + (x + 0.5 - this.grid / 2) * TILE, this.origin.y, this.origin.z + (z + 0.5 - this.grid / 2) * TILE);
    return out;
  }
  worldToTile(wx, wz) {
    return { x: Math.floor((wx - this.origin.x) / TILE + this.grid / 2), z: Math.floor((wz - this.origin.z) / TILE + this.grid / 2) };
  }

  /**
   * (Re)paint the ground. typeAt(x,z) -> 'dirt' | 'floor' | 'grass' | 'sand' | 'stone' | 'soil' | 'water';
   * shadeAt(x,z) -> [r,g,b] multiplier. Kinds are blended between tile centres, so a staircase of tiles
   * comes out as a soft diagonal and a lone tile as a round patch; only water keeps to its tiles.
   */
  rebuild(typeAt, shadeAt, fade = false) {
    const eng = this.engine, G = this.grid, M = this.margin, T = G + 2 * M, N = this.size, seed = this.seed;
    this._typeAt = typeAt; this._shadeAt = shadeAt;
    if (fade) this._beginFade();
    const season = eng.seasons ? eng.seasons.def : null;
    const map = (season && season.ground) || KIND_TEX;
    this._dressSeason(season, map);
    const names = Object.keys(KIND_TEX);
    const src = names.map((k) => pixelsOf(eng, eng.tex(map[k]) ? map[k] : KIND_TEX[k]));
    const kinds = new Uint8Array(T * T), shade = new Float32Array(T * T * 3);
    const water = [];
    for (let tz = 0; tz < T; tz++) for (let tx = 0; tx < T; tx++) {
      const k = typeAt(tx - M, tz - M) || 'floor';
      const i = tz * T + tx;
      kinds[i] = Math.max(0, names.indexOf(k));
      const s = shadeAt ? shadeAt(tx - M, tz - M) : null;
      shade[i * 3] = s ? s[0] : 1; shade[i * 3 + 1] = s ? s[1] : 1; shade[i * 3 + 2] = s ? s[2] : 1;
      if (k === 'water') water.push([tx - M, tz - M]);
    }
    // ---- smooth noise fields (value noise on coarse lattices, sampled per pixel) ----
    const field = (cell, s, extent = N) => {
      const n = Math.ceil(extent / cell) + 3, a = new Float32Array(n * n);
      for (let i = 0; i < a.length; i++) a[i] = hash2(i % n, (i / n) | 0, seed + s);
      return { a, n, cell };
    };
    const smp = (f, x, z) => {
      const fx = x / f.cell, fz = z / f.cell, ix = fx | 0, iz = fz | 0, n = f.n, a = f.a, i = iz * n + ix;
      let wx = fx - ix, wz = fz - iz;
      wx = wx * wx * (3 - 2 * wx); wz = wz * wz * (3 - 2 * wz);
      return a[i] + (a[i + 1] - a[i]) * wx + (a[i + n] - a[i]) * wz + (a[i] - a[i + 1] - a[i + n] + a[i + n + 1]) * wx * wz;
    };
    const drift = field(6 * PPT, 5);                               // broad light / dark drifts, 12 m across
    const wxA = field(44, 11), wzA = field(44, 12), wxB = field(13, 13), wzB = field(13, 14);      // border wobble
    const wornA = field(26, 15, N * 1.5), wornB = field(9, 16, N * 1.5), gate = field(40, 17);
    // ---- per-tile helpers: water never joins the soft borders (its sheet is cut to the tiles), and a blurred
    // ---- map of the trail tiles has a ridge along every trail: the ruts run a fixed step down from the crest
    const WATER = names.indexOf('water'), SAND = names.indexOf('sand'), DIRT = names.indexOf('dirt'), FLOOR = names.indexOf('floor');
    const land = new Uint8Array(T * T), sandF = new Float32Array(T * T);
    for (let i = 0; i < land.length; i++) land[i] = kinds[i] === WATER ? FLOOR : kinds[i];
    const isSand = (x, z) => (x >= 0 && z >= 0 && x < T && z < T && kinds[z * T + x] === SAND ? 1 : 0);
    for (let tz = 0; tz < T; tz++) for (let tx = 0; tx < T; tx++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += isSand(tx + i, tz + j) * (2 - Math.abs(i)) * (2 - Math.abs(j));
      sandF[tz * T + tx] = s / 16;
    }
    let shaded = false;
    for (let i = 0; i < shade.length; i++) if (shade[i] !== 1) { shaded = true; break; }
    // the dark packed earth that shows where the ground is worn (ruts, trodden patches): it keeps the grain of
    // the texture it replaces
    const wornHex = season ? season.worn : WORN, worn = wornHex ? new pc.Color().fromString(wornHex) : null;
    const mean = src.map((sp) => { let m = 0; for (let i = 0; i < sp.length; i += 4) m += sp[i] * 0.3 + sp[i + 1] * 0.59 + sp[i + 2] * 0.11; return m / (sp.length / 4); });
    const img = this.ctx.createImageData(N, N), out = img.data;
    const kmap = new Uint8Array(N * N), acc = new Float32Array(names.length);
    const lim = N - 1, tl = T - 1;
    for (let gz = 0; gz < N; gz++) {
      const tz0 = (gz / PPT) | 0;
      for (let gx = 0; gx < N; gx++) {
        const own = tz0 * T + ((gx / PPT) | 0), o = (gz * N + gx) * 4;
        const rim = Math.min(1, Math.min(gx, gz, lim - gx, lim - gz) / (2.5 * PPT));
        let k, sr = 1, sg = 1, sb = 1, rut = false;
        if (kinds[own] === WATER) {
          k = WATER; sr = shade[own * 3] * 0.62; sg = shade[own * 3 + 1] * 0.62; sb = shade[own * 3 + 2] * 0.62;
        } else {
          // where am I between the four nearest tile centres, after the wobble
          let px = gx + ((smp(wxA, gx, gz) - 0.5) * 22 + (smp(wxB, gx, gz) - 0.5) * 7) * rim;
          let pz = gz + ((smp(wzA, gx, gz) - 0.5) * 22 + (smp(wzB, gx, gz) - 0.5) * 7) * rim;
          px = px < 0 ? 0 : px > lim ? lim : px; pz = pz < 0 ? 0 : pz > lim ? lim : pz;
          const u = px / PPT - 0.5, v = pz / PPT - 0.5, fi = Math.floor(u), fj = Math.floor(v), fu = u - fi, fv = v - fj;
          const i0 = fi < 0 ? 0 : fi, i1 = fi + 1 > tl ? tl : fi + 1, j0 = fj < 0 ? 0 : fj, j1 = fj + 1 > tl ? tl : fj + 1;
          const t00 = j0 * T + i0, t10 = j0 * T + i1, t01 = j1 * T + i0, t11 = j1 * T + i1;
          const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
          const k00 = land[t00], k10 = land[t10], k01 = land[t01], k11 = land[t11];
          k = k00;
          if (k10 !== k00 || k01 !== k00 || k11 !== k00) {
            // the kind with the most weight wins; close to a border the runner-up breaks in, in 2 px chunks
            acc[k00] += w00; acc[k10] += w10; acc[k01] += w01; acc[k11] += w11;
            let best = -1, second = -1;
            for (let q = 0; q < 4; q++) {
              const kk = q === 0 ? k00 : q === 1 ? k10 : q === 2 ? k01 : k11;
              if (kk === best || kk === second) continue;
              if (best < 0 || acc[kk] > acc[best]) { second = best; best = kk; } else if (second < 0 || acc[kk] > acc[second]) second = kk;
            }
            k = best;
            const m = acc[best] - acc[second];
            if (m < FRINGE) { const p = 0.5 * Math.pow(1 - m / FRINGE, 1.6); if (hash2(gx >> 1, gz >> 1, seed) < p) k = second; }
            acc[k00] = 0; acc[k10] = 0; acc[k01] = 0; acc[k11] = 0;
          }
          if (shaded) {
            const a = t00 * 3, b = t10 * 3, c = t01 * 3, d = t11 * 3;
            sr = shade[a] * w00 + shade[b] * w10 + shade[c] * w01 + shade[d] * w11;
            sg = shade[a + 1] * w00 + shade[b + 1] * w10 + shade[c + 1] * w01 + shade[d + 1] * w11;
            sb = shade[a + 2] * w00 + shade[b + 2] * w10 + shade[c + 2] * w01 + shade[d + 2] * w11;
          }
          if (worn) {
            const cx = gx & ~1, cz = gz & ~1;
            if (k === SAND) {
              // twin ruts on a trail: ragged strips, with gaps
              const f = sandF[t00] * w00 + sandF[t10] * w10 + sandF[t01] * w01 + sandF[t11] * w11;
              rut = Math.abs(f - RUT_AT) < RUT_W && hash2(cx, cz, seed + 9) > 0.2 && smp(gate, gx, gz) > 0.4;
            } else if (k === DIRT) {
              // trodden strips across the yard, all leaning the same way like tracks
              const a = cx * 0.8 + cz * 0.6, b = cz * 0.8 - cx * 0.6 + N * 0.6;
              const n = smp(wornA, a / 3, b) + (smp(wornB, a / 2, b) - 0.5) * 0.22 + (hash2(cx, cz, seed + 8) - 0.5) * 0.07;
              rut = n * rim > WORN_AT;
            }
          }
        }
        kmap[gz * N + gx] = k;
        const sp = src[k], si = ((gz & 63) * 64 + (gx & 63)) * 4;
        const lv = 1 + (0.14 * smp(drift, gx, gz) - 0.07) * rim;
        if (rut) {
          const g = (sp[si] * 0.3 + sp[si + 1] * 0.59 + sp[si + 2] * 0.11) / mean[k] * 255 * lv;
          out[o] = worn.r * g * sr; out[o + 1] = worn.g * g * sg; out[o + 2] = worn.b * g * sb;
        } else {
          out[o] = sp[si] * sr * lv; out[o + 1] = sp[si + 1] * sg * lv; out[o + 2] = sp[si + 2] * sb * lv;
        }
        out[o + 3] = 255;
      }
    }
    // ---- big fallen leaves (petals, straw): drawn sprites, thick on the forest floor, thin on open ground ----
    const fallen = season ? season.fallen : FALLEN;
    if (fallen && fallen.colors.length) {
      const cols = fallen.colors.map((pair) => pair.map((h) => { const c = new pc.Color().fromString(h); return [c.r * 255, c.g * 255, c.b * 255]; }));
      const shapes = fallen.big === false ? LEAF_SHAPES.slice(2) : LEAF_SHAPES, cell = 11, cn = Math.floor(N / cell);
      for (let cz = 0; cz < cn; cz++) for (let cx = 0; cx < cn; cx++) {
        const x = cx * cell + ((hash2(cx, cz, seed + 22) * cell) | 0), z = cz * cell + ((hash2(cx, cz, seed + 23) * cell) | 0);
        const kk = kmap[z * N + x], rim = Math.min(1, Math.min(x, z, lim - x, lim - z) / (3 * PPT));
        if (hash2(cx, cz, seed + 21) >= LEAF_DENSITY[kk] * fallen.amount * rim) continue;
        const pick = hash2(cx, cz, seed + 24), sh = shapes[(pick * pick * shapes.length) | 0], turn = (hash2(cx, cz, seed + 25) * 8) | 0;
        const col = cols[(hash2(cx, cz, seed + 26) * cols.length) | 0], h = sh.length, w = sh[0].length;
        for (let pass = 0; pass < 2; pass++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const ch = sh[j][i];
          if (ch === '.') continue;
          // eight ways to lay the same leaf: mirror and quarter turns
          let dx = turn & 1 ? w - 1 - i : i, dz = turn & 2 ? h - 1 - j : j;
          if (turn & 4) { const t = dx; dx = dz; dz = t; }
          const qx = x + dx + (pass ? 0 : 1), qz = z + dz + (pass ? 0 : 1);
          if (qx < 0 || qz < 0 || qx > lim || qz > lim) continue;
          const q = qz * N + qx, qk = kmap[q];
          if (qk === WATER || LEAF_DENSITY[qk] === 0) continue;
          if (!pass) { out[q * 4] *= 0.8; out[q * 4 + 1] *= 0.8; out[q * 4 + 2] *= 0.82; continue; }      // its shadow, down-right
          const c = ch === 'b' ? col[1] : col[0], dk = ch === 'c' ? 0.62 : 1;
          out[q * 4] = c[0] * dk; out[q * 4 + 1] = c[1] * dk; out[q * 4 + 2] = c[2] * dk;
        }
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.groundTex.setSource(this.canvas);
    this.groundTex.upload();
    // water sits as a thin animated sheet just above its darkened bed
    if (this.waterNode.render) this.waterNode.removeComponent('render');
    if (water.length) {
      const p = [], n = [], uv = [], idx = [];
      // one unbroken sheet per pond: only the sides that meet land pull back, to leave a dark wet bank
      const wet = new Set(water.map(([x, z]) => x + ',' + z)), lip = 0.14;
      const bank = (x, z) => (wet.has(x + ',' + z) ? 0 : lip);
      for (const [x, z] of water) {
        const x0 = (x - G / 2) * TILE + bank(x - 1, z), z0 = (z - G / 2) * TILE + bank(x, z - 1);
        const x1 = (x - G / 2 + 1) * TILE - bank(x + 1, z), z1 = (z - G / 2 + 1) * TILE - bank(x, z + 1), b = p.length / 3;
        p.push(x0, 0.03, z0, x1, 0.03, z0, x1, 0.03, z1, x0, 0.03, z1);
        n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        uv.push(x0 / TEX_M, -z0 / TEX_M, x1 / TEX_M, -z0 / TEX_M, x1 / TEX_M, -z1 / TEX_M, x0 / TEX_M, -z1 / TEX_M);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const mesh = new pc.Mesh(eng.app.graphicsDevice);
      mesh.setPositions(p); mesh.setNormals(n); mesh.setUvs(0, uv); mesh.setIndices(new Uint16Array(idx));
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      this.waterNode.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.mats.water)], castShadows: false, receiveShadows: true });
    }
  }

  /** Paint the ground again with the current season's textures (same layout). */
  repaint(fade = false) { if (this._typeAt) this.rebuild(this._typeAt, this._shadeAt, fade); }
  /** Water <-> ice, and the rim around the island follows the season's ground. */
  _dressSeason(season, map) {
    const eng = this.engine, wname = (season && eng.tex(season.water)) ? season.water : 'water';
    if (this._waterName !== wname) {
      this._waterName = wname;
      this.frozen = wname === 'ice';
      const w = this.mats.water;
      w.diffuseMap = eng.tex(wname);
      w.diffuseMapOffset = new pc.Vec2(0, 0);
      w.emissive = new pc.Color().fromString(this.frozen ? '#9cc6e6' : '#2a6590');
      w.emissiveIntensity = this.frozen ? 0.1 : 0.16;
      w.gloss = this.frozen ? 0.7 : 0.5;
      w.update();
    }
    const floor = eng.tex(map.floor) ? map.floor : 'floor';
    if (this._outerName !== floor) {
      this._outerName = floor;
      this.outerMat.diffuseMap = eng.tex(floor);
      this.outerMat.update();
    }
  }
  /**
   * Low-detail forest on the land around the canvas, out to `radius` metres. clearAt(wx, wz) -> true keeps a
   * spot open (meadow on the camera side, trails). Static-batched: a handful of draw calls for a thousand trees.
   */
  forest(opts = {}) {
    const eng = this.engine, radius = opts.radius || 118, cell = opts.cell || 5.3;
    if (this._forest) this._forest.destroy();
    const node = ent('forest');
    this.root.addChild(node);
    this._forest = node;
    const names = FAR.filter((n) => eng.hasModel(n));
    const real = FAR_FALLBACK.filter((n) => eng.hasModel(n));
    const lod = names.length > 0, list = lod ? names : real;
    if (!list.length) return;
    const nearR = opts.near ?? (this.half + 13);       // inside this radius the forest is made of the real, detailed trees
    const r = mulberry32(this.seed * 131 + 17), inner = opts.inner || this.half - 0.5, n = Math.ceil(radius / cell);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const x = (i + 0.15 + r() * 0.7) * cell, z = (j + 0.15 + r() * 0.7) * cell;
      const roll = r(), pickR = r(), rot = r(), sc = r();
      if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;       // the canvas has its own, detailed dressing
      const d = Math.hypot(x, z);
      if (d > radius) continue;
      if (roll > (lod ? 0.86 : 0.4) - Math.max(0, d - radius * 0.7) / radius * 0.5) continue;
      if (opts.clearAt && opts.clearAt(x, z)) continue;
      const close = d < nearR && real.length > 0;
      if (close && roll > 0.7) continue;                                 // real trees are bigger: a few less of them fill the same ground
      const name = close ? real[Math.floor(pickR * real.length)] : list[Math.floor(pickR * list.length)];
      const m = eng.model(name, { castShadows: false, group: eng.farGroup });
      m.setLocalPosition(x, 0, z);
      m.setLocalEulerAngles(0, rot * 360, 0);
      const k = (close ? 1.15 : lod ? 1.1 : 0.8) + sc * 0.5;
      m.setLocalScale(k, k * (0.92 + sc * 0.2), k);
      node.addChild(m);
    }
  }
  /** Keep the old ground on a sheet just above the new one; setFade(1 -> 0) dissolves it. */
  _beginFade() {
    const dev = this.engine.app.graphicsDevice;
    if (!this.fadeTex) {
      this.fadeCanvas = document.createElement('canvas');
      this.fadeCanvas.width = this.size; this.fadeCanvas.height = this.size;
      this.fadeCtx = this.fadeCanvas.getContext('2d');
      this.fadeTex = new pc.Texture(dev, {
        width: this.size, height: this.size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, anisotropy: 8,
      });
      const fm = new pc.StandardMaterial();
      fm.diffuseMap = this.fadeTex; fm.gloss = 0.03; fm.useMetalness = true; fm.metalness = 0;
      fm.opacity = 0.99; fm.blendType = pc.BLEND_NORMAL; fm.depthWrite = false;
      fm.update();
      this.fadeMat = fm;
      const q = ent('ground_fade');
      q.addComponent('render', { meshInstances: [new pc.MeshInstance(this.groundMesh, fm)], castShadows: false, receiveShadows: true });
      q.setLocalPosition(0, 0.008, 0);
      this.root.addChild(q);
      this.fadeQuad = q;
    }
    this.fadeCtx.drawImage(this.canvas, 0, 0);
    this.fadeTex.setSource(this.fadeCanvas);
    this.fadeTex.upload();
    this.fadeQuad.enabled = true;
    this.fadeMat.opacity = 1; this.fadeMat.update();
  }
  setFade(a) {
    if (!this.fadeQuad || !this.fadeQuad.enabled) return;
    if (a <= 0.004) { this.fadeQuad.enabled = false; return; }
    // standard-material numbers live in the material's uniform block, so this goes through the property
    this.fadeMat.opacity = a; this.fadeMat.update();
  }
}
