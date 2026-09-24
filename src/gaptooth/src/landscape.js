// The world around the range: a concrete pad set into a pixel-grass field, voxel trees, a ring of
// stepped hills that fade into the haze, and slow voxel clouds. Everything is a handful of merged
// vertex-coloured meshes (one draw call per layer of scenery).
const pc = window.pc;

// deterministic PRNG so the layout is the same on every visit
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// sRGB hex -> linear rgb (vertex colours are used as linear values by the shader)
const hex = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));

// boxes: { c:[x,y,z], s:[w,h,d], top, side, bottom } colours as [r,g,b] 0..1 (linear)
// tile: metres per texture repeat for world-space UVs (0 = no UVs)
function boxMesh(device, boxes, tile = 0) {
  const pos = [], nrm = [], col = [], idx = [], uv = [];
  const F = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], k: 'side' }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], k: 'side' },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], k: 'top' }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], k: 'bottom' },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], k: 'side' }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], k: 'side' },
  ];
  for (const b of boxes) {
    for (const f of F) {
      const c = b[f.k] || b.side;
      const base = pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 1, 2].map((k) => b.c[k] + (f.n[k] * 0.5 + f.u[k] * 0.5 * su + f.v[k] * 0.5 * sv) * b.s[k]);
        pos.push(p[0], p[1], p[2]);
        nrm.push(...f.n);
        col.push(c[0], c[1], c[2], 1);
        if (tile) uv.push((p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2]) / tile, -(p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2]) / tile);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setColors(col); mesh.setIndices(idx);
  if (tile) mesh.setUvs(0, uv);
  mesh.update();
  return mesh;
}

function vcMat(opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  if (opts.map) m.diffuseMap = opts.map;
  m.useMetalness = true; m.metalness = 0; m.gloss = opts.gloss ?? 0.15;
  if (opts.unlit) {
    m.useLighting = false;
    m.emissive = new pc.Color(1, 1, 1);
    m.emissiveVertexColor = true;
    m.diffuse = new pc.Color(0, 0, 0);
    m.diffuseVertexColor = false;
  }
  if (opts.nofog) m.useFog = false;
  m.update();
  return m;
}

