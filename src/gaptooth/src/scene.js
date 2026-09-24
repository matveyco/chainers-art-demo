// Test range environment: grid floor, voxel props (crates, walls, platforms), lights,
// post-processing (CameraFrame). Returns static colliders for the controller/raycasts.
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
    px(g, 0, 0, w, h, '#e3e6eb');
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) px(g, i * 32, j * 32, 32, 32, '#dfe2e8');
    }
    for (let i = 0; i < 5; i++) { px(g, i * 32, 0, 1, h, '#cdd2da'); px(g, 0, i * 32, w, 1, '#cdd2da'); }
    px(g, 0, 0, 2, h, '#b9c0ca'); px(g, 0, 0, w, 2, '#b9c0ca');
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
    px(g, 0, 0, 16, 16, '#9aa1ac');
    px(g, 0, 0, 16, 1, '#b3b9c2'); px(g, 0, 15, 16, 1, '#7d848f');
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { px(g, x, y, 1, 1, '#6c737e'); px(g, x - 1, y - 1, 1, 1, '#c4c9d0'); }
    px(g, 5, 7, 6, 2, '#8c939e');
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

  const floorMat = matFor(T.floor, { tiling: [40, 40] });
  const floor = new pc.Entity('Floor');
  floor.addComponent('render', { type: 'plane', material: floorMat, castShadows: false, receiveShadows: true });
  floor.setLocalScale(200, 1, 200);
  world.addChild(floor);

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

export function buildLights(app) {
  app.scene.ambientLight = new pc.Color(0.46, 0.49, 0.55);
  app.scene.exposure = 1.0;
  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = SKY;
  app.scene.fog.start = 28;
  app.scene.fog.end = 90;
  const sun = new pc.Entity('Sun');
  sun.addComponent('light', {
    type: 'directional', color: new pc.Color(1.0, 0.96, 0.88), intensity: 1.55,
    castShadows: true, shadowBias: 0.25, normalOffsetBias: 0.06, shadowResolution: 2048,
    shadowDistance: 34, numCascades: 2, cascadeDistribution: 0.55, shadowType: pc.SHADOW_PCF3_32F,
  });
  app.root.addChild(sun);
  const fill = new pc.Entity('Fill');
  fill.addComponent('light', { type: 'directional', color: new pc.Color(0.62, 0.72, 0.9), intensity: 0.35, castShadows: false });
  app.root.addChild(fill);
  const rig = { sun, fill };
  aimLights(rig, 215, 50);
  return rig;
}

// Orient a directional light so it shines FROM the given azimuth/elevation (degrees).
// Azimuth 0 = from +Z, 90 = from +X. PlayCanvas directional lights shine along their -Y axis.
const _q = new pc.Quat(), _ax = new pc.Vec3(), _up = new pc.Vec3(0, 1, 0);
export function aimLight(entity, azDeg, elDeg) {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  const from = new pc.Vec3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  _ax.cross(_up, from);
  const len = _ax.length();
  if (len < 1e-5) { entity.setEulerAngles(0, 0, 0); return; }
  _ax.mulScalar(1 / len);
  _q.setFromAxisAngle(_ax, Math.acos(Math.max(-1, Math.min(1, from.y))) * 180 / Math.PI);
  entity.setRotation(_q);
}

// key light from (az, el); cool fill from the opposite side, low
export function aimLights(rig, azDeg, elDeg) {
  aimLight(rig.sun, azDeg, elDeg);
  aimLight(rig.fill, azDeg + 150, 22);
}

export function setupCameraFrame(app, camera) {
  let cf = null;
  try {
    cf = new pc.CameraFrame(app, camera.camera);
    cf.rendering.samples = 4;
    cf.rendering.toneMapping = pc.TONEMAP_NEUTRAL;
    cf.ssao.type = pc.SSAOTYPE_LIGHTING;
    cf.ssao.intensity = 0.45;
    cf.ssao.radius = 22;
    cf.ssao.samples = 12;
    cf.ssao.minAngle = 12;
    cf.bloom.intensity = 0.018;
    cf.bloom.blurLevel = 12;
    cf.vignette.intensity = 0.22;
    cf.vignette.inner = 0.55;
    cf.vignette.outer = 1.35;
    cf.vignette.color = new pc.Color(0.12, 0.11, 0.09);
    cf.update();
  } catch (e) {
    console.warn('CameraFrame unavailable', e);
    cf = null;
  }
  return cf;
}
