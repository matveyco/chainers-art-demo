// Shootable props: paper targets on hinged stands (per-part hit boxes, head shots, wobble, squash,
// knock-down, pop-up round mode, golden bonus targets) and explosive oil drums (fuse, fire,
// chain reactions).
import { meshEntity } from './scene.js';
import { chamferBoxes, barrelMesh, targetBoardMesh, texturedMaterial } from './props.js';
import { rayBox, boxNormal } from './physics.js';

const pc = window.pc;

// the board stands on a hinge at the top of its post; hit boxes live in hinge space.
// Head box = the head of the printed silhouette; the rest of the board counts as body.
const HINGE = 0.8;
const BOARD = { W: 0.8, H: 1.2, D: 0.03 };
const BODY = { min: new pc.Vec3(-0.4, 0, -0.02), max: new pc.Vec3(0.4, 1.2, 0.02) };
const HEAD = { min: new pc.Vec3(-0.115, 0.835, -0.02), max: new pc.Vec3(0.115, 1.14, 0.02) };
const HIDDEN = -88;
const _lo = new pc.Vec3(), _ld = new pc.Vec3(), _inv = new pc.Mat4();

// torn paper hole: dark punch-through with a ragged grey fibre rim (16 px, alpha-tested)
function holeTexture(device) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5) + (rnd() - 0.5) * 1.4;
    if (d < 3.4) g.fillStyle = '#16120e';
    else if (d < 4.6) g.fillStyle = rnd() < 0.7 ? '#4a443c' : '#16120e';
    else if (d < 6.2 && rnd() < 0.35) g.fillStyle = '#b9b2a4';
    else continue;
    g.fillRect(x, y, 1, 1);
  }
  const t = new pc.Texture(device, { name: 'hole', width: 16, height: 16, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  t.setSource(c);
  return t;
}

// Bullet holes punched through one target's paper: a ring buffer of quads in board space,
// parented to the board so they swing and fall with it; cleared when fresh paper goes up.
class Holes {
  constructor(device, parent, material, cap = 36) {
    this.cap = cap; this.next = 0; this.n = 0;
    this.pos = new Float32Array(cap * 12); this.nrm = new Float32Array(cap * 12); this.uv = new Float32Array(cap * 8);
    const idx = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    this.mesh = new pc.Mesh(device);
    this.mesh.clear(true, false);
    this.mesh.setPositions(this.pos); this.mesh.setNormals(this.nrm); this.mesh.setUvs(0, this.uv); this.mesh.setIndices(idx);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    const mi = new pc.MeshInstance(this.mesh, material);
    mi.cull = false;
    const e = new pc.Entity('holes');
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true });
    parent.addChild(e);
  }
  add(x, y, front) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const z = front ? BOARD.D / 2 + 0.0015 : -BOARD.D / 2 - 0.0015, n = front ? 1 : -1;
    const r = 0.017 + Math.random() * 0.007, a = Math.random() * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    const corners = front ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[1, -1], [-1, -1], [-1, 1], [1, 1]];
    corners.forEach(([u, v], k) => {
      this.pos.set([x + u * ca - v * sa, y + u * sa + v * ca, z], i * 12 + k * 3);
      this.nrm.set([0, 0, n], i * 12 + k * 3);
      this.uv.set([(u + 1) / 2, (1 - v) / 2], i * 8 + k * 2);
    });
    this.dirty = true;
  }
  clear() { if (this.next || this.dirty) { this.pos.fill(0); this.next = 0; this.dirty = true; } }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.setPositions(this.pos); this.mesh.setNormals(this.nrm); this.mesh.setUvs(0, this.uv);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }
}

