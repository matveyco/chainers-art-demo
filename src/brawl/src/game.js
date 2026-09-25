// Matches against bots, two modes:
//  Gem Grab, 3 vs 3: the player and two bot teammates (blue, bottom) against three bots (red,
//   top). Gems pop out of the mine in the middle; a team holding 10 or more (and more than the
//   other team) for 15 seconds wins; knocked-out brawlers drop every gem they carry. When the
//   clock runs out the team with more gems wins.
//  Solo Showdown: six brawlers, every one for themselves, no respawns. Power boxes break into
//   power cubes (+10% health and damage each), the poison gas closes in from the edges, the last
//   one standing wins.
import { BRAWLERS, ROSTER, BOT_NAMES, RULES, TEAM, UNIT_RADIUS, SHOWDOWN } from './config.js';
import { Unit } from './unit.js';
import { Bot } from './bot.js';
import { Combat } from './combat.js';
import { Gems } from './gems.js';

const pc = window.pc;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Game {
  constructor(o) {
    Object.assign(this, o);          // app, ctx, arena, view, fx, bfx, sfx, markers, hud, input, rig, look
    this.phase = 'lobby';
    this.time = 0;
    this.units = [];
    this.bots = [];
    this.combat = new Combat(this);
    this.gems = new Gems(this.app, this.arena, this.bfx, this.sfx);
    this.gems.onPickup = (u, g) => this._pickup(u, g);
    this.mode = 'gemgrab';
    this.respawns = true;
    this.gems.onPop = (m) => this.sound('gempop', m, 0.8);
    this.player = null;
    this.timeLeft = RULES.matchTime;
    this.countdown = null;
    this.mineT = RULES.mineFirst;
    this.onEnd = null;               // (result) for the UI
    this.slowT = 0;
    this.stopT = 0;
    this.aimMarkers = null;
    this.difficulty = 'normal';
    this.result = null;
  }

  // the match plays on this arena (each mode has its own map and view)
  setArena(arena, view) {
    if (this.view && this.view !== view) this.view.root.enabled = false;
    this.arena = arena;
    this.view = view;
    this.gems.arena = arena;
    this.rig.arena = arena;
    view.root.enabled = true;
  }

  teamColor(t) { return t === 0 ? TEAM.blue.color : TEAM.red.color; }
  alive() { let n = 0; for (const u of this.units) if (u.alive) n++; return n; }
  teamGems(t) { let n = 0; for (const u of this.units) if (u.team === t) n += u.gems; return n; }

  visibleTo(team, u) {
    if (u.team === team) return true;
    if (!u.inBush || u.revealT > 0) return true;
    const r2 = RULES.revealNear * RULES.revealNear;
    for (const o of this.units) {
      if (!o.alive || o.team !== team) continue;
      const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  sound(name, pos, vol = 1) {
    const p = this.player ? this.player.pos : this.rig.target;
    const d = pos ? Math.hypot(pos.x - p.x, pos.z - p.z) : 0;
    const k = Math.max(0.18, Math.min(1, 1.3 - d / 14));
    this.sfx.play(name, vol * k);
  }

  // ------------------------------------------------------------------ setup
  // opts.mode: 'gemgrab' (default) or 'showdown'; opts.blue / opts.red: force the Gem Grab
  // line-ups (tests, the cover shot)
  start(brawler, difficulty = 'normal', opts = {}) {
    this.cleanup();
    this.mode = opts.mode || 'gemgrab';
    this.respawns = this.mode === 'gemgrab';
    this.difficulty = difficulty;
    this.arena.reset();
    this.view.rebuildWalls();
    this.arena.onBreak = (tx, tz, type) => this._onBreak(tx, tz, type);
    const names = shuffle(BOT_NAMES.slice());
    if (this.mode === 'showdown') this._setupShowdown(brawler, difficulty, names);
    else this._setupGemGrab(brawler, difficulty, names, opts);
    for (const u of this.units) {
      u.ring = this.markers.ring(u === this.player);
      const col = u === this.player ? [0.35, 1, 0.45] : this.teamColor(u.team);
      u.ring.set(col, u === this.player ? 0.95 : 0.8);
    }
    if (!this.aimMarkers) this.aimMarkers = { line: this.markers.line(), cone: this.markers.cone(), circle: this.markers.circle(), guide: this.markers.line() };
    this.input.setPlayer(this.player);
    this.hud.setup(this.units, this.player, this.mode);
    this.timeLeft = RULES.matchTime;
    this.countdown = null;
    this.mineT = RULES.mineFirst;
    this.gasT = 0;
    this.gasTick = 0;
    this.safe = this.arena.halfW + 0.6;
    if (this.gas) { this.gas.show(this.mode === 'showdown'); this.gas.set(this.safe); }
    this.time = 0;
    this.result = null;
    this.phase = 'intro';
    this.danced = false;
    this.reported = false;
    this.endAt = 0;
    this.introT = 3.4;
    this.lastCount = 4;
    this.rig.follow(this.player.pos.x, this.player.pos.z, 0, 0, true);
    this.rig.flyFrom(true);
    this.look.refresh();
  }

  _setupGemGrab(brawler, difficulty, names, opts) {
    const pickTeam = (first) => {
      const pool = shuffle(ROSTER.filter((b) => b !== first));
      const team = first ? [first] : [];
      while (team.length < 3) team.push(pool.length ? pool.shift() : ROSTER[Math.floor(Math.random() * ROSTER.length)]);
      return team;
    };
    const blue = opts.blue || pickTeam(brawler), red = opts.red || shuffle(ROSTER.slice()).slice(0, 3);
    const lanes = [0, -1, 1];
    let id = 0;
    blue.forEach((b, i) => this.units.push(new Unit(this, { id: id++, brawler: b, team: 0, name: i === 0 ? 'You' : names.pop(), isPlayer: i === 0, spawnIndex: [1, 0, 2][i] })));
    red.forEach((b, i) => this.units.push(new Unit(this, { id: id++, brawler: b, team: 1, name: names.pop(), spawnIndex: [1, 0, 2][i] })));
    this.player = this.units[0];
    for (const u of this.units) {
      const sp = this.arena.spawns[u.team][u.spawnIndex];
      u.place(sp.x, sp.z);
      u.yaw = u.aimYaw = u.team === 0 ? Math.PI : 0;
      if (u !== this.player) this.bots.push(new Bot(this, u, difficulty, lanes[this.units.filter((v) => v.team === u.team).indexOf(u)]));
    }
  }

  _setupShowdown(brawler, difficulty, names) {
    const spawns = this.arena.spawns[0].slice();
    // the player starts on the bottom edge, facing up the map; the others are shuffled
    spawns.sort((a, b) => b.z - a.z || Math.abs(a.x) - Math.abs(b.x));
    const mine = spawns.shift();
    shuffle(spawns);
    const pool = [];
    while (pool.length < SHOWDOWN.players - 1) pool.push(...shuffle(ROSTER.slice()));
    const line = [brawler, ...pool.slice(0, SHOWDOWN.players - 1)];
    line.forEach((b, i) => {
      const u = new Unit(this, { id: i, brawler: b, team: i, name: i === 0 ? 'You' : names.pop(), isPlayer: i === 0 });
      const sp = i === 0 ? mine : spawns[i - 1];
      u.place(sp.x, sp.z);
      u.yaw = u.aimYaw = Math.atan2(-sp.x, -sp.z);        // face the middle
      this.units.push(u);
      if (i > 0) this.bots.push(new Bot(this, u, difficulty, 0));
    });
    this.player = this.units[0];
  }

  cleanup() {
    for (const u of this.units) { u.avatar.destroy(); if (u.ring) u.ring.destroy(); }
    this.units.length = 0;
    this.bots.length = 0;
    this.combat.clear();
    this.gems.clear();
    this.markers.clearWarnings();
    if (this.aimMarkers) for (const m of Object.values(this.aimMarkers)) m.show(false);
    this.countdown = null;
    this.player = null;
    this.app.timeScale = 1;
    if (this.gas) this.gas.show(false);
    // bushes close up again and stop parting (the lobby shows the arena behind the stage)
    if (this.view) this.view.update(0, [], null, true);
  }

  // ------------------------------------------------------------------ events
  onHurt(u, amount, from, info) {
    const p = this.player;
    if (u.visible || u.team === p.team) {
      const kind = u === p ? 'hurt' : u.team === p.team ? 'ally' : (from === p ? 'dmg' : 'dmg dim');
      this.hud.number(new pc.Vec3(u.pos.x, 2.4, u.pos.z), amount, kind);
    }
    if (u === p) {
      this.sfx.play('hurt', 0.8);
      this.rig.addShake(Math.min(0.5, amount / 1400));
      document.body.classList.remove('ouch'); void document.body.offsetWidth; document.body.classList.add('ouch');
    } else if (from === p) {
      this.sfx.play('tick', 0.55);
    }
  }

  onHeal(u, amount) {
    if (u.visible || u.team === this.player.team) this.hud.number(new pc.Vec3(u.pos.x, 2.4, u.pos.z), amount, 'heal');
  }

  onKnockout(u, killer, gems) {
    const p = this.player;
    this.hud.killFeed(killer, u);
    this.bfx.knockout(u.pos, this.teamColor(u.team));
    this.sound('ko', u.pos, 1);
    if (this.mode === 'showdown') {
      u.rank = this.alive() + 1;
      // everything it collected, and at least one cube, spills out
      this.gems.spill(u.pos.x, u.pos.z, Math.max(1, u.cubes), 'cube');
      if (u === p) { this.hud.banner(`#${u.rank}`, 'small bad', 1.6); this.rig.addShake(0.6); this.endAt = this.time + 1.6; }
      else if (killer === p) { this.hitstop(70, 0.08); this.hud.banner('KNOCKOUT!', 'small good', 0.9); }
      if (this.alive() <= 1 && p.alive) { p.rank = 1; this.endAt = this.time + 0.8; }
      return;
    }
    if (gems > 0) {
      this.gems.spill(u.pos.x, u.pos.z, gems);
      this.sound('gemdrop', u.pos, 1);
    }
    if (killer === p) { this.hitstop(70, 0.08); this.hud.banner('KNOCKOUT!', 'small good', 0.9); }
    if (u === p) { this.hud.banner('KNOCKED OUT', 'small bad', 1.4); this.rig.addShake(0.6); }
  }

  // a wall or power box was destroyed (supers, or a box worn down by shots)
  _onBreak(tx, tz, type) {
    const c = this.arena.center(tx, tz);
    this.view.rebuildWalls(false);
    this.bfx.wallBreak(c.x, c.z, type === 2 ? 'stone' : 'crate');
    this.sound('wallbreak', new pc.Vec3(c.x, 0, c.z), 0.9);
    if (type === 6) { this.gems.spill(c.x, c.z, 1, 'cube'); this.sound('gempop', new pc.Vec3(c.x, 0, c.z), 0.8); }
  }

  onBoxHit(tx, tz, owner) {
    if (owner === this.player && this.time - (this._boxTick || 0) > 0.08) { this._boxTick = this.time; this.sfx.play('wood', 0.5); }
  }

  onRespawn(u) {
    this.bfx.spawnBeam(u.pos, u === this.player ? [0.4, 1, 0.5] : this.teamColor(u.team));
    if (u === this.player) this.sfx.play('respawn', 0.8);
  }

  onSuper(u) {
    this.sound('super', u.pos, 0.8);
    if (u === this.player) this.rig.addShake(0.25);
  }

  // the player's own shots: a little recoil in the view
  onPlayerFire(spec, dx, dz, isSuper) {
    const k = { burst: 0.07, spread: 0.2, rocket: 0.16, barrage: 0.1, rally: 0 }[spec.kind] ?? 0.08;
    this.rig.kick(dx, dz, k * (isSuper ? 1.8 : 1));
    this.rig.addShake(k * (isSuper ? 0.9 : 0.35));
  }

  onSuperReady(u) {
    if (u === this.player) { this.sfx.play('superready', 0.9); this.bfx.superReady(u.pos, [1, 0.85, 0.3]); }
  }

  onBlast(x, z, r) {
    const p = this.player;
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    this.rig.addShake(Math.max(0, 0.45 - d * 0.04));
  }

  _pickup(u, g) {
    if (g && g.kind === 'cube') {
      u.addCube();
      u.stats.gems++;
      this.bfx.powerUp(u.pos);
      if (u === this.player) { this.sfx.play('superready', 0.6); this.hud.number(new pc.Vec3(u.pos.x, 2.6, u.pos.z), Math.round(u.def.hp * SHOWDOWN.cubeHp), 'heal'); }
      else if (u.visible) this.sound('gem', u.pos, 0.35);
      return;
    }
    u.gems++;
    u.stats.gems++;
    if (u === this.player) this.sfx.play('gem', 0.9);
    else if (u.visible) this.sound('gem', u.pos, 0.35);
  }

  hitstop(ms, scale) { this.stopT = Math.max(this.stopT, ms / 1000); this.stopScale = scale; }

  // ------------------------------------------------------------------ player control
  _auto(u, spec) {
    // nearest visible enemy in reach, led a little
    let best = null, bd = (spec.range || 6) * 1.15;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || !this.visibleTo(u.team, e)) continue;
      const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return null;
    const t = bd / (spec.speed || 16);
    const x = best.pos.x + best.vel.x * t * 0.6 - u.pos.x, z = best.pos.z + best.vel.z * t * 0.6 - u.pos.z;
    const d = Math.hypot(x, z) || 1;
    return { dx: x / d, dz: z / d, dist: d };
  }

  _playerActions() {
    const u = this.player;
    for (const a of this.input.take()) {
      if (!u.alive || this.phase !== 'play') continue;
      const spec = a.type === 'super' ? u.def.super : u.def.attack;
      let dx = a.dx, dz = a.dz, dist = a.dist;
      if (a.auto) {
        const t = this._auto(u, spec);
        if (t) { dx = t.dx; dz = t.dz; dist = t.dist; } else { dx = Math.sin(u.yaw); dz = Math.cos(u.yaw); dist = (spec.range || 6) * 0.7; }
      }
      if (dist == null && a.reach != null) dist = a.reach * (spec.range || 8);
      if (a.type === 'super') u.useSuper(dx, dz, dist);
      else if (!u.attack(dx, dz, dist) && u.ammo < 1) this.sfx.play('empty', 0.5);
    }
  }

  _aimIndicator() {
    const M = this.aimMarkers, u = this.player, a = this.input.aim;
    for (const m of Object.values(M)) m.show(false);
    if (!u || !u.alive || this.phase !== 'play' || !a.active) return;
    const isSuper = a.kind === 'super';
    if (isSuper && u.superCharge < 1) return;
    const spec = isSuper ? u.def.super : u.def.attack;
    const col = isSuper ? [1, 0.82, 0.2] : [1, 1, 1];
    const alpha = isSuper ? 0.95 : (a.strong ? 0.9 : 0.72);
    const yaw = Math.atan2(a.dx, a.dz);
    const x = u.pos.x, z = u.pos.z, y = 0.05;
    const A = this.arena;
    if (spec.kind === 'burst' || spec.kind === 'rocket') {
      let len = spec.range;
      if (!spec.breakWalls) len = Math.max(0.6, A.raycast(x, z, a.dx, a.dz, spec.range).dist);
      const w = spec.width || (spec.kind === 'rocket' ? 0.7 : 0.5);
      M.line.set(col, alpha, [len, w, 0, 0]);
      M.line.place(x, y, z, yaw, w / 2, len);
      M.line.show(true);
    } else if (spec.kind === 'spread') {
      const half = (spec.arc / 2 + 4) * Math.PI / 180;
      M.cone.set(col, alpha, [spec.range, half, 0, 0]);
      M.cone.place(x, y, z, yaw, spec.range, spec.range);
      M.cone.show(true);
    } else if (spec.kind === 'barrage') {
      const d = Math.min(spec.range, Math.max(1.5, a.dist != null ? a.dist : (a.reach || 0.7) * spec.range));
      const tx = x + a.dx * d, tz = z + a.dz * d;
      M.circle.set(col, alpha, [spec.area + spec.splash * 0.5, 0, 0, 1]);
      M.circle.place(tx, y, tz, 0, spec.area + spec.splash * 0.5, spec.area + spec.splash * 0.5);
      M.circle.show(true);
      M.guide.set(col, alpha * 0.6, [d, 0.16, 0, 0]);
      M.guide.place(x, y, z, yaw, 0.08, d);
      M.guide.show(true);
    } else if (spec.kind === 'rally') {
      M.circle.set(col, alpha, [spec.radius, 0, 0, 1]);
      M.circle.place(x, y, z, 0, spec.radius, spec.radius);
      M.circle.show(true);
    }
  }

  // ------------------------------------------------------------------ frame
  // dt: simulation step (scaled during hit-stop), rawDt: real time
  update(dt, rawDt = dt) {
    if (this.phase === 'lobby') return;
    // hit-stop: a few frames of near-freeze on knockouts (the whole app slows, animation too)
    if (this.stopT > 0) this.stopT -= rawDt;
    this.app.timeScale = this.stopT > 0 ? (this.stopScale || 0.1) : 1;
    this.time += dt;
    const p = this.player;

    if (this.phase === 'intro') {
      this.introT -= dt;
      const n = Math.ceil(this.introT - 0.4);
      if (n < this.lastCount && n >= 1 && n <= 3) { this.lastCount = n; this.hud.banner(String(n), 'count', 0.8); this.sfx.play('count', 0.8); }
      if (this.introT <= 0.4 && this.lastCount > 0) { this.lastCount = 0; this.hud.banner('BRAWL!', 'go', 1.0); this.sfx.play('fight', 0.9); }
      if (this.introT <= 0) { this.phase = 'play'; this.input.enabled = true; }
    }

    // input
    this.input.update();
    if (p) { p.move.x = this.input.stick.x; p.move.z = this.input.stick.z; }
    if (this.phase === 'play') this._playerActions();

    // brains, bodies, bullets
    for (const b of this.bots) b.update(dt);
    for (const u of this.units) u.update(dt);
    this._separate();
    this.combat.update(dt);
    this.gems.update(dt, this.phase === 'play' ? this.units : []);

    // bush visibility for the player's team
    for (const u of this.units) {
      u.visible = this.visibleTo(p.team, u);
      if (u.alive) u.avatar.setVisible(u.visible || u.team === p.team);
      if (u.ring) {
        const show = u.alive && (u.visible || u.team === p.team) && this.phase !== 'end';
        u.ring.show(show);
        if (show) {
          u.ring.place(u.pos.x, 0.035, u.pos.z, u.yaw, 0.78, 0.78);
          // spawn shield: the ring pulses ice blue
          const base = u === p ? [0.35, 1, 0.45] : this.teamColor(u.team);
          if (u.shield > 0) { const k = 0.5 + 0.5 * Math.sin(this.time * 14); u.ring.set([0.55 + 0.45 * k, 0.9, 1], 1); u._ringShield = true; }
          else if (u._ringShield) { u.ring.set(base, u === p ? 0.95 : 0.8); u._ringShield = false; }
        }
      }
    }

    if (this.phase === 'play') this._rules(dt);
    if (this.phase === 'end') this._endUpdate(rawDt);

    // arena: bushes part around brawlers, see-through round the player
    const pushers = [];
    for (const u of this.units) if (u.alive) {
      const tx = this.arena.tileX(u.pos.x), tz = this.arena.tileZ(u.pos.z);
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) if (this.arena.at(tx + dx, tz + dz) === 3) { near = true; break; }
      if (near) pushers.push({ x: u.pos.x, z: u.pos.z, r: 1.1, s: Math.min(1, 0.45 + Math.hypot(u.vel.x, u.vel.z) * 0.2) });
    }
    let see = null;
    if (p.alive) {
      // leaves thin out round the player when inside a bush or standing just behind one
      const A = this.arena, tx = A.tileX(p.pos.x), tz = A.tileZ(p.pos.z);
      let near = false;
      for (let dz = 0; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (A.at(tx + dx, tz + dz) !== 3) continue;
        const c = A.center(tx + dx, tz + dz);
        if (Math.abs(c.x - p.pos.x) < 1.05 && c.z - p.pos.z > -0.6 && c.z - p.pos.z < 1.35) { near = true; break; }
      }
      see = { x: p.pos.x, z: p.pos.z + 0.25, s: near ? 1 : 0 };
    }
    this.view.update(dt, pushers, see);
    if (this.gas && this.mode === 'showdown') this.gas.update(dt);

    // camera
    if (this.phase !== 'end') {
      const a = this.input.aim;
      const lead = a.active ? 1.2 : 0;
      this.rig.follow(p.pos.x, p.pos.z, a.dx * lead, a.dz * lead);
    }
    this.rig.addShake(this.fx.shake * 0.02);
    this._aimIndicator();
    this.hud.update(rawDt, this);
  }

  post(dt) { for (const u of this.units) u.post(dt); }

  // brawlers overlap a little at most: soft push apart
  _separate() {
    const U = this.units, r = UNIT_RADIUS * 1.6;
    for (let i = 0; i < U.length; i++) {
      const a = U[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < U.length; j++) {
        const b = U[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d >= r || d < 1e-4) continue;
        const k = (r - d) * 0.5 * 0.35;
        a.pos.x -= dx / d * k; a.pos.z -= dz / d * k;
        b.pos.x += dx / d * k; b.pos.z += dz / d * k;
      }
    }
  }

  _rules(dt) {
    if (this.mode === 'showdown') { this._rulesShowdown(dt); return; }
    // mine
    this.mineT -= dt;
    if (this.mineT <= 0) {
      this.mineT += RULES.mineEvery;
      if (this.gems.count() < 24) this.gems.fromMine();
    }
    // countdown to victory
    const b = this.teamGems(0), r = this.teamGems(1);
    let lead = -1;
    if (b >= RULES.gemsToWin && b > r) lead = 0; else if (r >= RULES.gemsToWin && r > b) lead = 1;
    if (lead >= 0) {
      if (!this.countdown || this.countdown.team !== lead) {
        this.countdown = { team: lead, left: RULES.countdown, lastS: RULES.countdown + 1 };
        this.sfx.play('alarm', 0.8);
      }
      this.countdown.left -= dt;
      const s = Math.ceil(this.countdown.left);
      if (s < this.countdown.lastS) { this.countdown.lastS = s; if (s <= 5) this.sfx.play('tickclock', 0.9); }
      if (this.countdown.left <= 0) { this._end(lead); return; }
    } else if (this.countdown) {
      this.countdown = null;
      this.hud.banner('COUNTDOWN STOPPED', 'small', 1.2);
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._end(b > r ? 0 : r > b ? 1 : -1);
    }
  }

  _rulesShowdown(dt) {
    const S = SHOWDOWN, A = this.arena;
    this.gasT += dt;
    const k = Math.max(0, Math.min(1, (this.gasT - S.gasStart) / S.gasDuration));
    const e = k * k * (3 - 2 * k);
    const start = A.halfW + 0.6;
    this.safe = start + (S.gasFinal - start) * e;
    if (this.gas) this.gas.set(this.safe);
    if (this.gasT > S.gasStart - 5 && !this.gasWarned) { this.gasWarned = true; this.hud.banner('THE GAS IS COMING', 'small', 1.6); this.sfx.play('alarm', 0.7); }
    // gas damage, in ticks
    this.gasTick -= dt;
    if (this.gasTick <= 0) {
      this.gasTick += 0.5;
      const dps = S.gasDps * (1 + e);
      for (const u of this.units) {
        if (!u.alive) continue;
        if (Math.max(Math.abs(u.pos.x), Math.abs(u.pos.z)) <= this.safe) continue;
        u.hurt(dps * 0.5, null, { color: [0.5, 1, 0.4], kind: 'gas' });
      }
    }
    this.timeLeft = Math.max(0, S.gasStart + S.gasDuration - this.gasT);
    // the match ends when the player is out (after a moment) or is the last one standing
    if (this.endAt && this.time >= this.endAt) {
      const p = this.player;
      this._end(p.alive ? p.team : -2);
    }
  }

  inGas(u) { return this.mode === 'showdown' && Math.max(Math.abs(u.pos.x), Math.abs(u.pos.z)) > this.safe; }

  _end(winner) {
    this.phase = 'end';
    this.input.enabled = false;
    this.input.clear();
    this.endT = 0;
    const p = this.player;
    this.countdown = null;
    for (const u of this.units) { u.move.x = u.move.z = 0; u.burst = null; }
    this.hitstop(300, 0.25);
    if (this.mode === 'showdown') {
      const rank = p.alive ? 1 : p.rank;
      const won = rank === 1;
      // survivors (when the player is out early) share the places above
      let r = 1;
      for (const u of this.units.filter((x) => x.alive && x !== p)) u.rank = r++;
      if (p.alive) p.rank = 1;
      this.result = { mode: 'showdown', winner: won ? p.team : -1, won, draw: false, rank };
      this.hud.banner(won ? '#1 VICTORY!' : `#${rank}`, won ? 'end win' : 'end lose', 99);
      this.sfx.play(won ? 'win' : rank <= 3 ? 'buzzer' : 'lose', 0.9);
      return;
    }
    const won = winner === p.team, draw = winner < 0;
    this.result = { mode: 'gemgrab', winner, won, draw };
    this.hud.banner(draw ? 'DRAW' : won ? 'VICTORY!' : 'DEFEAT', draw ? 'end draw' : won ? 'end win' : 'end lose', 99);
    this.sfx.play(draw ? 'buzzer' : won ? 'win' : 'lose', 0.9);
  }

  _endUpdate(dt) {
    this.endT += dt;
    if (this.endT > 0.9 && !this.danced) {
      this.danced = true;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (this.result.winner === u.team || (this.mode === 'showdown' && this.result.won && u === this.player)) u.avatar.emote('Dance');
      }
    }
    const p = this.player;
    this.rig.follow(p.pos.x, p.pos.z, 0, 0.6);
    if (this.gas && this.mode === 'showdown') this.gas.set(this.safe);
    if (this.endT > 2.4 && !this.reported) {
      this.reported = true;
      if (this.onEnd) this.onEnd(this.result, this.units);
    }
  }

  resetEnd() { this.danced = false; this.reported = false; }
}