export function buildLandscape(app, parent, T) {
  const device = app.graphicsDevice;
  const root = new pc.Entity('Landscape');
  parent.addChild(root);
  const R = rng(20260924);

  // ---- ground: pixel grass field + concrete pad (the range floor), both painted textures
  const gm = new pc.StandardMaterial();
  gm.diffuseMap = T.grass; gm.diffuseMapTiling = new pc.Vec2(220, 220);
  gm.useMetalness = true; gm.metalness = 0; gm.gloss = 0.08; gm.update();
  const field = new pc.Entity('Grass');
  field.addComponent('render', { type: 'plane', material: gm, castShadows: false, receiveShadows: true });
  field.setLocalScale(440, 1, 440);
  field.setLocalPosition(0, -0.012, 0);
  root.addChild(field);

  const PAD = { x0: -16, x1: 16, z0: -12, z1: 22 };
  const pm = new pc.StandardMaterial();
  pm.diffuseMap = T.floor;
  pm.diffuseMapTiling = new pc.Vec2((PAD.x1 - PAD.x0) / 2, (PAD.z1 - PAD.z0) / 2);   // 2 m slabs
  pm.useMetalness = true; pm.metalness = 0; pm.gloss = 0.2;
  pm.emissive = new pc.Color(0.002, 0.002, 0.002);
  pm.update();
  const pad = new pc.Entity('Floor');
  pad.addComponent('render', { type: 'plane', material: pm, castShadows: false, receiveShadows: true });
  pad.setLocalScale(PAD.x1 - PAD.x0, 1, PAD.z1 - PAD.z0);
  pad.setLocalPosition((PAD.x0 + PAD.x1) / 2, 0, (PAD.z0 + PAD.z1) / 2);
  root.addChild(pad);
  // kerb around the pad
  const kerbC = hex('#8d8981'), kerbT = hex('#b4afa6');
  const kb = [];
  const K = 0.35, H = 0.06;
  kb.push({ c: [(PAD.x0 + PAD.x1) / 2, H / 2 - 0.01, PAD.z0 - K / 2], s: [PAD.x1 - PAD.x0 + 2 * K, H, K], top: kerbT, side: kerbC });
  kb.push({ c: [(PAD.x0 + PAD.x1) / 2, H / 2 - 0.01, PAD.z1 + K / 2], s: [PAD.x1 - PAD.x0 + 2 * K, H, K], top: kerbT, side: kerbC });
  kb.push({ c: [PAD.x0 - K / 2, H / 2 - 0.01, (PAD.z0 + PAD.z1) / 2], s: [K, H, PAD.z1 - PAD.z0], top: kerbT, side: kerbC });
  kb.push({ c: [PAD.x1 + K / 2, H / 2 - 0.01, (PAD.z0 + PAD.z1) / 2], s: [K, H, PAD.z1 - PAD.z0], top: kerbT, side: kerbC });
  const kerb = new pc.Entity('Kerb');
  kerb.addComponent('render', { meshInstances: [new pc.MeshInstance(boxMesh(device, kb), vcMat({ gloss: 0.2 }))], castShadows: false, receiveShadows: true });
  root.addChild(kerb);

  // ---- voxel trees around the field (outside the pad, never in the line of fire): painted
  // foliage on the canopies, timber on the trunks; vertex colours only tint per tree
  const trees = [], trunks = [];
  const trunk = [0.62, 0.55, 0.5], trunkT = [0.72, 0.64, 0.58];
  const tint = (k) => [k, k, k];
  const leaf = [tint(0.86), tint(1.0), tint(0.8), tint(1.1)];
  let placed = 0, guard = 0;
  while (placed < 40 && guard++ < 4000) {
    const a = R() * Math.PI * 2, d = 26 + R() * 36;
    const x = Math.cos(a) * d, z = Math.sin(a) * d + 6;
    if (x > PAD.x0 - 5 && x < PAD.x1 + 5 && z > PAD.z0 - 5 && z < PAD.z1 + 5) continue;
    if (z > 12 && Math.abs(x) < 26 + (z - 12) * 0.6) continue;          // keep the backdrop behind the targets clear
    const s = 0.75 + R() * 0.55;
    const th = (1.6 + R() * 1.2) * s;
    trunks.push({ c: [x, th / 2, z], s: [0.45 * s, th, 0.45 * s], top: trunkT, side: trunk, bottom: trunk });
    const L = leaf[Math.floor(R() * leaf.length)], LT = tint(1.22), LB = tint(0.55);
    const cw = (2.2 + R() * 1.2) * s, ch = (1.5 + R() * 0.8) * s;
    trees.push({ c: [x, th + ch / 2, z], s: [cw, ch, cw], top: LT, side: L, bottom: LB });
    const cw2 = cw * (0.55 + R() * 0.2), ch2 = ch * 0.75;
    trees.push({ c: [x + (R() - 0.5) * 0.4 * s, th + ch + ch2 / 2, z + (R() - 0.5) * 0.4 * s], s: [cw2, ch2, cw2], top: LT, side: L });
    if (R() > 0.5) trees.push({ c: [x + cw * 0.45, th + ch * 0.35, z], s: [cw * 0.5, ch * 0.6, cw * 0.5], top: LT, side: L, bottom: LB });
    placed++;
  }
  const treeE = new pc.Entity('Trees');
  treeE.addComponent('render', {
    meshInstances: [
      new pc.MeshInstance(boxMesh(device, trees, 1.0), vcMat({ gloss: 0.12, map: T.foliage })),
      new pc.MeshInstance(boxMesh(device, trunks, 0.5), vcMat({ gloss: 0.1, map: T.wood })),
    ],
    castShadows: true, receiveShadows: true,
  });
  root.addChild(treeE);

  // ---- stepped hills on the horizon (fog turns them into layers of blue haze)
  const hills = [];
  const rock = [hex('#8c8a66'), hex('#7f8a5c'), hex('#94906c')], turf = [hex('#79a54c'), hex('#6f9c46'), hex('#84ad55')];
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + R() * 0.12;
    const d = 105 + R() * 80;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d + 6;
    const w = 16 + R() * 26, dd = 14 + R() * 22;
    const tiers = 2 + Math.floor(R() * 3);
    let y = 0, tw = w, td = dd;
    for (let t = 0; t < tiers; t++) {
      const th = 4 + R() * (t === 0 ? 10 : 6);
      hills.push({ c: [cx + (R() - 0.5) * 4, y + th / 2 - 0.5, cz + (R() - 0.5) * 4], s: [tw, th, td], top: turf[(i + t) % 3], side: rock[(i + t) % 3], bottom: rock[0] });
      y += th - 0.5; tw *= 0.55 + R() * 0.2; td *= 0.55 + R() * 0.2;
    }
  }
  const hillE = new pc.Entity('Hills');
  hillE.addComponent('render', { meshInstances: [new pc.MeshInstance(boxMesh(device, hills), vcMat({ gloss: 0.05 }))], castShadows: false, receiveShadows: false });
  root.addChild(hillE);

  // ---- voxel clouds (unlit, no fog, drifting)
  const clouds = [];
  const cw = hex('#ffffff'), cs = hex('#e6edf6'), cb = hex('#c4cfde');
  for (let i = 0; i < 16; i++) {
    const a = R() * Math.PI * 2, d = 70 + R() * 120;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, y = 42 + R() * 26;
    const n = 3 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const w = 8 + R() * 14, h = 2 + R() * 2.5, dp = 6 + R() * 10;
      clouds.push({ c: [x + (R() - 0.5) * 18, y + (k === 0 ? 0 : R() * 2.5), z + (R() - 0.5) * 12], s: [w, h, dp], top: cw, side: cs, bottom: cb });
    }
  }
  const cloudE = new pc.Entity('Clouds');
  cloudE.addComponent('render', { meshInstances: [new pc.MeshInstance(boxMesh(device, clouds), vcMat({ unlit: true, nofog: true }))], castShadows: false, receiveShadows: false });
  root.addChild(cloudE);
  app.on('update', (dt) => { if (root.enabled) cloudE.rotateLocal(0, dt * 0.35, 0); });

  return { root, pad, PAD };
}
