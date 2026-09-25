// Arena rendering. The floor is one baked pixel-art texture (grass and packed sand mixed by a
// noise mask, a light checker per tile, contact shade at wall feet, wet sand round the ponds).
// Walls and bushes are chamfered voxel blocks merged per material; bushes sway in the wind,
// part around brawlers walking through them and turn see-through round the player.
import { chamferBoxes } from './props.js';
import { T } from './arena.js';

const pc = window.pc;
const PX = 64;                 // floor texels per metre (the source textures are 64 texels/m)
const Q = 16;                  // mask cells per metre (4x4 texel blocks: chunky pixel-art edges)

export const WALL_H = { crate: 1.02, stone: 1.16, border: 0.9 };

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth value noise in [0, 1]
function noise2(x, z, seed = 0) {
  const h = (i, j) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pixelsOf(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  return { w: src.width, h: src.height, d: g.getImageData(0, 0, src.width, src.height).data };
}

function stdMat(opts = {}) {
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = opts.gloss ?? 0.28;
  if (opts.map) { m.diffuseMap = opts.map; }
  if (opts.tint) m.diffuse = new pc.Color(...opts.tint); else m.diffuse = new pc.Color(1, 1, 1);
  if (opts.vertexColor) m.diffuseVertexColor = true;
  if (opts.emissive) { m.emissive = new pc.Color(...opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  if (opts.emissiveMap) { m.emissiveMap = opts.emissiveMap; m.emissive = new pc.Color(1, 1, 1); }
  m.update();
  return m;
}

// ------------------------------------------------------------------------------------------
// bush / canopy material: wind sway, brawlers part the leaves, see-through circle round the
// player (dithered, so it needs no sorting and keeps writing depth)
// ------------------------------------------------------------------------------------------
const WIND_VS = `
#ifdef PIXELSNAP
uniform vec4 uScreenSize;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
uniform float uTime;
uniform vec4 uPush[8];
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec3 localPos = getLocalPosition(vertexPosition);
	vec4 posW = modelMatrix * vec4(localPos, 1.0);
	float h = max(posW.y, 0.0);
	float k = h * h;
	posW.x += sin(uTime * 1.6 + posW.z * 0.8 + posW.x * 0.35) * 0.04 * k;
	posW.z += cos(uTime * 1.25 + posW.x * 0.7) * 0.03 * k;
	for (int i = 0; i < 8; i++) {
		vec4 p = uPush[i];
		if (p.w <= 0.0) continue;
		vec2 d = posW.xz - p.xy;
		float l = length(d);
		float f = (1.0 - smoothstep(0.0, p.z, l)) * p.w * h;
		posW.xz += (l > 1e-3 ? d / l : vec2(0.0)) * f * 0.28;
		posW.y -= f * 0.12;
	}
	return posW;
}
vec4 getPosition() {
	dModelMatrix = getModelMatrix();
	vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
	dPositionW = posW.xyz;
	return matrix_viewProjection * posW;
}
vec3 getWorldPosition() {
	return dPositionW;
}
`;

const SEE_PS = `
uniform float material_opacity;
uniform float material_alphaDitherScale;
uniform vec4 uSee;
float dSeeK;
void getOpacity() {
	float d = length(vPositionW.xz - uSee.xy);
	dSeeK = uSee.w * (1.0 - smoothstep(uSee.z * 0.5, uSee.z, d));
	// keep the lower leaves a little denser so the bush still reads as a bush
	dAlpha = 1.0 - dSeeK * mix(0.72, 1.0, smoothstep(0.1, 0.6, vPositionW.y));
}
`;
// Inside the see-through circle the leaves and the floor under them write a low scene alpha:
// the comic ink pass (toon.js) fades its lines by scene alpha, so it does not outline every
// dither dot (which turned the circle into a dark smudge in the Comic and Pixel styles).
const SEE_ALPHA_PS = `
	gl_FragColor.a = 1.0 - smoothstep(0.02, 0.2, dSeeK);
`;
const FLOOR_SEE_DECL = `
uniform vec4 uSee;
`;
const FLOOR_SEE_ALPHA_PS = `
	float floorSeeK = uSee.w * (1.0 - smoothstep(uSee.z * 0.5, uSee.z, length(vPositionW.xz - uSee.xy)));
	gl_FragColor.a = 1.0 - smoothstep(0.02, 0.2, floorSeeK);
`;

function foliageMaterial(map, seeThrough) {
  const m = stdMat({ map, gloss: 0.22 });
  const ch = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  ch.set('transformVS', WIND_VS);
  if (seeThrough) {
    ch.set('opacityPS', SEE_PS);
    ch.set('outputAlphaPS', SEE_ALPHA_PS);
    m.opacityDither = pc.DITHER_BAYER8;
    m.opacityShadowDither = pc.DITHER_NONE;
  }
  m.shaderChunksVersion = '2.8';
  m.setParameter('uTime', 0);
  m.setParameter('uPush[0]', new Float32Array(32));
  if (seeThrough) m.setParameter('uSee', [0, 0, 1.6, 0]);
  m.update();
  return m;
}

// ------------------------------------------------------------------------------------------
// water: unlit toon shader, pixel-quantised ripples, foam along the banks from a blurred mask
// ------------------------------------------------------------------------------------------
const WATER_VS = `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vW;
void main(void) {
	vec4 w = matrix_model * vec4(vertex_position, 1.0);
	vW = w.xyz;
	gl_Position = matrix_viewProjection * w;
}
`;
const WATER_FS = `
#include "gammaPS"
#include "tonemappingPS"
#include "fogPS"
uniform sampler2D uMask;
uniform vec4 uArena;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
varying vec3 vW;
void main(void) {
	vec2 q = floor(vW.xz * 16.0 + 0.5) / 16.0;          // 16 texels per metre, like the floor
	vec2 uv = (q + uArena.xy * 0.5) / uArena.xy;
	float m = texture2D(uMask, uv).r;                  // 1 deep inside, 0.5 on the bank line
	float depth = smoothstep(0.62, 0.98, m);
	vec3 col = mix(uShallow, uDeep, depth);
	float w1 = sin(q.x * 2.7 + uTime * 1.2) * sin(q.y * 2.1 - uTime * 0.9);
	float w2 = sin((q.x - q.y) * 3.9 + uTime * 1.7);
	float ripple = step(0.62, w1 * 0.55 + w2 * 0.45);
	col = mix(col, uShallow * 1.35 + 0.04, ripple * 0.55);
	float band = 0.62 + 0.035 * sin(uTime * 2.2 + (q.x + q.y) * 5.0);
	float foam = 1.0 - step(band, m);
	col = mix(col, uFoam, foam);
	col = addFog(col);
	col = toneMap(col);
	col = gammaCorrectOutput(col);
	// mostly opaque; thinner near the banks so the pond floor and walls show through
	float a = mix(0.62, 0.9, depth) + foam * 0.1;
	gl_FragColor = vec4(col * a, a);
}
`;

// ------------------------------------------------------------------------------------------
// mesh helpers
// ------------------------------------------------------------------------------------------
function meshEntity(parent, name, mesh, material, cast = true, receive = true) {
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: cast, receiveShadows: receive });
  parent.addChild(e);
  return e;
}

function quadMesh(device, quads) {
  // quads: [{p:[[x,y,z] x4], n:[x,y,z], uv:[[u,v] x4], col?:[r,g,b]}]
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  for (const q of quads) {
    const b = pos.length / 3;
    // wind the quad so its front faces along n
    const [a, c1, c2] = q.p;
    const e1 = [c1[0] - a[0], c1[1] - a[1], c1[2] - a[2]], e2 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * q.n[0] + cr[1] * q.n[1] + cr[2] * q.n[2] < 0) {
      q.p = q.p.slice().reverse();
      if (q.uv) q.uv = q.uv.slice().reverse();
    }
    for (let i = 0; i < 4; i++) {
      pos.push(...q.p[i]); nrm.push(...q.n); uv.push(...(q.uv ? q.uv[i] : [0, 0]));
      const c = q.col || [1, 1, 1]; col.push(c[0], c[1], c[2], 1);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const m = new pc.Mesh(device);
  m.setPositions(pos); m.setNormals(nrm); m.setUvs(0, uv); m.setColors(col); m.setIndices(idx);
  m.update();
  return m;
}

// faceted crystal: hexagonal prism with a pointed cap
function crystalMesh(device, list) {
  const pos = [], nrm = [], idx = [];
  const add = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c); nrm.push(...n, ...n, ...n); idx.push(base, base + 1, base + 2);
  };
  for (const cr of list) {
    const { x, z, r, h, tip, tiltX = 0, tiltZ = 0, yaw = 0 } = cr;
    const P = (px, py, pz) => {
      // tilt: shear the top away from vertical, then place
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const rx = px * cy + pz * sy, rz = -px * sy + pz * cy;
      return [x + rx + tiltX * py, py, z + rz + tiltZ * py];
    };
    const ring = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let i = 0; i < 6; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 6];
      const a0 = P(ax, -0.05, az), b0 = P(bx, -0.05, bz), a1 = P(ax, h, az), b1 = P(bx, h, bz), t = P(0, h + tip, 0);
      add(a0, a1, b1); add(a0, b1, b0);
      add(a1, t, b1);
    }
  }
  const m = new pc.Mesh(device);
  m.setPositions(pos); m.setNormals(nrm); m.setIndices(idx);
  m.update();
  return m;
}

