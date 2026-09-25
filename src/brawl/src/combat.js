// Projectiles and damage. Bullets and pellets travel visibly (they can be dodged), stop at walls
// (supers smash through), rockets explode with splash, barrage rockets fall on marked spots,
// the rally heals and hastes a squad. Hits charge the shooter's super.
import { UNIT_RADIUS } from './config.js';

const pc = window.pc;
const D2R = Math.PI / 180;
const SHOT_Y = 1.02;
const ROCKET_OFF = new pc.Vec3(0, 0.15, 0.48);

const LOOK = {
  gaptooth: { color: [1, 0.8, 0.28], width: 0.19, len: 0.95, superColor: [1, 0.46, 0.14], superWidth: 0.26, superLen: 1.3 },
  pip: { color: [0.4, 1, 0.76], width: 0.2, len: 0.85 },
  brick: { color: [1, 0.62, 0.26], size: 0.22, superColor: [1, 0.4, 0.12], superSize: 0.3 },
  rosa: { color: [1, 0.55, 0.3] },
};

export class Combat {
  constructor(game) {
    this.g = game;
    this.shots = [];
    this.drops = [];
    this._a = new pc.Vec3();
    this._b = new pc.Vec3();
  }

  clear() {
    for (const s of this.shots) this._kill(s);
    this.shots.length = 0;
    for (const d of this.drops) if (d.sprite) d.sprite.t = d.sprite.life;
    this.drops.length = 0;
  }

  _origin(u, dx, dz, fwd = 0.55) {
    return { x: u.pos.x + dx * fwd, y: SHOT_Y, z: u.pos.z + dz * fwd };
  }

  _muzzleFx(u, dx, dz, kind, scale = 1.5) {
    const o = this._origin(u, dx, dz, 0.75);
    if (u.visible) this.g.bfx.muzzle(new pc.Vec3(o.x, o.y + 0.04, o.z), new pc.Vec3(dx, 0, dz), kind, scale);
  }

  _spawn(u, o) {
    const s = Object.assign({
      owner: u, team: u.team, x: 0, y: SHOT_Y, z: 0, dx: 0, dz: 1, speed: 18, range: 9, travelled: 0,
      radius: 0.2, damage: 100, pierce: false, breakWalls: false, knock: 0, isSuper: false, hitSet: null,
      kind: 'bullet', vis: null, len: 0.5, splash: 0, trailT: 0, color: [1, 1, 1],
    }, o);
    if (s.pierce) s.hitSet = new Set();
    this.shots.push(s);
    return s;
  }

  // ------------------------------------------------------------------ attack kinds
  bullet(u, spec, dx, dz, isSuper, index) {
    const L = LOOK[u.brawler] || LOOK.gaptooth;
    const jitter = (Math.random() - 0.5) * 2 * (spec.spread || 0) * D2R;
    const side = (index % 2 ? 1 : -1) * 0.07;
    const a = Math.atan2(dx, dz) + jitter;
    const ndx = Math.sin(a), ndz = Math.cos(a);
    const o = this._origin(u, dx, dz);
    const color = isSuper ? (L.superColor || L.color) : L.color;
    const width = isSuper ? (L.superWidth || L.width) : L.width;
    const len = isSuper ? (L.superLen || L.len) : L.len;
    const s = this._spawn(u, {
      x: o.x - dz * side, z: o.z + dx * side, dx: ndx, dz: ndz, speed: spec.speed, range: spec.range, radius: spec.radius,
      damage: spec.damage * u.dmgMul, pierce: !!spec.pierce, breakWalls: !!spec.breakWalls, isSuper, kind: 'bullet', color, len,
    });
    s.vis = this.g.bfx.bolt(color, width, len);
    this.g.bfx.moveBolt(s.vis, s.x, s.y, s.z, s.dx, s.dz, s.len);
    if (index % 2 === 0) this._muzzleFx(u, dx, dz, u.def.weapon === 'SMG' ? 'smg' : 'pistol', isSuper ? 1.9 : 1.5);
    this.g.sound(u.def.weapon === 'SMG' ? 'smg' : 'pistol', u.pos, isSuper ? 0.9 : 0.7);
  }

