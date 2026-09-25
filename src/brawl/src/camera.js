// Camera rig: the fixed-angle top-down follow camera of the match (frames the full arena width
// in landscape, a closer slice on portrait phones, leads toward the aim, clamps to the arena,
// shakes), the lobby showcase shot and the fly-in from the arena overview.
const pc = window.pc;
const D2R = Math.PI / 180;

export class CameraRig {
  constructor(app, camera, arena) {
    this.app = app;
    this.cam = camera;
    this.arena = arena;
    this.mode = 'lobby';
    this.pitch = 57;                 // degrees below the horizon
    this.dist = 17;
    this.target = new pc.Vec3(0, 0, 0);
    this.pos = new pc.Vec3();
    this.look = new pc.Vec3();
    this.shake = 0;
    this.shakeT = 0;
    this.fly = null;
    this.kickX = 0; this.kickZ = 0;
    this.lobbyAt = new pc.Vec3(0, 0, 12);
    this._p = new pc.Vec3();
    this._l = new pc.Vec3();
  }

  // vertical field of view that shows ~18 m across in landscape and at least 10 m of depth
  _fov() {
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / Math.max(1, h);
    const V = Math.max(10, Math.min(24, 18 / aspect));
    return 2 * Math.atan(V / 2 / this.dist) / D2R;
  }

  addShake(a) { this.shake = Math.min(1, this.shake + a); }

  // recoil: the view jolts against the shot direction and springs back
  kick(dx, dz, amount) { this.kickX -= dx * amount; this.kickZ -= dz * amount; }

  // visible depth at the focus point (m): ~10 in landscape, up to 24 on portrait phones
  viewDepth() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    return Math.max(10, Math.min(24, 18 / aspect));
  }

  follow(x, z, leadX = 0, leadZ = 0, snap = false) {
    const A = this.arena;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const V = this.viewDepth();
    const halfView = V * aspect / 2;
    // keep the arena filling the screen sideways; on narrow screens follow the player freely
    const maxX = Math.max(0, A.halfW + 1.2 - halfView);
    // look a little up the arena (toward the enemy base), more on tall screens
    let tx = x + leadX, tz = z + leadZ - V * 0.1;
    tx = Math.max(-maxX, Math.min(maxX, tx));
    tz = Math.max(-A.halfH + 1, Math.min(A.halfH - 1, tz));
    if (snap) this.target.set(tx, 0, tz);
    this._want = { x: tx, z: tz };
    this.mode = 'follow';
  }

  flyFrom(overview = true) {
    this.fly = { t: 0, dur: 2.2, overview };
  }

  lobby(at) {
    this.mode = 'lobby';
    if (at) this.lobbyAt.copy(at);
  }

  update(dt) {
    const cam = this.cam;
    const c = cam.camera;
    if (this.mode === 'lobby') {
      const a = this.lobbyAt;
      const wide = window.innerWidth / Math.max(1, window.innerHeight) > 1.1;
      // brawler on the right third in landscape, centred higher up on portrait phones
      this._p.set(a.x - (wide ? 1.55 : 0), a.y + (wide ? 2.0 : 2.6), a.z + (wide ? 7.4 : 11.5));
      this._l.set(a.x - (wide ? 1.55 : 0), a.y + (wide ? 1.35 : 0.9), a.z);
      c.fov = wide ? 36 : 44;
      c.horizontalFov = false;
      cam.setPosition(this._p);
      cam.lookAt(this._l);
      return;
    }
    const w = this._want;
    if (w) {
      const k = 1 - Math.exp(-dt * 7);
      this.target.x += (w.x - this.target.x) * k;
      this.target.z += (w.z - this.target.z) * k;
    }
    c.horizontalFov = false;
    c.fov = this._fov();
    const p = this.pitch * D2R;
    let px = this.target.x, py = Math.sin(p) * this.dist, pz = this.target.z + Math.cos(p) * this.dist;
    let lx = this.target.x, ly = 0, lz = this.target.z;
    if (this.fly) {
      const f = this.fly;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      const e = 1 - Math.pow(1 - u, 3);
      // from high above the arena centre down to the player
      const ox = 0, oy = 34, oz = 13;
      px = ox + (px - ox) * e; py = oy + (py - oy) * e; pz = oz + (pz - oz) * e;
      lx = lx * e; lz = -2 * (1 - e) + lz * e;
      if (u >= 1) this.fly = null;
    }
    // recoil offset decays quickly
    const kd = Math.exp(-dt * 12);
    this.kickX *= kd; this.kickZ *= kd;
    px += this.kickX; pz += this.kickZ; lx += this.kickX; lz += this.kickZ;
    // shake: decaying random offsets
    if (this.shake > 0) {
      this.shakeT += dt;
      const s = this.shake * this.shake * 0.28;
      px += (Math.sin(this.shakeT * 71) + Math.sin(this.shakeT * 43)) * 0.5 * s;
      pz += (Math.sin(this.shakeT * 59) + Math.sin(this.shakeT * 37)) * 0.5 * s;
      py += Math.sin(this.shakeT * 67) * 0.3 * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    cam.setPosition(px, py, pz);
    cam.lookAt(lx, ly, lz);
  }
}
