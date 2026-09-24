// Bullet holes and scorch marks: a single dynamic mesh (ring buffer of quads) = one draw call
// for every mark in the level. Painted pixel-art atlas (2x2: concrete hole, wood hole, steel
// dent, scorch), alpha-tested, nudged off the surface.
const pc = window.pc;

export class Decals {
  constructor(app, tex, capacity = 192) {
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

  // cell: 0 concrete hole, 1 wood hole, 2 steel dent, 3 scorch
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