export class Targets {
  constructor(app, T, world, colliders, fx, sfx) {
    this.app = app; this.fx = fx; this.sfx = sfx;
    this.list = [];
    this.barrels = [];
    this.colliders = colliders;
    this.mode = 'free';
    this.onHit = null; this.onKO = null; this.onBoom = null; this.onPlayerBlast = null;
    const boardMat = texturedMaterial(T.target, { gloss: 0.18 });
    const stakeMat = texturedMaterial(T.wood, { gloss: 0.15 });
    const barrelMat = texturedMaterial(T.barrel, { gloss: 0.5, metal: 0.25 });
    const boardMesh = targetBoardMesh(app.graphicsDevice, BOARD.W, BOARD.H, BOARD.D);
    const holeMat = new pc.StandardMaterial();
    const holeTex = holeTexture(app.graphicsDevice);
    holeMat.diffuseMap = holeTex; holeMat.opacityMap = holeTex; holeMat.opacityMapChannel = 'a'; holeMat.alphaTest = 0.5;
    holeMat.useMetalness = true; holeMat.metalness = 0; holeMat.gloss = 0.1; holeMat.update();
    // two battens stapled behind the board: they swing with it
    const battens = chamferBoxes(app.graphicsDevice, [-0.28, 0.28].map((x) => ({ c: [x, 0.58, -0.035], s: [0.045, 1.12, 0.04], b: 0.008, uv: 'world', tile: 0.5 })));
    const stands = [], posts = [];
    const spots = [[-6.4, 12.5], [-3.2, 13.5], [0, 12.0], [3.2, 13.5], [6.4, 12.5], [-1.6, 16.0], [1.6, 16.0]];
    spots.forEach(([x, z], i) => {
      const root = new pc.Entity('Target' + i);
      root.setLocalPosition(x, 0, z);
      const yaw = 180 + Math.atan2(x, z) * 57.3 * 0.5;
      root.setLocalEulerAngles(0, yaw, 0);
      world.addChild(root);
      // stand (never moves): steel foot + timber post + hinge bracket, merged into two static meshes
      stands.push({ c: [x, 0.04, z], s: [0.62, 0.08, 0.5], b: 0.02, uv: 'world', tile: 1, yaw });
      stands.push({ c: [x, HINGE - 0.02, z], s: [0.24, 0.06, 0.09], b: 0.012, uv: 'world', tile: 1, yaw });
      posts.push({ c: [x, (HINGE - 0.05) / 2 + 0.06, z], s: [0.1, HINGE - 0.05 - 0.04, 0.1], b: 0.015, uv: 'world', tile: 0.5, yaw });
      const hinge = new pc.Entity('hinge');
      hinge.setLocalPosition(0, HINGE, 0);
      root.addChild(hinge);
      // board: its own mesh instance so hit flashes / gold glow stay per target
      const board = new pc.Entity('board');
      const mi = new pc.MeshInstance(boardMesh, boardMat);
      board.addComponent('render', { meshInstances: [mi, new pc.MeshInstance(battens, stakeMat)], castShadows: true, receiveShadows: true });
      hinge.addChild(board);
      const holes = new Holes(app.graphicsDevice, board, holeMat);
      const top = HINGE + BOARD.H;
      const col = { min: new pc.Vec3(x - 0.42, 0, z - 0.2), max: new pc.Vec3(x + 0.42, top, z + 0.2), kind: 'dummy', active: true };
      colliders.push(col);
      const rb = { min: new pc.Vec3(x - 1.4, 0, z - 1.4), max: new pc.Vec3(x + 1.4, top + 0.2, z + 1.4) };   // ray pre-check, covers wobble
      this.list.push({ kind: 'dummy', root, hinge, board, mi, holes, hp: 100, maxHp: 100, angle: 0, vel: 0, state: 'up', t: 0, flash: 0, squash: 0, gold: false, upT: 0, col, rb, x, z });
    });
    world.addChild(meshEntity('TargetStands', chamferBoxes(app.graphicsDevice, stands), texturedMaterial(T.steel, { gloss: 0.4, metal: 0.5 })));
    world.addChild(meshEntity('TargetPosts', chamferBoxes(app.graphicsDevice, posts), stakeMat));
    const drum = barrelMesh(app.graphicsDevice);
    const bspots = [[-5.2, 10.4], [5.4, 10.8], [-0.9, 14.6], [9.2, 8.0], [-9.0, 7.0]];
    bspots.forEach(([x, z], i) => {
      const e = meshEntity('Barrel' + i, drum, barrelMat);
      e.setLocalPosition(x, 0, z);
      e.setLocalEulerAngles(0, (i * 67) % 360, 0);
      world.addChild(e);
      const col = { min: new pc.Vec3(x - 0.3, 0, z - 0.3), max: new pc.Vec3(x + 0.3, 0.9, z + 0.3), kind: 'barrel', active: true };
      colliders.push(col);
      this.barrels.push({ kind: 'barrel', e, mi: e.render.meshInstances[0], hp: 25, dead: false, fuse: -1, t: 0, col, x, z, flash: 0, grow: 1 });
    });
  }

  _hittable(t) { return t.state === 'up' || t.state === 'rising'; }

  // ---------------------------------------------------------------- modes (free play / score attack)
  setMode(mode) {
    this.mode = mode;
    for (const t of this.list) {
      t.gold = false; t.flash = 0; t.squash = 0;
      t.hp = t.maxHp = mode === 'round' ? 70 : 100;
      t.holes.clear();
      t.state = mode === 'round' ? 'hidden' : 'up';
      t.col.active = mode !== 'round';
      if (mode !== 'round') t.vel += 120;
    }
    for (const b of this.barrels) this._resetBarrel(b);
  }

  upCount() { return this.list.filter((t) => t.state === 'up' || t.state === 'rising').length; }

