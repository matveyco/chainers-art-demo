// In-match HUD (DOM): overhead name, health and ammo bars that follow the brawlers, gem score,
// clock, team status dots, the gem countdown, kill feed, floating damage and heal numbers, the
// big centre banner and the super charge meter.
import { BRAWLERS, RULES } from './config.js';

const pc = window.pc;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(app, camera) {
    this.app = app;
    this.camera = camera;
    this.el = $('hud');
    this.barsEl = $('bars');
    this.numsEl = $('nums');
    this.feedEl = $('feed');
    this.bannerEl = $('banner');
    this.bars = new Map();
    this.nums = [];
    this.pool = [];
    this.feed = [];
    this._v = new pc.Vec3();
    this._s = new pc.Vec3();
    this.bannerT = 0;
    this.lastClock = '';
    this.lastGems = [-1, -1];
  }

  // ------------------------------------------------------------------ setup per match
  setup(units, player, mode = 'gemgrab') {
    this.mode = mode;
    const sd = mode === 'showdown';
    this.el.classList.toggle('sd', sd);
    $('sdbar').hidden = !sd;
    document.querySelector('.scorebar').hidden = sd;
    $('gaswarn').hidden = true;
    this.lastLeft = -1; this.lastCubes = -1;
    this.barsEl.textContent = '';
    this.bars.clear();
    for (const u of units) {
      const el = document.createElement('div');
      const rel = u === player ? 'me' : u.team === player.team ? 'ally' : 'enemy';
      el.className = 'ob ' + rel;
      el.innerHTML = `<div class="ob-gem${sd ? ' cube' : ''}" hidden><i></i><b>0</b></div><div class="ob-name">${esc(u.name)}</div>` +
        `<div class="ob-hp"><i class="ob-lag"></i><i class="ob-fill"></i><span>${Math.round(u.hp)}</span></div>` +
        (u === player ? '<div class="ob-ammo"><i><b></b></i><i><b></b></i><i><b></b></i></div>' : '');
      this.barsEl.appendChild(el);
      const b = {
        el, u, fill: el.querySelector('.ob-fill'), lag: el.querySelector('.ob-lag'), num: el.querySelector('.ob-hp span'),
        gem: el.querySelector('.ob-gem'), gemN: el.querySelector('.ob-gem b'),
        ammo: u === player ? [...el.querySelectorAll('.ob-ammo b')] : null,
        shownHp: -1, lagHp: u.hp, lagT: 0, gems: -1, vis: null, ammoS: '',
      };
      this.bars.set(u, b);
    }
    this.player = player;
    this.units = units;
    // team status dots
    for (const t of [0, 1]) {
      const box = $(t === 0 ? 'dots-blue' : 'dots-red');
      box.textContent = '';
      if (sd) continue;
      for (const u of units.filter((x) => x.team === t)) {
        const d = document.createElement('span');
        d.className = 'dot' + (u === player ? ' me' : '');
        d.style.setProperty('--c', BRAWLERS[u.brawler].accent);
        d.innerHTML = `<b>${esc(BRAWLERS[u.brawler].name[0])}</b><em></em>`;
        d.title = `${u.name} (${BRAWLERS[u.brawler].name})`;
        box.appendChild(d);
        u._dot = d;
      }
    }
    this.feedEl.textContent = '';
    this.feed.length = 0;
    for (const n of this.nums) { n.el.style.opacity = '0'; this.pool.push(n.el); }
    this.nums.length = 0;
    this.lastGems = [-1, -1];
    this.lastClock = '';
    $('gem-countdown').hidden = true;
    $('respawn').hidden = true;
  }

  show(on) { this.el.hidden = !on; }

  // ------------------------------------------------------------------ events
  number(pos, value, kind) {
    const el = this.pool.pop() || this.numsEl.appendChild(document.createElement('div'));
    el.className = 'num ' + kind;
    el.textContent = (kind === 'heal' ? '+' : '') + Math.round(value);
    el.style.opacity = '1';
    this.nums.push({ el, x: pos.x, y: pos.y, z: pos.z, t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  killFeed(killer, victim) {
    const row = document.createElement('div');
    row.className = 'kf';
    const name = (u) => `<b class="t${u.team === this.player.team ? 0 : 1}">${esc(u.name)}</b>`;
    row.innerHTML = killer && killer !== victim ? `${name(killer)}<i class="kf-ico" aria-label="knocked out"></i>${name(victim)}` : `${name(victim)}<i class="kf-ico" aria-label="was knocked out"></i>`;
    this.feedEl.prepend(row);
    this.feed.unshift({ row, t: 0 });
    while (this.feed.length > 5) { const f = this.feed.pop(); f.row.remove(); }
  }

  banner(text, kind = '', dur = 1.2) {
    const el = this.bannerEl;
    el.className = 'banner ' + kind;
    el.textContent = text;
    // restart the pop animation
    void el.offsetWidth;
    el.classList.add('on');
    this.bannerT = dur;
  }

  clearBanner() { this.bannerEl.className = 'banner'; this.bannerT = 0; }

  // ------------------------------------------------------------------ per frame
  update(dt, g) {
    const cam = this.camera.camera;
    const W = window.innerWidth, H = window.innerHeight;
    // overhead bars
    for (const [u, b] of this.bars) {
      const vis = u.alive && (u.visible || u.team === this.player.team) && u.avatar.root.enabled;
      if (vis !== b.vis) { b.el.style.visibility = vis ? 'visible' : 'hidden'; b.vis = vis; }
      if (!vis) continue;
      this._v.set(u.pos.x, 2.95, u.pos.z);
      cam.worldToScreen(this._v, this._s);
      if (this._s.z < 0 || this._s.x < -80 || this._s.x > W + 80 || this._s.y < -80 || this._s.y > H + 80) { b.el.style.visibility = 'hidden'; b.vis = false; continue; }
      b.el.style.transform = `translate3d(${this._s.x.toFixed(1)}px, ${this._s.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      const hp = Math.max(0, Math.round(u.hp));
      if (hp !== b.shownHp) {
        if (hp < b.shownHp) b.lagT = 0.45;
        b.shownHp = hp;
        b.fill.style.width = (hp / u.maxHp * 100).toFixed(1) + '%';
        b.num.textContent = hp;
        b.el.classList.toggle('low', hp / u.maxHp < 0.3);
      }
      b.lagT -= dt;
      if (b.lagT <= 0 && b.lagHp !== hp) {
        b.lagHp += (hp - b.lagHp) * Math.min(1, dt * 6);
        if (Math.abs(b.lagHp - hp) < 5) b.lagHp = hp;
        b.lag.style.width = (b.lagHp / u.maxHp * 100).toFixed(1) + '%';
      }
      const carried = this.mode === 'showdown' ? u.cubes : u.gems;
      if (carried !== b.gems) {
        b.gems = carried;
        b.gem.hidden = carried <= 0;
        b.gemN.textContent = carried;
      }
      b.el.classList.toggle('shield', u.shield > 0);
      b.el.classList.toggle('bush', u.inBush && u.team === this.player.team);
      if (b.ammo) {
        const a = u.ammo;
        const s = a.toFixed(2);
        if (s !== b.ammoS) {
          b.ammoS = s;
          for (let i = 0; i < 3; i++) {
            const f = Math.max(0, Math.min(1, a - i));
            b.ammo[i].style.width = (f * 100).toFixed(0) + '%';
            b.ammo[i].parentNode.classList.toggle('full', f >= 1);
          }
        }
      }
    }
    // floating numbers
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      const u = n.t / 0.85;
      if (u >= 1) { n.el.style.opacity = '0'; this.pool.push(n.el); this.nums.splice(i, 1); continue; }
      this._v.set(n.x, n.y, n.z);
      cam.worldToScreen(this._v, this._s);
      const rise = 26 + 40 * (1 - Math.pow(1 - u, 3));
      const pop = u < 0.12 ? 0.6 + u / 0.12 * 0.6 : 1.2 - Math.min(0.2, (u - 0.12) * 0.6);
      n.el.style.transform = `translate3d(${(this._s.x + n.dx * u).toFixed(1)}px, ${(this._s.y - rise).toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      n.el.style.opacity = u > 0.7 ? ((1 - u) / 0.3).toFixed(3) : '1';
    }
    // feed ageing
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t += dt;
      if (f.t > 5) { f.row.remove(); this.feed.splice(i, 1); }
      else if (f.t > 4.4) f.row.style.opacity = ((5 - f.t) / 0.6).toFixed(2);
    }
    // banner
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.bannerEl.classList.remove('on'); }
    // showdown: brawlers left, the player's power cubes, gas warning
    if (this.mode === 'showdown') {
      const left = g.alive();
      if (left !== this.lastLeft) { this.lastLeft = left; $('sd-left').textContent = left; }
      const pc_ = this.player.cubes;
      if (pc_ !== this.lastCubes) { this.lastCubes = pc_; $('sd-cubes').textContent = pc_; const c = $('sd-cubes').parentNode; c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      const gw = $('gaswarn');
      const inGas = this.player.alive && g.inGas(this.player) && g.phase === 'play';
      if (gw.hidden === inGas) gw.hidden = !inGas;
    }
    // score, clock, dots
    for (const t of [0, 1]) {
      if (this.mode === 'showdown') break;
      const n = g.teamGems(t);
      if (n !== this.lastGems[t]) {
        this.lastGems[t] = n;
        const el = $(t === 0 ? 'gems-blue' : 'gems-red');
        el.textContent = n;
        el.parentNode.classList.remove('bump'); void el.offsetWidth; el.parentNode.classList.add('bump');
      }
    }
    const left = Math.max(0, g.timeLeft);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if (clock !== this.lastClock) { this.lastClock = clock; $('clock').textContent = clock; $('clock').classList.toggle('late', left < 30); }
    for (const u of this.units) {
      if (this.mode === 'showdown') break;
      const d = u._dot;
      if (!d) continue;
      const dead = !u.alive;
      if (d.classList.contains('dead') !== dead) d.classList.toggle('dead', dead);
      if (dead) {
        const s = Math.ceil(Math.max(0, u.respawnT));
        const em = d.querySelector('em');
        if (em.textContent !== String(s)) em.textContent = s;
      }
    }
    // gem countdown
    const cd = $('gem-countdown');
    if (g.countdown) {
      cd.hidden = false;
      const mine = g.countdown.team === this.player.team;
      const txt = `${Math.ceil(g.countdown.left)}`;
      if (cd.dataset.v !== txt || cd.dataset.t !== String(mine)) {
        cd.dataset.v = txt; cd.dataset.t = String(mine);
        cd.className = 'gemcd ' + (mine ? 'ours' : 'theirs');
        cd.innerHTML = `<small>${mine ? 'Your team wins in' : 'Enemy team wins in'}</small><b>${txt}</b>`;
      }
    } else if (!cd.hidden) cd.hidden = true;
    // respawn timer for the player
    const p = this.player;
    const rs = $('respawn');
    const showRs = p && !p.alive && g.phase === 'play' && p.deadT > 1.2;
    if (rs.hidden === showRs) rs.hidden = !showRs;
    if (showRs) { const n = String(Math.max(1, Math.ceil(p.respawnT))); const el = $('respawn-n'); if (el.textContent !== n) el.textContent = n; }
    // super meter
    if (p) {
      const s = $('superbtn');
      const v = Math.min(1, p.superCharge);
      const key = v.toFixed(2) + (p.alive ? '' : 'x');
      if (s.dataset.v !== key) {
        s.dataset.v = key;
        s.style.setProperty('--charge', v.toFixed(3));
        s.classList.toggle('ready', v >= 1 && p.alive);
      }
    }
  }
}

export { RULES };
