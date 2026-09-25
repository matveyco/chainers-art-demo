// Bot brains. Each bot looks at what its team can see (bushes hide enemies), picks a mode
// (fight, collect a gem, advance on the mine, protect a lead, retreat to heal), walks there on A*
// paths, keeps its weapon's preferred distance while strafing, leads its shots with a
// difficulty-based error, sidesteps incoming bullets and fires its super when it pays off.
import { DIFFICULTY, RULES } from './config.js';

const PREF = { gaptooth: 6.2, brick: 2.4, rosa: 7.4, pip: 5.2 };
const rnd = (a, b) => a + Math.random() * (b - a);
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

export class Bot {
  constructor(game, unit, level = 'normal', lane = 0) {
    this.g = game;
    this.u = unit;
    this.d = DIFFICULTY[level] || DIFFICULTY.normal;
    this.lane = lane;
    this.mode = 'advance';
    this.goal = null;
    this.path = null;
    this.pathGoal = null;
    this.pathT = 0;
    this.thinkT = Math.random() * 0.3;
    this.target = null;
    this.seen = new Map();
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = rnd(0.8, 1.8);
    this.dodge = null;
    this.stuckT = 0;
    this.lastX = unit.pos.x; this.lastZ = unit.pos.z;
    this.holdFire = 0;
    this.wander = { x: 0, z: 0, t: 0 };
  }

  get pref() { return PREF[this.u.brawler] || 5; }