  popUp(upTime, gold = false) {
    const hidden = this.list.filter((t) => t.state === 'hidden' && t.angle < -70);
    if (!hidden.length) return false;
    const t = hidden[Math.floor(Math.random() * hidden.length)];
    t.state = 'rising'; t.upT = upTime; t.gold = gold; t.hp = t.maxHp; t.t = 0; t.col.active = true;
    t.holes.clear();
    t.vel = 520;
    this.sfx.play(gold ? 'popgold' : 'popup', 0.8);
    return true;
  }

  // ---------------------------------------------------------------- queries
  raycast(o, d, maxDist) {
    let best = null;
    for (const t of this.list) {
      if (!this._hittable(t)) continue;
      if (rayBox(o, d, t.rb.min, t.rb.max, maxDist) < 0) continue;
      _inv.copy(t.hinge.getWorldTransform()).invert();
      _inv.transformPoint(o, _lo);
      _inv.transformVector(d, _ld);
      let hitHead = false;
      for (const [part, bx] of [['head', HEAD], ['body', BODY]]) {
        if (part === 'body' && hitHead) break;                      // the head shares the board's face: it wins
        const dist = rayBox(_lo, _ld, bx.min, bx.max, maxDist);
        if (dist >= 0 && (!best || dist < best.dist - 1e-4)) {
          const lp = _lo.clone().add(_ld.clone().mulScalar(dist));
          best = { dist, target: t, part, local: lp, localNormal: boxNormal(lp, bx.min, bx.max) };
          if (part === 'head') hitHead = true;
        }
      }
    }
    for (const b of this.barrels) {
      if (b.dead) continue;
      const dist = rayBox(o, d, b.col.min, b.col.max, maxDist);
      if (dist >= 0 && (!best || dist < best.dist)) best = { dist, target: b, part: 'body' };
    }
    if (best) {
      best.point = o.clone().add(d.clone().mulScalar(best.dist));
      best.normal = best.localNormal
        ? best.target.hinge.getWorldTransform().transformVector(best.localNormal, new pc.Vec3()).normalize()
        : boxNormal(best.point, best.target.col.min, best.target.col.max);
    }
    return best;
  }

  // ---------------------------------------------------------------- damage
  damage(t, amount, dir, info = {}) {
    if (t.kind === 'dummy') {
      if (!this._hittable(t)) return;
      t.hp -= amount;
      t.flash = 1;
      t.squash = Math.min(1.3, t.squash + 0.6 + amount / 80);
      // wobble impulse away from the shot (local x-rotation)
      const fwd = t.root.forward;
      const push = -(dir.x * fwd.x + dir.z * fwd.z);
      t.vel += (push >= 0 ? 1 : -1) * Math.min(460, 60 + amount * 6);
      const killed = t.hp <= 0;
      this.onHit && this.onHit(t, Object.assign({}, info, { amount, killed, gold: t.gold }));
      if (killed) this._ko(t, dir, Object.assign({}, info, { amount }));
    } else if (t.kind === 'barrel') {
      if (t.dead) return;
      t.flash = 1;
      if (info.source !== 'blast') this.onHit && this.onHit(t, Object.assign({}, info, { amount, killed: false }));
      if (t.fuse < 0) this.ignite(t, amount >= 60 ? 0.1 : 0.85);
      else if (info.source !== 'blast') t.fuse = Math.min(t.fuse, 0.06);   // shoot a burning barrel: boom now
    }
  }

  // a bullet went through the paper at a hinge-space point (from raycast)
  punch(t, local, localNormal) {
    if (!t.holes || !local || !localNormal || Math.abs(localNormal.z) < 0.5) return;
    t.holes.add(local.x, local.y, localNormal.z > 0);
  }

  _ko(t, dir, info) {
    t.state = 'down'; t.t = 0; t.col.active = false; t.fresh = false;
    t.vel -= 180 + Math.min(300, (info.amount || 0) * 2);
    const at = t.hinge.getPosition().clone().add(new pc.Vec3(0, 0.7, 0));
    if (t.gold) this.fx.debris(at, 'gold', 18, 5, 0.07, dir);
    else this.fx.knockdown(at, dir);
    this.sfx.play('thud');
    this.onKO && this.onKO(t, Object.assign({}, info, { gold: t.gold, point: at }));
    t.gold = false;
  }

  ignite(b, fuse) {
    if (b.dead) return;
    if (b.fuse >= 0) { b.fuse = Math.min(b.fuse, fuse); return; }
    b.fuse = fuse;
    this.sfx.play('fuse', 0.7);
  }

  explodeBarrel(b) {
    b.dead = true; b.t = 0; b.fuse = -1; b.col.active = false; b.e.enabled = false;
    const p = new pc.Vec3(b.x, 0.5, b.z);
    this.fx.explosion(p, 3);
    this.fx.debris(p, 'redChip', 12, 8, 0.13, null, 'shard');
    this.fx.burnAcc.delete(b);
    this.sfx.play('explosion');
    this.onBoom && this.onBoom(b, { pos: p });
    this.blast(p, 3.4, 140, b);
  }

