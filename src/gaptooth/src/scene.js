// Test range environment: grid floor, voxel props (crates, walls, platforms), lights,
// post-processing (CameraFrame). Returns static colliders for the controller/raycasts.
import { buildLandscape } from './landscape.js';

const pc = window.pc;

export const SKY = new pc.Color(0.913, 0.925, 0.945);

function canvasTex(app, name, size, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  const t = new pc.Texture(app.graphicsDevice, {
    name, width: c.width, height: c.height, format: pc.PIXELFORMAT_RGBA8,
    mipmaps: opts.mipmaps !== false, minFilter: opts.min ?? pc.FILTER_NEAREST_MIPMAP_LINEAR,
    magFilter: opts.mag ?? pc.FILTER_NEAREST, addressU: opts.wrap ?? pc.ADDRESS_REPEAT, addressV: opts.wrap ?? pc.ADDRESS_REPEAT,
    anisotropy: opts.aniso ?? 1,
  });
  t.setSource(c);
  return t;
}

function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

export function makeTextures(app) {
  const T = {};
  // floor: 1m cells, 32px per metre, stronger line every 5m (tile = 5m)
  T.floor = canvasTex(app, 'floor', [160, 160], (g, w, h) => {
    // warm poured concrete: 1 m slabs with slight tone variation, saw cuts, a stronger 5 m grid
    px(g, 0, 0, w, h, '#a8a39a');
    const tones = ['#aba69d', '#a39e95', '#ada89f', '#a6a198', '#a9a49b'];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) px(g, i * 32 + 1, j * 32 + 1, 31, 31, tones[(i * 3 + j * 2) % tones.length]);
    for (let k = 0; k < 90; k++) { const x = (k * 37) % w, y = (k * 61) % h; px(g, x, y, 1, 1, k % 2 ? '#9b968d' : '#b3aea5'); }
    for (let i = 0; i < 5; i++) { px(g, i * 32, 0, 1, h, '#8f8a82'); px(g, 0, i * 32, w, 1, '#8f8a82'); }
    px(g, 0, 0, 2, h, '#7f7a72'); px(g, 0, 0, w, 2, '#7f7a72');
  }, { min: pc.FILTER_LINEAR_MIPMAP_LINEAR, mag: pc.FILTER_LINEAR, aniso: 8 });
  // crate: 16px planks
  T.crate = canvasTex(app, 'crate', [16, 16], (g) => {
    px(g, 0, 0, 16, 16, '#c79a5c');
    for (const y of [4, 8, 12]) px(g, 1, y, 14, 1, '#a57942');
    px(g, 0, 0, 16, 2, '#8f6535'); px(g, 0, 14, 16, 2, '#8f6535'); px(g, 0, 0, 2, 16, '#8f6535'); px(g, 14, 0, 2, 16, '#8f6535');
    for (let i = 2; i < 14; i++) px(g, i, i, 1, 1, '#9c6f3d');
    px(g, 1, 1, 1, 1, '#d9b27a'); px(g, 14, 1, 1, 1, '#d9b27a');
  });
  T.metal = canvasTex(app, 'metal', [16, 16], (g) => {
    px(g, 0, 0, 16, 16, '#7d848e');
    px(g, 0, 0, 16, 1, '#959ca5'); px(g, 0, 15, 16, 1, '#646a73');
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { px(g, x, y, 1, 1, '#555b63'); px(g, x - 1, y - 1, 1, 1, '#a7adb5'); }
    px(g, 5, 7, 6, 2, '#6f7680');
  });
  T.barrel = canvasTex(app, 'barrel', [16, 16], (g) => {
    px(g, 0, 0, 16, 16, '#c9432f');
    px(g, 0, 2, 16, 1, '#a13322'); px(g, 0, 13, 16, 1, '#a13322');
    for (let i = 0; i < 16; i += 4) { px(g, i, 6, 2, 4, '#f2c12e'); px(g, i + 2, 6, 2, 4, '#1f1f22'); }
    px(g, 0, 0, 16, 1, '#e0634c');
  });
  T.dummy = canvasTex(app, 'dummy', [16, 16], (g) => {
    px(g, 0, 0, 16, 16, '#d8be86');
    for (let y = 1; y < 16; y += 3) px(g, 0, y, 16, 1, '#c4a86f');
    px(g, 4, 4, 8, 8, '#f3ede1'); px(g, 5, 5, 6, 6, '#d6452f'); px(g, 6, 6, 4, 4, '#f3ede1'); px(g, 7, 7, 2, 2, '#d6452f');
  });
  T.post = canvasTex(app, 'post', [8, 8], (g) => { px(g, 0, 0, 8, 8, '#6d5236'); px(g, 0, 0, 8, 1, '#80613f'); px(g, 3, 2, 1, 5, '#5b442c'); });
  T.pad = canvasTex(app, 'pad', [32, 32], (g) => {
    px(g, 0, 0, 32, 32, '#2a2722');
    for (let i = 0; i < 32; i += 4) px(g, i, 0, 2, 32, '#302c26');
    px(g, 0, 0, 32, 2, '#e6c13f'); px(g, 0, 30, 32, 2, '#e6c13f');
  });
  return T;
}

