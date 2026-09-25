// Prop geometry for the range: chamfered boxes (every edge carries a 45° bevel that catches the
// light), a lathed oil drum with rolled rims, and the paper target board. Boxes are merged per
// material so the whole range costs a handful of draw calls.
const pc = window.pc;

// ---------------------------------------------------------------- chamfered boxes
// box: { c:[x,y,z], s:[w,h,d], b: bevel, uv: 'face' | 'world', tile: metres per texture repeat,
//        rot: quarter turns of the face mapping ('face' mode), tint: [r,g,b] vertex colour,
//        yaw: degrees about the vertical axis (texture follows the box) }
export function chamferBoxes(device, boxes) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const v3 = (x, y, z) => [x, y, z];
  for (const box of boxes) {
    const [cx, cy, cz] = box.c;
    const hx = box.s[0] / 2, hy = box.s[1] / 2, hz = box.s[2] / 2;
    const b = Math.min(box.b ?? 0.03, hx * 0.45, hy * 0.45, hz * 0.45);
    const h = [hx, hy, hz], inn = [hx - b, hy - b, hz - b];
    const tint = box.tint || [1, 1, 1];
    const world = box.uv === 'world';
    const tile = box.tile || 1;
    const rot = box.rot || 0;
    const yr = (box.yaw || 0) * Math.PI / 180, cyw = Math.cos(yr), syw = Math.sin(yr);

    // projection used for a surface with normal n: side faces win ties so bevels between the top
    // and a side continue the side's texture
    const uvFor = (p, n) => {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      let u, v;
      if (ay > ax + 1e-3 && ay > az + 1e-3) {            // top / bottom
        if (world) { u = (cx + p[0]) / tile; v = (cz + p[2]) / tile; }
        else { u = p[0] / (2 * hx) + 0.5; v = p[2] / (2 * hz) + 0.5; }
      } else if (ax >= az) {                             // +-X
        const s = n[0] >= 0 ? -1 : 1;
        if (world) { u = s * (cz + p[2]) / tile; v = -(cy + p[1]) / tile; }
        else { u = s * p[2] / (2 * hz) + 0.5; v = 0.5 - p[1] / (2 * hy); }
      } else {                                           // +-Z
        const s = n[2] >= 0 ? -1 : 1;
        if (world) { u = s * (cx + p[0]) / tile; v = -(cy + p[1]) / tile; }
        else { u = s * p[0] / (2 * hx) + 0.5; v = 0.5 - p[1] / (2 * hy); }
      }
      if (!world && rot) {                               // quarter turns around the face centre
        for (let r = 0; r < rot; r++) { const t = u; u = 1 - v; v = t; }
      }
      return [u, v];
    };

    const emit = (verts, n) => {
      // make the winding face along n (counter-clockwise seen from outside)
      const a = verts[0], bb = verts[1], c = verts[2];
      const e1 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) verts = verts.slice().reverse();
      const base = pos.length / 3;
      for (const p of verts) {
        pos.push(cx + p[0] * cyw + p[2] * syw, cy + p[1], cz - p[0] * syw + p[2] * cyw);
        nrm.push(n[0] * cyw + n[2] * syw, n[1], -n[0] * syw + n[2] * cyw);
        const t = uvFor(p, n);
        uv.push(t[0], t[1]);
        col.push(tint[0], tint[1], tint[2], 1);
      }
      if (verts.length === 4) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 1, base + 2);
    };
    const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

    // 6 faces
    for (let a = 0; a < 3; a++) {
      const o1 = (a + 1) % 3, o2 = (a + 2) % 3;
      for (const s of [-1, 1]) {
        const q = [];
        for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = [0, 0, 0]; p[a] = s * h[a]; p[o1] = s1 * inn[o1]; p[o2] = s2 * inn[o2]; q.push(p);
        }
        const n = [0, 0, 0]; n[a] = s;
        emit(q, n);
      }
    }
    if (b > 1e-5) {
      // 12 edge bevels
      for (let a = 0; a < 3; a++) {
        const bA = (a + 1) % 3, c = (a + 2) % 3;         // bevel between faces a and bA, running along c
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
          const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0], p3 = [0, 0, 0];
          p0[a] = sa * h[a]; p0[bA] = sb * inn[bA]; p0[c] = -inn[c];
          p1[a] = sa * inn[a]; p1[bA] = sb * h[bA]; p1[c] = -inn[c];
          p2[a] = sa * inn[a]; p2[bA] = sb * h[bA]; p2[c] = inn[c];
          p3[a] = sa * h[a]; p3[bA] = sb * inn[bA]; p3[c] = inn[c];
          const n = [0, 0, 0]; n[a] = sa; n[bA] = sb;
          emit([p0, p1, p2, p3], norm(n[0], n[1], n[2]));
        }
      }
      // 8 corners
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        emit([v3(sx * hx, sy * inn[1], sz * inn[2]), v3(sx * inn[0], sy * hy, sz * inn[2]), v3(sx * inn[0], sy * inn[1], sz * hz)], norm(sx, sy, sz));
      }
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setColors(col); mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

