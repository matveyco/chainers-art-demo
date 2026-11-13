// Terrain of a location: one pixel-art ground canvas with dithered borders between ground kinds (the look
// of the Chainers Farm yard) set in open land that runs to the horizon: the same forest floor carries on
// far beyond the canvas, a low-detail forest stands on it, and distance haze closes the view. No edges.
import { pc, ent } from './engine.js';
import { TILE } from '../data/config.js';
import { mulberry32 } from '../core/util.js';

const TEX_M = 4;        // ground textures: one 64px tile covers 4 m
const OUTER = 760;      // metres of forest floor around the canvas (the haze hides its end)
const FAR = ['tree_far_a', 'tree_far_b', 'tree_far_c', 'forest_clump_a', 'forest_clump_b'];
const FAR_FALLBACK = ['tree_a', 'tree_b', 'tree_c', 'tree_pine'];
const PPT = 32;         // ground pixels per tile (16 px per metre, like the reference ground)
const BAND = 10;        // width in pixels of the dithered fringe between two ground kinds
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
   * shadeAt(x,z) -> [r,g,b] multiplier. Neighbouring kinds meet in a ragged pixel-dither fringe.
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
      const dk = k === 'water' ? 0.62 : 1;
      shade[i * 3] = (s ? s[0] : 1) * dk; shade[i * 3 + 1] = (s ? s[1] : 1) * dk; shade[i * 3 + 2] = (s ? s[2] : 1) * dk;
      if (k === 'water') water.push([tx - M, tz - M]);
    }
    // broad light / dark drifts so large areas never look flat
    const L = 3 * PPT, LN = Math.ceil(N / L) + 2;
    const lat = new Float32Array(LN * LN);
    for (let i = 0; i < lat.length; i++) lat[i] = hash2(i % LN, (i / LN) | 0, seed + 5);
    const img = this.ctx.createImageData(N, N), out = img.data;
    const half = PPT / 2;
    for (let gz = 0; gz < N; gz++) {
      const tz = (gz / PPT) | 0, lz = gz % PPT;
      const dz = lz < half ? lz : PPT - 1 - lz, nz = lz < half ? tz - 1 : tz + 1;
      const fz = gz / L, iz = fz | 0, wz = fz - iz;
      for (let gx = 0; gx < N; gx++) {
        const tx = (gx / PPT) | 0, lx = gx % PPT;
        let ti = tz * T + tx;
        const k0 = kinds[ti];
        const dx = lx < half ? lx : PPT - 1 - lx, nx = lx < half ? tx - 1 : tx + 1;
        let cand = -1, d = BAND;
        if (dx < d && nx >= 0 && nx < T && kinds[tz * T + nx] !== k0) { cand = tz * T + nx; d = dx; }
        if (dz < d && nz >= 0 && nz < T && kinds[nz * T + tx] !== k0) { cand = nz * T + tx; d = dz; }
        if (cand < 0 && dx < BAND && dz < BAND && nx >= 0 && nx < T && nz >= 0 && nz < T && kinds[nz * T + nx] !== k0) { cand = nz * T + nx; d = Math.max(dx, dz); }
        if (cand >= 0) {
          // chunky 2px dither whose density falls off away from the border
          const p = 0.5 * Math.pow(1 - d / BAND, 1.25);
          if (hash2(gx >> 1, gz >> 1, seed) < p) ti = cand;
        }
        const sp = src[kinds[ti]];
        const si = ((gz & 63) * 64 + (gx & 63)) * 4;
        const fx = gx / L, ix = fx | 0, wx = fx - ix;
        const a = lat[iz * LN + ix], b = lat[iz * LN + ix + 1], c = lat[(iz + 1) * LN + ix], e = lat[(iz + 1) * LN + ix + 1];
        // drifts fade out toward the rim so the canvas meets the plain forest floor around it without a seam
        const rim = Math.min(1, Math.min(gx, gz, N - 1 - gx, N - 1 - gz) / (2.5 * PPT));
        const v = 1 + (0.2 * (a + (b - a) * wx + (c - a) * wz + (a - b - c + e) * wx * wz) - 0.1) * rim;
        const o = (gz * N + gx) * 4, s3 = ti * 3;
        out[o] = sp[si] * shade[s3] * v; out[o + 1] = sp[si + 1] * shade[s3 + 1] * v; out[o + 2] = sp[si + 2] * shade[s3 + 2] * v; out[o + 3] = 255;
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
