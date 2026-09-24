// Shootable props: target dummies (per-part hit boxes, head shots, wobble, squash, knock-down,
// pop-up round mode, golden bonus targets) and explosive barrels (fuse, fire, chain reactions).
import { box, matFor, mergedBoxes } from './scene.js';
import { rayBox, boxNormal } from './physics.js';

const pc = window.pc;

// hit boxes in hinge space (hinge sits on top of the post, 1 m up)
const BODY = { min: new pc.Vec3(-0.36, 0, -0.12), max: new pc.Vec3(0.36, 0.84, 0.12) };
const HEAD = { min: new pc.Vec3(-0.19, 0.84, -0.18), max: new pc.Vec3(0.19, 1.2, 0.18) };
const HIDDEN = -88;
const _lo = new pc.Vec3(), _ld = new pc.Vec3(), _inv = new pc.Mat4();

export class Targets {
  constructor(app, T, world, colliders, fx, sfx, batchGroup) {
    this.app = app; this.fx = fx; this.sfx = sfx;
    this.list = [];
    this.barrels = [];
    this.colliders = colliders;
    this.mode = 'free';
    this.onHit = null; this.onKO = null; this.onBoom = null; this.onPlayerBlast = null;
    const dummyMat = matFor(T.dummy), postMat = matFor(T.post), barrelMat = matFor(T.barrel, { gloss: 0.35 });
    const baseMat = matFor(T.metal, { metal: 0.2 });
    const dummyMesh = mergedBoxes(app, [{ c: [0, 0.42, 0], s: [0.72, 0.84, 0.24] }, { c: [0, 1.02, 0], s: [0.38, 0.36, 0.36] }]);
    const spots = [[-6.4, 12.5], [-3.2, 13.5], [0, 12.0], [3.2, 13.5], [6.4, 12.5], [-1.6, 16.0], [1.6, 16.0]];
    spots.forEach(([x, z], i) => {
      const root = new pc.Entity('Dummy' + i);
      root.setLocalPosition(x, 0, z);
      root.setLocalEulerAngles(0, 180 + Math.atan2(x, z) * 57.3 * 0.5, 0);
      world.addChild(root);
      // base + post never move: merged into the static world batch
      root.addChild(box(app, 'base', [0, 0.05, 0], [0.7, 0.1, 0.7], baseMat, { batch: batchGroup }));
      root.addChild(box(app, 'post', [0, 0.55, 0], [0.12, 0.9, 0.12], postMat, { batch: batchGroup }));
      const hinge = new pc.Entity('hinge');
      hinge.setLocalPosition(0, 1.0, 0);
      root.addChild(hinge);
      // body + head: one mesh, one draw call, own mesh instance for flash / gold glow
      const board = new pc.Entity('board');
      const mi = new pc.MeshInstance(dummyMesh, dummyMat);
      board.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
      hinge.addChild(board);
      const col = { min: new pc.Vec3(x - 0.36, 0, z - 0.2), max: new pc.Vec3(x + 0.36, 2.2, z + 0.2), kind: 'dummy', active: true };
      colliders.push(col);
      const rb = { min: new pc.Vec3(x - 1.3, 0, z - 1.3), max: new pc.Vec3(x + 1.3, 2.4, z + 1.3) };   // ray pre-check, covers wobble
      this.list.push({ kind: 'dummy', root, hinge, board, mi, hp: 100, maxHp: 100, angle: 0, vel: 0, state: 'up', t: 0, flash: 0, squash: 0, gold: false, upT: 0, col, rb, x, z });
    });
    const bspots = [[-5.2, 10.4], [5.4, 10.8], [-0.9, 14.6], [9.2, 8.0], [-9.0, 7.0]];
    bspots.forEach(([x, z], i) => {
      const e = box(app, 'Barrel' + i, [x, 0.45, z], [0.6, 0.9, 0.6], barrelMat);
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
      for (const [part, bx] of [['head', HEAD], ['body', BODY]]) {
        const dist = rayBox(_lo, _ld, bx.min, bx.max, maxDist);
        if (dist >= 0 && (!best || dist < best.dist)) {
          const lp = _lo.clone().add(_ld.clone().mulScalar(dist));
          best = { dist, target: t, part, localNormal: boxNormal(lp, bx.min, bx.max) };
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

  _ko(t, dir, info) {
    t.state = 'down'; t.t = 0; t.col.active = false;
    t.vel -= 180 + Math.min(300, (info.amount || 0) * 2);
    const at = t.hinge.getPosition().clone().add(new pc.Vec3(0, 0.7, 0));
    this.fx.debris(at, t.gold ? 'gold' : 'chunkStraw', t.gold ? 18 : 9, t.gold ? 5 : 3.2, 0.07, dir);
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
    this.fx.debris(p, 'chunkRed', 14, 8, 0.14);
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
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    for (const t of this.list) {
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
        const k = 1 - Math.pow(1 - b.grow, 3);
        b.e.setLocalScale(0.6 * k, 0.9 * k, 0.6 * k);
        b.e.setLocalPosition(b.x, 0.45 * k, b.z);
      }
      if (b.fuse >= 0) {
        b.fuse -= dt;
        this.fx.burn(new pc.Vec3(b.x, 0.92, b.z), dt, 1);
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
