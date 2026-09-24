// Test range environment: concrete pad, chamfered props (crates, block walls, tread-plate steps)
// with painted pixel-art textures, and the studio cyclorama. Returns static colliders for the
// controller and the raycasts.
import { buildLandscape } from './landscape.js';
import { chamferBoxes, texturedMaterial } from './props.js';

const pc = window.pc;

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

// Procedural textures that are not part of the painted set (the studio pad).
export function makeTextures(app) {
  const T = {};
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

export function box(app, name, pos, size, material, opts = {}) {
  const e = new pc.Entity(name);
  e.addComponent('render', { type: 'box', material, castShadows: opts.cast !== false, receiveShadows: true });
  e.setLocalPosition(pos[0], pos[1], pos[2]);
  e.setLocalScale(size[0], size[1], size[2]);
  if (opts.rot) e.setLocalEulerAngles(0, opts.rot, 0);
  return e;
}

// one entity rendering a merged mesh
export function meshEntity(name, mesh, material, opts = {}) {
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: opts.cast !== false, receiveShadows: true });
  return e;
}

// deterministic variation
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// Build the range. Coordinates: character spawns at origin facing +Z; targets downrange at +Z.
// Static props are chamfered boxes merged per material: crates, concrete walls with painted
// hazard caps, tread-plate steps and lane markers are five draw calls in total.
export function buildRange(app, T) {
  const device = app.graphicsDevice;
  const world = new pc.Entity('World');
  app.root.addChild(world);
  const props = new pc.Entity('Props');       // everything but floor + pad (hidden in the studio)
  world.addChild(props);
  const colliders = [];

  const land = buildLandscape(app, world, T);
  const floor = land.pad;

  const lists = { crate: [], wall: [], cap: [], steel: [], marker: [] };
  const solid = (list, surface, c, s, extra = {}) => {
    lists[list].push(Object.assign({ c, s }, extra));
    colliders.push({ min: new pc.Vec3(c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2), max: new pc.Vec3(c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2), kind: 'solid', surface });
  };

  // studio pad (turntable sits here, flush with the floor)
  const p = box(app, 'StudioPad', [0, -0.03, 0], [2.4, 0.08, 2.4], matFor(T.pad), { cast: false });
  world.addChild(p);

  // crates: stepping stones & cover (each gets its own quarter turn and a slight tone shift)
  const c = 0.8;
  const crates = [
    [-4.2, c / 2, 3.5], [-4.2, c * 1.5, 3.5], [-5.0, c / 2, 3.5], [-4.2, c / 2, 4.3],
    [4.6, c / 2, 5.2], [5.4, c / 2, 5.2], [5.0, c * 1.5, 5.2],
    [-2.2, c / 2, 7.2], [2.4, c / 2, 8.4],
    [-7.5, c / 2, -2.5], [-7.5, c * 1.5, -2.5], [-6.7, c / 2, -2.5],
  ];
  crates.forEach((q, i) => {
    const k = 0.9 + hash(i) * 0.14;
    solid('crate', 'wood', q, [c, c, c], { b: 0.035, uv: 'face', rot: Math.floor(hash(i + 20) * 4), tint: [k, k * (0.97 + hash(i + 40) * 0.05), k * 0.96] });
  });
  // platform with ramp-like steps (tread plate, 1 m tiles)
  const step = (x, y, z, w, h, d) => solid('steel', 'metal', [x, y, z], [w, h, d], { b: 0.04, uv: 'world', tile: 1 });
  step(7.5, 0.25, -1.0, 2.0, 0.5, 2.0);
  step(7.5, 0.5, -3.0, 2.0, 1.0, 2.0);
  step(7.5, 0.75, -5.0, 2.0, 1.5, 2.0);
  // back walls of the range: block walls with a painted steel cap
  const wall = (x, h, z, w, d) => {
    solid('wall', 'wall', [x, (h - 0.1) / 2, z], [w, h - 0.1, d], { b: 0.05, uv: 'world', tile: 2 });
    solid('cap', 'metal', [x, h - 0.05, z], [w + 0.06, 0.1, d + 0.06], { b: 0.02, uv: 'world', tile: 0.5 });
  };
  wall(-9, 2.0, 17, 8, 1.0);
  wall(9, 2.0, 17, 8, 1.0);
  wall(0, 3.0, 19, 10, 1.0);
  wall(-13.5, 1.2, 8, 1.0, 18);
  wall(13.5, 1.2, 8, 1.0, 18);
  // lane markers
  for (let i = -2; i <= 2; i++) solid('marker', 'metal', [i * 3.2, 0.06, 11.0], [0.14, 0.12, 0.9], { b: 0.02, uv: 'world', tile: 0.5 });

  const mats = {
    crate: texturedMaterial(T.crate, { vertexColor: true, gloss: 0.22 }),
    wall: texturedMaterial(T.wall, { gloss: 0.12 }),
    cap: texturedMaterial(T.hazard, { gloss: 0.35, metal: 0.1 }),
    steel: texturedMaterial(T.steel, { gloss: 0.45, metal: 0.55 }),
    marker: texturedMaterial(T.hazard, { gloss: 0.35 }),
  };
  for (const [k, list] of Object.entries(lists)) props.addChild(meshEntity('Range_' + k, chamferBoxes(device, list), mats[k]));
  return { world, props, colliders, floor };
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
