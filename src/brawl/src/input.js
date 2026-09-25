// Controls. Desktop: WASD/arrows move, the mouse aims (on the ground plane), left click fires
// (hold for auto-fire), right click or Space: hold to aim the super, release to fire; E fires the
// super at once, Q is a quick shot at the nearest enemy. Touch: a floating stick on the left
// half moves; the attack and super sticks aim while dragged and fire on release, a tap fires
// at the nearest enemy.
const pc = window.pc;
const $ = (id) => document.getElementById(id);

export class Input {
  constructor(app, canvas, camera) {
    this.app = app;
    this.canvas = canvas;
    this.camera = camera;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false, down: false, superDown: false };
    this.queue = [];
    this.enabled = false;
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.stick = { x: 0, z: 0 };
    this.aim = { active: false, kind: 'attack', dx: 0, dz: 1, dist: 0, from: null };
    this.player = null;
    this._bind();
    if (this.touch) this._bindTouch();
  }

  setPlayer(u) { this.player = u; }
  clear() {
    this.keys.clear(); this.queue.length = 0; this.mouse.down = false; this.mouse.superDown = false;
    this.stick.x = this.stick.z = 0; this.aim.active = false;
    for (const s of Object.values(this.sticks || {})) this._resetStick(s);
  }

  // ------------------------------------------------------------------ desktop
  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.mouse.superDown = true;
      if (e.code === 'KeyE') this._push('super', false);
      if (e.code === 'KeyQ') this.queue.push({ type: 'attack', auto: true });
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.mouse.superDown) { this.mouse.superDown = false; if (this.enabled) this._push('super', false); }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.mouse.superDown = false; });
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    c.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    c.addEventListener('mousedown', (e) => {
      if (this.touch && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      c.focus();
      if (!this.enabled) return;
      if (e.button === 0) { this.mouse.down = true; this._push('attack', false); }
      if (e.button === 2) this.mouse.superDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2 && this.mouse.superDown) { this.mouse.superDown = false; if (this.enabled) this._push('super', false); }
    });
  }

  _push(type, auto) {
    const a = this._mouseAim();
    if (!a || auto) { this.queue.push({ type, auto: true }); return; }
    this.queue.push({ type, dx: a.dx, dz: a.dz, dist: a.dist });
  }

  // aim from the player to the mouse point on the plane at shot height
  _mouseAim() {
    const p = this.player;
    if (!p || !this.mouse.inside) return null;
    const cam = this.camera.camera;
    const near = cam.screenToWorld(this.mouse.x, this.mouse.y, cam.nearClip, new pc.Vec3());
    const far = cam.screenToWorld(this.mouse.x, this.mouse.y, cam.farClip, new pc.Vec3());
    const dy = far.y - near.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = (1.0 - near.y) / dy;
    const x = near.x + (far.x - near.x) * t, z = near.z + (far.z - near.z) * t;
    const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return null;
    return { dx: dx / d, dz: dz / d, dist: d, x, z };
  }

  // ------------------------------------------------------------------ touch
  _bindTouch() {
    $('touch').hidden = false;
    document.body.classList.add('touch-on');
    const mk = (id, kind) => {
      const el = $(id);
      return { el, knob: el.querySelector('i'), kind, id: null, ox: 0, oy: 0, dx: 0, dy: 0, r: 58, moved: false, t0: 0 };
    };
    this.sticks = { move: mk('stick-move', 'move'), attack: mk('stick-attack', 'attack'), super: mk('stick-super', 'super') };
    const zoneMove = $('zone-move');
    const start = (s, t, float) => {
      s.id = t.identifier;
      const r = s.el.getBoundingClientRect();
      if (float) {
        // the move stick appears where the thumb lands
        s.ox = t.clientX; s.oy = t.clientY;
        s.el.style.left = (t.clientX - r.width / 2) + 'px';
        s.el.style.top = (t.clientY - r.height / 2) + 'px';
        s.el.style.right = 'auto'; s.el.style.bottom = 'auto';
      } else { s.ox = r.left + r.width / 2; s.oy = r.top + r.height / 2; }
      s.r = r.width * 0.42;
      s.dx = s.dy = 0; s.moved = false; s.t0 = performance.now();
      s.el.classList.add('on');
    };
    const move = (s, t) => {
      let dx = (t.clientX - s.ox) / s.r, dy = (t.clientY - s.oy) / s.r;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      s.dx = dx; s.dy = dy;
      if (m > 0.28) s.moved = true;
      s.knob.style.transform = `translate(${(dx * s.r).toFixed(1)}px, ${(dy * s.r).toFixed(1)}px)`;
    };
    const find = (id) => Object.values(this.sticks).find((s) => s.id === id);
    const onStart = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && el.closest('#stick-attack')) { start(this.sticks.attack, t, false); e.preventDefault(); continue; }
        if (el && el.closest('#stick-super')) {
          if (this.player && this.player.superCharge >= 1) start(this.sticks.super, t, false);
          e.preventDefault(); continue;
        }
        if (el && (el === zoneMove || el.closest('#zone-move')) && this.sticks.move.id === null) { start(this.sticks.move, t, true); e.preventDefault(); }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) { const s = find(t.identifier); if (s) { move(s, t); e.preventDefault(); } }
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        const s = find(t.identifier);
        if (!s) continue;
        if (s.kind !== 'move' && this.enabled) {
          const tap = !s.moved;
          if (tap) this.queue.push({ type: s.kind, auto: true });
          else {
            const l = Math.hypot(s.dx, s.dy) || 1;
            this.queue.push({ type: s.kind, dx: s.dx / l, dz: s.dy / l, dist: null, reach: l });
          }
        }
        this._resetStick(s);
      }
    };
    const root = $('touch');
    root.addEventListener('touchstart', onStart, { passive: false });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onEnd, { passive: false });
  }

  _resetStick(s) {
    s.id = null; s.dx = s.dy = 0; s.moved = false;
    s.knob.style.transform = '';
    s.el.classList.remove('on');
    if (s.kind === 'move') { s.el.style.left = ''; s.el.style.top = ''; s.el.style.right = ''; s.el.style.bottom = ''; }
  }

  // ------------------------------------------------------------------ per frame
  update() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (this.sticks && this.sticks.move.id !== null) { x = this.sticks.move.dx; z = this.sticks.move.dy; }
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    this.stick.x = x; this.stick.z = z;
    // aim indicator state
    const a = this.aim;
    a.active = false;
    if (this.sticks) {
      for (const s of [this.sticks.attack, this.sticks.super]) {
        if (s.id !== null && s.moved) {
          const ll = Math.hypot(s.dx, s.dy) || 1;
          a.active = true; a.kind = s.kind; a.dx = s.dx / ll; a.dz = s.dy / ll; a.reach = ll; a.dist = null;
        }
      }
    } else {
      const m = this._mouseAim();
      if (m) {
        a.active = true; a.kind = this.mouse.superDown ? 'super' : 'attack';
        a.dx = m.dx; a.dz = m.dz; a.dist = m.dist; a.reach = null;
        a.strong = this.mouse.down || this.mouse.superDown;
      }
      // held button: auto-fire whenever a bar is ready
      if (this.mouse.down && this.enabled && this.player && this.player.canAttack()) this._push('attack', false);
    }
  }

  take() { const q = this.queue.slice(); this.queue.length = 0; return q; }
}