export function matFor(tex, opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuseMap = tex;
  if (opts.tiling) m.diffuseMapTiling = new pc.Vec2(opts.tiling[0], opts.tiling[1]);
  m.useMetalness = true;
  m.metalness = opts.metal ?? 0;
  m.gloss = opts.gloss ?? 0.2;
  // tiny emissive keeps the emissive uniform in the shader so hit-flashes can override it per instance
  m.emissive = opts.emissive ?? new pc.Color(0.002, 0.002, 0.002);
  m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  m.update();
  return m;
}

// One mesh from several axis-aligned boxes (each face UV-mapped 0..1 like the box primitive):
// lets multi-box props render in a single draw call.
export function mergedBoxes(app, boxes) {
  const pos = [], nrm = [], uv = [], idx = [];
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const b of boxes) {
    for (const [n, u, v] of faces) {
      const base = pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let k = 0; k < 3; k++) pos.push(b.c[k] + (n[k] * 0.5 + u[k] * 0.5 * su + v[k] * 0.5 * sv) * b.s[k]);
        nrm.push(n[0], n[1], n[2]);
        uv.push((su + 1) / 2, (sv + 1) / 2);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

export function box(app, name, pos, size, material, opts = {}) {
  const e = new pc.Entity(name);
  e.addComponent('render', { type: 'box', material, castShadows: opts.cast !== false, receiveShadows: true, batchGroupId: opts.batch ?? undefined });
  e.setLocalPosition(pos[0], pos[1], pos[2]);
  e.setLocalScale(size[0], size[1], size[2]);
  if (opts.rot) e.setLocalEulerAngles(0, opts.rot, 0);
  return e;
}

// Build the range. Coordinates: character spawns at origin facing +Z; targets downrange at +Z.
export function buildRange(app, T) {
  const world = new pc.Entity('World');
  app.root.addChild(world);
  const props = new pc.Entity('Props');       // everything but floor + pad (hidden in the studio)
  world.addChild(props);
  const colliders = [];
  const group = app.batcher.addGroup('static', false, 1000);

  const land = buildLandscape(app, world, T.floor);
  const floor = land.pad;

  const crate = matFor(T.crate), metal = matFor(T.metal, { metal: 0.2, gloss: 0.35 }), pad = matFor(T.pad);
  const addStatic = (name, pos, size, mat, surface = 'metal') => {
    const e = box(app, name, pos, size, mat, { batch: group.id });
    props.addChild(e);
    colliders.push({ min: new pc.Vec3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2), max: new pc.Vec3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2), kind: 'solid', surface, entity: e });
    return e;
  };
  // studio pad (turntable sits here, flush with the floor)
  const p = box(app, 'StudioPad', [0, -0.03, 0], [2.4, 0.08, 2.4], pad, { batch: group.id, cast: false });
  world.addChild(p);

  // crates: stepping stones & cover
  const c = 0.8;
  const crates = [
    [-4.2, c / 2, 3.5], [-4.2, c * 1.5, 3.5], [-5.0, c / 2, 3.5], [-4.2, c / 2, 4.3],
    [4.6, c / 2, 5.2], [5.4, c / 2, 5.2], [5.0, c * 1.5, 5.2],
    [-2.2, c / 2, 7.2], [2.4, c / 2, 8.4],
    [-7.5, c / 2, -2.5], [-7.5, c * 1.5, -2.5], [-6.7, c / 2, -2.5],
  ];
  crates.forEach((q, i) => addStatic('Crate' + i, q, [c, c, c], crate, 'wood'));
  // platform with ramp-like steps
  addStatic('Step1', [7.5, 0.25, -1.0], [2.0, 0.5, 2.0], metal);
  addStatic('Step2', [7.5, 0.5, -3.0], [2.0, 1.0, 2.0], metal);
  addStatic('Step3', [7.5, 0.75, -5.0], [2.0, 1.5, 2.0], metal);
  // back walls of the range
  addStatic('BermL', [-9, 1.0, 17], [8, 2.0, 1.0], metal);
  addStatic('BermR', [9, 1.0, 17], [8, 2.0, 1.0], metal);
  addStatic('BermC', [0, 1.5, 19], [10, 3.0, 1.0], metal);
  addStatic('SideL', [-13.5, 0.6, 8], [1.0, 1.2, 18], metal);
  addStatic('SideR', [13.5, 0.6, 8], [1.0, 1.2, 18], metal);
  // lane markers
  for (let i = -2; i <= 2; i++) addStatic('Lane' + i, [i * 3.2, 0.06, 11.0], [0.12, 0.12, 0.9], pad);
  return { world, props, colliders, floor, batchGroup: group.id };
}