  // ------------------------------------------------------------------ perception
  _enemies() {
    const g = this.g, u = this.u, out = [];
    for (const e of g.units) {
      if (!e.alive || e.team === u.team) continue;
      if (!g.visibleTo(u.team, e)) continue;
      const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
      if (d > 15) continue;
      out.push({ e, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  _updateSeen(list) {
    const now = this.g.time;
    const alive = new Set(list.map((x) => x.e));
    for (const e of [...this.seen.keys()]) if (!alive.has(e)) this.seen.delete(e);
    for (const { e } of list) if (!this.seen.has(e)) this.seen.set(e, now);
  }

  _reacted(e) {
    const t0 = this.seen.get(e);
    return t0 !== undefined && this.g.time - t0 >= this.d.react;
  }

  // ------------------------------------------------------------------ decisions
  think() {
    if (this.g.mode === 'showdown') { this.thinkShowdown(); return; }
    const g = this.g, u = this.u, A = g.arena;
    const list = this._enemies();
    this._updateSeen(list);
    const nearest = list[0];
    const hpf = u.hp / u.maxHp;
    const teamGems = g.teamGems(u.team), foeGems = g.teamGems(1 - u.team);
    const leading = teamGems >= RULES.gemsToWin && teamGems > foeGems;
    const range = this._range();
    // target: a gem carrier nearby first, then weakest in reach, then nearest
    let target = null, best = Infinity;
    for (const { e, d } of list) {
      let score = d - (e.gems >= 3 ? 4 + e.gems * 0.3 : 0) - (1 - e.hp / e.maxHp) * 3;
      if (!A.los(u.pos.x, u.pos.z, e.pos.x, e.pos.z)) score += 3;
      if (score < best) { best = score; target = e; }
    }
    this.target = target;
    const lowHp = hpf < (u.gems >= 3 ? 0.5 : 0.34);
    const ownBase = this._base(u.team);

    if (lowHp && nearest && nearest.d < 10) {
      this.mode = 'retreat';
      // away from the nearest threat, toward home, preferring bushes
      const ex = nearest.e.pos.x, ez = nearest.e.pos.z;
      let rx = u.pos.x - ex, rz = u.pos.z - ez;
      const l = Math.hypot(rx, rz) || 1;
      rx /= l; rz /= l;
      const hx = ownBase.x - u.pos.x, hz = ownBase.z - u.pos.z, hl = Math.hypot(hx, hz) || 1;
      this.goal = this._bushNear(u.pos.x + (rx * 0.6 + hx / hl * 0.8) * 5, u.pos.z + (rz * 0.6 + hz / hl * 0.8) * 5) ||
        { x: u.pos.x + (rx * 0.6 + hx / hl * 0.8) * 5, z: u.pos.z + (rz * 0.6 + hz / hl * 0.8) * 5 };
      return;
    }
    if (leading && u.gems > 0) {
      this.mode = 'protect';
      if (target && Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z) < range * 0.8) { this.mode = 'fight'; this._fightGoal(target); return; }
      this.goal = { x: ownBase.x + this.lane * 2.5, z: ownBase.z + (u.team === 0 ? -2.5 : 2.5) };
      return;
    }
    if (target) {
      const d = Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z);
      const engage = range + 2.5 + (this.d.aggression - 1) * 3;
      if (d < engage || target.gems >= 3) { this.mode = 'fight'; this._fightGoal(target); return; }
    }
    // gems: go for the nearest free gem unless a visible enemy is clearly closer to it
    const gem = this._gem(list);
    if (gem) { this.mode = 'collect'; this.goal = { x: gem.x, z: gem.z }; return; }
    this.mode = 'advance';
    const m = A.mine;
    const side = u.team === 0 ? 1 : -1;
    // hold a spot around the mine; the lane spreads the squad, the gem lead pulls it back
    const back = teamGems > foeGems + 3 ? 3.2 : 1.6;
    this.goal = { x: m.x + this.lane * 3.2 + this.wander.x, z: m.z + side * back + this.wander.z };
  }

  // Solo Showdown: stay out of the gas, fight what comes close, loot power boxes and cubes
  thinkShowdown() {
    const g = this.g, u = this.u, A = g.arena;
    const list = this._enemies();
    this._updateSeen(list);
    const nearest = list[0];
    let target = null, best = Infinity;
    const attacker = g.time - u.lastHurt < 3 ? u.lastHitBy : null;
    for (const { e, d } of list) {
      let score = d - (1 - e.hp / e.maxHp) * 3 - e.cubes * 0.3 - (e === attacker ? 6 : 0);
      if (!A.los(u.pos.x, u.pos.z, e.pos.x, e.pos.z)) score += 3;
      if (score < best) { best = score; target = e; }
    }
    this.target = target;
    this.boxTarget = null;
    const safe = g.safe;
    const lim = (v, k) => Math.max(-k, Math.min(k, v));
    const edge = Math.max(Math.abs(u.pos.x), Math.abs(u.pos.z));
    const inside = (x, z, m = 0.8) => Math.max(Math.abs(x), Math.abs(z)) < safe - m;
    // the gas is (nearly) here: walk in toward the middle
    if (safe < A.halfW && edge > safe - 1.4) {
      this.mode = 'gas';
      const k = Math.max(0.6, safe - 2.2);
      this.goal = { x: lim(u.pos.x, k) * 0.55, z: lim(u.pos.z, k) * 0.55 };
      return;
    }
    const hpf = u.hp / u.maxHp;
    if (hpf < 0.36 && nearest && nearest.d < 9) {
      this.mode = 'retreat';
      let rx = u.pos.x - nearest.e.pos.x, rz = u.pos.z - nearest.e.pos.z;
      const l = Math.hypot(rx, rz) || 1;
      let gx = u.pos.x + rx / l * 4.5, gz = u.pos.z + rz / l * 4.5;
      const k = Math.max(0.6, safe - 1.5);
      gx = lim(gx, k); gz = lim(gz, k);
      const bush = this._bushNear(gx, gz);
      this.goal = bush && inside(bush.x, bush.z) ? bush : { x: gx, z: gz };
      return;
    }
    const range = this._range();
    const calm = this._calm();
    if (target) {
      const d = Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z);
      // early on everyone loots and only fights back (or bumps right into someone); later the
      // reach grows to the weapon's range and beyond, and a weak brawler in range is fair game
      const weak = target.hp / target.maxHp < 0.3;
      const early = weak ? range * 0.9 : 1.8;
      const late = Math.max(weak ? range + 3 : 0, (range + 2 + (this.d.aggression - 1) * 3) * (1 - calm * 0.75) + (hpf > 0.7 && calm < 0.5 ? 1.5 : 0));
      const w = Math.max(0, Math.min(1, (0.55 - calm) / 0.25));        // the calm wears off between ~27 s and ~42 s
      const reach = target === attacker ? range + 3 : early + (late - early) * w * w * (3 - 2 * w);
      if (d < reach) { this.mode = 'fight'; this._fightGoal(target); return; }
    }
    // while it is calm, leave a box or cube to anyone about as close to it
    const taken = (x, z, d) => calm > 0.25 && list.some(({ e }) => {
      const de = Math.hypot(x - e.pos.x, z - e.pos.z);
      return de < 6 && de < d + 0.5;
    });
    // a power cube within reach
    let cube = null, cd = 12;
    for (const gm of g.gems.list) {
      if (gm.kind !== 'cube' || (gm.air && gm.t < 0.2) || !inside(gm.x, gm.z, 0.3)) continue;
      const d = Math.hypot(gm.x - u.pos.x, gm.z - u.pos.z);
      if (d < cd && !taken(gm.x, gm.z, d)) { cd = d; cube = gm; }
    }
    if (cube) { this.mode = 'collect'; this.goal = { x: cube.x, z: cube.z }; return; }
    // the nearest power box inside the safe zone: stand off and shoot it open
    let box = null, bd = 14;
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (!A.isBox(tx, tz)) continue;
      const c = A.center(tx, tz);
      if (!inside(c.x, c.z, 0.5)) continue;
      const d = Math.hypot(c.x - u.pos.x, c.z - u.pos.z);
      if (d < bd && !taken(c.x, c.z, d)) { bd = d; box = { tx, tz, x: c.x, z: c.z }; }
    }
    if (box) {
      this.mode = 'loot';
      this.boxTarget = box;
      const stand = Math.min(range * 0.7, 4);
      let dx = u.pos.x - box.x, dz = u.pos.z - box.z;
      const l = Math.hypot(dx, dz) || 1;
      this.goal = bd > stand + 0.5 || !A.los(u.pos.x, u.pos.z, box.x, box.z) ? { x: box.x + dx / l * stand, z: box.z + dz / l * stand } : null;
      if (this.goal && A.blocksMove(A.tileX(this.goal.x), A.tileZ(this.goal.z))) this.goal = { x: box.x + dx / l * 1.4, z: box.z + dz / l * 1.4 };
      return;
    }
    // nothing left to loot: hold a bush on its own side of the map, creeping inward every few
    // seconds (the gas does the rest), instead of everyone converging on the middle at once
    this.mode = 'hold';
    if (!this.hold || g.time > this.holdT || !inside(this.hold.x, this.hold.z, 1.2)) {
      this.holdT = g.time + rnd(7, 13);
      let ax = u.pos.x + rnd(-3, 3), az = u.pos.z + rnd(-3, 3);
      const m = Math.max(Math.abs(ax), Math.abs(az)) || 1;
      const k = Math.max(1.5, Math.min(safe - 2.2, edge * 0.85));
      ax = ax / m * k; az = az / m * k;
      const bush = this._bushNear(ax, az);
      this.hold = bush && inside(bush.x, bush.z, 1.2) ? { x: bush.x, z: bush.z } : this._openNear(ax, az);
    }
    this.goal = this.hold;
  }

