// Voxel FX on GPU instancing: every particle kind is one instanced box mesh, so a whole
// explosion (fire, smoke, debris, sparks) costs one draw call per material instead of one per cube.
// Particles are plain data; dropped weapon parts (props) stay real entities.
const pc = window.pc;

function unlit(color, opts = {}) {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = color;
  m.emissiveIntensity = opts.intensity ?? 1;
  if (opts.additive) { m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; }
  m.useFog = !opts.nofog;
  m.update();
  return m;
}

function lit(color, opts = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = color;
  m.useMetalness = true;
  m.metalness = opts.metal ?? 0;
  m.gloss = opts.gloss ?? 0.3;
  if (opts.emissive) { m.emissive = opts.emissive; m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  m.update();
  return m;
}

const G = 18;   // gravity for debris

class Instancer {
  constructor(device, parent, name, material, capacity) {
    this.cap = capacity;
    this.n = 0;
    this.data = new Float32Array(capacity * 16);
    this.vb = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), capacity, { usage: pc.BUFFER_DYNAMIC, data: this.data });
    this.mi = new pc.MeshInstance(Instancer.box(device), material);
    this.mi.setInstancing(this.vb);
    this.mi.instancingCount = 0;
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [this.mi], castShadows: false, receiveShadows: false });
    parent.addChild(e);
    this.live = 0;               // particles of this kind currently alive (spawn budget)
  }

  static box(device) {
    if (!Instancer._box) Instancer._box = pc.Mesh.fromGeometry(device, new pc.BoxGeometry());
    return Instancer._box;
  }

  push(m) { if (this.n < this.cap) { this.data.set(m.data, this.n * 16); this.n++; } }

  flush() {
    this.mi.instancingCount = this.n;
    if (this.n) this.vb.setData(this.data);
    this.n = 0;
  }
}

const CAPS = {
  core: 32, flash: 64, tracer: 96, spark: 256, fire: 160, fire2: 96, ember: 128, white: 48,
  smoke: 256, dust: 256, brass: 128, redshell: 32,
  chunkRed: 128, chunkDark: 160, chunkWood: 128, chunkStraw: 160, chunkGrey: 128, gold: 128,
};