  blast(p, radius, dmg, source) {
    for (const t of this.list) {
      if (!this._hittable(t)) continue;
      const c = new pc.Vec3(t.x, 1.4, t.z);
      const d = c.distance(p);
      if (d < radius) this.damage(t, dmg * (1 - d / radius) + 10, c.clone().sub(p).normalize(), { source: 'blast', point: c, dist: 0 });
    }
    for (const b of this.barrels) {
      if (b === source || b.dead) continue;
      const d = new pc.Vec3(b.x, 0.45, b.z).distance(p);
      if (d < radius * 0.95) { b.flash = 1; this.ignite(b, 0.14 + d * 0.07); }   // staggered chain
    }
    this.onPlayerBlast && this.onPlayerBlast(p, radius);
  }

  _resetBarrel(b) {
    b.dead = false; b.hp = 25; b.fuse = -1; b.col.active = true; b.e.enabled = true; b.flash = 0;
    b.grow = 0; b.e.setLocalScale(0.01, 0.01, 0.01);
    this.fx.burnAcc.delete(b);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    for (const t of this.list) {
      t.holes.flush();
      t.t += dt;
      let goal = 0, k = 160, c = 10;
      switch (t.state) {
        case 'up':
          if (this.mode === 'round') {
            t.upT -= dt;
            if (t.upT <= 0) { t.state = 'lowering'; t.col.active = false; this.sfx.play('whoosh', 0.35); }
          }
          break;
        case 'rising':
          k = 260; c = 13;
          if (Math.abs(t.angle) < 14) t.state = 'up';
          break;
        case 'lowering':
        case 'hidden':
          goal = HIDDEN; k = 220; c = 16;
          if (t.state === 'lowering' && t.angle < HIDDEN + 6) t.state = 'hidden';
          break;
        case 'down':
          goal = -84; k = 90; c = 9;
          if (this.mode === 'round') { if (t.t > 1.1) { t.state = 'hidden'; goal = HIDDEN; } }
          else if (t.t > 3.2) {
            goal = 0; k = 60;
            if (t.t > 3.25 && !t.fresh) { t.holes.clear(); t.fresh = true; }        // new paper while it swings back up
            if (Math.abs(t.angle) < 3 && t.t > 3.6) { t.state = 'up'; t.hp = t.maxHp; t.col.active = true; }
          }
          break;
        default: break;
      }
      t.vel += ((goal - t.angle) * k - t.vel * c) * dt;
      t.angle += t.vel * dt;
      if (t.angle < -89) { t.angle = -89; t.vel = -t.vel * 0.22; }
      t.hinge.setLocalEulerAngles(t.angle, 0, 0);
      // squash & stretch
      if (t.squash > 0.001) {
        t.squash = Math.max(0, t.squash - dt * 7);
        const s = t.squash * 0.16;
        t.board.setLocalScale(1 + s, 1 - s * 0.7, 1 + s);
      } else if (t.squash !== 0) { t.squash = 0; t.board.setLocalScale(1, 1, 1); }
      // flash + gold glow
      if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 7);
      const g = t.gold ? 0.35 + 0.25 * Math.sin(t.t * 10) : 0;
      if (t.flash > 0 || g > 0 || t._glow) {
        t.mi.setParameter('material_emissive', [t.flash * 0.9 + g * 1.0, t.flash * 0.35 + g * 0.7, t.flash * 0.2 + g * 0.05]);
        t._glow = t.flash > 0 || g > 0;
      }
    }
    for (const b of this.barrels) {
      if (b.dead) {
        b.t += dt;
        if (b.t > (this.mode === 'round' ? 4 : 6)) this._resetBarrel(b);
        continue;
      }
      if (b.grow < 1) {
        b.grow = Math.min(1, b.grow + dt * 3);
        const k = Math.max(0.01, 1 - Math.pow(1 - b.grow, 3));
        b.e.setLocalScale(k, k, k);
      }
      if (b.fuse >= 0) {
        b.fuse -= dt;
        this.fx.burn(new pc.Vec3(b.x, 0.9, b.z), dt, 1, b);
        b.flash = Math.max(b.flash, 0.5 + 0.5 * Math.sin(performance.now() / 45));
        if (b.fuse <= 0) { this.explodeBarrel(b); continue; }
      }
      if (b.flash > 0) {
        b.flash = Math.max(0, b.flash - dt * 7);
        b.mi.setParameter('material_emissive', [b.flash, b.flash * 0.6, b.flash * 0.2]);
      }
    }
  }
}
