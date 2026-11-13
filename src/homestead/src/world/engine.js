// PlayCanvas bootstrap: app, asset cache, lights, sky, camera rig and pointer input.
import * as pc from 'playcanvas';
import { clamp, lerp } from '../core/util.js';
import { asset } from '../core/assets.js';

export { pc };

// PlayCanvas binds `new Entity()` to whichever app ticked last. We run a second app (portrait studio),
// so every world entity is created through this factory with the main app passed explicitly.
let MAIN_APP = null;
export const ent = (name) => new pc.Entity(name, MAIN_APP);

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const app = new pc.Application(canvas, {
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' },
    });
    this.app = app;
    MAIN_APP = app;
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    // one dynamic batch group for all props/buildings: identical materials are shared across models (see _canon)
    this.batchGroup = app.batcher.addGroup('world', true, 70);
    this.farGroup = app.batcher.addGroup('far', false, 420);        // the distant forest: static, merged into a few meshes
    this._canonMats = new Map();
    this.islands = new Set();      // every Island registers here (season repaint + cross-fade)
    this.onCanon = null;           // hook: called once for each shared model material (see world/seasons.js)
    this.seasons = null; this.skyline = null;
    window.addEventListener('resize', () => app.resizeCanvas());

    this.containers = new Map();   // name -> container asset
    this.textures = new Map();     // name -> pc.Texture
    this.manifest = { models: [], icons: [], textures: [] };
    this.updaters = new Set();
    this.time = 0;

    this._setupScene();
    this._setupCamera();
    this._setupInput();
    app.on('update', (dt) => {
      dt = Math.min(dt, 0.1);
      this.time += dt;
      this._updateCamera(dt);
      for (const fn of this.updaters) fn(dt, this.time);
    });
  }
  start() { this.app.start(); }
  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  // ------------------------------------------------------------------------------------------
  // assets
  // ------------------------------------------------------------------------------------------
  async loadManifest() {
    try { this.manifest = await (await fetch(asset('manifest.json'), { cache: 'no-cache' })).json(); } catch (e) { console.warn('no manifest', e); }
    return this.manifest;
  }
  _loadOne(url, type, name) {
    return new Promise((resolve) => {
      this.app.assets.loadFromUrlAndFilename(url, name, type, (err, asset) => {
        if (err) { console.warn('asset failed', url, err); resolve(null); } else resolve(asset);
      });
    });
  }
  async loadAssets(onProgress) {
    const m = this.manifest;
    const jobs = [];
    let done = 0;
    const total = m.models.length + m.textures.length;
    const tick = () => { done++; onProgress && onProgress(done / Math.max(1, total)); };
    for (const name of m.textures) {
      jobs.push(this._loadOne(asset(`textures/${name}.png`), 'texture', name + '.png').then((a) => {
        if (a) {
          const t = a.resource;
          t.minFilter = pc.FILTER_NEAREST_MIPMAP_LINEAR; t.magFilter = pc.FILTER_NEAREST;
          t.addressU = pc.ADDRESS_REPEAT; t.addressV = pc.ADDRESS_REPEAT; t.anisotropy = 4;
          this.textures.set(name, t);
        }
        tick();
      }));
    }
    for (const name of m.models) {
      jobs.push(this._loadOne(asset(`models/${name}.glb`), 'container', name + '.glb').then((a) => { if (a) this.containers.set(name, a); tick(); }));
    }
    await Promise.all(jobs);
  }
  hasModel(name) { return this.containers.has(name); }
  tex(name) { return this.textures.get(name) || null; }
  /** New entity instance of a model (shares meshes and materials). Falls back to a tinted box. */
  model(name, opts = {}) {
    const a = this.containers.get(name);
    let e;
    if (a) {
      e = a.resource.instantiateRenderEntity({ castShadows: opts.castShadows !== false, receiveShadows: true });
      this._optimise(e, opts.batch !== false, opts.group || this.batchGroup);
    } else {
      e = ent(name);
      const box = ent('placeholder');
      const s = opts.size || [1.6, 1.6, 1.6];
      box.addComponent('render', { type: 'box', material: this.flatMaterial(opts.color || '#d19a5b') });
      box.setLocalScale(s[0], s[1], s[2]);
      box.setLocalPosition(0, s[1] / 2, 0);
      e.addChild(box);
    }
    e.name = name;
    return e;
  }
  /** Share identical materials between models and put static parts into the world batch group. */
  _optimise(root, batch, group) {
    const visit = (n, glow) => {
      glow = glow || (n.name || '').startsWith('glow_');
      if (n.render) {
        for (const mi of n.render.meshInstances) mi.material = this._canon(mi.material);
        if (batch && !glow) n.render.batchGroupId = group.id;
      }
      for (const c of n.children) visit(c, glow);
    };
    visit(root, false);
  }
  _canon(m) {
    if (!m || m._canon) return m;
    if ((m.name || '').startsWith('tint_')) return m;
    // a GLB carries its own copy of every texture it uses: swap in the shared one from assets/textures (same name),
    // so there is one of each on the GPU and a texture can be retuned without rebuilding the models
    const shared = m.diffuseMap && this.textures.get((m.diffuseMap.name || '').replace(/-\d+$/, ''));      // "wood_g-12" -> wood_g
    if (shared && shared !== m.diffuseMap) m.diffuseMap = shared;
    const c = (x) => (x ? `${x.r.toFixed(3)},${x.g.toFixed(3)},${x.b.toFixed(3)}` : '-');
    const leaf = (m.name || '').startsWith('leafc');      // leaf cards + canopy cores: glow a little, like the reference foliage
    const key = `${m.diffuseMap ? m.diffuseMap.name : '-'}|${c(m.diffuse)}|${c(m.emissive)}|${(m.emissiveIntensity || 0).toFixed(2)}|${m.emissiveMap ? m.emissiveMap.name : '-'}|${(m.opacity ?? 1).toFixed(2)}|${m.blendType}|${leaf ? 'leaf' : ''}`;
    const hit = this._canonMats.get(key);
    if (hit) return hit;
    m._canon = true;
    // models are meant to be matte, like the painted reference. GLB materials store roughness in `gloss`
    // (glossInvert), so "matte" is a high value there and a low one everywhere else.
    if (m.glossInvert) m.gloss = Math.max(m.gloss ?? 0.9, 0.85); else m.gloss = Math.min(m.gloss ?? 0.1, 0.15);
    if (leaf) {
      m.emissive = m.diffuse.clone(); m.emissiveIntensity = 0.3; m.emissiveVertexColor = true; m.emissiveVertexColorChannel = 'rgb';
      m.twoSidedLighting = true; m.cull = pc.CULLFACE_NONE;
      m.gloss = 0;      // on purpose: leaf cards stay smooth, their sun glints are autumn's bleached leaves (other seasons mute them in the shader)
    }
    if (this.onCanon) this.onCanon(m);
    m.update();
    this._canonMats.set(key, m);
    return m;
  }
  // ------------------------------------------------------------------------------------------
  // animated sub-parts shared by every location: spinY_ / bob_ / sway_ / glow_ nodes
  // ------------------------------------------------------------------------------------------
  /** Lamps and fires: each mesh under a glow_ node gets its own copy of its material, so its brightness can flicker. */
  glowOf(node, list) {
    const mis = [];
    walk(node, (k) => {
      if (!k.render) return;
      for (const mi of k.render.meshInstances) { const m = mi.material.clone(); m._canon = true; mi.material = m; mis.push({ m, base: m.emissiveIntensity || 1 }); }
    });
    // what kind of light it is decides how it moves: 2 a flame (jumps, and the flame itself licks), 1 a lamp or a lit
    // window (steady, an odd flick), 0 crystals and other magic (a slow breath)
    const nm = node.name || '';
    const kind = /fire|flame|burner|mouth|torch/.test(nm) ? 2 : /lantern|lamp|window/.test(nm) ? 1 : 0;
    if (mis.length) list.push({ mis, ph: Math.random() * 6, acc: 0, kind, k: -1, n: kind === 2 && !/mouth/.test(nm) ? node : null, sc: node.getLocalScale().clone() });
  }
  animate(set, dt, t, speed = 1) {
    for (const s of set.spin) { const a = 130 * dt * speed; s.n.rotateLocal(s.ax === 0 ? a : 0, s.ax === 1 ? a : 0, s.ax === 2 ? a : 0); }
    for (const b of set.bob) { const p = b.n.getLocalPosition(); b.n.setLocalPosition(p.x, b.y + Math.sin(t * 1.6 + b.ph) * 0.18, p.z); b.n.rotateLocal(0, 28 * dt, 0); }
    // the season's wind (the one that bends the smoke) decides how hard crowns, flags and reeds move
    const sn = this.seasons, wind = (sn && sn.def ? sn.def.wind : 1) * (0.8 + 0.3 * Math.sin(t * 0.37) + 0.14 * Math.sin(t * 1.21 + 1.3)), wk = 0.55 + 0.75 * wind;
    for (const s of set.sway) s.n.setLocalEulerAngles(s.r.x + Math.sin(t * 1.3 + s.ph) * 2.2 * wk, s.r.y, s.r.z + Math.cos(t * 1.1 + s.ph) * 2.6 * wk);
    if (set.lean) for (const s of set.lean) {        // whole small plants: bent a little downwind, nodding in the gusts
      const a = s.amp * (0.35 * wind + Math.sin(t * 1.7 + s.ph) * (0.3 + 0.5 * wind) + Math.sin(t * 3.1 + s.ph * 2.3) * 0.18 * wind) * 0.008727;
      _q2.set(a * 0.38, 0, -a * 0.92, 1).normalize();
      s.n.setLocalRotation(_q1.mul2(_q2, s.q));
    }
    if (set.drift && !(sn && sn.def && sn.def.water === 'ice')) for (const s of set.drift) {      // lily pads ride the ripples
      const p = s.n.getLocalPosition(), a = t * 1.15 + s.ph;
      s.n.setLocalPosition(p.x, s.y + Math.sin(a) * 0.014, p.z);
      s.n.setLocalEulerAngles(Math.sin(a + 1.3) * 2.4, s.ry + Math.sin(t * 0.31 + s.ph) * 7, Math.cos(a * 0.83) * 2.4);
    }
    for (const g of set.glow) {
      g.acc += dt;
      if (g.acc < (g.kind === 2 ? 0.07 : 0.11)) continue;            // a flame changes about 14 times a second, in steps
      g.acc = 0;
      let k;
      if (g.kind === 2) {
        const h = hash1(Math.floor(t * 14) + g.ph * 31), gut = hash1(Math.floor(t * 2.6 + g.ph) + 7.7) > 0.88 ? 0.72 : 1;      // now and then it gutters
        k = (0.74 + 0.36 * h + 0.12 * Math.sin(t * 3.1 + g.ph)) * gut;
        if (g.n) { const up = 0.86 + 0.3 * h * gut, w = 1.05 - 0.1 * h; g.n.setLocalScale(g.sc.x * w, g.sc.y * up, g.sc.z * w); }
      } else if (g.kind === 1) {
        k = 0.95 + 0.05 * Math.sin(t * 1.7 + g.ph);
        if (hash1(Math.floor(t * 9) + g.ph * 17) > 0.975) k *= 0.74;
      } else k = 0.86 + 0.18 * Math.sin(t * 1.3 + g.ph);
      if (Math.abs(k - g.k) < 0.012) continue;                        // nothing to see: leave the material alone
      g.k = k;
      // (material numbers live in the material's uniform block in this engine version, so set the property)
      for (const x of g.mis) { x.m.emissiveIntensity = x.base * k; x.m.update(); }
    }
  }
  /** Models without parts of their own that should still live: reeds, ferns, grass, flowers and crops lean in the wind
   *  as a whole (set.lean), lily pads drift on the water (set.drift). Call after the model is placed and turned. */
  aliveOf(m, into) {
    const nm = m.name || '';
    if (nm === 'lilypad') (into.drift = into.drift || []).push({ n: m, y: m.getLocalPosition().y, ry: m.getLocalEulerAngles().y, ph: Math.random() * 6 });
    else { const amp = LEAN[nm] || (nm.startsWith('crop_') ? 2.6 : 0); if (amp) (into.lean = into.lean || []).push({ n: m, q: m.getLocalRotation().clone(), amp, ph: Math.random() * 6 }); }
  }
  // ------------------------------------------------------------------------------------------
  // walkers and rollers: leg_* (pivot at the hip), wheel_* and sway_tail nodes, driven by the distance travelled,
  // so feet and wheels keep pace with the ground and stop when the model stops
  // ------------------------------------------------------------------------------------------
  gaitOf(root) {
    const g = { root, legs: [], wheels: [], tail: null, tailR: null, x: 0, z: 0, yaw: 0, set: false, ph: 0, odo: 0, k: 0, v: 0, seed: Math.random() * 9 };
    walk(root, (n) => {
      const nm = n.name || '';
      if (nm.startsWith('leg_')) g.legs.push({ n, off: GAIT[nm.slice(4, 6)] || 0, len: Math.max(0.3, n.getLocalPosition().y) });
      else if (nm.startsWith('wheel_')) { const mi = n.render && n.render.meshInstances[0]; g.wheels.push({ n, rad: mi ? Math.max(0.2, mi.mesh.aabb.halfExtents.y) : 0.56, a: 0 }); }
      else if (nm.startsWith('sway_tail')) { g.tail = n; g.tailR = n.getLocalEulerAngles().clone(); }
    });
    return g;
  }
  /** Put a walker at x,z heading `yaw` degrees (turns are eased) and move its legs, wheels, body and tail. */
  gait(g, x, z, yaw, dt, t) {
    let d = 0;
    if (!g.set || dt <= 0) { g.set = true; g.yaw = yaw; }
    else {
      d = Math.hypot(x - g.x, z - g.z);
      if (d > 3) { d = 0; g.yaw = yaw; }                                // a jump (time skipped): no moonwalk
      else { const dy = ((yaw - g.yaw + 540) % 360) - 180; g.yaw += dy * Math.min(1, dt * 5); }
    }
    g.x = x; g.z = z;
    if (dt > 0) g.v += (d / dt - g.v) * Math.min(1, dt * 6);
    g.k += ((g.v > 0.06 ? 1 : 0) - g.k) * Math.min(1, dt * 7);
    g.odo += d;
    const k = g.k, TAU = Math.PI * 2;
    let y = 0, pitch = 0, roll = 0;
    if (g.legs.length) {
      // a four-beat walk: diagonal pairs swing together, the hind foot of each pair a touch late. One cycle covers a
      // stride, so the feet keep pace with the ground; a party that only creeps along still steps at a walking beat
      // (a small slip reads better at phone size than slow motion), and nothing moves once it stands
      const stride = clamp(g.v * 1.05, 1.2, 1.5);
      g.ph = (g.ph + Math.max(d / stride, d > 0 ? 0.8 * dt : 0)) % 1;
      for (const l of g.legs) {
        const amp = Math.asin(Math.min(0.5, stride / (4 * l.len))) * 57.3, a = TAU * (g.ph + l.off);
        l.n.setLocalEulerAngles(amp * k * (Math.sin(a) + 0.18 * Math.sin(2 * a + 0.6)), 0, 0);
      }
      y = k * 0.032 * (0.5 - 0.5 * Math.cos(2 * TAU * g.ph));
      pitch = k * 1.7 * Math.sin(2 * TAU * g.ph + 0.7);                // the head nods twice a stride
      roll = k * 1.4 * Math.sin(TAU * g.ph) + (1 - k) * 1.1 * Math.sin(t * 0.55 + g.seed);      // standing: shifts its weight
    }
    if (g.wheels.length) {
      for (const w of g.wheels) { w.a = (w.a + d / w.rad * 57.2958) % 360; w.n.setLocalEulerAngles(w.a, 0, 0); }
      // ruts and stones under the wheels, and the mule in the shafts stepping (its legs are part of the body)
      const o = g.odo;
      y += k * (0.022 * Math.abs(Math.sin(o * 2.9 + g.seed)) + 0.012 * Math.abs(Math.sin(o * 4.4)));
      roll += k * 1.1 * Math.sin(o * 1.7 + g.seed);
      pitch += k * (0.7 * Math.sin(o * 2.3) + 0.5 * Math.sin(o * 8.2)) + (1 - k) * 0.35 * Math.sin(t * 1.3 + g.seed);
    }
    if (g.tail) {
      // walking: it swings with the stride; standing: a flick every few seconds
      const u = (t * 0.27 + g.seed) % 1, flick = u < 0.16 ? Math.sin(u / 0.16 * Math.PI) * Math.sin(u * 90) * 24 : 0;
      const r = g.tailR;
      g.tail.setLocalEulerAngles(r.x - k * 9 + flick * 0.3, r.y, r.z + k * 13 * Math.sin(TAU * g.ph + 1) + (1 - k * 0.7) * (flick + 3 * Math.sin(t * 1.1 + g.seed)));
    }
    g.root.setLocalPosition(x, y, z);
    _q1.setFromEulerAngles(0, g.yaw, 0); _q2.setFromEulerAngles(pitch, 0, roll);
    g.root.setLocalRotation(_q1.mul(_q2));
  }
  flatMaterial(hex, opts = {}) {
    const key = hex + JSON.stringify(opts);
    this._mats = this._mats || new Map();
    if (this._mats.has(key)) return this._mats.get(key);
    const m = new pc.StandardMaterial();
    const c = new pc.Color().fromString(hex);
    m.diffuse = c;
    m.gloss = 0.1; m.metalness = 0; m.useMetalness = true;
    if (opts.emissive) { m.emissive = new pc.Color().fromString(opts.emissive); m.emissiveIntensity = opts.intensity ?? 1; }
    if (opts.unlit) { m.useLighting = false; m.emissive = c; m.diffuse = new pc.Color(0, 0, 0); }
    if (opts.opacity !== undefined) { m.opacity = opts.opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
    if (opts.additive) { m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; }
    m.update();
    this._mats.set(key, m);
    return m;
  }

  // ------------------------------------------------------------------------------------------
  // scene: light, sky, fog
  // ------------------------------------------------------------------------------------------
  _setupScene() {
    const app = this.app;
    // golden-hour light of the Chainers Farm yard: warm low sun, dim warm ambient, long soft shadows
    app.scene.ambientLight = new pc.Color(0.50, 0.42, 0.40);
    app.scene.exposure = 1.0;

    const sun = ent('sun');
    sun.addComponent('light', {
      type: 'directional', color: new pc.Color(1.0, 0.88, 0.70), intensity: 1.75,
      castShadows: true, shadowResolution: 2048, shadowDistance: 150, numCascades: 2, cascadeDistribution: 0.5,
      shadowBias: 0.25, normalOffsetBias: 0.06, shadowType: pc.SHADOW_PCF5_32F, shadowIntensity: 0.78,
    });
    sun.setEulerAngles(54, 215, 0);
    app.root.addChild(sun);
    this.sun = sun;

    // hazy sky dome (unlit); the gradient is repainted by setSky() when the season turns
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    this._skyCv = cv; this._skyG = cv.getContext('2d');
    const skyTex = new pc.Texture(app.graphicsDevice, { width: 4, height: 256, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    this._skyTex = skyTex;
    // distance haze in the colour of the horizon: the land has no edge, it just fades away
    app.scene.fog.type = pc.FOG_LINEAR;
    this.setSky([0.435, 0.612, 0.769, 0.663, 0.776, 0.855, 0.945, 0.863, 0.729, 0.965, 0.827, 0.643, 0.933, 0.741, 0.549, 0.851, 0.627, 0.439]);
    const skyMat = new pc.StandardMaterial();
    skyMat.useLighting = false; skyMat.diffuse = new pc.Color(0, 0, 0); skyMat.emissive = new pc.Color(1, 1, 1); skyMat.emissiveMap = skyTex;
    skyMat.cull = pc.CULLFACE_FRONT; skyMat.depthWrite = false; skyMat.useFog = false;
    skyMat.update();
    const sky = ent('sky');
    sky.addComponent('render', { type: 'sphere', material: skyMat, castShadows: false, receiveShadows: false });
    sky.setLocalScale(1600, 1600, 1600);
    app.root.addChild(sky);
    this.sky = sky;
  }

  /** Repaint the sky gradient: 6 colours (flat r,g,b array, 0..1 sRGB) from the zenith to below the horizon. */
  setSky(c) {
    const g = this._skyG, grad = g.createLinearGradient(0, 0, 0, 256), at = [0, 0.36, 0.5, 0.6, 0.8, 1];
    for (let i = 0; i < 6; i++) grad.addColorStop(at[i], `rgb(${Math.round(c[i * 3] * 255)},${Math.round(c[i * 3 + 1] * 255)},${Math.round(c[i * 3 + 2] * 255)})`);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    this._skyTex.setSource(this._skyCv);
    this._skyTex.upload();
    this.app.scene.fog.color.set(c[6], c[7], c[8]);       // the colour of the sky where it meets the land
  }

  // ------------------------------------------------------------------------------------------
  // camera rig: orbit-style diorama camera with pan + zoom
  // ------------------------------------------------------------------------------------------
  _setupCamera() {
    const cam = ent('camera');
    cam.addComponent('camera', { fov: 30, nearClip: 1.5, farClip: 2500, clearColor: new pc.Color(0.93, 0.80, 0.62) });
    cam.camera.gammaCorrection = pc.GAMMA_SRGB;
    cam.camera.toneMapping = pc.TONEMAP_NEUTRAL;
    this.app.root.addChild(cam);
    this.camera = cam;
    this.rig = {
      target: new pc.Vec3(0, 0, 0), cur: new pc.Vec3(0, 0, 0), dist: 58, curDist: 130, yaw: 36, curYaw: 36, pitch: 40, curPitch: 40,
      minDist: 15, maxDist: 104, bounds: 30, origin: new pc.Vec3(0, 0, 0), shake: 0, locked: false,
    };
  }
  /** Move the rig to another island. */
  setCameraHome(origin, bounds, dist, snap = false) {
    const r = this.rig;
    r.origin.copy(origin); r.bounds = bounds;
    r.target.copy(origin); if (dist) r.dist = dist;
    if (snap) { r.cur.copy(origin); r.curDist = r.dist; }
  }
  focus(x, z, dist) { const r = this.rig; r.target.set(x, r.origin.y, z); if (dist) r.dist = clamp(dist, r.minDist, r.maxDist); }
  shake(a = 0.5) { this.rig.shake = Math.max(this.rig.shake, a); }
  _updateCamera(dt) {
    const r = this.rig;
    const k = 1 - Math.exp(-dt * 7);
    r.target.x = clamp(r.target.x, r.origin.x - r.bounds, r.origin.x + r.bounds);
    r.target.z = clamp(r.target.z, r.origin.z - r.bounds, r.origin.z + r.bounds);
    r.cur.lerp(r.cur, r.target, k);
    r.curDist = lerp(r.curDist, r.dist, k);
    r.curYaw = lerp(r.curYaw, r.yaw, k);
    r.curPitch = lerp(r.curPitch, r.pitch, k);
    const p = r.curPitch * Math.PI / 180, y = r.curYaw * Math.PI / 180;
    const cx = r.cur.x + Math.sin(y) * Math.cos(p) * r.curDist;
    const cy = r.cur.y + Math.sin(p) * r.curDist;
    const cz = r.cur.z + Math.cos(y) * Math.cos(p) * r.curDist;
    let sx = 0, sy = 0;
    if (r.shake > 0.001) { sx = (Math.random() - 0.5) * r.shake; sy = (Math.random() - 0.5) * r.shake; r.shake *= Math.exp(-dt * 9); }
    this.camera.setPosition(cx + sx, cy + sy, cz);
    this.camera.lookAt(r.cur.x + sx, r.cur.y + sy + 1.2, r.cur.z);
    this.sky.setPosition(cx, 0, cz);
    const fog = this.app.scene.fog;
    fog.start = r.curDist + 34; fog.end = r.curDist + 118;
  }
  /** World point on the ground plane (y = planeY) under a screen position. */
  groundAt(sx, sy, planeY = 0, out = new pc.Vec3()) {
    const cam = this.camera.camera;
    const a = cam.screenToWorld(sx, sy, cam.nearClip, this._va || (this._va = new pc.Vec3()));
    const b = cam.screenToWorld(sx, sy, cam.farClip, this._vb || (this._vb = new pc.Vec3()));
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = (planeY - a.y) / dy;
    if (t < 0) return null;
    out.set(a.x + (b.x - a.x) * t, planeY, a.z + (b.z - a.z) * t);
    return out;
  }
  ray(sx, sy) {
    const cam = this.camera.camera;
    const a = cam.screenToWorld(sx, sy, cam.nearClip, new pc.Vec3());
    const b = cam.screenToWorld(sx, sy, cam.farClip, new pc.Vec3());
    return { o: a, d: b.sub(a).normalize() };
  }
  /** World position -> CSS pixel position (or null when behind the camera). */
  toScreen(x, y, z, out = { x: 0, y: 0 }) {
    const v = this._vs || (this._vs = new pc.Vec3());
    const w = this._vw || (this._vw = new pc.Vec3());
    w.set(x, y, z);
    this.camera.camera.worldToScreen(w, v);
    if (v.z < 0) return null;
    out.x = v.x; out.y = v.y;
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // pointer input: tap, drag-pan, wheel / pinch zoom
  // ------------------------------------------------------------------------------------------
  _setupInput() {
    const cv = this.canvas;
    this.input = { onTap: null, onMove: null, onDragStart: null, onDrag: null, onDragEnd: null, hover: { x: 0, y: 0 } };
    const pts = new Map();
    let dragging = false, moved = 0, downAt = 0, pinch = 0, custom = false, last = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e); pts.set(e.pointerId, p);
      if (pts.size === 1) {
        dragging = true; moved = 0; downAt = performance.now(); last = p;
        custom = !!(this.input.onDragStart && this.input.onDragStart(p.x, p.y));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); custom = false;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.input.hover = p;
      if (!pts.has(e.pointerId)) { this.input.onMove && this.input.onMove(p.x, p.y); return; }
      pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoomBy(pinch / d);
        pinch = d; moved = 99;
        return;
      }
      if (!dragging || !last) return;
      const dx = p.x - last.x, dy = p.y - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (custom) { this.input.onDrag && this.input.onDrag(p.x, p.y); last = p; return; }
      if (moved > 6 && !this.rig.locked) {
        const g0 = this.groundAt(last.x, last.y, this.rig.origin.y), g1 = this.groundAt(p.x, p.y, this.rig.origin.y);
        if (g0 && g1) { this.rig.target.x -= (g1.x - g0.x); this.rig.target.z -= (g1.z - g0.z); this.rig.cur.x -= (g1.x - g0.x) * 0.6; this.rig.cur.z -= (g1.z - g0.z) * 0.6; }
      }
      last = p;
    });
    const up = (e) => {
      const p = pos(e);
      const had = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!had) return;
      if (pts.size === 0) {
        if (custom) { this.input.onDragEnd && this.input.onDragEnd(p.x, p.y, moved); }
        if (moved <= 8 && performance.now() - downAt < 600) this.input.onTap && this.input.onTap(p.x, p.y);
        dragging = false; custom = false; last = null;
      } else last = [...pts.values()][0];
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  zoomBy(f) { const r = this.rig; r.dist = clamp(r.dist * f, r.minDist, r.maxDist); }
}

const _q1 = new pc.Quat(), _q2 = new pc.Quat();
const LEAN = { reeds: 4.5, fern: 3, grass_tuft: 3.4, flowers_a: 3, flowers_b: 3, decor_scarecrow: 1.4 };      // degrees in a fair wind
const GAIT = { fl: 0, br: 0.1, fr: 0.5, bl: 0.6 };                                                         // footfall order, in strides
const hash1 = (x) => { const v = Math.sin(x * 12.9898) * 43758.5453; return v - Math.floor(v); };
/** Depth-first visit of an entity hierarchy. */
export function walk(e, fn) {
  fn(e);
  for (const c of e.children) walk(c, fn);
}
export function meshInstancesOf(e) {
  const out = [];
  walk(e, (n) => { if (n.render) out.push(...n.render.meshInstances); });
  return out;
}
