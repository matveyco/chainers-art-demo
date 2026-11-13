// Seasons: one controller that blends light, sky, clouds, foliage colours, snow cover and weather
// between the four seasons, and tells the islands when to repaint their ground.
//
// Foliage and snow live in the shader, so nothing is rebuilt when the season turns:
//  - leaf materials (`leafc*`) re-paint their baked autumn colours on a per-season ramp, and in winter
//    the cards on top of a crown catch snow (whole cards, the lightest and most skyward first);
//  - every other model material grows pixel-dithered snow on faces that look up. `snow` is an amount:
//    below 1 the cover breaks into drifts about a metre wide and the surface shows through.
import { pc, ent } from './engine.js';
import { SEASONS, DEFAULT_SEASON, SKY_STOPS, SNOW, WEATHER } from '../data/seasons.js';

const DUR = 2.8;            // seconds for one season to turn into the next
const SWAP_AT = 0.2;        // progress at which the ground repaints (then cross-fades)
const FAMILIES = ['russet', 'orange', 'gold', 'green'];
const srgb = (hex) => { const c = new pc.Color().fromString(hex); return [c.r, c.g, c.b]; };
const lin = (hex) => srgb(hex).map((v) => Math.pow(v, 2.2));
const mix = (a, b, k) => a + (b - a) * k;
const mixN = (a, b, k) => a.map((v, i) => mix(v, b[i], k));
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
/** The wind right now: the season's own strength breathing in slow gusts. Weather motes and chimney smoke share it. */
export const windAt = (engine) => { const s = engine.seasons, t = engine.time; return (s ? s.def.wind : 1) * (0.8 + 0.3 * Math.sin(t * 0.37) + 0.14 * Math.sin(t * 1.21 + 1.3)); };

