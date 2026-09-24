// Player: input -> movement (kinematic), third-person camera, animation state selection,
// weapons (hitscan + rocket), reloads, emotes, roll, jump, hit & death.
import { rayBox, boxNormal } from './physics.js';

const pc = window.pc;
const D2R = Math.PI / 180;

export const WEAPONS = {
  Pistol:   { key: '1', mag: 12, delay: 0.2, auto: false, dmg: 34, pellets: 1, range: 80, sound: 'pistol', flash: 0.9, casing: 'brass', magDrop: 0.42,
              spread: 0.35, bloomAdd: 0.38, bloomSpread: 2.2, moveSpread: 1.2, kick: 1.6, bodyKick: 7, kickYaw: 1, fovKick: 1.6, punch: 0.06, shake: 0.14, smoke: 1 },
  SMG:      { key: '2', mag: 30, delay: 0.1, auto: true, dmg: 14, pellets: 1, range: 70, sound: 'smg', flash: 0.75, casing: 'brass', magDrop: 0.56,
              spread: 1.0, bloomAdd: 0.11, bloomSpread: 3.4, moveSpread: 1.4, kick: 0.55, bodyKick: 2.4, kickYaw: 1.4, fovKick: 0.5, punch: 0.025, shake: 0.07, smoke: 1 },
  Shotgun:  { key: '3', mag: 4, delay: 0.88, auto: false, dmg: 13, pellets: 9, range: 40, sound: 'shotgun', flash: 1.5, casing: 'shell', perReload: 2,
              spread: 4.6, bloomAdd: 0.6, bloomSpread: 0, moveSpread: 1.0, kick: 3.4, bodyKick: 14, kickYaw: 2, fovKick: 5, punch: 0.28, shake: 0.4, smoke: 3 },
  Launcher: { key: '4', mag: 1, delay: 0.9, auto: false, projectile: true, speed: 24, radius: 3.4, dmg: 150, sound: 'launcher', flash: 1.7,
              spread: 0, bloomAdd: 0.5, bloomSpread: 0, moveSpread: 0, kick: 2.8, bodyKick: 10, kickYaw: 0, fovKick: 6, punch: 0.32, shake: 0.5, smoke: 4 },
};
export const ORDER = ['Pistol', 'SMG', 'Shotgun', 'Launcher'];

const ROCKET_OFF = new pc.Vec3(0, 0.15, 0.48);

