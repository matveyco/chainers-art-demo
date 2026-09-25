// A brawler in the match: health, ammo bars with continuous reload, super charge, movement
// against the arena, facing, attacks (queued bursts), damage, healing, knock-outs, respawns,
// bush concealment. Player input and bot brains both drive a unit through the same fields:
// move (x, z in -1..1) and attack()/useSuper().
import { Avatar } from './avatar.js';
import { BRAWLERS, RULES, UNIT_RADIUS, SHOWDOWN } from './config.js';

const pc = window.pc;
const TAU = Math.PI * 2;

function wrapAngle(a) { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; }

export class Unit {
  constructor(game, o) {
    this.g = game;
    this.id = o.id;
    this.brawler = o.brawler;
    this.def = BRAWLERS[o.brawler];
    this.team = o.team;
    this.name = o.name;
    this.isPlayer = !!o.isPlayer;
    this.avatar = new Avatar(game.app, game.ctx, o.brawler);
    game.app.root.addChild(this.avatar.root);
    this.pos = new pc.Vec3();
    this.vel = new pc.Vec3();
    this.knock = new pc.Vec3();
    this.move = { x: 0, z: 0 };
    this.yaw = this.team === 0 ? Math.PI : 0;       // blue starts facing up the screen (-z)
    this.aimYaw = this.yaw;
    this.faceT = 0;
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.ammo = this.def.ammo;
    this.reloadT = 0;
    this.cool = 0;
    this.superCharge = 0;
    this.gems = 0;
    this.cubes = 0;                  // Showdown power cubes
    this.dmgMul = 1;
    this.rank = 0;
    this.alive = true;
    this.deadT = 0;
    this.respawnT = 0;
    this.shield = 0;
    this.lastHurt = -99;
    this.lastAttack = -99;
    this.revealT = 0;
    this.burst = null;
    this.haste = 0;
    this.hasteMul = 1;
    this.inBush = false;
    this.visible = true;             // to the player's team
    this.regenFx = 0;
    this.stats = { kills: 0, deaths: 0, damage: 0, gems: 0, heal: 0 };
    this.lastHitBy = null;
    this.spawnIndex = o.spawnIndex || 0;
    this.ring = null;
  }

  get radius() { return UNIT_RADIUS; }
  get now() { return this.g.time; }

  place(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.avatar.root.setPosition(x, 0, z);
  }

  // ------------------------------------------------------------------ actions
  canAttack() { return this.alive && this.cool <= 0 && !this.burst && this.ammo >= 1; }
  canSuper() { return this.alive && this.cool <= 0 && !this.burst && this.superCharge >= 1; }

  // dir: aim direction (x, z); dist: aim distance for targeted attacks
  attack(dx, dz, dist) {
    if (!this.canAttack()) return false;
    this.ammo -= 1;
    return this._fire(this.def.attack, dx, dz, dist, false);
  }

  useSuper(dx, dz, dist) {
    if (!this.canSuper()) return false;
    this.superCharge = 0;
    return this._fire(this.def.super, dx, dz, dist, true);
  }