// ---------------------------------------------------------------------------------------------------
// shader chunks (GLSL, PlayCanvas 2.x StandardMaterial front end)
// ---------------------------------------------------------------------------------------------------
const ALBEDO = `
	dAlbedo = material_diffuse.rgb;
	#ifdef STD_DIFFUSE_TEXTURE
		dAlbedo *= {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_DIFFUSE_TEXTURE_CHANNEL};
	#endif
`;
const LEAF_DIFFUSE = `
uniform vec3 material_diffuse;
uniform float uLeafK;
uniform float uLeafGlow;
uniform float uLeafSnow;
uniform vec3 uSnowCol;
uniform vec3 uSnowShade;
uniform vec3 uLeafShade;
uniform vec3 uLeafR0; uniform vec3 uLeafR1;
uniform vec3 uLeafO0; uniform vec3 uLeafO1;
uniform vec3 uLeafB0; uniform vec3 uLeafB1;
uniform vec3 uLeafG0; uniform vec3 uLeafG1;
float sLeafTone = 0.0;      // 0 shade .. 1 the lightest cards of a crown
float sLeafSnow = 0.0;      // 1 where this card carries snow
// baked autumn colour -> this season's colour. Family by green/red ratio, tone by brightness.
vec3 seasonLeaf(vec3 c) {
	float v = max(c.r, max(c.g, c.b));
	float q = c.g / max(c.r, 0.0001);
	float wG = smoothstep(0.80, 1.00, q);
	float wB = smoothstep(0.42, 0.54, q) * (1.0 - wG);
	float wR = 1.0 - smoothstep(0.18, 0.23, q);
	float wO = max(0.0, 1.0 - wG - wB - wR);
	float vRef = wR * 0.69 + wO * 0.74 + wB * 0.87 + wG * 0.32;
	float t = clamp(v / vRef, 0.0, 1.12);
	sLeafTone = t;
	vec3 mid = wR * uLeafR0 + wO * uLeafO0 + wB * uLeafB0 + wG * uLeafG0;
	vec3 top = wR * uLeafR1 + wO * uLeafO1 + wB * uLeafB1 + wG * uLeafG1;
	vec3 ramp = t < 0.55 ? mix(uLeafShade, mid, t / 0.55) : mix(mid, top, (t - 0.55) / 0.45);
	return mix(c, ramp, uLeafK);
}
void getAlbedo() {${ALBEDO}
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
	#endif
	dAlbedo = seasonLeaf(dAlbedo);
	sLeafSnow = 0.0;
	#ifdef LIT_NEEDS_NORMAL
	if (uLeafSnow > 0.002) {
		// every leaf normal leans skyward; only the middle of a crown points straight up, so "up" picks the
		// cap of each tree. A card's own tone (lighter towards the top and the tip) breaks the edge into leaves.
		float up = smoothstep(0.82, 0.98, dVertexNormalW.y);
		float tone = smoothstep(0.5, 1.0, sLeafTone);
		sLeafSnow = step(1.0 - uLeafSnow, up * 0.7 + tone * 0.3);
		dAlbedo = mix(dAlbedo, mix(uSnowShade, uSnowCol, tone), sLeafSnow);
	}
	#endif
}
`;
const LEAF_EMISSIVE = `
#ifndef MESH_COLOR
	uniform vec3 material_emissive;
#endif
uniform float material_emissiveIntensity;
void getEmission() {
	#ifdef MESH_COLOR
		dEmission = mesh_color.rgb;
	#else
		dEmission = material_emissive;
	#endif
	#ifdef STD_EMISSIVE_TEXTURE
	dEmission *= {STD_EMISSIVE_TEXTURE_DECODE}(texture2DBias({STD_EMISSIVE_TEXTURE_NAME}, {STD_EMISSIVE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_EMISSIVE_TEXTURE_CHANNEL};
	#endif
	#ifdef STD_EMISSIVE_VERTEX
	dEmission *= saturate(vVertexColor.{STD_EMISSIVE_VERTEX_CHANNEL});
	#endif
	dEmission = seasonLeaf(dEmission) * material_emissiveIntensity * mix(1.0, uLeafGlow, uLeafK) * (1.0 - sLeafSnow);
}
`;
// Leaf materials arrive mirror-smooth (roughness 0), so single cards throw hard, sun-coloured glints.
// Autumn keeps them: they are its sun-bleached leaves. On a recoloured crown they are orange or peach
// specks that belong to no palette, so the other seasons turn the cards matte.
const LEAF_GLOSS = `
#ifdef STD_GLOSS_CONSTANT
uniform float material_gloss;
#endif
uniform float uLeafMatte;
void getGlossiness() {
	dGlossiness = 1.0;
	#ifdef STD_GLOSS_CONSTANT
	dGlossiness *= material_gloss;
	#endif
	#ifdef STD_GLOSS_TEXTURE
	dGlossiness *= texture2DBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_UV}, {STD_TEXTURE_BIAS}).{STD_GLOSS_TEXTURE_CHANNEL};
	#endif
	#ifdef STD_GLOSS_VERTEX
	dGlossiness *= saturate(vVertexColor.{STD_GLOSS_VERTEX_CHANNEL});
	#endif
	#ifdef STD_GLOSS_INVERT
	dGlossiness = 1.0 - dGlossiness;
	#endif
	dGlossiness = mix(dGlossiness, min(dGlossiness, 0.25), uLeafMatte);
	dGlossiness += 0.0000001;
}
`;
const SNOW_DIFFUSE = `
uniform vec3 material_diffuse;
uniform float uSnow;
uniform vec3 uSnowCol;
uniform vec3 uSnowShade;
float seasonHash(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.x + p.y) * p.z);
}
// soft blobs about a metre wide: where the snow lies thick and where it has slid or blown off
float seasonDrift(vec3 p) {
	vec3 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = mix(mix(seasonHash(i), seasonHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(seasonHash(i + vec3(0.0, 0.0, 1.0)), seasonHash(i + vec3(1.0, 0.0, 1.0)), f.x), f.z);
	float b = mix(mix(seasonHash(i + vec3(0.0, 1.0, 0.0)), seasonHash(i + vec3(1.0, 1.0, 0.0)), f.x), mix(seasonHash(i + vec3(0.0, 1.0, 1.0)), seasonHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.z);
	return mix(a, b, f.y);
}
void getAlbedo() {${ALBEDO}
	#ifdef LIT_NEEDS_NORMAL
	if (uSnow > 0.002) {
		// 16 chunky pixels per metre, like the ground; cover thins out as the face tips over
		vec3 cell = floor(vPositionW * 16.0 + dVertexNormalW * 0.5);
		float n = seasonHash(cell);
		float drift = seasonDrift(cell / 16.0 * 1.1 + 3.7);
		float cover = uSnow * smoothstep(0.34, 0.66, dVertexNormalW.y);
		float m = step(n * 0.4 + drift * 0.6, cover * 1.25 - 0.12);
		float n2 = seasonHash(floor(vPositionW * 5.0) + 7.0);
		dAlbedo = mix(dAlbedo, mix(uSnowShade, uSnowCol, step(0.2, n2 * 0.55 + n * 0.45)), m);
	}
	#endif
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
	#endif
}
`;
// never snowed on: glowing parts, flames, crystals, ETH
const NO_SNOW = /^(emit|emis|exp_emit|exp_crystal|flame|lamp|eth_|plus_gold|glass)/;
const TUFT = { '#b8742c': 0, '#c98a3c': 1, '#a5621f': 2 };   // the dry grass tufts at the foot of things
// props baked in the colours of the first art pass follow the seasons' palette instead:
// petal litter is dusty rose / peach / cream, modelled snow (drifts, the snowman) is the shader's snow
const RETINT = { '#f4a9c0': '#d79c90', '#fbd0dc': '#ebc7b4', '#fff8fa': '#f5e8d6', '#f4f7fc': SNOW.color };