function discMesh(device, r, seg = 28, y = 0) {
  const pos = [0, y, 0], nrm = [0, 1, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2;
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r); nrm.push(0, 1, 0); uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    if (i > 0) idx.push(0, i + 1, i);
  }
  const m = new pc.Mesh(device);
  m.setPositions(pos); m.setNormals(nrm); m.setUvs(0, uv); m.setIndices(idx);
  m.update();
  return m;
}

// ------------------------------------------------------------------------------------------
export class ArenaView {
  // opts.stage: build the lobby stage south of the arena (the Gem Grab arena hosts the lobby)
  constructor(app, arena, tex, opts = {}) {
    this.opts = opts;
    this.app = app;
    this.arena = arena;
    this.tex = tex;
    this.device = app.graphicsDevice;
    this.root = new pc.Entity('ArenaView');
    app.root.addChild(this.root);
    this.time = 0;
    this.push = new Float32Array(32);
    this.see = [0, 0, 1.7, 0];
    this.mats = {
      crate: stdMat({ map: tex.crate, gloss: 0.3 }),
      stone: stdMat({ map: tex.stone, gloss: 0.34 }),
      box: stdMat({ map: tex.crate, gloss: 0.3, tint: [0.62, 0.95, 0.5] }),
      trunk: stdMat({ vertexColor: true, gloss: 0.2 }),
      bush: foliageMaterial(tex.leaves, true),
      canopy: foliageMaterial(tex.leaves, false),
    };
    this._bakeGround();
    this.bakeVersion = arena.version;
    this._buildGround();
    this._buildWater();
    this.wallEnts = {};
    this._buildWalls();
    this.wallVersion = arena.version;
    this._buildBushes();
    this._buildBorder();
    this.stageAt = { x: 0, z: arena.H / 2 + 6.2 };
    this._buildDecor();
    if (opts.stage) this._buildStage();
    if (arena.mine) this._buildMine();
    this._buildPads();
  }