export class FX {
  constructor(app, camera) {
    this.app = app;
    this.camera = camera;
    this.root = new pc.Entity('FX');
    app.root.addChild(this.root);
    this.items = [];
    this.props = [];
    this.shake = 0;
    this.floorAt = () => 0;
    this.onSound = null;
    const M = this.mats = {
      core: unlit(new pc.Color(1, 0.97, 0.85), { additive: true, intensity: 6 }),
      flash: unlit(new pc.Color(1, 0.86, 0.45), { additive: true, intensity: 4 }),
      tracer: unlit(new pc.Color(1, 0.85, 0.4), { additive: true, intensity: 3 }),
      spark: unlit(new pc.Color(1, 0.62, 0.2), { additive: true, intensity: 4 }),
      fire: unlit(new pc.Color(1, 0.55, 0.12), { additive: true, intensity: 3 }),
      fire2: unlit(new pc.Color(1, 0.85, 0.3), { additive: true, intensity: 3 }),
      ember: unlit(new pc.Color(1, 0.42, 0.08), { additive: true, intensity: 3.5 }),
      white: unlit(new pc.Color(1, 0.95, 0.85), { additive: true, intensity: 2.5 }),
      smoke: lit(new pc.Color(0.3, 0.29, 0.28)),
      dust: lit(new pc.Color(0.8, 0.78, 0.74)),
      brass: lit(new pc.Color(0.85, 0.64, 0.25), { metal: 0.8, gloss: 0.6 }),
      redshell: lit(new pc.Color(0.8, 0.22, 0.16)),
      chunkRed: lit(new pc.Color(0.78, 0.26, 0.18)),
      chunkDark: lit(new pc.Color(0.18, 0.18, 0.2)),
      chunkWood: lit(new pc.Color(0.78, 0.6, 0.35)),
      chunkStraw: lit(new pc.Color(0.85, 0.74, 0.52)),
      chunkGrey: lit(new pc.Color(0.62, 0.64, 0.68), { metal: 0.3, gloss: 0.4 }),
      gold: lit(new pc.Color(1, 0.78, 0.2), { metal: 0.7, gloss: 0.7, emissive: new pc.Color(0.5, 0.33, 0.05) }),
    };
    this.inst = {};
    for (const k of Object.keys(M)) this.inst[k] = new Instancer(app.graphicsDevice, this.root, 'fx_' + k, M[k], CAPS[k] || 64);
    // one shared light for muzzle / explosion flashes
    this.light = new pc.Entity('FlashLight');
    this.light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.8, 0.45), intensity: 0, range: 7, castShadows: false });
    this.root.addChild(this.light);
    this.lightT = 0; this.lightDur = 0.06; this.lightPeak = 0;
    this._m = new pc.Mat4(); this._q = new pc.Quat(); this._s = new pc.Vec3(); this._p = new pc.Vec3();
  }

  // ---------------------------------------------------------------- spawning
  _spawn(k, pos, scale, props = {}) {
    const ins = this.inst[k];
    if (!ins || ins.live >= ins.cap) return null;
    ins.live++;
    const it = Object.assign({ k, pos: pos.clone(), s: scale, eul: null, rot: null, vel: null, spin: null, t: 0, life: 1 }, props);
    if (!it.rot && !it.eul) it.eul = new pc.Vec3(Math.random() * 360, Math.random() * 360, Math.random() * 360);
    this.items.push(it);
    return it;
  }

  static look(dir) {
    const m = new pc.Mat4().setLookAt(pc.Vec3.ZERO, dir.clone().mulScalar(-1), Math.abs(dir.y) > 0.99 ? pc.Vec3.RIGHT : pc.Vec3.UP);
    return new pc.Quat().setFromMat4(m);
  }

  // ---------------------------------------------------------------- effects
  muzzle(pos, dir, size = 1) {
    const q = FX.look(dir);
    this._spawn('core', pos, new pc.Vec3(0.09 * size, 0.09 * size, 0.09 * size), { rot: q, life: 0.05, shrink: true });
    for (let i = 0; i < 4; i++) {
      const qq = q.clone().mul(new pc.Quat().setFromEulerAngles(0, 0, i * 45 + Math.random() * 20));
      const L = (0.16 + Math.random() * 0.12) * size;
      this._spawn('flash', pos.clone().add(dir.clone().mulScalar(0.06 * size)), new pc.Vec3(0.03 * size, i % 2 ? 0.14 * size : 0.03 * size, L),
        { rot: qq, life: 0.045 + Math.random() * 0.02, shrink: true });
    }
    this.flashLight(pos, 3.5 * size, 0.06);
  }

  muzzleSmoke(pos, dir, amount = 1) {
    for (let i = 0; i < amount; i++) {
      const s = 0.05 + Math.random() * 0.05 * amount;
      const v = dir.clone().mulScalar(0.6 + Math.random() * 0.8).add(new pc.Vec3((Math.random() - 0.5) * 0.2, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2));
      this._spawn('dust', pos.clone().add(dir.clone().mulScalar(0.05 + i * 0.05)), new pc.Vec3(s, s, s), { vel: v, drag: 2.5, life: 0.5 + Math.random() * 0.4, puff: 1.2 });
    }
  }

  flashLight(pos, peak, dur, color) {
    this.light.setPosition(pos);
    this.light.light.color = color || new pc.Color(1, 0.8, 0.45);
    this.lightPeak = Math.max(peak, this.light.light.intensity);
    this.lightT = 0;
    this.lightDur = dur;
    this.light.light.range = peak > 6 ? 14 : 7;
  }

  tracer(from, to, thick = 1) {
    const d = to.clone().sub(from);
    const len = d.length();
    if (len < 0.05) return;
    const mid = from.clone().add(d.clone().mulScalar(0.5));
    this._spawn('tracer', mid, new pc.Vec3(0.018 * thick, 0.018 * thick, len), { rot: FX.look(d.clone().mulScalar(1 / len)), life: 0.07, shrinkXY: true });
  }

  casing(pos, dir, kind = 'brass', vel = null) {
    const k = kind === 'shell' ? 'redshell' : 'brass';
    const s = kind === 'shell' ? new pc.Vec3(0.032, 0.032, 0.08) : new pc.Vec3(0.016, 0.016, 0.034);
    const v = vel || dir.clone().mulScalar(1.6 + Math.random() * 0.8).add(new pc.Vec3((Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4));
    this._spawn(k, pos, s, { life: 2.6, vel: v, spin: new pc.Vec3(Math.random() * 900, Math.random() * 900, 0), bounce: 0.35, sound: 'shell', fadeScale: true, halfExtent: 0.012 });
  }

  sparks(pos, normal, n = 6, k = 'spark') {
    for (let i = 0; i < n; i++) {
      const s = 0.02 + Math.random() * 0.025;
      const v = normal.clone().mulScalar(1.5 + Math.random() * 2.5).add(new pc.Vec3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3));
      this._spawn(k, pos, new pc.Vec3(s, s, s), { life: 0.22 + Math.random() * 0.2, vel: v, grav: 0.6, shrink: true });
    }
  }

  puff(pos, kind = 'smoke', size = 0.3, life = 1.0, vel = null) {
    this._spawn(kind, pos, new pc.Vec3(size, size, size), {
      life, vel: vel || new pc.Vec3((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3), drag: 1.5, puff: 1.6,
    });
  }

  debris(pos, matName, n = 10, power = 5, size = 0.12, dir = null) {
    for (let i = 0; i < n; i++) {
      const s = size * (0.5 + Math.random() * 0.8);
      let v = new pc.Vec3((Math.random() - 0.5), 0.6 + Math.random(), (Math.random() - 0.5)).normalize();
      if (dir) v.add(dir.clone().mulScalar(1.2)).normalize();
      v = v.mulScalar(power * (0.4 + Math.random() * 0.8));
      this._spawn(matName, pos.clone().add(new pc.Vec3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)), new pc.Vec3(s, s, s),
        { life: 1.6 + Math.random(), vel: v, spin: new pc.Vec3(Math.random() * 600, Math.random() * 600, Math.random() * 600), bounce: 0.3, fadeScale: true, halfExtent: s / 2 });
    }
  }

  // surface-specific bullet impact
  impact(pos, normal, surface = 'metal', strength = 1) {
    const p = pos.clone().add(normal.clone().mulScalar(0.02));
    switch (surface) {
      case 'wood':
        this.debris(p, 'chunkWood', Math.round(2 + strength * 2), 2.2, 0.035, normal);
        this.puff(p, 'dust', 0.08, 0.45);
        break;
      case 'dummy':
        this.debris(p, 'chunkStraw', Math.round(2 + strength * 3), 2.6, 0.04, normal);
        this.puff(p, 'dust', 0.1, 0.4);
        break;
      case 'barrel':
        this.sparks(p, normal, 5);
        this.debris(p, 'chunkRed', 2, 2, 0.03, normal);
        break;
      case 'floor':
        this.debris(p, 'chunkGrey', 2, 1.8, 0.03, normal);
        this.puff(p, 'dust', 0.1, 0.5, new pc.Vec3((Math.random() - 0.5) * 0.3, 0.6, (Math.random() - 0.5) * 0.3));
        break;
      default:
        this.sparks(p, normal, Math.round(3 + strength * 3));
        this.puff(p, 'dust', 0.07, 0.35);
    }
  }

  explosion(pos, radius = 3) {
    for (let i = 0; i < 16; i++) {
      const s = 0.35 + Math.random() * 0.45;
      const v = new pc.Vec3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().mulScalar(radius * (1.2 + Math.random()));
      this._spawn(i % 3 ? 'fire' : 'fire2', pos.clone().add(new pc.Vec3((Math.random() - 0.5) * 0.6, Math.random() * 0.5, (Math.random() - 0.5) * 0.6)),
        new pc.Vec3(s, s, s), { life: 0.35 + Math.random() * 0.25, vel: v, drag: 5, grow: 1.2, shrink: true });
    }
    // bright core
    this._spawn('white', pos.clone().add(new pc.Vec3(0, 0.4, 0)), new pc.Vec3(1.1, 1.1, 1.1), { life: 0.12, shrink: true, grow: 1.5 });
    for (let i = 0; i < 12; i++) {
      const v = new pc.Vec3((Math.random() - 0.5) * 3, 1.2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.puff(pos.clone().add(new pc.Vec3((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5))), 'smoke', 0.5 + Math.random() * 0.4, 1.4 + Math.random() * 0.8, v);
    }
    // embers arc out
    for (let i = 0; i < 14; i++) {
      const v = new pc.Vec3(Math.random() - 0.5, 0.8 + Math.random(), Math.random() - 0.5).normalize().mulScalar(5 + Math.random() * 5);
      this._spawn('ember', pos.clone().add(new pc.Vec3(0, 0.3, 0)), new pc.Vec3(0.05, 0.05, 0.05), { life: 0.8 + Math.random() * 0.6, vel: v, grav: 0.8, shrink: true });
    }
    this.debris(pos, 'chunkDark', 8, 7, 0.1);
    this.shockwave(pos, radius);
    this.flashLight(pos.clone().add(new pc.Vec3(0, 0.8, 0)), 16, 0.4, new pc.Color(1, 0.62, 0.3));
    this.addShake(0.8);
  }

  // ring of dust racing outward along the ground
  shockwave(pos, radius = 3) {
    const n = 20;
    const y = this.floorAt(pos) + 0.08;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const d = new pc.Vec3(Math.cos(a), 0, Math.sin(a));
      const s = 0.22 + Math.random() * 0.14;
      this._spawn('dust', new pc.Vec3(pos.x + d.x * 0.4, y, pos.z + d.z * 0.4), new pc.Vec3(s, s * 0.7, s),
        { vel: d.mulScalar(radius * 3.2 + Math.random() * 2), drag: 4.2, life: 0.7 + Math.random() * 0.3, puff: 0.8 });
    }
  }

  // continuous fire for a burning barrel (call every frame while lit)
  burn(pos, dt, intensity = 1) {
    this._burnAcc = (this._burnAcc || 0) + dt * 40 * intensity;
    while (this._burnAcc > 1) {
      this._burnAcc -= 1;
      const s = 0.07 + Math.random() * 0.09;
      this._spawn(Math.random() < 0.6 ? 'fire' : 'fire2', pos.clone().add(new pc.Vec3((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35)), new pc.Vec3(s, s, s),
        { vel: new pc.Vec3((Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4), life: 0.3 + Math.random() * 0.25, shrink: true });
      if (Math.random() < 0.25) this.puff(pos.clone().add(new pc.Vec3(0, 0.3, 0)), 'smoke', 0.12, 0.9, new pc.Vec3((Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3));
    }
  }

  rocketExhaust(pos, dir) {
    this._spawn('core', pos, new pc.Vec3(0.07, 0.07, 0.07), { life: 0.05, shrink: true });
    this._spawn('fire', pos.clone().sub(dir.clone().mulScalar(0.05)), new pc.Vec3(0.09, 0.09, 0.09), { vel: dir.clone().mulScalar(-2), life: 0.12, shrink: true });
  }

  // physics prop from an existing render entity template (dropped magazines etc.)
  prop(template, worldMat, vel, life = 3, halfExtent = 0.03) {
    const e = template.clone();
    e.enabled = true;
    this.root.addChild(e);
    const pos = worldMat.getTranslation(new pc.Vec3());
    const rot = new pc.Quat().setFromMat4(worldMat);
    e.setPosition(pos); e.setRotation(rot); e.setLocalScale(1, 1, 1);
    this.props.push({ e, t: 0, life, vel, spin: new pc.Vec3((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 120), bounce: 0.25, halfExtent });
  }

  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  // ---------------------------------------------------------------- update
  _physics(it, dt, pos) {
    if (!it.vel) return;
    if (it.drag) it.vel.mulScalar(Math.max(0, 1 - it.drag * dt));
    if (it.bounce || it.grav) it.vel.y -= G * (it.grav ?? 1) * dt;
    pos.x += it.vel.x * dt; pos.y += it.vel.y * dt; pos.z += it.vel.z * dt;
    if (it.bounce) {
      const fl = this.floorAt(pos) + (it.halfExtent ?? 0.01);
      if (pos.y < fl) {
        pos.y = fl;
        if (it.vel.y < -1.2 && it.sound && this.onSound && !it.played) { this.onSound(it.sound); it.played = true; }
        it.vel.y = -it.vel.y * it.bounce;
        it.vel.x *= 0.6; it.vel.z *= 0.6;
        if (it.spin) it.spin.mulScalar(0.5);
      }
    }
  }

  update(dt) {
    if (this.lightPeak > 0) {
      this.lightT += dt;
      const k = Math.max(0, 1 - this.lightT / this.lightDur);
      this.light.light.intensity = this.lightPeak * k * k;
      if (k <= 0) this.lightPeak = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const m = this._m, q = this._q, s = this._s;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        this.inst[it.k].live--;
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        continue;
      }
      this._physics(it, dt, it.pos);
      if (it.spin) { it.eul.x += it.spin.x * dt; it.eul.y += it.spin.y * dt; it.eul.z += it.spin.z * dt; }
      let kx = 1, ky = 1, kz = 1;
      if (it.shrink) { const k = 1 - u; kx = ky = kz = k * (it.grow ? 1 + it.grow * u : 1); }
      else if (it.shrinkXY) { kx = ky = 1 - u; }
      else if (it.puff) { const k = (1 + it.puff * u) * (1 - u * u * u); kx = ky = kz = k; }
      else if (it.grow) { kx = ky = kz = 1 + it.grow * u; }
      if (it.fadeScale && u > 0.8) { const k = (1 - u) / 0.2; kx *= k; ky *= k; kz *= k; }
      if (it.rot) q.copy(it.rot); else q.setFromEulerAngles(it.eul.x, it.eul.y, it.eul.z);
      s.set(it.s.x * kx, it.s.y * ky, it.s.z * kz);
      m.setTRS(it.pos, q, s);
      this.inst[it.k].push(m);
    }
    for (const k in this.inst) this.inst[k].flush();
    // entity props
    for (let i = this.props.length - 1; i >= 0; i--) {
      const it = this.props[i];
      it.t += dt;
      if (it.t >= it.life) { it.e.destroy(); this.props.splice(i, 1); continue; }
      const p = this._p.copy(it.e.getPosition());
      this._physics(it, dt, p);
      it.e.setPosition(p);
      const r = it.e.getLocalEulerAngles();
      it.e.setLocalEulerAngles(r.x + it.spin.x * dt, r.y + it.spin.y * dt, r.z + it.spin.z * dt);
      const u = it.t / it.life;
      if (u > 0.85) { const k = (1 - u) / 0.15; it.e.setLocalScale(k, k, k); }
    }
  }
}