  spread(u, spec, dx, dz, isSuper) {
    const L = LOOK[u.brawler] || LOOK.brick;
    const base = Math.atan2(dx, dz);
    const o = this._origin(u, dx, dz);
    const n = spec.count;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const a = base + t * spec.arc * D2R + (Math.random() - 0.5) * 3 * D2R;
      const s = this._spawn(u, {
        x: o.x, z: o.z, dx: Math.sin(a), dz: Math.cos(a), speed: spec.speed * (0.94 + Math.random() * 0.12), range: spec.range * (0.95 + Math.random() * 0.05),
        radius: spec.radius, damage: spec.damage * u.dmgMul, breakWalls: !!spec.breakWalls, knock: spec.knock || 0.12, isSuper, kind: 'pellet',
        color: isSuper ? L.superColor : L.color, len: 0.3,
      });
      s.vis = this.g.bfx.pellet(s.color, isSuper ? L.superSize : L.size);
      this.g.bfx.moveBolt(s.vis, s.x, s.y, s.z, s.dx, s.dz, 0.3);
    }
    this._muzzleFx(u, dx, dz, 'shotgun', isSuper ? 2.6 : 2);
    this.g.sound('shotgun', u.pos, isSuper ? 1 : 0.85);
    if (isSuper) this.g.bfx.superCast(u.pos, L.superColor);
  }

  rocket(u, spec, dx, dz) {
    const o = this._origin(u, dx, dz, 0.7);
    const s = this._spawn(u, {
      x: o.x, z: o.z, dx, dz, speed: spec.speed * 0.55, maxSpeed: spec.speed, range: spec.range, radius: spec.radius,
      damage: spec.damage * u.dmgMul, splash: spec.splash, kind: 'rocket', color: LOOK.rosa.color,
    });
    s.mesh = this._rocketMesh(u);
    this._placeRocket(s);
    this._muzzleFx(u, dx, dz, 'launcher', 1.7);
    const bb = u.avatar.ch.weapon && u.avatar.ch.weapon.nodes.Backblast;
    if (bb && u.visible) this.g.fx.backBlast(bb.getPosition().clone(), new pc.Vec3(dx, 0, dz));
    this.g.sound('launcher', u.pos, 0.9);
  }

  _rocketMesh(u) {
    const w = u.avatar.ch.weapon;
    const tpl = w && w.nodes.Rocket;
    if (!tpl) return null;
    const e = tpl.clone();
    e.enabled = true;
    this.g.app.root.addChild(e);
    const k = 1.55;
    e.setLocalScale(k, k, k);
    return e;
  }

  _placeRocket(s) {
    if (!s.mesh) return;
    const dir = this._a.set(s.dx, 0, s.dz);
    const q = new pc.Quat().setFromMat4(new pc.Mat4().setLookAt(pc.Vec3.ZERO, dir.clone().mulScalar(-1), pc.Vec3.UP));
    s.mesh.setRotation(q);
    const off = q.transformVector(ROCKET_OFF.clone().mulScalar(1.55));
    s.mesh.setPosition(s.x - off.x, s.y - off.y, s.z - off.z);
  }

  barrage(u, spec, dx, dz, dist) {
    const A = this.g.arena;
    const d = Math.min(spec.range, Math.max(1.5, dist || spec.range * 0.7));
    const tx = u.pos.x + dx * d, tz = u.pos.z + dz * d;
    const col = this.g.teamColor(u.team);
    for (let i = 0; i < spec.count; i++) {
      const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : Math.sqrt(Math.random()) * spec.area;
      let x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
      x = Math.max(-A.halfW + 0.3, Math.min(A.halfW - 0.3, x));
      z = Math.max(-A.halfH + 0.3, Math.min(A.halfH - 0.3, z));
      const delay = spec.delay + i * spec.gap;
      this.drops.push({ owner: u, team: u.team, x, z, t: -delay, fall: 0.38, spec, dmg: spec.damage * u.dmgMul, sprite: null, glow: null });
      this.g.markers.warn(x, z, spec.splash, col, delay + 0.02);
    }
    this.g.bfx.superCast(u.pos, [1, 0.55, 0.3]);
    this.g.sound('launcher', u.pos, 1);
    this._muzzleFx(u, dx, dz, 'launcher', 2);
  }

  rally(u, spec) {
    const g = this.g;
    g.bfx.heal(u.pos, spec.radius);
    g.sound('rally', u.pos, 1);
    for (const v of g.units) {
      if (!v.alive || v.team !== u.team) continue;
      if (Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) > spec.radius) continue;
      const h = v.heal(spec.heal, u);
      v.ammo = v.def.ammo;
      v.haste = spec.duration;
      v.hasteMul = spec.haste;
      if (h > 0) g.onHeal(v, h);
    }
  }

  // ------------------------------------------------------------------ simulation
  _kill(s) {
    if (s.vis) this.g.bfx.killBolt(s.vis);
    if (s.mesh) s.mesh.destroy();
    s.dead = true;
  }

  _chargeSuper(owner, dmg, isSuper) {
    if (isSuper || !owner.alive) return;
    const before = owner.superCharge;
    owner.superCharge = Math.min(1, owner.superCharge + dmg / owner.def.charge);
    if (before < 1 && owner.superCharge >= 1) this.g.onSuperReady(owner);
  }

  _damage(s, v, amount, point, dirx, dirz) {
    const g = this.g;
    if (v.shield > 0) { g.bfx.hit(point, [0.6, 0.9, 1], 0.6); return 0; }
    const dealt = v.hurt(amount, s.owner, { color: [1, 1, 1], isSuper: s.isSuper, kind: s.kind });
    if (s.knock) v.push(dirx * s.knock * 7, dirz * s.knock * 7);
    this._chargeSuper(s.owner, dealt || amount, s.isSuper);
    g.bfx.hit(point, s.color, s.kind === 'pellet' ? 0.8 : 1);
    return dealt;
  }

  _explode(s, x, z) {
    const g = this.g;
    const R = s.splash;
    g.bfx.boom(new pc.Vec3(x, 0, z), R, 1);
    g.sound('explosion', new pc.Vec3(x, 0, z), 0.9);
    let hitAny = false;
    for (const v of g.units) {
      if (!v.alive || v.team === s.team) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d > R + UNIT_RADIUS * 0.6) continue;
      const f = d < R * 0.45 ? 1 : 1 - 0.4 * Math.min(1, (d - R * 0.45) / (R * 0.55 + UNIT_RADIUS));
      const dx = v.pos.x - x, dz = v.pos.z - z, l = Math.hypot(dx, dz) || 1;
      if (v.shield > 0) continue;
      const dealt = v.hurt(s.damage * f, s.owner, { color: [1, 0.85, 0.7], isSuper: s.isSuper, kind: 'blast' });
      v.push(dx / l * 2.5, dz / l * 2.5);
      this._chargeSuper(s.owner, dealt, s.isSuper);
      hitAny = true;
    }
    const A = g.arena;
    const t0x = A.tileX(x - R), t1x = A.tileX(x + R), t0z = A.tileZ(z - R), t1z = A.tileZ(z + R);
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      if (!A.isBox(tx, tz)) continue;
      const c = A.center(tx, tz);
      if (Math.hypot(c.x - x, c.z - z) > R + 0.5) continue;
      g.onBoxHit(tx, tz, s.owner);
      A.damageBox(tx, tz, s.damage * 0.8);
    }
    g.onBlast(x, z, R, s.owner);
    return hitAny;
  }

  update(dt) {
    const g = this.g, A = g.arena;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      if (s.dead) { this.shots.splice(i, 1); continue; }
      if (s.maxSpeed) s.speed = Math.min(s.maxSpeed, s.speed + 40 * dt);
      let step = s.speed * dt;
      if (s.travelled + step > s.range) step = Math.max(0, s.range - s.travelled);
      const x0 = s.x, z0 = s.z;
      // walls along this step (supers break them and keep going)
      let wall = A.raycast(x0, z0, s.dx, s.dz, step);
      let stopAt = step;
      let stopWall = null;
      while (wall.hit) {
        if (s.breakWalls && A.isWall(wall.tx, wall.tz)) {
          A.breakWall(wall.tx, wall.tz);
          wall = A.raycast(x0, z0, s.dx, s.dz, step);
          continue;
        }
        stopAt = wall.dist;
        stopWall = wall;
        break;
      }
      // units along the (possibly shortened) step
      let hitUnit = null, hitT = stopAt;
      for (const v of g.units) {
        if (!v.alive || v.team === s.team) continue;
        if (s.hitSet && s.hitSet.has(v)) continue;
        // closest approach of the segment to the unit centre
        const ex = v.pos.x - x0, ez = v.pos.z - z0;
        const t = Math.max(0, Math.min(stopAt, ex * s.dx + ez * s.dz));
        const cx = x0 + s.dx * t - v.pos.x, cz = z0 + s.dz * t - v.pos.z;
        const rr = UNIT_RADIUS + s.radius;
        if (cx * cx + cz * cz <= rr * rr) {
          // entry point along the segment
          const back = Math.sqrt(Math.max(0, rr * rr - (cx * cx + cz * cz)));
          const te = Math.max(0, t - back);
          if (s.pierce) {
            s.hitSet.add(v);
            this._damage(s, v, s.damage, new pc.Vec3(x0 + s.dx * te, s.y, z0 + s.dz * te), s.dx, s.dz);
          } else if (te < hitT) { hitT = te; hitUnit = v; }
        }
      }
      if (hitUnit) {
        const px = x0 + s.dx * hitT, pz = z0 + s.dz * hitT;
        if (s.kind === 'rocket') this._explode(s, px, pz);
        else this._damage(s, hitUnit, s.damage, new pc.Vec3(px, s.y, pz), s.dx, s.dz);
        this._kill(s); this.shots.splice(i, 1);
        continue;
      }
      if (stopWall) {
        const px = x0 + s.dx * stopAt, pz = z0 + s.dz * stopAt;
        if (s.kind === 'rocket') this._explode(s, px - s.dx * 0.2, pz - s.dz * 0.2);
        else if (A.isBox(stopWall.tx, stopWall.tz)) {
          g.bfx.boxHit(new pc.Vec3(px, 0.6, pz));
          g.onBoxHit(stopWall.tx, stopWall.tz, s.owner);
          A.damageBox(stopWall.tx, stopWall.tz, s.damage);
        } else g.bfx.wallHit(new pc.Vec3(px, s.y, pz), new pc.Vec3(stopWall.nx, 0, stopWall.nz), A.at(stopWall.tx, stopWall.tz) === 1 ? 'crate' : 'stone');
        this._kill(s); this.shots.splice(i, 1);
        continue;
      }
      s.x += s.dx * step; s.z += s.dz * step;
      s.travelled += step;
      if (A.outOfBounds(s.x, s.z, 0.05)) {
        if (s.kind === 'rocket') this._explode(s, s.x - s.dx * 0.3, s.z - s.dz * 0.3);
        else g.bfx.wallHit(new pc.Vec3(s.x, s.y, s.z), new pc.Vec3(-s.dx, 0, -s.dz), 'stone');
        this._kill(s); this.shots.splice(i, 1);
        continue;
      }
      if (s.travelled >= s.range - 1e-4) {
        if (s.kind === 'rocket') this._explode(s, s.x, s.z);
        else g.bfx.fizzle(new pc.Vec3(s.x, s.y, s.z), s.color);
        this._kill(s); this.shots.splice(i, 1);
        continue;
      }
      // visuals
      if (s.kind === 'rocket') {
        this._placeRocket(s);
        s.trailT += dt;
        const tail = new pc.Vec3(s.x - s.dx * 0.45, s.y, s.z - s.dz * 0.45);
        g.fx.rocketExhaust(tail, new pc.Vec3(s.dx, 0, s.dz));
        while (s.trailT > 0.03) { s.trailT -= 0.03; g.fx.rocketTrail(tail.clone()); }
      } else if (s.vis) {
        g.bfx.moveBolt(s.vis, s.x, s.y, s.z, s.dx, s.dz, s.len);
        if (s.isSuper) {
          s.trailT += dt;
          if (s.trailT > 0.05) { s.trailT = 0; g.bfx.trailPuff(new pc.Vec3(s.x, s.y, s.z), [1, 0.9, 0.75], 0.12); }
        }
      }
    }

    // barrage drops
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      const S = g.fx.sprites;
      if (d.t > -d.fall && !d.sprite) {
        d.sprite = S.spawn({ cell: 12, mode: 3, axis: new pc.Vec3(0, 1, 0), pos: new pc.Vec3(d.x, 12, d.z), size: [0.16, 0.16], aspect: 6,
          color: [1, 0.7, 0.35], add: 1, emis: 5, life: 99, fadeOut: 0 });
        d.glow = S.spawn({ cell: 15, pos: new pc.Vec3(d.x, 12, d.z), size: [0.5, 0.5], color: [1, 0.6, 0.3], add: 1, emis: 2, alpha: 0.8, life: 99, fadeOut: 0 });
      }
      if (d.sprite) {
        const u = Math.min(1, (d.t + d.fall) / d.fall);
        const y = 12 * (1 - u) + 0.3;
        d.sprite.pos.set(d.x, y + 0.9, d.z);
        if (d.glow) d.glow.pos.set(d.x, y, d.z);
        if (Math.random() < 0.5) g.fx.rocketTrail(new pc.Vec3(d.x, y + 1.2, d.z));
      }
      if (d.t >= 0) {
        if (d.sprite) d.sprite.t = d.sprite.life;
        if (d.glow) d.glow.t = d.glow.life;
        this._explode({ owner: d.owner, team: d.team, damage: d.dmg, splash: d.spec.splash, isSuper: true }, d.x, d.z);
        this.drops.splice(i, 1);
      }
    }
  }
}