  // ------------------------------------------------------------------ floor texture
  _dirtAt(x, z) {
    const A = this.arena;
    const n = noise2(x * 1.1, z * 1.1, 3) - 0.5;
    const n2 = noise2(x * 2.7, z * 2.7, 11) - 0.5;
    const e = n * 0.9 + n2 * 0.35;
    const m = A.mine;
    if (m) {
      if (Math.hypot(x - m.x, (z - m.z) * 0.85) < 2.6 + e) return true;
      for (const t of [0, 1]) {
        const s = A.spawns[t];
        if (!s.length) continue;
        const sz = s.reduce((a, p) => a + p.z, 0) / s.length;
        if (Math.abs(x) < 3.4 + e && Math.abs(z - sz) < 1.9 + e * 0.8) return true;
      }
      // winding path from each base to the mine
      const px = Math.sin(z * 0.42) * 0.9 * Math.sign(z || 1);
      if (Math.abs(z) < 12 && Math.abs(x - px) < 0.62 + e * 0.55) return true;
    } else {
      // open arena: a sandy heart and a patch round every spawn
      if (Math.hypot(x, z) < 3.2 + e) return true;
      for (const p of A.spawns[0]) if (Math.hypot(x - p.x, z - p.z) < 1.9 + e) return true;
      if (Math.abs(Math.abs(x) - Math.abs(z)) < 0.55 + e * 0.5 && Math.hypot(x, z) < 8) return true;
    }
    // stray sandy patches
    return noise2(x * 0.55, z * 0.55, 21) > 0.8;
  }

