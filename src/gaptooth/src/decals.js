// Bullet holes and scorch marks: a single dynamic mesh (ring buffer of quads) = one draw call
// for every mark in the level. Pixel-art atlas, alpha-tested, nudged off the surface.
const pc = window.pc;

// 32x32 atlas, four 16x16 cells: 0 hole, 1 hole (splintered), 2 scorch, 3 dust ring
function atlas(app) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // cell 0: round hole
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 2.2) px(x, y, '#0d0b09');
    else if (d < 3.6) px(x, y, '#2b241d');
    else if (d < 5.2 && rnd() < 0.55) px(x, y, 'rgba(40,34,28,1)');
  }
  // cell 1: splintered hole
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const ang = Math.atan2(y - 7.5, x - 7.5);
    const spike = 3.2 + 2.4 * Math.max(0, Math.cos(ang * 5 + 0.7));
    if (d < 2.0) px(16 + x, y, '#0d0b09');
    else if (d < spike) px(16 + x, y, rnd() < 0.8 ? '#3a2e22' : '#1c1712');
  }
  // cell 2: scorch
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5) + (rnd() - 0.5) * 2.2;
    if (d < 3) px(x, 16 + y, '#141210');
    else if (d < 5.5) px(x, 16 + y, '#23201c');
    else if (d < 7.4 && rnd() < 0.6) px(x, 16 + y, '#3b3630');
  }
  // cell 3: dust ring (floor hits)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 1.6) px(16 + x, 16 + y, '#1a1816');
    else if (d < 3.2 && rnd() < 0.7) px(16 + x, 16 + y, '#4a4640');
  }
  const t = new pc.Texture(app.graphicsDevice, {
    name: 'decals', width: 32, height: 32, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
    minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  t.setSource(c);
  return t;
}

export class Decals {
  constructor(app, capacity = 192) {
    this.cap = capacity;
    this.next = 0;
    this.pos = new Float32Array(capacity * 12);
    this.nrm = new Float32Array(capacity * 12);
    this.uv = new Float32Array(capacity * 8);
    const idx = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    const mesh = this.mesh = new pc.Mesh(app.graphicsDevice);
    mesh.clear(true, false);
    mesh.setPositions(this.pos); mesh.setNormals(this.nrm); mesh.setUvs(0, this.uv); mesh.setIndices(idx);
    mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    const tex = atlas(app);
    const m = new pc.StandardMaterial();
    m.diffuseMap = tex;
    m.opacityMap = tex; m.opacityMapChannel = 'a';
    m.alphaTest = 0.5;
    m.useMetalness = true; m.metalness = 0; m.gloss = 0.1;
    m.update();
    const mi = new pc.MeshInstance(mesh, m);
    mi.cull = false;
    this.entity = new pc.Entity('Decals');
    this.entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true });
    app.root.addChild(this.entity);
    this.dirty = false;
  }

  // cell: 0 hole, 1 splinter, 2 scorch, 3 dust
  add(p, n, size = 0.06, cell = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    // tangent basis around the normal, random roll
    const up = Math.abs(n.y) > 0.9 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
    const t = new pc.Vec3().cross(up, n).normalize();
    const b = new pc.Vec3().cross(n, t).normalize();
    const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const tx = t.clone().mulScalar(ca).add(b.clone().mulScalar(sa)).mulScalar(size / 2);
    const bx = b.clone().mulScalar(ca).sub(t.clone().mulScalar(sa)).mulScalar(size / 2);
    const o = p.clone().add(n.clone().mulScalar(0.004 + Math.random() * 0.002));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const u0 = (cell % 2) * 0.5, v0 = cell < 2 ? 0 : 0.5;     // textures upload unflipped: canvas top row is v = 0
    for (let k = 0; k < 4; k++) {
      const [cx, cy] = corners[k];
      const q = o.clone().add(tx.clone().mulScalar(cx)).add(bx.clone().mulScalar(cy));
      this.pos.set([q.x, q.y, q.z], i * 12 + k * 3);
      this.nrm.set([n.x, n.y, n.z], i * 12 + k * 3);
      this.uv.set([u0 + (cx + 1) * 0.25, v0 + (cy + 1) * 0.25], i * 8 + k * 2);
    }
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.setPositions(this.pos); this.mesh.setNormals(this.nrm); this.mesh.setUvs(0, this.uv);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }

  clear() {
    this.pos.fill(0); this.dirty = true;
  }
}