// ---------------------------------------------------------------- oil drum
// Texture layout (128x128): side wrap in the top half, lid bottom-left, underside bottom-right.
export function barrelMesh(device, R = 0.3, H = 0.9, N = 18) {
  const pos = [], nrm = [], uv = [], idx = [];
  // profile from the bottom centre round the side to the top centre: [r, y]
  const lip = 0.007, rim = 0.03, recess = 0.014;
  const prof = [
    [R - 0.02, 0], [R + lip, 0.012], [R + lip, rim], [R, rim + 0.006],
    [R, H - rim - 0.006], [R + lip, H - rim], [R + lip, H - 0.012], [R - 0.02, H], [R - 0.022, H - recess],
  ];
  const vSide = (y) => Math.min(0.5, Math.max(0, (1 - y / H) * 0.5));
  // side: each profile segment is its own band (flat across the band, smooth around the drum)
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    const nr = dy / l, ny = -dr / l;                    // outward normal in the (r, y) plane
    const base = pos.length / 3;
    for (let s = 0; s <= N; s++) {
      const a = (s / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(r0 * ca, y0, r0 * sa, r1 * ca, y1, r1 * sa);
      nrm.push(nr * ca, ny, nr * sa, nr * ca, ny, nr * sa);
      const u = 1 - s / N;
      uv.push(u, vSide(y0), u, vSide(y1));
    }
    for (let s = 0; s < N; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  // lid (recessed) and underside
  const disc = (y, r, up, cu, cv) => {
    const base = pos.length / 3;
    pos.push(0, y, 0); nrm.push(0, up, 0); uv.push(cu, cv);
    for (let s = 0; s <= N; s++) {
      const a = (s / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(r * ca, y, r * sa); nrm.push(0, up, 0);
      uv.push(cu + ca * 0.235, cv + sa * 0.235 * up);
    }
    for (let s = 0; s < N; s++) {
      if (up > 0) idx.push(base, base + s + 2, base + s + 1);
      else idx.push(base, base + s + 1, base + s + 2);
    }
  };
  disc(H - recess, R - 0.022, 1, 0.25, 0.75);
  disc(0, R - 0.02, -1, 0.75, 0.75);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

// ---------------------------------------------------------------- paper target board
// W x H board standing on its bottom edge (hinge at y = 0), print on +Z.
// Texture (128x128): print 64x96 at the top-left, cardboard back top-right, cut edge strip below.
export function targetBoardMesh(device, W = 0.8, H = 1.2, D = 0.03) {
  const pos = [], nrm = [], uv = [], idx = [];
  const hw = W / 2, hd = D / 2;
  const quad = (p, n, t) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...p[i]); nrm.push(...n); uv.push(...t[i]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const e = 0.004;                                       // keep samples off the region borders
  // front (+Z): left of the print on -X when seen from the front
  quad([[-hw, 0, hd], [hw, 0, hd], [hw, H, hd], [-hw, H, hd]], [0, 0, 1],
    [[0 + e, 0.75 - e], [0.5 - e, 0.75 - e], [0.5 - e, 0 + e], [0 + e, 0 + e]]);
  // back (-Z)
  quad([[hw, 0, -hd], [-hw, 0, -hd], [-hw, H, -hd], [hw, H, -hd]], [0, 0, -1],
    [[0.5 + e, 0.75 - e], [1 - e, 0.75 - e], [1 - e, 0 + e], [0.5 + e, 0 + e]]);
  // cut edges: the strip at the bottom of the texture
  const s0 = 0.75 + e, s1 = 0.78;
  quad([[hw, 0, hd], [hw, 0, -hd], [hw, H, -hd], [hw, H, hd]], [1, 0, 0], [[0, s1], [0, s0], [1, s0], [1, s1]]);
  quad([[-hw, 0, -hd], [-hw, 0, hd], [-hw, H, hd], [-hw, H, -hd]], [-1, 0, 0], [[0, s0], [0, s1], [1, s1], [1, s0]]);
  quad([[-hw, H, hd], [hw, H, hd], [hw, H, -hd], [-hw, H, -hd]], [0, 1, 0], [[0, s1], [1, s1], [1, s0], [0, s0]]);
  quad([[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]], [0, -1, 0], [[0, s0], [1, s0], [1, s1], [0, s1]]);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos); mesh.setNormals(nrm); mesh.setUvs(0, uv); mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

export function texturedMaterial(tex, opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuseMap = tex;
  if (opts.tiling) m.diffuseMapTiling = new pc.Vec2(opts.tiling[0], opts.tiling[1]);
  m.diffuseVertexColor = !!opts.vertexColor;
  m.useMetalness = true;
  m.metalness = opts.metal ?? 0;
  m.gloss = opts.gloss ?? 0.25;
  // a tiny emissive keeps the emissive uniform in the shader so hit flashes can drive it per instance
  m.emissive = opts.emissive ?? new pc.Color(0.002, 0.002, 0.002);
  m.emissiveIntensity = 1;
  m.update();
  return m;
}
