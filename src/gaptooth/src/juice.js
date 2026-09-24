// Feedback layer: time (hit-stop, slow motion), screen flash, hitmarkers, floating damage
// numbers, callouts, combo meter, honest crosshair. DOM for the 2D bits, pooled and allocation-light.
const pc = window.pc;
const $ = (id) => document.getElementById(id);

export class Juice {
  constructor(app, camera) {
    this.app = app;
    this.camera = camera;
    this.stops = [];           // {until, scale} in performance.now() ms
    this.scale = 1;
    this.flashEl = $('screenflash');
    this.hitEl = $('hitmark');
    this.crossEl = $('crosshair');
    this.calloutEl = $('callouts');
    this.comboEl = $('combo');
    this.comboN = $('combo-n');
    this.comboBar = $('combo-bar');
    this.layer = $('dmg-layer');
    this.nums = [];
    this.pool = [];
    this._gap = -1; this._tgt = null; this._on = null;
    this._v = new pc.Vec3();
  }

  reset() {
    this.stops.length = 0;
    this.scale = 1;
    this.app.timeScale = 1;
    for (const n of this.nums) { n.el.style.opacity = '0'; this.pool.push(n.el); }
    this.nums.length = 0;
    this.calloutEl.textContent = '';
    this.combo(0, 0);
  }

  // ---------------------------------------------------------------- time
  hitstop(ms, scale = 0.04) { this.stops.push({ until: performance.now() + ms, scale, ease: 0 }); }
  slowmo(ms, scale = 0.4) { this.stops.push({ until: performance.now() + ms, scale, ease: 140 }); }

  _timeScale() {
    const now = performance.now();
    let s = 1;
    for (let i = this.stops.length - 1; i >= 0; i--) {
      const st = this.stops[i];
      if (now >= st.until + st.ease) { this.stops.splice(i, 1); continue; }
      let k = st.scale;
      if (now > st.until) k = st.scale + (1 - st.scale) * ((now - st.until) / st.ease);   // ease back to real time
      s = Math.min(s, k);
    }
    return s;
  }

  // ---------------------------------------------------------------- screen
  flash(strength = 0.5, ms = 220, kind = '') {
    const el = this.flashEl;
    el.className = 'screenflash ' + kind;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(0.85, strength));
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms ease-out`;
    el.style.opacity = '0';
  }

  hitmark(kind = 'hit') {
    const h = this.hitEl;
    h.className = 'hitmark ' + kind;
    void h.offsetWidth;
    h.classList.add('on');
  }

  crosshair(visible, gapPx, onTarget) {
    const el = this.crossEl;
    if (visible !== this._on) { el.classList.toggle('on', visible); this._on = visible; }
    if (!visible) return;
    const g = Math.max(3, Math.min(90, gapPx));
    if (Math.abs(g - this._gap) > 0.4) { el.style.setProperty('--gap', g.toFixed(1) + 'px'); this._gap = g; }
    if (onTarget !== this._tgt) { el.classList.toggle('target', onTarget); this._tgt = onTarget; }
  }

  // ---------------------------------------------------------------- numbers & callouts
  // key: same target within 0.45 s accumulates into one number (SMG streams, shotgun pellets)
  number(pos, value, kind = '', key = null) {
    const now = performance.now();
    if (key) {
      const n = this.nums.find((x) => x.key === key && now - x.born < 450);
      if (n) {
        n.value += value; n.born = now; n.t = 0; n.pos.copy(pos);
        if (kind) n.kind = kind;
        n.el.textContent = String(Math.round(n.value));
        n.el.className = 'dmg ' + n.kind;
        return;
      }
    }
    const el = this.pool.pop() || this.layer.appendChild(document.createElement('span'));
    el.className = 'dmg ' + kind;
    el.textContent = String(Math.round(value));
    this.nums.push({ el, key, value, kind, pos: pos.clone(), born: now, t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  callout(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'callout ' + kind;
    el.textContent = text;
    this.calloutEl.appendChild(el);
    while (this.calloutEl.children.length > 3) this.calloutEl.firstChild.remove();
    setTimeout(() => el.remove(), 1300);
  }

  combo(n, frac) {
    const el = this.comboEl;
    const show = n >= 2;
    if (el.hidden === show) el.hidden = !show;
    if (!show) return;
    const txt = 'x' + n;
    if (this.comboN.textContent !== txt) {
      this.comboN.textContent = txt;
      this.comboN.classList.remove('pop'); void this.comboN.offsetWidth; this.comboN.classList.add('pop');
    }
    this.comboBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
  }

  // ---------------------------------------------------------------- per frame (real time)
  update() {
    const s = this._timeScale();
    if (s !== this.scale) { this.scale = s; this.app.timeScale = s; }
    if (!this.nums.length) return;
    const cam = this.camera.camera;
    const cp = this.camera.getPosition(), fw = this.camera.forward;
    const now = performance.now();
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      const age = (now - n.born) / 1000;
      const life = n.kind.includes('kill') ? 1.1 : 0.8;
      if (age > life) { n.el.style.opacity = '0'; this.pool.push(n.el); this.nums.splice(i, 1); continue; }
      if ((n.pos.x - cp.x) * fw.x + (n.pos.y - cp.y) * fw.y + (n.pos.z - cp.z) * fw.z < 0.2) { n.el.style.opacity = '0'; continue; }
      const p = cam.worldToScreen(n.pos, this._v);
      const pop = age < 0.08 ? 1.6 - age * 7.5 : 1;           // punch in
      const y = p.y - 26 - age * 55;
      const a = age < life * 0.6 ? 1 : 1 - (age - life * 0.6) / (life * 0.4);
      n.el.style.transform = `translate(${(p.x + n.dx).toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      n.el.style.opacity = a.toFixed(2);
    }
  }
}