// ---------------------------------------------------------------------------------------------------
// weather: a small cloud of drifting motes around the camera (petals, fireflies, leaves, snow)
// ---------------------------------------------------------------------------------------------------
class Weather {
  constructor(engine, max = 150) {
    this.engine = engine;
    this.root = ent('weather');
    engine.app.root.addChild(this.root);
    this.group = engine.app.batcher.addGroup('weather', true, 600);
    this.items = [];
    const base = engine.flatMaterial('#ffffff');
    for (let i = 0; i < max; i++) {
      const e = ent('w');
      e.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false, material: base });
      e.render.batchGroupId = this.group.id;
      e.enabled = false;
      this.root.addChild(e);
      this.items.push({ e, x: 0, y: 0, z: 0, vy: 0, ph: Math.random() * 6.28, s: 0.1, spin: 0, rot: Math.random() * 360, yaw: Math.random() * 360, flip: false });
    }
    this.kind = null; this.cfg = null; this.wind = 0;
    this.R = 25; this.H = 15;
  }
  set(kind, wind) {
    this.wind = wind;
    if (kind === this.kind) return;
    this.kind = kind;
    const c = this.cfg = WEATHER[kind] || null;
    const eng = this.engine;
    const mats = c ? c.colors.map((hex) => eng.flatMaterial(hex, { emissive: hex, intensity: c.glow })) : [];
    this.items.forEach((it, i) => {
      const on = !!c && i < c.count;
      if (it.e.enabled !== on) it.e.enabled = on;
      if (!on) return;
      it.e.render.material = mats[i % mats.length];
      this._spawn(it, true);
    });
    eng.app.batcher.markGroupDirty(this.group.id);
  }
  _spawn(it, anywhere) {
    const c = this.cfg, o = this.engine.rig.cur, top = c.low ? 6 : this.H;
    it.x = o.x + (Math.random() * 2 - 1) * this.R;
    it.z = o.z + (Math.random() * 2 - 1) * this.R;
    it.y = o.y + (anywhere ? 0.4 + Math.random() * (top - 0.4) : top * (0.8 + Math.random() * 0.2));
    it.vy = mix(c.fall[0], c.fall[1], Math.random());
    it.s = mix(c.size[0], c.size[1], Math.random());
    it.spin = c.spin * (0.5 + Math.random());
    it.flip = Math.random() < 0.3;                       // about one leaf in three tumbles end over end, the rest rock like a cradle
    if (!c.flat && !c.low && Math.random() < 0.12) { it.s *= 1.3; it.vy *= 0.75; }      // a few fat, slow flakes
  }
  update(dt, t) {
    const c = this.cfg;
    if (!c) return;
    const o = this.engine.rig.cur, R = this.R, top = c.low ? 6 : this.H;
    const wind = windAt(this.engine), wx = wind * 0.92, wz = wind * 0.38;      // gusts: the same wind that bends the chimney smoke
    // a mote drifting right past the lens would fill the screen as one flat square: shrink it away as it nears
    const cp = this.engine.camera.getPosition(), near = Math.max(7, this.engine.rig.curDist * 0.42);
    for (let i = 0; i < c.count; i++) {
      const it = this.items[i];
      // flat cards (leaves, petals) fall like paper: they rock from side to side, slide the way they lean and
      // drop fastest through the middle of each swing
      const sw = t * (1.7 + (it.ph % 1) * 0.9) + it.ph, rock = c.flat ? Math.sin(sw) : 0;
      it.x += (wx + Math.sin(t * 0.9 + it.ph) * c.drift + rock * Math.cos(it.ph) * c.drift * 0.9) * dt;
      it.z += (wz + Math.cos(t * 0.7 + it.ph * 1.3) * c.drift + rock * Math.sin(it.ph) * c.drift * 0.9) * dt;
      it.y -= it.vy * (c.flat ? 0.55 + 0.75 * Math.abs(Math.cos(sw)) : 1) * dt;
      if (c.low) it.y += Math.sin(t * 0.6 + it.ph) * 0.35 * dt;
      if (it.x - o.x > R) it.x -= 2 * R; else if (it.x - o.x < -R) it.x += 2 * R;
      if (it.z - o.z > R) it.z -= 2 * R; else if (it.z - o.z < -R) it.z += 2 * R;
      if (it.y < o.y + 0.04 || it.y > o.y + top + 1) this._spawn(it, c.low);
      it.e.setPosition(it.x, it.y, it.z);
      const cd = Math.hypot(it.x - cp.x, it.y - cp.y, it.z - cp.z);
      const k = cd >= near ? 1 : Math.max(0.001, (cd / near) ** 3);
      if (c.flat) {
        it.yaw += it.spin * 0.22 * dt;
        if (it.flip) { it.rot += it.spin * dt; it.e.setLocalEulerAngles(it.rot, it.yaw, rock * 30); }
        else it.e.setLocalEulerAngles(Math.cos(sw * 0.8) * 22, it.yaw, rock * 58);
        it.e.setLocalScale(it.s * k, it.s * 0.12 * k, it.s * 0.8 * k);
      } else if (c.low) {
        // fireflies blink in three hard steps rather than pulse
        const b = Math.sin(t * 2.6 + it.ph * 3), s = it.s * (b > 0.35 ? 1 : b > -0.45 ? 0.62 : 0.22) * k;
        it.e.setLocalScale(s, s, s);
      } else {
        // snow: little cubes turning slowly as they fall
        it.rot += (38 + (it.ph % 1) * 70) * dt;
        it.e.setLocalEulerAngles(it.rot, it.rot * 0.7 + it.yaw, 0);
        const s = it.s * k;
        it.e.setLocalScale(s, s, s);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
export class Seasons {
  constructor(engine) {
    this.engine = engine;
    this.scope = engine.app.graphicsDevice.scope;
    this.id = DEFAULT_SEASON;
    this.to = SEASONS[this.id];
    this.a = this.b = this.cur = this._state(this.to);
    this.p = 1;
    this._swapped = true;
    this._swapFns = new Set();
    this._jobs = [];
    this._tuft = [];           // [material, index]
    this._water = [];
    this._col = new pc.Color();
    this._uni = {};
    engine.onCanon = (m) => this._adopt(m);
    this.weather = new Weather(engine);
    this.weather.set(this.to.weather, this.to.wind);
    this._apply(this.cur);
    engine.onUpdate((dt, t) => this._update(dt, t));
  }
  /** The season the world is in, or turning into. */
  get def() { return this.to; }
  get turning() { return this.p < 1; }
  /** fn() runs once per change, at the moment the ground should repaint. */
  onSwap(fn) { this._swapFns.add(fn); }
  /** Heavy work spread over the following frames (one job per frame). */
  defer(fn) { this._jobs.push(fn); }

  set(id, instant = false) {
    const to = SEASONS[id];
    if (!to || (id === this.id && !instant)) return false;
    this.id = id; this.to = to;
    this.a = this.cur;
    this.b = this._state(to);
    this.p = instant ? 1 : 0;
    this._swapped = false;
    if (instant) { this.cur = this.b; this._apply(this.cur); this._swap(false); }
    return true;
  }
  /** Re-apply the current look (e.g. after the clouds were created). */
  refresh() { this._apply(this.cur); }

  // ------------------------------------------------------------------------------------------
  _state(d) {
    const L = d.leaf;
    const st = {
      sun: d.sun.color.slice(), sunI: d.sun.intensity, pitch: d.sun.pitch, shadow: d.sun.shadow,
      amb: d.ambient.slice(),
      sky: d.sky.flatMap(srgb), cloud: d.cloud.flatMap(srgb), tuft: d.tuft.flatMap(srgb),
      snow: d.snow, leafSnow: (L && L.snow) || 0, leafK: L ? 1 : 0, glow: L ? L.glow : 1,
      ramp: L ? [lin(L.shade), ...FAMILIES.flatMap((f) => [lin(L[f][0]), lin(L[f][1])])].flat() : null,
    };
    return st;
  }
  _blend(a, b, p) {
    const e = smooth(p);
    const snowK = b.snow > a.snow ? smooth((p - 0.3) / 0.7) : smooth(p / 0.6);
    return {
      sun: mixN(a.sun, b.sun, e), sunI: mix(a.sunI, b.sunI, e), pitch: mix(a.pitch, b.pitch, e), shadow: mix(a.shadow, b.shadow, e),
      amb: mixN(a.amb, b.amb, e), sky: mixN(a.sky, b.sky, e), cloud: mixN(a.cloud, b.cloud, e), tuft: mixN(a.tuft, b.tuft, e),
      snow: mix(a.snow, b.snow, snowK), leafSnow: mix(a.leafSnow, b.leafSnow, snowK),
      leafK: mix(a.leafK, b.leafK, e), glow: mix(a.glow, b.glow, e),
      // a season without a ramp (autumn) borrows the other side's while the mix factor fades
      ramp: !b.ramp ? a.ramp : !a.ramp ? b.ramp : mixN(a.ramp, b.ramp, e),
    };
  }
  _set(name, v) {
    let u = this._uni[name];
    if (!u) u = this._uni[name] = { id: this.scope.resolve(name), buf: typeof v === 'number' ? null : new Float32Array(3) };
    if (u.buf) { u.buf[0] = v[0]; u.buf[1] = v[1]; u.buf[2] = v[2]; u.id.setValue(u.buf); } else u.id.setValue(v);
  }
  _apply(s) {
    const eng = this.engine, sun = eng.sun.light;
    sun.color = this._col.set(s.sun[0], s.sun[1], s.sun[2]);
    sun.intensity = s.sunI;
    sun.shadowIntensity = s.shadow;
    eng.sun.setEulerAngles(s.pitch, 215, 0);
    eng.app.scene.ambientLight.set(s.amb[0], s.amb[1], s.amb[2]);
    eng.setSky(s.sky);
    if (eng.skyline) eng.skyline.tint(s.cloud);
    this._set('uSnow', s.snow);
    this._set('uLeafSnow', s.leafSnow);
    this._set('uSnowCol', this._snowCol || (this._snowCol = lin(SNOW.color)));
    this._set('uSnowShade', this._snowShade || (this._snowShade = lin(SNOW.shade)));
    this._set('uLeafK', s.ramp ? s.leafK : 0);
    this._set('uLeafMatte', s.ramp ? s.leafK : 0);
    this._set('uLeafGlow', s.glow);
    const r = s.ramp || this._zero || (this._zero = new Array(27).fill(0));
    const names = ['uLeafShade', 'uLeafR0', 'uLeafR1', 'uLeafO0', 'uLeafO1', 'uLeafB0', 'uLeafB1', 'uLeafG0', 'uLeafG1'];
    for (let i = 0; i < 9; i++) this._set(names[i], [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]]);
    for (const [m, i] of this._tuft) { m.diffuse.set(s.tuft[i * 3], s.tuft[i * 3 + 1], s.tuft[i * 3 + 2]); m.update(); }
  }
  /** Called by the engine for every shared model material, once. */
  _adopt(m) {
    const n = m.name || '';
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    if (n.startsWith('leafc')) {
      chunks.set('diffusePS', LEAF_DIFFUSE);
      chunks.set('emissivePS', LEAF_EMISSIVE);
      chunks.set('glossPS', LEAF_GLOSS);
    } else if (m.diffuseMap && /^water/.test(m.diffuseMap.name || '')) {
      m._liquid = m.diffuseMap;
      this._water.push(m);
      this._freeze(m);
      return;
    } else if (NO_SNOW.test(n) || m.blendType !== pc.BLEND_NONE) {
      return;
    } else {
      chunks.set('diffusePS', SNOW_DIFFUSE);
      const hex = /^flat_(#[0-9a-f]{6})_/.exec(n);
      if (hex && hex[1] in TUFT) {
        const i = TUFT[hex[1]], t = this.cur.tuft;
        this._tuft.push([m, i]);
        m.diffuse.set(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]);
      } else if (hex && hex[1] in RETINT) m.diffuse.fromString(RETINT[hex[1]]);
    }
    m.shaderChunksVersion = pc.CHUNKAPI_2_8 || '2.8';
  }
  _freeze(m) {
    const ice = this.to.water === 'ice' ? this.engine.tex('ice') : null;
    const want = ice || m._liquid;
    if (m.diffuseMap !== want) { m.diffuseMap = want; m.update(); }
  }
  _swap(fade) {
    this._swapped = true;
    this.fading = fade;
    this.weather.set(this.to.weather, this.to.wind);
    for (const m of this._water) this._freeze(m);
    for (const fn of this._swapFns) fn(fade);
  }
  _update(dt, t) {
    if (this._jobs.length) this._jobs.shift()();
    if (this.p < 1) {
      this.p = Math.min(1, this.p + dt / DUR);
      this.cur = this.p >= 1 ? this.b : this._blend(this.a, this.b, this.p);
      this._apply(this.cur);
      if (!this._swapped && this.p >= SWAP_AT) this._swap(true);
      if (this.fading) {
        const k = 1 - smooth((this.p - SWAP_AT) / 0.62);
        for (const isl of this.engine.islands) isl.setFade(k);
        if (k <= 0) this.fading = false;
      }
    }
    this.weather.update(dt, t);
  }
}