// Photo-studio cyclorama for the animation studio: an infinite-looking floor that curves up into
// a wall all around the turntable (lathe mesh), plus the turntable itself.
export function buildCyclorama(app) {
  const root = new pc.Entity('Cyclorama');
  const R = 6.5, C = 2.6, Y0 = -0.045, TOP = 9, SEG = 96;
  const prof = [[0, Y0], [R * 0.5, Y0], [R, Y0]];
  for (let i = 1; i <= 10; i++) { const t = (i / 10) * Math.PI / 2; prof.push([R + C * Math.sin(t), Y0 + C - C * Math.cos(t)]); }
  prof.push([R + C, TOP]);
  const pos = [], nrm = [], uv = [], idx = [];
  const pn = prof.map((p, i) => {             // inward normals of the profile curve
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  for (let s = 0; s <= SEG; s++) {
    const t = (s / SEG) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
    prof.forEach(([r, y], i) => {
      pos.push(r * c, y, r * si);
      nrm.push(pn[i][0] * c, pn[i][1], pn[i][0] * si);
      uv.push(s / SEG, i / (prof.length - 1));
    });
  }
  const n = prof.length;
  for (let s = 0; s < SEG; s++) {
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i, b = (s + 1) * n + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setIndices(idx); mesh.update();
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(0.36, 0.37, 0.39);
  mat.useMetalness = true; mat.metalness = 0; mat.gloss = 0.22;
  mat.update();
  const cyc = new pc.Entity('CycWall');
  cyc.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, mat)], castShadows: false, receiveShadows: true });
  root.addChild(cyc);
  // turntable: charcoal disc, satin top, yellow index ring
  const disc = new pc.Entity('Turntable');
  const dm = new pc.StandardMaterial();
  dm.diffuse = new pc.Color(0.075, 0.075, 0.08); dm.useMetalness = true; dm.metalness = 0; dm.gloss = 0.55; dm.update();
  const discMesh = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.CylinderGeometry({ radius: 1.25, height: 0.045, heightSegments: 1, capSegments: 96 }));
  disc.addComponent('render', { meshInstances: [new pc.MeshInstance(discMesh, dm)], castShadows: false, receiveShadows: true });
  disc.setLocalPosition(0, -0.0225, 0);
  root.addChild(disc);
  // yellow index ring inset in the turntable top (flat annulus)
  const rp = [], rn = [], ri = [];
  const RS = 96, r0 = 1.14, r1 = 1.185;
  for (let s = 0; s <= RS; s++) {
    const t = (s / RS) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
    rp.push(r0 * c, 0.0015, r0 * si, r1 * c, 0.0015, r1 * si);
    rn.push(0, 1, 0, 0, 1, 0);
    if (s < RS) { const a = s * 2; ri.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  }
  const rmesh = new pc.Mesh(app.graphicsDevice);
  rmesh.setPositions(rp); rmesh.setNormals(rn); rmesh.setIndices(ri); rmesh.update();
  const rm = new pc.StandardMaterial();
  rm.diffuse = new pc.Color(0.9, 0.72, 0.16); rm.emissive = new pc.Color(0.95, 0.7, 0.14); rm.emissiveIntensity = 0.5;
  rm.useMetalness = true; rm.metalness = 0; rm.gloss = 0.4; rm.update();
  const ring = new pc.Entity('TurntableRing');
  ring.addComponent('render', { meshInstances: [new pc.MeshInstance(rmesh, rm)], castShadows: false, receiveShadows: true });
  root.addChild(ring);
  root.enabled = false;
  app.root.addChild(root);
  return root;
}