  // the centre of the nearest tile a brawler can stand on
  _openNear(x, z) {
    const A = this.g.arena, tx0 = A.tileX(x), tz0 = A.tileZ(z);
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tx = tx0 + dx, tz = tz0 + dz;
        if (A.inside(tx, tz) && !A.blocksMove(tx, tz)) return A.center(tx, tz);
      }
    }
    return { x, z };
  }

  // Showdown: 1 at the start, fading to 0 over the first minute (fights get more likely)
  _calm() { return Math.max(0, 1 - this.g.time / 60); }

  _range() {
    const a = this.u.def.attack;
    return a.range || 8;
  }

  _base(team) {
    const s = this.g.arena.spawns[team];
    return { x: 0, z: s.reduce((a, p) => a + p.z, 0) / s.length };
  }

  _bushNear(x, z) {
    const A = this.g.arena;
    let best = null, bd = 4.5;
    for (let tz = 0; tz < A.H; tz++) for (let tx = 0; tx < A.W; tx++) {
      if (A.at(tx, tz) !== 3) continue;
      const c = A.center(tx, tz);
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _gem(list) {
    const u = this.u;
    let best = null, bd = 11;
    for (const gm of this.g.gems.list) {
      if (gm.kind !== 'gem' || (gm.air && gm.t < 0.2)) continue;
      const d = Math.hypot(gm.x - u.pos.x, gm.z - u.pos.z);
      if (d > bd) continue;
      let contested = false;
      for (const { e } of list) {
        const de = Math.hypot(gm.x - e.pos.x, gm.z - e.pos.z);
        if (de < d - 1.5 && de < 5) { contested = true; break; }
      }
      // a teammate already closer takes it
      for (const f of this.g.units) {
        if (f === u || !f.alive || f.team !== u.team) continue;
        if (Math.hypot(gm.x - f.pos.x, gm.z - f.pos.z) < d - 1.2) { contested = true; break; }
      }
      if (contested && d > 2) continue;
      bd = d; best = gm;
    }
    return best;
  }

  _fightGoal(t) {
    const u = this.u, A = this.g.arena;
    let dx = u.pos.x - t.pos.x, dz = u.pos.z - t.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const pref = this.pref * (u.ammo < 1 ? 1.35 : 1);
    const px = -dz * this.strafe, pz = dx * this.strafe;
    let gx = t.pos.x + dx * pref + px * 1.8, gz = t.pos.z + dz * pref + pz * 1.8;
    // without line of sight, walk toward the target instead (around the cover)
    if (!A.los(u.pos.x, u.pos.z, t.pos.x, t.pos.z)) { gx = t.pos.x + dx * 1.5; gz = t.pos.z + dz * 1.5; }
    gx = Math.max(-A.halfW + 0.6, Math.min(A.halfW - 0.6, gx));
    gz = Math.max(-A.halfH + 0.6, Math.min(A.halfH - 0.6, gz));
    this.goal = { x: gx, z: gz };
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const u = this.u, g = this.g;
    if (!u.alive || g.phase !== 'play') { u.move.x = 0; u.move.z = 0; this.path = null; return; }
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = rnd(0.7, 1.9); }
    this.wander.t -= dt;
    if (this.wander.t <= 0) { this.wander.t = rnd(1.5, 3); this.wander.x = rnd(-1.2, 1.2); this.wander.z = rnd(-1, 1); }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = rnd(0.18, 0.3); }
    this._dodge(dt);
    this._steer(dt);
    this._shoot(dt);
  }

  _dodge(dt) {
    const u = this.u;
    if (this.dodge) {
      this.dodge.t -= dt;
      if (this.dodge.t <= 0) this.dodge = null;
      return;
    }
    if (Math.random() > this.d.dodge * dt * 8) return;
    for (const s of this.g.combat.shots) {
      if (s.team === u.team || s.dead) continue;
      const rx = u.pos.x - s.x, rz = u.pos.z - s.z;
      const along = rx * s.dx + rz * s.dz;
      if (along < 0 || along > s.speed * 0.6) continue;
      const side = rx * -s.dz + rz * s.dx;          // signed distance from the shot line
      if (Math.abs(side) > 0.95) continue;
      const sgn = side >= 0 ? 1 : -1;
      this.dodge = { x: -s.dz * sgn, z: s.dx * sgn, t: rnd(0.22, 0.34) };
      return;
    }
  }

  _steer(dt) {
    const u = this.u, A = this.g.arena;
    let mx = 0, mz = 0;
    if (this.dodge) { mx = this.dodge.x; mz = this.dodge.z; }
    else if (this.goal) {
      const gx = this.goal.x, gz = this.goal.z;
      const dist = Math.hypot(gx - u.pos.x, gz - u.pos.z);
      this.pathT -= dt;
      const moved = this.pathGoal ? Math.hypot(this.pathGoal.x - gx, this.pathGoal.z - gz) : 99;
      if (dist > 0.45 && (!this.path || this.pathT <= 0 || moved > 1.2)) {
        if (A.walkable(u.pos.x, u.pos.z, gx, gz, u.radius * 0.95)) this.path = [{ x: gx, z: gz }];
        else this.path = A.path(u.pos.x, u.pos.z, gx, gz, u.radius) || [{ x: gx, z: gz }];
        this.pathGoal = { x: gx, z: gz };
        this.pathT = 0.8;
      }
      if (this.path && this.path.length) {
        let wp = this.path[0];
        while (this.path.length > 1 && Math.hypot(wp.x - u.pos.x, wp.z - u.pos.z) < 0.4) { this.path.shift(); wp = this.path[0]; }
        const dx = wp.x - u.pos.x, dz = wp.z - u.pos.z, l = Math.hypot(dx, dz);
        if (l > 0.3 || this.path.length > 1) { mx = dx / (l || 1); mz = dz / (l || 1); }
        // ease into the final spot
        if (this.path.length === 1 && l < 0.9) { mx *= l / 0.9; mz *= l / 0.9; }
      }
    }
    // keep a little space from teammates
    for (const f of this.g.units) {
      if (f === u || !f.alive || f.team !== u.team) continue;
      const dx = u.pos.x - f.pos.x, dz = u.pos.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.3 && d > 1e-3) { const k = (1.3 - d) / 1.3 * 0.8; mx += dx / d * k; mz += dz / d * k; }
    }
    // stuck: nudge sideways and re-plan
    const moved = Math.hypot(u.pos.x - this.lastX, u.pos.z - this.lastZ);
    this.lastX = u.pos.x; this.lastZ = u.pos.z;
    if (Math.hypot(mx, mz) > 0.5 && moved < dt * 0.6) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) { this.path = null; this.stuckT = 0; this.dodge = { x: -mz * this.strafe, z: mx * this.strafe, t: 0.3 }; }
    } else this.stuckT = 0;
    u.move.x = mx; u.move.z = mz;
  }

  _shoot(dt) {
    const u = this.u, g = this.g, A = g.arena;
    this.holdFire = Math.max(0, this.holdFire - dt);
    const t = this.target;
    const def = u.def;
    // Showdown: only shoot brawlers when engaged (fighting, covering a retreat, or pushed together
    // by the gas once the calm is over); otherwise work on the power box, if any
    if (g.mode === 'showdown') {
      const engaged = this.mode === 'fight' || this.mode === 'retreat' || (this.mode === 'gas' && this._calm() === 0);
      if (!engaged) { if (this.boxTarget) this._shootBox(); return; }
    }
    if (!t || !t.alive || !g.visibleTo(u.team, t) || !this._reacted(t)) return;
    const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z, dist = Math.hypot(dx, dz);
    // super first
    if (u.superCharge >= 1 && this._wantSuper(t, dist)) {
      const aim = this._aim(t, def.super, dist);
      if (aim && u.useSuper(aim.x, aim.z, aim.d)) { this.holdFire = 0.3; return; }
    }
    if (u.ammo < 1 || u.cool > 0 || this.holdFire > 0) return;
    const range = def.attack.range;
    const reach = def.attack.kind === 'spread' ? range * 0.82 : range * 0.94;
    if (dist > reach) return;
    if (!A.los(u.pos.x, u.pos.z, t.pos.x, t.pos.z)) return;
    // keep one bar in reserve at long range unless aggressive
    if (u.ammo < 2 && dist > reach * 0.75 && this.d.aggression < 1.1 && Math.random() < 0.6) { this.holdFire = 0.35; return; }
    const aim = this._aim(t, def.attack, dist);
    if (!aim) return;
    if (u.attack(aim.x, aim.z, aim.d)) this.holdFire = rnd(0.05, 0.35) / this.d.aggression;
  }

  _shootBox() {
    const u = this.u, A = this.g.arena, b = this.boxTarget;
    if (!A.isBox(b.tx, b.tz)) { this.boxTarget = null; return; }
    if (u.ammo < 1 || u.cool > 0 || this.holdFire > 0) return;
    const dx = b.x - u.pos.x, dz = b.z - u.pos.z, d = Math.hypot(dx, dz);
    const spec = u.def.attack;
    if (d > spec.range * 0.9 || d < 0.3) return;
    const hit = A.raycast(u.pos.x, u.pos.z, dx / d, dz / d, d + 0.6);
    if (!hit.hit || hit.tx !== b.tx || hit.tz !== b.tz) return;       // something else is in the way
    if (u.attack(dx / d, dz / d, d)) this.holdFire = 0.15;
  }

  _wantSuper(t, dist) {
    const u = this.u, s = u.def.super;
    switch (s.kind) {
      case 'burst': return dist < s.range * 0.9 && (t.hp / t.maxHp < 0.75 || t.gems >= 3 || Math.random() < 0.02);
      case 'spread': return dist < s.range * 0.6;
      case 'barrage': return dist < s.range && dist > 2;
      case 'rally': {
        if (u.hp / u.maxHp < 0.55) return true;
        for (const f of this.g.units) if (f.alive && f.team === u.team && f !== u && f.hp / f.maxHp < 0.5 && Math.hypot(f.pos.x - u.pos.x, f.pos.z - u.pos.z) < s.radius) return true;
        return u.ammo < 1 && dist < 6;
      }
      default: return false;
    }
  }

  // lead the target by its velocity (times the difficulty's lead factor), plus aim error
  _aim(t, spec, dist) {
    const u = this.u;
    let speed = spec.speed || 14;
    if (spec.kind === 'rocket') speed *= 0.82;
    let px = t.pos.x, pz = t.pos.z;
    if (spec.kind === 'barrage') {
      const tt = (spec.delay || 0.5) + 0.2;
      px += t.vel.x * tt * this.d.lead; pz += t.vel.z * tt * this.d.lead;
    } else if (spec.kind !== 'rally') {
      const tt = dist / speed;
      px += t.vel.x * tt * this.d.lead; pz += t.vel.z * tt * this.d.lead;
    }
    let dx = px - u.pos.x, dz = pz - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return null;
    const err = gauss() * this.d.aimError * Math.PI / 180;
    const a = Math.atan2(dx, dz) + err;
    return { x: Math.sin(a), z: Math.cos(a), d };
  }
}