  _bakeGround() {
    const A = this.arena;
    const MW = A.W * Q, MH = A.H * Q;
    // cell kinds: 0 grass, 1 sand, 2 wet sand (pond bank)
    const kind = new Uint8Array(MW * MH);
    const shade = new Float32Array(MW * MH).fill(1);
    const wallD = (x, z) => {
      // distance from (x, z) to the nearest wall tile edge, within 1 tile
      let best = 9;
      const tx = A.tileX(x), tz = A.tileZ(z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!A.isWall(tx + dx, tz + dz)) continue;
        const minX = tx + dx - A.W / 2, minZ = tz + dz - A.H / 2;
        const cx = Math.max(minX, Math.min(x, minX + 1)), cz = Math.max(minZ, Math.min(z, minZ + 1));
        best = Math.min(best, Math.hypot(x - cx, z - cz));
      }
      return best;
    };
    const waterD = (x, z) => {
      let best = 9;
      const tx = A.tileX(x), tz = A.tileZ(z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (A.at(tx + dx, tz + dz) !== T.WATER) continue;
        const minX = tx + dx - A.W / 2, minZ = tz + dz - A.H / 2;
        const cx = Math.max(minX, Math.min(x, minX + 1)), cz = Math.max(minZ, Math.min(z, minZ + 1));
        best = Math.min(best, Math.hypot(x - cx, z - cz));
      }
      return best;
    };
    for (let j = 0; j < MH; j++) {
      for (let i = 0; i < MW; i++) {
        const x = (i + 0.5) / Q - A.W / 2, z = (j + 0.5) / Q - A.H / 2;
        const tx = A.tileX(x), tz = A.tileZ(z);
        const t = A.at(tx, tz);
        const k = j * MW + i;
        let kd = this._dirtAt(x, z) ? 1 : 0;
        if (t === T.BUSH) kd = 0;
        const wd = waterD(x, z);
        if (wd < 0.2 + (noise2(x * 5, z * 5, 5) - 0.5) * 0.12) kd = 2;
        else if (wd < 0.42) kd = 1;
        kind[k] = kd;
        let s = ((tx + tz) & 1) ? (kd === 0 ? 0.955 : 0.972) : 1;
        if (t === T.BUSH) s *= 0.88;
        // contact shade round the walls' feet, but not under them: a wall or power box smashed
        // mid-match (the floor is not re-baked then) leaves a faint outline, not a dark square
        if (!A.isWall(tx, tz)) {
          const d = wallD(x, z);
          if (d < 0.09) s *= 0.66; else if (d < 0.2) s *= 0.8; else if (d < 0.32) s *= 0.91;
        }
        shade[k] = s;
      }
    }
    // dark lip on grass cells that touch sand (crisp cartoon edge)
    for (let j = 1; j < MH - 1; j++) for (let i = 1; i < MW - 1; i++) {
      const k = j * MW + i;
      if (kind[k] !== 0) continue;
      if (kind[k - 1] || kind[k + 1] || kind[k - MW] || kind[k + MW]) shade[k] *= 0.8;
    }
    this.maskKind = kind;
    // texels
    const W = A.W * PX, H = A.H * PX;
    const cv = this.groundCanvas || document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const img = g.createImageData(W, H);
    const out = img.data;
    const grass = this._grassPx || (this._grassPx = pixelsOf(this.tex.src.grass));
    const dirt = this._dirtPx || (this._dirtPx = pixelsOf(this.tex.src.dirt));
    const cell = PX / Q;
    for (let y = 0; y < H; y++) {
      const mj = (y / cell) | 0;
      for (let x = 0; x < W; x++) {
        const k = mj * MW + ((x / cell) | 0);
        const kd = kind[k];
        const src = kd === 0 ? grass : dirt;
        const si = (((y % src.h) * src.w) + (x % src.w)) * 4;
        let s = shade[k];
        if (kd === 2) s *= 0.74;
        const o = (y * W + x) * 4;
        out[o] = src.d[si] * s; out[o + 1] = src.d[si + 1] * s; out[o + 2] = src.d[si + 2] * s * (kd === 2 ? 1.06 : 1); out[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.groundCanvas = cv;
    if (this.groundTex) this.groundTex.setSource(cv);
    else {
      this.groundTex = new pc.Texture(this.device, {
        name: 'ground', width: W, height: H, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, anisotropy: 8,
      });
      this.groundTex.setSource(cv);
    }
  }

  _buildGround() {
    const A = this.arena;
    const quads = [];
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (A.at(tx, tz) === T.WATER) continue;
      const x0 = tx - A.W / 2, z0 = tz - A.H / 2;
      const u0 = tx / A.W, u1 = (tx + 1) / A.W, v0 = tz / A.H, v1 = (tz + 1) / A.H;
      quads.push({ p: [[x0, 0, z0], [x0, 0, z0 + 1], [x0 + 1, 0, z0 + 1], [x0 + 1, 0, z0]], n: [0, 1, 0], uv: [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] });
    }
    // pond banks: vertical faces down to the water
    const bankCol = [0.8, 0.72, 0.66];
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (A.at(tx, tz) !== T.WATER) continue;
      const x0 = tx - A.W / 2, z0 = tz - A.H / 2, y0 = -0.42;
      // the floor texture holds wet sand inside the pond tiles: map the banks onto it
      const u0 = (tx + 0.2) / A.W, u1 = (tx + 0.8) / A.W, v0 = (tz + 0.2) / A.H, v1 = (tz + 0.8) / A.H;
      const uv = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      const side = (dx, dz) => A.inside(tx + dx, tz + dz) && A.at(tx + dx, tz + dz) !== T.WATER;
      if (side(-1, 0)) quads.push({ p: [[x0, 0, z0], [x0, y0, z0], [x0, y0, z0 + 1], [x0, 0, z0 + 1]], n: [1, 0, 0], col: bankCol, uv });
      if (side(1, 0)) quads.push({ p: [[x0 + 1, 0, z0 + 1], [x0 + 1, y0, z0 + 1], [x0 + 1, y0, z0], [x0 + 1, 0, z0]], n: [-1, 0, 0], col: bankCol, uv });
      if (side(0, -1)) quads.push({ p: [[x0 + 1, 0, z0], [x0 + 1, y0, z0], [x0, y0, z0], [x0, 0, z0]], n: [0, 0, 1], col: bankCol, uv });
      if (side(0, 1)) quads.push({ p: [[x0, 0, z0 + 1], [x0, y0, z0 + 1], [x0 + 1, y0, z0 + 1], [x0 + 1, 0, z0 + 1]], n: [0, 0, -1], col: bankCol, uv });
    }
    this.groundMat = stdMat({ map: this.groundTex, gloss: 0.12, tint: [0.9, 0.9, 0.88] });
    this.groundMat.diffuseVertexColor = true;
    const gch = this.groundMat.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    gch.set('litUserDeclarationPS', FLOOR_SEE_DECL);
    gch.set('outputAlphaPS', FLOOR_SEE_ALPHA_PS);
    this.groundMat.shaderChunksVersion = '2.8';
    this.groundMat.setParameter('uSee', this.see);
    this.groundMat.update();
    this.ground = meshEntity(this.root, 'Ground', quadMesh(this.device, quads), this.groundMat, false, true);
    // outer field: four strips around the arena at ground level (the ponds sit below it)
    const field = new pc.Entity('Field');
    const fm = stdMat({ map: this.tex.grass, tint: [0.66, 0.72, 0.6], gloss: 0.1 });
    fm.update();
    const F = 60, hw = A.W / 2, hh = A.H / 2;
    const strip = (x0, z0, x1, z1) => ({ p: [[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], n: [0, 1, 0], uv: [[x0 / 2, z0 / 2], [x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2]] });
    const fq = quadMesh(this.device, [strip(-F, -F, F, -hh), strip(-F, hh, F, F), strip(-F, -hh, -hw, hh), strip(hw, -hh, F, hh)]);
    field.addComponent('render', { meshInstances: [new pc.MeshInstance(fq, fm)], castShadows: false, receiveShadows: true });
    this.root.addChild(field);
    this.field = field;
  }

  _buildWater() {
    const A = this.arena;
    const quads = [];
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (A.at(tx, tz) !== T.WATER) continue;
      const x0 = tx - A.W / 2, z0 = tz - A.H / 2, y = -0.2;
      quads.push({ p: [[x0, y, z0], [x0, y, z0 + 1], [x0 + 1, y, z0 + 1], [x0 + 1, y, z0]], n: [0, 1, 0] });
    }
    if (!quads.length) return;
    // blurred water mask: 1 in open water, fading to 0 across the bank
    const S = 8, MW = A.W * S, MH = A.H * S;
    const data = new Uint8Array(MW * MH * 4);
    const raw = new Float32Array(MW * MH);
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) raw[j * MW + i] = A.at((i / S) | 0, (j / S) | 0) === T.WATER ? 1 : 0;
    const blur = (src) => {
      const dst = new Float32Array(src.length);
      for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
        let s = 0, n = 0;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= MW || jj >= MH) { n++; continue; }
          s += src[jj * MW + ii]; n++;
        }
        dst[j * MW + i] = s / n;
      }
      return dst;
    };
    const b = blur(raw);
    for (let k = 0; k < MW * MH; k++) { const v = Math.round(b[k] * 255); data[k * 4] = v; data[k * 4 + 1] = v; data[k * 4 + 2] = v; data[k * 4 + 3] = 255; }
    const mask = new pc.Texture(this.device, { name: 'watermask', width: MW, height: MH, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    mask.lock().set(data); mask.unlock();
    const m = new pc.ShaderMaterial({ uniqueName: 'brawl-water', vertexGLSL: WATER_VS, fragmentGLSL: WATER_FS, attributes: { vertex_position: pc.SEMANTIC_POSITION } });
    m.setParameter('uMask', mask);
    m.setParameter('uArena', [A.W, A.H, 0, 0]);
    m.setParameter('uTime', 0);
    m.setParameter('uDeep', [0.03, 0.2, 0.42]);
    m.setParameter('uShallow', [0.08, 0.46, 0.66]);
    m.setParameter('uFoam', [0.8, 0.93, 0.97]);
    // premultiplied; destination alpha keeps how much of the scene still shows (the comic ink
    // pass skips lines under the water)
    m.blendState = new pc.BlendState(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA,
      pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA);
    m.depthWrite = false;
    m.update();
    this.waterMat = m;
    this.water = meshEntity(this.root, 'Water', quadMesh(this.device, quads), m, false, false);
    // pond floor
    const floor = [];
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (A.at(tx, tz) !== T.WATER) continue;
      const x0 = tx - A.W / 2, z0 = tz - A.H / 2, y = -0.42;
      floor.push({ p: [[x0, y, z0], [x0, y, z0 + 1], [x0 + 1, y, z0 + 1], [x0 + 1, y, z0]], n: [0, 1, 0], col: [0.16, 0.34, 0.38] });
    }
    const fm = stdMat({ vertexColor: true, gloss: 0.2 });
    fm.vertexColorGamma = true;
    fm.update();
    meshEntity(this.root, 'PondFloor', quadMesh(this.device, floor), fm, false, true);
  }

  // ------------------------------------------------------------------ walls
  _wallBoxes(type) {
    const A = this.arena;
    const boxes = [];
    const r = rng32(type === T.CRATE ? 17 : 29);
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      const t = A.at(tx, tz);
      const c = A.center(tx, tz);
      const jr = rng32(tx * 131 + tz * 7 + t);        // stable per tile
      if (t !== type) continue;
      if (type === T.CRATE) {
        const h = WALL_H.crate;
        boxes.push({ c: [c.x, h / 2, c.z], s: [0.96, h, 0.96], b: 0.05, rot: Math.floor(jr() * 4) });
      } else if (type === T.BOX) {
        boxes.push({ c: [c.x, 0.45, c.z], s: [0.9, 0.9, 0.9], b: 0.06, rot: Math.floor(jr() * 4) });
      } else {
        const h = WALL_H.stone + (jr() - 0.5) * 0.08;
        boxes.push({ c: [c.x, h / 2, c.z], s: [1.0, h, 1.0], b: 0.07, rot: Math.floor(jr() * 4) });
      }
    }
    void r;
    return boxes;
  }

  _buildWalls() {
    this._buildBoxMarks();
    for (const [type, key] of [[T.CRATE, 'crate'], [T.STONE, 'stone'], [T.BOX, 'box']]) {
      const old = this.wallEnts[key];
      if (old) old.destroy();          // the mesh goes with its last mesh instance
      const boxes = this._wallBoxes(type);
      if (!boxes.length) { this.wallEnts[key] = null; continue; }
      this.wallEnts[key] = meshEntity(this.root, 'Walls_' + key, chamferBoxes(this.device, boxes), this.mats[key]);
    }
  }

  // a glowing green cube floats over every power box
  _buildBoxMarks() {
    const A = this.arena;
    if (this.boxMarks) { this.boxMarks.destroy(); this.boxMarks = null; }
    const boxes = [];
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (!A.isBox(tx, tz)) continue;
      const c = A.center(tx, tz);
      boxes.push({ c: [c.x, 1.2, c.z], s: [0.26, 0.26, 0.26], b: 0.04, yaw: 45, tint: [0.4, 1, 0.45] });
    }
    if (!boxes.length) return;
    if (!this.markMat) {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(0.3, 0.9, 0.35); m.emissive = new pc.Color(0.25, 0.95, 0.3); m.emissiveIntensity = 1.1;
      m.useMetalness = true; m.metalness = 0; m.gloss = 0.7;
      m.update();
      this.markMat = m;
    }
    this.boxMarks = meshEntity(this.root, 'BoxMarks', chamferBoxes(this.device, boxes), this.markMat, false, false);
  }

  // walls changed: rebuild the merged wall meshes; full = also re-bake the floor's contact shade
  // (a new match). A wall smashed mid-match leaves its dark footprint on the floor.
  rebuildWalls(full = true) {
    const v = this.arena.version;
    if (this.wallVersion !== v) { this._buildWalls(); this.wallVersion = v; }
    if (full && this.bakeVersion !== v) { this._bakeGround(); this.bakeVersion = v; }
  }

  // ------------------------------------------------------------------ bushes
  _buildBushes() {
    const A = this.arena;
    const boxes = [];
    const isBush = (tx, tz) => A.at(tx, tz) === T.BUSH;
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (!isBush(tx, tz)) continue;
      const c = A.center(tx, tz);
      const r = rng32(tx * 977 + tz * 131);
      // base mass: spills a little toward bush neighbours so a patch reads as one hedge
      const ex = (isBush(tx - 1, tz) ? 0.12 : 0) + (isBush(tx + 1, tz) ? 0.12 : 0);
      const ez = (isBush(tx, tz - 1) ? 0.12 : 0) + (isBush(tx, tz + 1) ? 0.12 : 0);
      const ox = (isBush(tx + 1, tz) ? 0.06 : 0) - (isBush(tx - 1, tz) ? 0.06 : 0);
      const oz = (isBush(tx, tz + 1) ? 0.06 : 0) - (isBush(tx, tz - 1) ? 0.06 : 0);
      const h = 0.7 + r() * 0.1;
      boxes.push({ c: [c.x + ox, h / 2, c.z + oz], s: [0.98 + ex, h, 0.98 + ez], b: 0.16, uv: 'world', tile: 1.5 });
      // leafy clumps on top, turned and jittered
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const sz = 0.5 + r() * 0.26;
        const a = r() * Math.PI * 2, d = 0.12 + r() * 0.2;
        boxes.push({ c: [c.x + Math.cos(a) * d, h + sz * 0.18, c.z + Math.sin(a) * d], s: [sz, sz * 0.72, sz], b: sz * 0.22, yaw: r() * 90, uv: 'world', tile: 1.5 });
      }
      // side puffs breaking the square outline where the patch ends
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (isBush(tx + dx, tz + dz) || r() < 0.45) continue;
        const sz = 0.42 + r() * 0.16;
        boxes.push({ c: [c.x + dx * 0.44 + (r() - 0.5) * 0.3 * (dz !== 0 ? 1 : 0), 0.26 + r() * 0.2, c.z + dz * 0.44 + (r() - 0.5) * 0.3 * (dx !== 0 ? 1 : 0)], s: [sz, sz * 0.8, sz], b: sz * 0.22, yaw: r() * 90, uv: 'world', tile: 1.5 });
      }
    }
    if (!boxes.length) return;
    this.bushes = meshEntity(this.root, 'Bushes', chamferBoxes(this.device, boxes), this.mats.bush);
  }

  // ------------------------------------------------------------------ border and decor
  _buildBorder() {
    const A = this.arena;
    const boxes = [];
    const hw = A.W / 2, hh = A.H / 2;
    const put = (x, z, i) => {
      const r = rng32(i * 71 + 5);
      const h = WALL_H.border + (r() - 0.5) * 0.1;
      boxes.push({ c: [x, h / 2, z], s: [1.0, h, 1.0], b: 0.07, rot: Math.floor(r() * 4) });
    };
    let i = 0;
    for (let x = -hw - 0.5; x <= hw + 0.5; x += 1) { put(x, -hh - 0.5, i++); put(x, hh + 0.5, i++); }
    for (let z = -hh + 0.5; z <= hh - 0.5; z += 1) { put(-hw - 0.5, z, i++); put(hw + 0.5, z, i++); }
    this.border = meshEntity(this.root, 'Border', chamferBoxes(this.device, boxes), this.mats.stone);
  }

  _buildDecor() {
    const A = this.arena;
    const r = rng32(4242);
    const trunks = [], canopy = [], rocks = [];
    const hw = A.W / 2 + 1, hh = A.H / 2 + 1;
    const spots = [];
    const stage = this.stageAt;
    const tryPlace = (x, z, minD) => {
      if (Math.abs(x - stage.x) < 5.5 && z > stage.z - 3.5 && z < stage.z + 9) return false;
      for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < minD) return false;
      spots.push({ x, z });
      return true;
    };
    for (let n = 0; n < 220; n++) {
      const side = r();
      let x, z;
      if (side < 0.36) { x = -hw - 1.2 - r() * 9; z = (r() - 0.5) * (hh * 2 + 10); }
      else if (side < 0.72) { x = hw + 1.2 + r() * 9; z = (r() - 0.5) * (hh * 2 + 10); }
      else if (side < 0.86) { x = (r() - 0.5) * (hw * 2 + 14); z = -hh - 1.4 - r() * 7; }
      else { x = (r() - 0.5) * (hw * 2 + 14); z = hh + 1.6 + r() * 5; }
      if (r() < 0.62) {
        if (!tryPlace(x, z, 2.3)) continue;
        const th = 0.9 + r() * 0.8, tw = 0.3 + r() * 0.12;
        trunks.push({ c: [x, th / 2, z], s: [tw, th, tw], b: 0.04, tint: [0.45 + r() * 0.08, 0.3, 0.18] });
        const cs = 1.35 + r() * 0.7;
        const yaw = r() * 90;
        canopy.push({ c: [x, th + cs * 0.42, z], s: [cs, cs * 0.85, cs], b: 0.14, yaw, rot: Math.floor(r() * 4) });
        const cs2 = cs * (0.55 + r() * 0.15);
        canopy.push({ c: [x + (r() - 0.5) * 0.4, th + cs * 0.85 + cs2 * 0.3, z + (r() - 0.5) * 0.4], s: [cs2, cs2 * 0.8, cs2], b: 0.12, yaw: yaw + 45, rot: Math.floor(r() * 4) });
      } else {
        if (!tryPlace(x, z, 1.2)) continue;
        const s = 0.35 + r() * 0.55;
        rocks.push({ c: [x, s * 0.35, z], s: [s * (1 + r() * 0.5), s * 0.7, s], b: 0.08, yaw: r() * 90, rot: Math.floor(r() * 4) });
      }
    }
    this.decor = new pc.Entity('Decor');
    this.root.addChild(this.decor);
    if (trunks.length) meshEntity(this.decor, 'Trunks', chamferBoxes(this.device, trunks), this.mats.trunk);
    if (canopy.length) meshEntity(this.decor, 'Canopy', chamferBoxes(this.device, canopy), this.mats.canopy);
    if (rocks.length) meshEntity(this.decor, 'Rocks', chamferBoxes(this.device, rocks), this.mats.stone);
  }

  // lobby stage: a stone platform in a clearing south of the arena
  _buildStage() {
    const { x, z } = this.stageAt;
    const r = rng32(77);
    const boxes = [{ c: [x, 0.09, z], s: [2.6, 0.18, 2.6], b: 0.06, rot: 0 }];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const s = 0.34 + r() * 0.12;
      boxes.push({ c: [x + Math.cos(a) * 1.75, s * 0.3, z + Math.sin(a) * 1.75], s: [s * 1.2, s * 0.6, s], b: 0.05, yaw: -a * 57.3, rot: Math.floor(r() * 4) });
    }
    meshEntity(this.root, 'Stage', chamferBoxes(this.device, boxes), this.mats.stone);
  }

  // ------------------------------------------------------------------ gem mine and spawn pads
  _buildMine() {
    const m = this.arena.mine;
    const e = new pc.Entity('Mine');
    e.setPosition(m.x, 0, m.z);
    this.root.addChild(e);
    // hole: radial pixel gradient, unlit
    const S = 64, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const id = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const qx = Math.floor(x / 2) * 2 + 1, qy = Math.floor(y / 2) * 2 + 1;
      const d = Math.hypot(qx - S / 2, qy - S / 2) / (S / 2);
      const k = (y * S + x) * 4;
      const t = Math.min(1, d);
      const ring = d > 0.86 ? 1 : 0;
      id.data[k] = ring ? 40 : 14 + 40 * t * t; id.data[k + 1] = ring ? 26 : 6 + 14 * t * t; id.data[k + 2] = ring ? 58 : 28 + 60 * t * t; id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const holeTex = new pc.Texture(this.device, { width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST });
    holeTex.setSource(cv);
    const hm = new pc.StandardMaterial();
    hm.diffuse = new pc.Color(0, 0, 0);
    hm.emissiveMap = holeTex;
    hm.emissive = new pc.Color(1, 1, 1);
    hm.useLighting = false;
    hm.update();
    meshEntity(e, 'Hole', discMesh(this.device, 0.62, 32, 0.012), hm, false, false);
    // rim stones
    const r = rng32(99);
    const rim = [];
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + r() * 0.2;
      const s = 0.2 + r() * 0.14;
      rim.push({ c: [Math.cos(a) * 0.74, s * 0.32, Math.sin(a) * 0.74], s: [s * 1.2, s * 0.64, s], b: 0.05, yaw: -a * 57.3 + r() * 20, rot: Math.floor(r() * 4) });
    }
    meshEntity(e, 'Rim', chamferBoxes(this.device, rim), this.mats.stone);
    // crystal clusters
    const cm = new pc.StandardMaterial();
    cm.diffuse = new pc.Color(0.55, 0.22, 0.95);
    cm.emissive = new pc.Color(0.42, 0.12, 0.85);
    cm.emissiveIntensity = 0.9;
    cm.useMetalness = true; cm.metalness = 0.1; cm.gloss = 0.85;
    cm.update();
    this.crystalMat = cm;
    const cl = [];
    for (const [ang, big] of [[0.5, 1], [2.6, 0.8], [4.4, 0.9]]) {
      const cx = Math.cos(ang) * 0.95, cz = Math.sin(ang) * 0.95;
      for (let k = 0; k < 4; k++) {
        cl.push({ x: cx + (r() - 0.5) * 0.3, z: cz + (r() - 0.5) * 0.3, r: (0.06 + r() * 0.05) * big, h: (0.2 + r() * 0.3) * big, tip: 0.1 * big, tiltX: (r() - 0.5) * 0.5, tiltZ: (r() - 0.5) * 0.5, yaw: r() * 3 });
      }
    }
    meshEntity(e, 'Crystals', crystalMesh(this.device, cl), cm, true, false);
    const light = new pc.Entity('MineLight');
    light.addComponent('light', { type: 'omni', color: new pc.Color(0.7, 0.35, 1), intensity: 1.6, range: 3.2, castShadows: false });
    light.setLocalPosition(0, 0.6, 0);
    e.addChild(light);
    this.mineLight = light;
    this.mineEnt = e;
  }

  _buildPads() {
    // spawn pads: team-coloured rings of chunky pixels
    const S = 64, mk = (rgb) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      const id = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const qx = Math.floor(x / 2) * 2 + 1, qy = Math.floor(y / 2) * 2 + 1;
        const d = Math.hypot(qx - S / 2, qy - S / 2) / (S / 2);
        const k = (y * S + x) * 4;
        let a = 0, l = 1;
        if (d < 1 && d > 0.8) { a = 1; l = 1; } else if (d <= 0.8 && d > 0.7) { a = 0.9; l = 0.55; } else if (d <= 0.7) { a = 0.32; l = 0.9; }
        id.data[k] = rgb[0] * 255 * l; id.data[k + 1] = rgb[1] * 255 * l; id.data[k + 2] = rgb[2] * 255 * l; id.data[k + 3] = a * 255;
      }
      g.putImageData(id, 0, 0);
      const t = new pc.Texture(this.device, { width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST });
      t.setSource(cv);
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(0, 0, 0);
      m.emissiveMap = t; m.emissive = new pc.Color(1, 1, 1); m.emissiveIntensity = 0.9;
      m.opacityMap = t; m.opacityMapChannel = 'a';
      m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.useLighting = false;
      m.update();
      return m;
    };
    const mats = this.arena.mine ? [mk([0.3, 0.62, 1]), mk([1, 0.32, 0.28])] : [mk([0.95, 0.9, 0.7]), null];
    const disc = discMesh(this.device, 0.62, 24, 0.015);
    for (const t of [0, 1]) for (const s of this.arena.spawns[t]) {
      const e = meshEntity(this.root, 'Pad', disc, mats[t], false, false);
      e.setPosition(s.x, 0, s.z);
    }
  }

  // ------------------------------------------------------------------ per frame
  // pushers: [{x, z, r, s}] brawlers inside or near bushes; see: player position or null;
  // reset: drop the see-through circle at once (end of a match)
  update(dt, pushers, see, reset = false) {
    this.time += dt;
    const p = this.push;
    p.fill(0);
    for (let i = 0; i < Math.min(8, pushers.length); i++) {
      const q = pushers[i];
      p[i * 4] = q.x; p[i * 4 + 1] = q.z; p[i * 4 + 2] = q.r; p[i * 4 + 3] = q.s;
    }
    for (const m of [this.mats.bush, this.mats.canopy]) {
      m.setParameter('uTime', this.time);
      m.setParameter('uPush[0]', p);
    }
    const target = see ? see.s * 0.82 : 0;
    this.see[3] = reset ? 0 : this.see[3] + (target - this.see[3]) * Math.min(1, dt * 8);
    if (see) { this.see[0] = see.x; this.see[1] = see.z; }
    this.mats.bush.setParameter('uSee', this.see);
    this.groundMat.setParameter('uSee', this.see);
    if (this.waterMat) this.waterMat.setParameter('uTime', this.time);
    if (this.mineLight) this.mineLight.light.intensity = 1.4 + Math.sin(this.time * 2.3) * 0.35;
    if (this.boxMarks) this.boxMarks.setLocalPosition(0, Math.sin(this.time * 2.2) * 0.06, 0);
  }
}