function angDiff(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

export class Player {
  constructor(app, ch, mover, cam, fx, sfx, targets, colliders, meta) {
    Object.assign(this, { app, ch, mover, cam, fx, sfx, targets, colliders, meta });
    this.pos = new pc.Vec3(0, 0, 0);
    this.vel = new pc.Vec3();
    this.yaw = 0;                 // character facing (deg), +Z at 0
    this.grounded = true;
    this.camYaw = 180;            // camera orbit yaw (deg): camera behind player looks +Z
    this.camPitch = 12;
    this.camDist = 4.6;
    this.camTarget = new pc.Vec3(0, 1.5, 0);
    this.shoulder = 0;
    this.action = null;           // {name, t, dur, ...}
    this.weapon = null;
    this.ammo = Object.fromEntries(ORDER.map((w) => [w, WEAPONS[w].mag]));
    this.cool = 0;
    this.reload = null;
    this.firing = false;
    this.trigger = false;
    this.keys = new Set();
    this.moveInput = new pc.Vec2();
    this.touchMove = null;
    this.runHeld = false;
    this.enabled = true;
    this.dead = false;
    this.projectiles = [];
    this.stepT = 0;
    this.baseState = 'Locomotion';
    this.upperState = 'None';
    this.recoil = 0;
    this.bloom = 0;               // 0..1 accuracy loss from firing (crosshair opens up)
    this.fovKick = 0;             // degrees added to the camera FOV
    this.camPunch = 0;            // metres the camera is shoved back
    this.score = null;            // set by main
    this.decals = null;
    this.onExplosion = null;
    this.onChange = null;          // UI callback
    this.onToast = null;
    this._bindEvents();
  }

  // ---------------------------------------------------------------- input
  keyDown(code) {
    if (!this.enabled) return;
    this.keys.add(code);
    this.sfx.ensure();
    switch (code) {
      case 'Space': this.jump(); break;
      case 'KeyC': case 'ControlLeft': this.roll(); break;
      case 'Digit1': this.equip('Pistol'); break;
      case 'Digit2': this.equip('SMG'); break;
      case 'Digit3': this.equip('Shotgun'); break;
      case 'Digit4': this.equip('Launcher'); break;
      case 'KeyQ': case 'Digit0': this.equip(null); break;
      case 'KeyR': this.startReload(); break;
      case 'KeyF': this.emote('Wave'); break;
      case 'KeyG': this.emote('Dance'); break;
      case 'KeyK': this.die(); break;
      default: break;
    }
  }

  keyUp(code) { this.keys.delete(code); }

  triggerDown() { if (!this.enabled) return; this.sfx.ensure(); this.trigger = true; this.tryFire(true); }
  triggerUp() { this.trigger = false; }

  look(dx, dy) {
    this.camYaw -= dx * 0.16;
    this.camPitch = Math.max(-30, Math.min(55, this.camPitch + dy * 0.14));
  }

  zoom(d) { this.camDist = Math.max(1.8, Math.min(9, this.camDist * (1 + d * 0.001))); }

  // ---------------------------------------------------------------- actions
  _startAction(name, opts = {}) {
    const m = this.ch.clipMeta[name];
    this.action = Object.assign({ name, t: 0, dur: m ? m.duration : 1, lockMove: true, full: true }, opts);
    this.ch.playBase(name, opts.blend ?? 0.12, 0);
    this.baseState = name;
  }

  jump() {
    if (!this.grounded || this.dead || (this.action && this.action.name !== 'Jump_Land' && this.action.name !== 'Dance')) return;
    this._startAction('Jump_Start', { lockMove: false, full: false, blend: 0.06 });
    this.action.launch = 0.1;
    this.sfx.play('jump');
  }

  roll() {
    if (!this.grounded || this.dead || (this.action && !['Jump_Land', 'Dance', 'Wave'].includes(this.action.name))) return;
    this.cancelReload();
    // roll toward input direction if any, else facing
    const dir = this._inputWorld();
    if (dir.lengthSq() > 0.01) this.yaw = Math.atan2(dir.x, dir.z) / D2R;
    this._startAction('Roll', { lockMove: true, full: true, blend: 0.06, travel: this.ch.clipMeta.Roll.travel, done: 0 });
    this.sfx.play('jump');
  }

  emote(name) {
    if (!this.grounded || this.dead || this.action) return;
    if (this.weapon) this.equip(null);
    this._startAction(name, { lockMove: false, full: true, emote: true, blend: 0.25, dur: name === 'Dance' ? 1e9 : undefined });
    if (name === 'Wave') this.action.dur = this.ch.clipMeta.Wave.duration;
  }

  hit(fromDir) {
    if (this.dead || (this.action && this.action.name === 'Roll')) return;
    this.cancelReload();
    this._startAction('Hit_React', { lockMove: true, full: true, blend: 0.05 });
    if (fromDir) { this.vel.x += fromDir.x * 3; this.vel.z += fromDir.z * 3; }
  }

  die() {
    if (this.dead) { this.respawn(); return; }
    this.cancelReload();
    this.dead = true;
    this._startAction('Death', { lockMove: true, full: true, blend: 0.08, dur: 3.2 });
    this.onToast && this.onToast('Knocked out. Respawning…');
  }

  respawn() {
    this.dead = false;
    this.action = null;
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.ch.playBase('Locomotion', 0.2);
    this.baseState = 'Locomotion';
  }

  equip(name) {
    if (this.dead || (this.action && this.action.full && !this.action.emote)) return;
    if (name === this.weapon) return;
    if (this.action && this.action.emote) { this.action = null; }
    this.cancelReload();
    this.weapon = name;
    this.ch.equip(name);
    this.sfx.play('swap');
    this.firing = false;
    this.cool = 0.18;
    if (name) {
      this.ch.upperWeight = 0;       // quick raise
      this.upperState = name + '_Idle';
      this.ch.playUpper(this.upperState, 0.0);
      if (name === 'Launcher' && this.ammo.Launcher === 0) this.startReload();
    }
    this.onChange && this.onChange();
  }

  refill() {
    this.cancelReload();
    for (const w of ORDER) this.ammo[w] = WEAPONS[w].mag;
    if (!this.weapon && !this.dead) this.equip('Pistol');
    this.onChange && this.onChange();
  }

  cancelReload() {
    if (this.reload) {
      this.reload = null;
      if (this.weapon) { this.upperState = this.weapon + '_Idle'; this.ch.playUpper(this.upperState, 0.15); this.ch.playWeaponClip('none'); }
    }
  }

  startReload() {
    const w = this.weapon;
    if (!w || this.reload || this.dead) return;
    if (this.ammo[w] >= WEAPONS[w].mag) return;
    if (this.action && this.action.full) return;
    const clip = w + '_Reload';
    this.reload = { t: 0, dur: this.ch.clipMeta[clip].duration, clip, dropped: false };
    this.upperState = clip;
    this.ch.playUpper(clip, 0.1);
    this.ch.playWeaponClip(clip);
    this.firing = false;
    this.onChange && this.onChange();
  }

  // ---------------------------------------------------------------- firing
  aimRay() {
    return { from: this.cam.getPosition().clone(), dir: this.cam.forward.clone().normalize() };
  }

  raycastWorld(o, d, maxDist, ignoreTargets = false) {
    let best = null;
    if (!ignoreTargets) {
      const t = this.targets.raycast(o, d, maxDist);
      if (t) best = { dist: t.dist, point: t.point, normal: t.normal, target: t.target, part: t.part };
    }
    for (const c of this.colliders) {
      if (c.active === false || c.kind === 'dummy' || c.kind === 'barrel') continue;
      const dist = rayBox(o, d, c.min, c.max, maxDist);
      if (dist > 0 && (!best || dist < best.dist)) {
        const p = o.clone().add(d.clone().mulScalar(dist));
        best = { dist, point: p, normal: boxNormal(p, c.min, c.max), collider: c };
      }
    }
    if (d.y < -1e-4) {
      const dist = -o.y / d.y;
      if (dist > 0 && dist < maxDist && (!best || dist < best.dist)) {
        best = { dist, point: o.clone().add(d.clone().mulScalar(dist)), normal: new pc.Vec3(0, 1, 0), floor: true };
      }
    }
    return best;
  }

  muzzle() {
    const w = this.ch.weapon;
    const node = w.nodes.Muzzle;
    const pos = node.getPosition().clone();
    const dir = w.entity.getWorldTransform().transformVector(new pc.Vec3(0, 0, 1)).normalize();
    return { pos, dir };
  }

  // current cone half-angle in degrees: base + firing bloom + movement + airborne
  currentSpread() {
    const spec = WEAPONS[this.weapon];
    if (!spec) return 0;
    const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3);
    return spec.spread + spec.bloomSpread * this.bloom + spec.moveSpread * moving + (this.grounded ? 0 : 2.5);
  }

  _surface(hit) {
    if (hit.target) return hit.target.kind;
    if (hit.floor) return 'floor';
    return hit.collider && hit.collider.surface || 'metal';
  }

  tryFire(press) {
    const w = this.weapon;
    if (!w || this.dead || !this.enabled) return;
    if (this.action && this.action.full) return;
    const spec = WEAPONS[w];
    if (!press && !spec.auto) return;
    if (this.cool > 0) return;
    if (this.reload) {
      if (w === 'Shotgun' && this.ammo[w] > 0) this.cancelReload(); else return;
    }
    if (this.ammo[w] <= 0) { if (press) { this.sfx.play('empty'); this.startReload(); } return; }
    this.ammo[w]--;
    this.cool = spec.delay;
    const clip = w + '_Shoot';
    // animation
    if (spec.auto) {
      if (this.upperState !== clip) { this.upperState = clip; this.ch.playUpper(clip, 0.03); this.ch.playWeaponClip(clip); }
      this.firing = true;
    } else {
      this.upperState = clip;
      this.ch.restartUpper(clip, 0.02);
      this.ch.playWeaponClip(clip);
      this.shootT = 0;
    }
    const spreadDeg = this.currentSpread();
    // aim point from camera centre
    const aim = this.aimRay();
    const hitA = this.raycastWorld(aim.from, aim.dir, 120);
    const aimPoint = hitA ? hitA.point : aim.from.clone().add(aim.dir.clone().mulScalar(120));
    const mz = this.muzzle();
    this.fx.muzzle(mz.pos, mz.dir, spec.flash);
    this.fx.muzzleSmoke(mz.pos, mz.dir, spec.smoke);
    this.sfx.play(spec.sound);
    // feel: camera climbs, FOV punches, camera shoves back, upper body kicks, crosshair blooms
    this.recoil += spec.kick;
    this.fovKick = Math.min(9, this.fovKick + spec.fovKick);
    this.camPunch = Math.min(0.5, this.camPunch + spec.punch);
    this.ch.addKick(spec.bodyKick, (Math.random() - 0.5) * 2 * spec.kickYaw);
    this.bloom = Math.min(1, this.bloom + spec.bloomAdd);
    this.sinceShot = 0;
    this.fx.addShake(spec.shake);
    if (spec.projectile) {
      this._spawnRocket(mz.pos, aimPoint.clone().sub(mz.pos).normalize(), spec);
      this.score && this.score.shot(false);
    } else {
      const base = aimPoint.clone().sub(mz.pos).normalize();
      const per = new Map();
      for (let i = 0; i < spec.pellets; i++) {
        const d = this._spread(base, spreadDeg);
        const hit = this.raycastWorld(mz.pos, d, spec.range);
        const end = hit ? hit.point : mz.pos.clone().add(d.clone().mulScalar(spec.range));
        if (i < 4 || Math.random() < 0.4) this.fx.tracer(mz.pos.clone().add(d.clone().mulScalar(0.25)), end, spec.pellets > 1 ? 0.8 : 1.15);
        if (!hit) continue;
        const surface = this._surface(hit);
        this.fx.impact(hit.point, hit.normal, surface, spec.pellets > 1 ? 0.5 : 1);
        if (hit.target) {
          const head = hit.part === 'head';
          const acc = per.get(hit.target) || { amount: 0, head: false, point: hit.point, dir: d };
          acc.amount += spec.dmg * (head ? 2 : 1);
          acc.head = acc.head || head;
          if (head) acc.point = hit.point;
          per.set(hit.target, acc);
        } else {
          if (this.decals) this.decals.add(hit.point, hit.normal, spec.pellets > 1 ? 0.045 : 0.06, surface === 'floor' ? 3 : surface === 'wood' ? 1 : 0);
          if (i < 2) this.sfx.play(surface === 'wood' ? 'wood' : surface === 'floor' ? 'dirt' : 'metal', Math.max(0.25, 1 - hit.dist / 40));
        }
      }
      const from = this.pos.clone();
      for (const [t, acc] of per) {
        this.targets.damage(t, acc.amount, acc.dir, { head: acc.head, point: acc.point, weapon: w, dist: from.distance(acc.point), source: 'player' });
      }
      this.score && this.score.shot(per.size > 0);
    }
    if (this.ammo[w] === 0 && !spec.projectile) setTimeout(() => { if (this.weapon === w && this.ammo[w] === 0) this.startReload(); }, 380);
    if (spec.projectile) setTimeout(() => { if (this.weapon === w && this.ammo[w] === 0) this.startReload(); }, 650);
    this.onChange && this.onChange();
  }

  _spread(dir, deg) {
    if (!deg) return dir.clone();
    const a = (Math.random() - 0.5) * 2 * deg * D2R, b = (Math.random() - 0.5) * 2 * deg * D2R;
    const up = Math.abs(dir.y) > 0.95 ? pc.Vec3.RIGHT : pc.Vec3.UP;
    const r = new pc.Vec3().cross(dir, up).normalize();
    const u = new pc.Vec3().cross(r, dir).normalize();
    return dir.clone().add(r.mulScalar(Math.tan(a))).add(u.mulScalar(Math.tan(b))).normalize();
  }

  _spawnRocket(pos, dir, spec) {
    const tpl = this.ch.weapon.nodes.Rocket;
    const e = tpl.clone();
    e.enabled = true;
    this.app.root.addChild(e);
    e.setPosition(tpl.getPosition());
    e.setRotation(tpl.getRotation());
    e.setLocalScale(1, 1, 1);
    // rocket geometry is authored in weapon space: its centre sits at ROCKET_OFF from the node origin
    const centre = tpl.getWorldTransform().transformPoint(ROCKET_OFF.clone());
    const d = dir.clone();
    this.projectiles.push({ e, pos: centre, dir: d, speed: spec.speed * 0.35, spec, t: 0, trail: 0 });
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      p.speed = Math.min(p.spec.speed, p.speed + 60 * dt);
      const step = p.speed * dt;
      const hit = this.raycastWorld(p.pos, p.dir, step + 0.05);
      if (hit || p.t > 4) {
        const at = hit ? hit.point.clone().add(hit.normal.clone().mulScalar(0.1)) : p.pos;
        this.fx.explosion(at, 3);
        this.sfx.play('explosion');
        if (hit && hit.target && hit.target.kind === 'dummy') {
          this.targets.damage(hit.target, 80, p.dir, { head: hit.part === 'head', point: hit.point, weapon: 'Launcher', dist: this.pos.distance(hit.point), source: 'player' });
        }
        this.targets.blast(at, p.spec.radius, p.spec.dmg, null);
        this.onExplosion && this.onExplosion(at, hit);
        p.e.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.add(p.dir.clone().mulScalar(step));
      // orient rocket along flight dir; geometry sits at its authored offset
      const q = new pc.Quat().setFromMat4(new pc.Mat4().setLookAt(pc.Vec3.ZERO, p.dir.clone().mulScalar(-1), pc.Vec3.UP));
      p.e.setRotation(q);
      const lookOff = q.transformVector(ROCKET_OFF.clone());
      p.e.setPosition(p.pos.clone().sub(lookOff));
      this.fx.rocketExhaust(p.pos.clone().sub(p.dir.clone().mulScalar(0.3)), p.dir);
      p.trail += dt;
      while (p.trail > 0.018) {
        p.trail -= 0.018;
        this.fx.puff(p.pos.clone().sub(p.dir.clone().mulScalar(0.25)), 'smoke', 0.14 + Math.random() * 0.08, 0.7, new pc.Vec3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4));
      }
    }
  }

  _bindEvents() {
    const a = this.ch.anim;
    const ev = {
      eject: () => this._eject(),
      mag_out: () => this.sfx.play('click'), mag_in: () => this.sfx.play('clack'), slide: () => this.sfx.play('clack'),
      bolt: () => this.sfx.play('clack'), pump: () => this.sfx.play('pump'), shell_in: () => this.sfx.play('click'),
      rocket_in: () => this.sfx.play('clack'), rocket_grab: () => this.sfx.play('click'), mag_grab: () => this.sfx.play('click'),
      impact: () => { this.sfx.play('thud'); this.fx.addShake(0.3); },
    };
    for (const [k, f] of Object.entries(ev)) a.on(k, f);
  }

  _eject() {
    const w = this.ch.weapon;
    if (!w || !w.nodes.Eject) return;
    const spec = WEAPONS[w.name];
    if (!spec.casing) return;
    const p = w.nodes.Eject.getPosition();
    const right = w.entity.getWorldTransform().transformVector(new pc.Vec3(-1, 0.35, 0.1)).normalize();
    this.fx.casing(p, right, spec.casing);
  }

  _inputWorld() {
    const f = new pc.Vec3(-Math.sin(this.camYaw * D2R), 0, -Math.cos(this.camYaw * D2R));
    const r = new pc.Vec3(Math.cos(this.camYaw * D2R), 0, -Math.sin(this.camYaw * D2R));
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    let mag = Math.min(1, Math.hypot(x, y));
    if (this.touchMove) { x = this.touchMove.x; y = this.touchMove.y; mag = Math.min(1, Math.hypot(x, y)); }
    if (mag < 0.05) return new pc.Vec3();
    const n = Math.hypot(x, y);
    const d = f.mulScalar(y / n).add(r.mulScalar(x / n));
    return d.mulScalar(mag);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const ch = this.ch;
    this.cool = Math.max(0, this.cool - dt);
    const armed = !!this.weapon;
    const act = this.action;
    if (act) act.t += dt;

    // ---- desired velocity
    const inp = this.enabled && !this.dead ? this._inputWorld() : new pc.Vec3();
    const running = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (this.touchMove && Math.hypot(this.touchMove.x, this.touchMove.y) > 0.85));
    let desired = new pc.Vec3();
    const facingFwd = new pc.Vec3(Math.sin(this.yaw * D2R), 0, Math.cos(this.yaw * D2R));
    const facingRight = new pc.Vec3(-Math.cos(this.yaw * D2R), 0, Math.sin(this.yaw * D2R));
    if (inp.lengthSq() > 0 && !(act && act.lockMove)) {
      if (armed) {
        // strafe set: speed depends on direction relative to the aim
        const lf = inp.dot(facingFwd), lr = inp.dot(facingRight);
        const fwdMax = running && lf > 0.5 ? 3.06 : 0.9;
        const vf = lf >= 0 ? lf * fwdMax : lf * 0.61;
        const vr = lr * 0.6875;
        desired = facingFwd.clone().mulScalar(vf).add(facingRight.clone().mulScalar(vr));
      } else {
        desired = inp.clone().mulScalar(running ? 3.06 : 0.9);
      }
    }
    if (act && act.name === 'Roll') {
      // scripted travel from clip metadata
      const tr = act.travel;
      const tt = Math.min(act.t, act.dur);
      let d = 0;
      for (let i = 0; i < tr.length - 1; i++) {
        if (tt >= tr[i][0] && tt <= tr[i + 1][0]) { const u = (tt - tr[i][0]) / (tr[i + 1][0] - tr[i][0]); d = tr[i][1] + (tr[i + 1][1] - tr[i][1]) * u; }
      }
      if (tt >= tr[tr.length - 1][0]) d = tr[tr.length - 1][1];
      const step = d - act.done;
      act.done = d;
      this.mover.move(this.pos, facingFwd.x * step, facingFwd.z * step);
      this.vel.x = 0; this.vel.z = 0;
    } else {
      const accel = this.grounded ? 14 : 4;
      const k = 1 - Math.exp(-accel * dt);
      this.vel.x += (desired.x - this.vel.x) * k;
      this.vel.z += (desired.z - this.vel.z) * k;
      this.mover.move(this.pos, this.vel.x * dt, this.vel.z * dt);
    }
    // ---- vertical
    if (act && act.name === 'Jump_Start' && act.launch !== undefined && act.t >= act.launch) {
      act.launch = undefined;
      this.vel.y = 6.2;
      this.grounded = false;
    }
    if (!this.grounded || this.vel.y > 0) {
      this.vel.y -= 21 * dt;
      const r = this.mover.moveY(this.pos, this.vel.y * dt);
      if (r.ceiling) this.vel.y = Math.min(0, this.vel.y);
      if (r.grounded && this.vel.y <= 0) {
        const fall = this.vel.y;
        this.vel.y = 0;
        this.grounded = true;
        if (!this.dead) {
          this._startAction('Jump_Land', { lockMove: false, full: false, blend: 0.05, dur: 0.3 });
          this.sfx.play('land', Math.min(1, -fall / 8));
        }
      }
    } else {
      // walked off a ledge?
      const g = this.mover.groundAt(this.pos, 0.05);
      if (this.pos.y - g > 0.06) { this.grounded = false; this.vel.y = 0; }
      else this.pos.y = g;
    }

    // ---- facing
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (!(act && act.name === 'Roll') && !this.dead) {
      let target = null;
      if (armed) target = this.camYaw + 180;
      else if (speed > 0.15 && !(act && act.lockMove)) target = Math.atan2(this.vel.x, this.vel.z) / D2R;
      if (target !== null) {
        const d = angDiff(this.yaw, target);
        const maxStep = (armed ? 900 : 540) * dt;
        this.yaw += Math.max(-maxStep, Math.min(maxStep, d));
      }
    }

    // ---- action completion
    if (act && act.t >= act.dur) {
      if (act.name === 'Jump_Start') {
        if (!this.grounded) { this.action = null; } else { this.action = null; }
      } else if (act.name === 'Death') {
        this.respawn();
      } else {
        this.action = null;
      }
    }
    if (this.action && this.action.emote && this.action.name === 'Dance' && inp.lengthSq() > 0.01) this.action = null;

    // ---- base layer state
    let base;
    const a2 = this.action;
    if (a2 && (a2.full || a2.name === 'Jump_Start' || a2.name === 'Jump_Land')) base = a2.name;
    else if (!this.grounded) base = 'Jump_Loop';
    else if (armed && speed < 0.08) base = this.weapon + '_Idle';
    else base = 'Locomotion';
    if (a2 && a2.name === 'Jump_Land' && speed > 0.5) base = 'Locomotion';
    if (base !== this.baseState) {
      const blend = base === 'Jump_Loop' ? 0.18 : (this.baseState === 'Jump_Land' ? 0.15 : 0.2);
      ch.playBase(base, blend);
      this.baseState = base;
    }
    // locomotion blend params in character space (m/s)
    const vf = this.vel.x * facingFwd.x + this.vel.z * facingFwd.z;
    const vr = this.vel.x * facingRight.x + this.vel.z * facingRight.z;
    ch.setLocomotion(vr, vf);

    // ---- upper (weapon) layer
    const fullBody = a2 && a2.full;
    ch.upperTarget = armed && !fullBody ? 1 : 0;
    if (armed) {
      const w = this.weapon;
      if (this.reload) {
        this.reload.t += dt;
        const spec = WEAPONS[w];
        if (spec.magDrop && !this.reload.dropped && this.reload.t >= spec.magDrop) {
          this.reload.dropped = true;
          const mag = ch.weapon.nodes.Mag;
          if (mag) this.fx.prop(mag, mag.getWorldTransform().clone(), new pc.Vec3(0, -2.6, 0), 2.5, 0.14);
        }
        if (this.reload.t >= this.reload.dur) {
          const spec2 = WEAPONS[w];
          this.ammo[w] = Math.min(spec2.mag, this.ammo[w] + (spec2.perReload || spec2.mag));
          this.reload = null;
          this.upperState = w + '_Idle';
          ch.playUpper(this.upperState, 0.15);
          if (this.ammo[w] < spec2.mag && spec2.perReload && !this.trigger) this.startReload();
          this.onChange && this.onChange();
        }
      } else if (this.firing) {
        if (!this.trigger || this.ammo[w] <= 0) {
          this.firing = false;
          this.upperState = w + '_Idle';
          ch.playUpper(this.upperState, 0.08);
          ch.playWeaponClip('none');
        }
      } else if (this.upperState === w + '_Shoot') {
        this.shootT = (this.shootT || 0) + dt;
        if (this.shootT >= this.ch.clipMeta[w + '_Shoot'].duration) {
          this.upperState = w + '_Idle';
          ch.playUpper(this.upperState, 0.12);
        }
      }
      if (this.trigger && WEAPONS[w].auto) this.tryFire(false);
    }

    // ---- aim offset: follows camera pitch while armed
    ch.aimEnabled = armed && !fullBody;
    const pitchAim = Math.max(-35, Math.min(40, (this.camPitch - 8) * -1.0));
    ch.aimPitch += ((armed ? pitchAim : 0) - ch.aimPitch) * Math.min(1, dt * 12);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.sinceShot = (this.sinceShot || 0) + dt;
    if (this.sinceShot > 0.13) this.bloom = Math.max(0, this.bloom - dt * 2.6);   // recovers once you stop firing
    this.fovKick *= Math.exp(-dt * 11);
    this.camPunch *= Math.exp(-dt * 12);
    ch.updateKick(dt);

    // ---- footsteps (subtle)
    if (this.grounded && speed > 0.4 && !(a2 && a2.full)) {
      this.stepT += dt * (speed > 2 ? 4.3 : 3.0);
      if (this.stepT > 1) { this.stepT = 0; this.sfx.play('step', speed > 2 ? 1.4 : 0.8); }
    }

    // ---- apply transform
    ch.root.setLocalPosition(this.pos);
    ch.root.setLocalEulerAngles(0, this.yaw, 0);
    this._updateProjectiles(dt);
  }

  // third-person camera (call after update)
  updateCamera(dt) {
    const armed = !!this.weapon;
    const want = new pc.Vec3(this.pos.x, this.pos.y + (armed ? 1.62 : 1.45), this.pos.z);
    const k = 1 - Math.exp(-dt * 16);
    this.camTarget.lerp(this.camTarget, want, k);
    this.shoulder += ((armed ? 0.72 : 0) - this.shoulder) * (1 - Math.exp(-dt * 8));
    const dist = (armed ? Math.min(this.camDist, 3.4) : this.camDist) + this.camPunch;
    const pitch = (this.camPitch - this.recoil * 0.7) * D2R, yaw = this.camYaw * D2R;
    const back = new pc.Vec3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new pc.Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
    const pivot = this.camTarget.clone().add(right.clone().mulScalar(this.shoulder));
    // camera collision against boxes and floor
    let d = dist;
    for (const c of this.colliders) {
      if (c.active === false) continue;
      const t = rayBox(pivot, back, c.min, c.max, dist);
      if (t >= 0 && t < d) d = Math.max(0.6, t - 0.2);
    }
    const pos = pivot.clone().add(back.mulScalar(d));
    if (pos.y < 0.2) pos.y = 0.2;
    // trauma shake: squared falloff, smooth noise, a little roll
    const tr = Math.min(1, this.fx.shake), s2 = tr * tr;
    const now = performance.now() / 1000;
    const n = (f, o) => Math.sin(now * f + o) * 0.6 + Math.sin(now * f * 2.37 + o * 1.9) * 0.4;
    if (s2 > 0.0005) pos.add(new pc.Vec3(n(29, 1) * s2 * 0.2, n(33, 2) * s2 * 0.2, n(27, 3) * s2 * 0.2));
    this.cam.setPosition(pos);
    this.cam.lookAt(pivot);
    if (s2 > 0.0005) this.cam.rotateLocal(0, 0, n(21, 4) * s2 * 5);
  }
}