  _fire(spec, dx, dz, dist, isSuper) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); } else { dx /= l; dz /= l; }
    this.cool = this.def.cooldown;
    this.lastAttack = this.now;
    this.revealT = RULES.revealAfterAttack;
    this.aimYaw = Math.atan2(dx, dz);
    this.faceT = 0.5;
    const C = this.g.combat;
    switch (spec.kind) {
      case 'burst':
        this.burst = { spec, left: spec.count, t: 0, dx, dz, isSuper };
        break;
      case 'spread': C.spread(this, spec, dx, dz, isSuper); this.avatar.shoot(isSuper ? 9 : 6); break;
      case 'rocket': C.rocket(this, spec, dx, dz); this.avatar.shoot(7); break;
      case 'barrage': C.barrage(this, spec, dx, dz, dist); this.avatar.shoot(8); break;
      case 'rally': C.rally(this, spec); this.faceT = 0; break;
      default: break;
    }
    if (isSuper) this.g.onSuper(this, spec);
    if (this.isPlayer) this.g.onPlayerFire(spec, dx, dz, isSuper);
    return true;
  }

  // ------------------------------------------------------------------ damage
  hurt(amount, from, info = {}) {
    if (!this.alive || this.shield > 0 || this.g.phase !== 'play') return 0;
    const dmg = Math.min(this.hp, amount);
    this.hp -= amount;
    this.lastHurt = this.now;
    this.revealT = Math.max(this.revealT, 0.7);
    this.lastHitBy = from;
    this.avatar.hitFlash(info.color || [1, 1, 1]);
    if (from) from.stats.damage += dmg;
    this.g.onHurt(this, amount, from, info);
    if (this.hp <= 0) this.die(from);
    return dmg;
  }

  heal(amount, from) {
    if (!this.alive) return 0;
    const h = Math.min(this.maxHp - this.hp, amount);
    this.hp += h;
    if (from && from !== this) from.stats.heal += h;
    return h;
  }

  push(x, z) { this.knock.x += x; this.knock.z += z; }

  addCube() {
    this.cubes++;
    const add = this.def.hp * SHOWDOWN.cubeHp;
    this.maxHp += add;
    this.hp += add;
    this.dmgMul = 1 + this.cubes * SHOWDOWN.cubeDmg;
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deadT = 0;
    this.respawnT = RULES.respawn;
    this.burst = null;
    this.stats.deaths++;
    if (killer && killer !== this) killer.stats.kills++;
    this.avatar.die();
    const n = this.gems;
    this.gems = 0;
    this.g.onKnockout(this, killer, n);
  }

  respawn() {
    const s = this.g.arena.spawns[this.team][this.spawnIndex % this.g.arena.spawns[this.team].length];
    this.place(s.x, s.z);
    this.hp = this.maxHp;
    this.ammo = this.def.ammo;
    this.reloadT = 0;
    this.cool = 0.4;
    this.alive = true;
    this.deadT = 0;
    this.shield = RULES.spawnShield;
    this.yaw = this.aimYaw = this.team === 0 ? Math.PI : 0;
    this.avatar.revive();
    this.avatar.setVisible(true);
    this.g.onRespawn(this);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    if (!this.alive) {
      this.deadT += dt;
      this.avatar.drive(dt, 0, 0, this.yaw);
      if (this.deadT > 1.25 && this.avatar.root.enabled) { this.avatar.setVisible(false); g.bfx.knockout(this.pos, this.g.teamColor(this.team)); }
      if (g.phase === 'play' && g.respawns) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) this.respawn();
      }
      return;
    }
    this.shield = Math.max(0, this.shield - dt);
    this.cool = Math.max(0, this.cool - dt);
    this.revealT = Math.max(0, this.revealT - dt);
    this.faceT = Math.max(0, this.faceT - dt);
    if (this.haste > 0) { this.haste -= dt; if (this.haste <= 0) this.hasteMul = 1; }

    // reload: one bar at a time, continuously
    if (this.ammo < this.def.ammo) {
      this.ammo = Math.min(this.def.ammo, this.ammo + dt / this.def.reload);
    }

    // regeneration after a quiet spell
    if (g.phase === 'play' && this.hp < this.maxHp && this.now - this.lastHurt > RULES.regenDelay && this.now - this.lastAttack > RULES.regenDelay) {
      this.heal(this.maxHp * RULES.regenRate * dt);
      this.regenFx -= dt;
      if (this.regenFx <= 0) { this.regenFx = 0.35; if (this.visible) g.bfx.healTick(this.pos); }
    }

    // queued burst shots
    if (this.burst) {
      const b = this.burst;
      b.t -= dt;
      while (b.t <= 0 && b.left > 0) {
        g.combat.bullet(this, b.spec, b.dx, b.dz, b.isSuper, b.spec.count - b.left);
        b.left--;
        b.t += b.spec.interval;
        this.avatar.shoot(b.isSuper ? 2.5 : 1.8);
        if (this.isPlayer) g.rig.kick(b.dx, b.dz, b.isSuper ? 0.05 : 0.035);
      }
      if (b.left <= 0) this.burst = null;
      this.faceT = Math.max(this.faceT, 0.3);
    }

    // movement: snappy acceleration toward the stick direction
    const m = this.move;
    let mx = m.x, mz = m.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const speed = this.def.speed * this.hasteMul * (g.phase === 'play' ? 1 : 0);
    const k = 1 - Math.exp(-dt * 16);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    const p = this.pos;
    p.x += (this.vel.x + this.knock.x) * dt;
    p.z += (this.vel.z + this.knock.z) * dt;
    const kd = Math.exp(-dt * 7);
    this.knock.x *= kd; this.knock.z *= kd;
    g.arena.resolveCircle(p, UNIT_RADIUS);
    this.inBush = g.arena.isBushAt(p.x, p.z);

    // facing: toward the last attack for a moment, otherwise along the movement
    let want = this.yaw;
    if (this.faceT > 0) want = this.aimYaw;
    else if (Math.hypot(this.vel.x, this.vel.z) > 0.4) want = Math.atan2(this.vel.x, this.vel.z);
    const d = wrapAngle(want - this.yaw);
    const turn = (this.faceT > 0 ? 30 : 14) * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-turn, Math.min(turn, d * Math.min(1, dt * 18))));
    if (Math.abs(d) < turn) this.yaw = wrapAngle(want);

    this.avatar.root.setPosition(p.x, 0, p.z);
    this.avatar.drive(dt, this.vel.x, this.vel.z, this.yaw);
    if (this.haste > 0 && Math.random() < dt * 20 && this.visible) g.bfx.haste(p, [1, 0.9, 0.4]);
    // a charged super glitters at the feet
    if (this.superCharge >= 1 && this.visible && Math.random() < dt * 7) g.bfx.haste(p, [1, 0.8, 0.25]);
  }

  post(dt) { this.avatar.post(dt); }
}
