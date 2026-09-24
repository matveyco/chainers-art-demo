// Sprite VFX: every camera-facing particle in the game (muzzle flashes, fireballs, smoke, dust,
// sparks, tracers, shock rings) is one instanced quad drawn in a single call, sorted back to
// front and blended premultiplied, so a particle can be anything from fully additive (glow) to
// fully solid (a toon smoke puff) in the same draw.
//
// The sprites come from an atlas of hand-drawn toon elements plus an "erosion field" atlas: each
// sprite dissolves from its edges inwards (field below the erosion threshold is cut away), and
// fire sprites can be re-coloured through a temperature ramp so a fireball cools from white-hot
// to soot as it ages. With a depth prepass available the sprites fade where they meet geometry
// (soft particles), so smoke never shows a hard line against the floor.
const pc = window.pc;

const COLS = 4, ROWS = 5;
export const CELL = {
  MUZZLE_SIDE: 0, MUZZLE_STAR: 1, BLAST_SIDE: 2, FLARE: 3,
  FIRE: 4,          // 4..7
  SMOKE: 8,         // 8..11
  STREAK: 12, IMPACT_STAR: 13, RING: 14, GLOW: 15,
  FLAME: 16,        // 16..19
};
export const MODE = { BILLBOARD: 0, STRETCH: 1, FLAT: 2, STRETCH_SOLID: 3 };

const VS = /* glsl */`
attribute vec3 vertex_position;
attribute vec4 aP0;   // centre xyz, half size (m)
attribute vec4 aP1;   // colour rgb (linear multiplier), opacity
attribute vec4 aP2;   // axis xyz, rotation (billboard / flat) or aspect (stretch)
attribute vec4 aP3;   // cell, additive 0..1, erosion 0..1, emissive (0 = lit by uLight)
attribute vec4 aP4;   // soft distance (m), heat 0..1, fire ramp 0..1, mode

uniform mat4 matrix_viewProjection;
uniform mat4 matrix_view;
uniform vec3 view_position;

varying vec2 vUv;
varying vec2 vQuad;
varying vec4 vColor;
varying vec4 vP3;
varying vec4 vP4;
varying float vDepth;

void main(void) {
	vec2 c = vertex_position.xy;
	vQuad = c;
	vec3 camRight = vec3(matrix_view[0][0], matrix_view[1][0], matrix_view[2][0]);
	vec3 camUp = vec3(matrix_view[0][1], matrix_view[1][1], matrix_view[2][1]);
	vec3 centre = aP0.xyz;
	float size = aP0.w;
	float mode = aP4.w;
	float fade = 1.0;
	vec3 world;
	if (mode > 1.5 && mode < 2.5) {
		// flat quad lying in the plane perpendicular to the axis (ground rings, scorch flashes)
		vec3 n = normalize(aP2.xyz);
		vec3 t = abs(n.y) < 0.99 ? normalize(cross(vec3(0.0, 1.0, 0.0), n)) : vec3(1.0, 0.0, 0.0);
		vec3 b = cross(n, t);
		float cr = cos(aP2.w), sr = sin(aP2.w);
		vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
		world = centre + (t * r.x + b * r.y) * size;
	} else if (mode > 0.5) {
		// stretched along the axis, turned about it to face the camera (sparks, tracers, side flashes)
		vec3 ax = aP2.xyz;
		vec3 toCam = view_position - centre;
		vec3 side = cross(ax, toCam);
		float sl = length(side);
		side = sl > 1e-6 ? side / sl : camRight;
		if (mode < 2.5) fade = clamp(sl / max(length(toCam), 1e-4) * 4.0, 0.0, 1.0);   // looking straight down the axis: fade out
		world = centre + ax * (c.x * size * aP2.w) + side * (c.y * size);
	} else {
		float cr = cos(aP2.w), sr = sin(aP2.w);
		vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
		world = centre + (camRight * r.x + camUp * r.y) * size;
	}
	gl_Position = matrix_viewProjection * vec4(world, 1.0);
	vDepth = -(matrix_view * vec4(world, 1.0)).z;
	float cell = aP3.x + 0.5;
	float cx = floor(mod(cell, ${COLS}.0));
	float cy = floor(cell / ${COLS}.0);
	vUv = (vec2(cx, cy) + vec2(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5)) / vec2(${COLS}.0, ${ROWS}.0);
	vColor = vec4(aP1.rgb, aP1.a * fade);
	vP3 = aP3;
	vP4 = aP4;
}
`;

const FS = /* glsl */`
#include "gammaPS"
#include "tonemappingPS"
#include "fogPS"
#ifdef SOFT
	#include "screenDepthPS"
#endif

uniform sampler2D uAtlas;
uniform sampler2D uField;
uniform vec3 uLight;

varying vec2 vUv;
varying vec2 vQuad;
varying vec4 vColor;
varying vec4 vP3;
varying vec4 vP4;
varying float vDepth;

// toon temperature ramp: soot, deep red, orange, yellow, white-hot (hard bands, 6% soft edges)
vec3 fireRamp(float t) {
	vec3 c = vec3(0.075, 0.065, 0.06);
	c = mix(c, vec3(0.50, 0.09, 0.03), smoothstep(0.08, 0.14, t));
	c = mix(c, vec3(1.00, 0.33, 0.05), smoothstep(0.28, 0.34, t));
	c = mix(c, vec3(1.00, 0.70, 0.16), smoothstep(0.50, 0.56, t));
	c = mix(c, vec3(1.00, 0.95, 0.78), smoothstep(0.74, 0.80, t));
	return c;
}

void main(void) {
	vec4 tex;
	float field;
	if (abs(vP3.x - ${CELL.STREAK}.0) < 0.5) {
		// streaks (sparks, tracers) are drawn analytically: stretched 20:1 a texture would be
		// mip-mapped down to a faint smear, this stays a crisp white-hot core with a warm glow
		float along = 1.0 - abs(vQuad.x);
		float across = abs(vQuad.y);
		float core = smoothstep(0.0, 0.35, along) * (1.0 - smoothstep(0.1 + 0.25 * along, 0.2 + 0.3 * along, across));
		float glow = sqrt(max(along, 0.0)) * exp(-across * across * 5.0);
		tex = vec4(mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.97, 0.86), core), max(core, glow * 0.55));
		field = tex.a;
	} else {
		tex = texture2D(uAtlas, vUv);
		field = texture2D(uField, vUv).r;
	}
	// erosion: the sprite dissolves from low field values (edges) to high ones (core)
	float w = 0.07;
	float vis = clamp((field - vP3.z * (1.0 + w)) / w + 1.0, 0.0, 1.0);
	float a = tex.a * vis * vColor.a;
	vec3 col = tex.rgb;
	if (vP4.z > 0.0) {
		float h = vP4.y;
		float t = field * 1.25 * (1.0 - h) - h * 0.3;
		col = mix(col, fireRamp(t), vP4.z);
	}
	col *= vColor.rgb * (vP3.w > 0.0 ? vec3(vP3.w) : uLight);
	#ifdef SOFT
		if (vP4.x > 0.0) {
			float sceneZ = getLinearScreenDepth();
			a *= clamp((sceneZ - vDepth) / vP4.x, 0.0, 1.0);
		}
	#endif
	// never let a sprite smear across the lens: fade out within a metre of the camera
	a *= clamp((vDepth - 0.35) * 1.1, 0.0, 1.0);
	if (a < 0.003) discard;
	float add = vP3.y;
	dBlendModeFogFactor = 1.0 - add;
	col = addFog(col);
	col = toneMap(col);
	col = gammaCorrectOutput(col);
	gl_FragColor = vec4(col * a, a * (1.0 - add));
}
`;

function makeMaterial(soft, atlas, field) {
  const m = new pc.ShaderMaterial({
    uniqueName: soft ? 'vfx-sprites-soft' : 'vfx-sprites',
    vertexGLSL: VS,
    fragmentGLSL: FS,
    attributes: {
      vertex_position: pc.SEMANTIC_POSITION,
      aP0: pc.SEMANTIC_ATTR11, aP1: pc.SEMANTIC_ATTR12, aP2: pc.SEMANTIC_ATTR13, aP3: pc.SEMANTIC_ATTR14, aP4: pc.SEMANTIC_ATTR15,
    },
  });
  if (soft) m.setDefine('SOFT', '');
  m.setParameter('uAtlas', atlas);
  m.setParameter('uField', field);
  m.setParameter('uLight', [1.2, 1.15, 1.08]);
  // premultiplied colour; destination alpha keeps "how much of the scene is still visible", so
  // the comic ink pass can leave out lines behind smoke and fire
  m.blendState = new pc.BlendState(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA,
    pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA);
  m.depthWrite = false;
  m.depthTest = true;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

const ease = {
  lin: (u) => u,
  out: (u) => 1 - (1 - u) * (1 - u),
  out3: (u) => 1 - Math.pow(1 - u, 3),
  in: (u) => u * u,
};

// A particle is a plain object; everything that changes over life is a [from, to] pair.
// Fields: cell, pos, vel, life, delay, size:[a,b], sizeEase, grow (fraction of life to reach full
// size), color:[r,g,b] (+ color1), alpha, fadeIn,
// fadeOut (fraction of life), add, emis:[a,b], erode:[a,b] + erodeStart, heat:[a,b], ramp,
// soft, mode, axis, rot, spin, drag, grav, stretch, bounce, floor, onUpdate
export class Sprites {
  constructor(app, camera, atlas, field, capacity = 1800) {
    this.app = app;
    this.camera = camera;
    this.cap = capacity;
    this.list = [];
    this.floorAt = () => 0;
    const device = app.graphicsDevice;
    const fmt = new pc.VertexFormat(device, [
      { semantic: pc.SEMANTIC_ATTR11, components: 4, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_ATTR12, components: 4, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_ATTR13, components: 4, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_ATTR14, components: 4, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_ATTR15, components: 4, type: pc.TYPE_FLOAT32 },
    ]);
    this.stride = 20;
    this.data = new Float32Array(capacity * this.stride);
    this.vb = new pc.VertexBuffer(device, fmt, capacity, { usage: pc.BUFFER_DYNAMIC, data: this.data });
    const quad = new pc.Mesh(device);
    quad.setPositions([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    quad.setIndices([0, 1, 2, 0, 2, 3]);
    quad.update();
    this.mats = { hard: makeMaterial(false, atlas, field), soft: makeMaterial(true, atlas, field) };
    this.mi = new pc.MeshInstance(quad, this.mats.hard);
    this.mi.setInstancing(this.vb);
    this.mi.instancingCount = 0;
    this.mi.cull = false;
    this.mi.castShadow = false;
    this.mi.calculateSortDistance = () => 0;     // after the other transparent geometry
    this.entity = new pc.Entity('Sprites');
    this.entity.addComponent('render', { meshInstances: [this.mi], castShadows: false, receiveShadows: false });
    app.root.addChild(this.entity);
    this._depth = new Float32Array(capacity);
    this._order = new Uint16Array(capacity);
    this._orderArr = [];
    this.soft = false;
    this.budget = 1;
  }

  setSoft(on) {
    if (on === this.soft) return;
    this.soft = on;
    this.mi.material = on ? this.mats.soft : this.mats.hard;
  }

  setLight(rgb) {
    for (const m of Object.values(this.mats)) m.setParameter('uLight', rgb);
  }

  get count() { return this.list.length; }

  spawn(o) {
    if (this.list.length >= this.cap) return null;
    // low quality: thin out the big lit puffs (the fill-rate cost), keep every flash and spark
    if (this.budget < 1 && o.cell >= CELL.SMOKE && o.cell < CELL.SMOKE + 4 && Math.random() > this.budget) return null;
    const p = {
      cell: o.cell ?? CELL.GLOW, pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : null,
      t: -(o.delay || 0), life: o.life ?? 0.5,
      size: o.size ?? [0.2, 0.2], sizeEase: ease[o.sizeEase || 'out'],
      color: o.color ?? [1, 1, 1], color1: o.color1 ?? null,
      alpha: o.alpha ?? 1, fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0.4,
      add: o.add ?? 0, emis: o.emis ?? [0, 0], erode: o.erode ?? [0, 0], erodeStart: o.erodeStart ?? 0,
      heat: o.heat ?? [0, 0], ramp: o.ramp ?? 0, soft: o.soft ?? 0,
      mode: o.mode ?? MODE.BILLBOARD, axis: o.axis ? o.axis.clone() : null,
      rot: o.rot ?? Math.random() * Math.PI * 2, spin: o.spin ?? 0,
      drag: o.drag ?? 0, grav: o.grav ?? 0, stretch: o.stretch ?? 0, bounce: o.bounce ?? 0,
      aspect: o.aspect ?? 1, onUpdate: o.onUpdate ?? null, grow: o.grow ?? 1, fresh: true, camOffset: o.camOffset ?? 0,
      // live values
      s: 0, a: 0, e: 0, h: 0, em: 0, r: 0, g: 0, b: 0,
    };
    if (typeof p.emis === 'number') p.emis = [p.emis, p.emis];
    if (typeof p.size === 'number') p.size = [p.size, p.size];
    if (typeof p.erode === 'number') p.erode = [p.erode, p.erode];
    if (typeof p.heat === 'number') p.heat = [p.heat, p.heat];
    this.list.push(p);
    return p;
  }

  clear() { this.list.length = 0; }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      const pdt = p.fresh ? 0 : dt;                        // a new particle is drawn once at birth
      p.fresh = false;
      p.t += pdt;
      if (p.t >= p.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
      if (p.t < 0) { p.a = 0; continue; }                   // delayed start
      const u = p.t / p.life;
      if (p.vel && pdt > 0) {
        if (p.drag) p.vel.mulScalar(Math.max(0, 1 - p.drag * pdt));
        if (p.grav) p.vel.y -= 18 * p.grav * pdt;
        p.pos.x += p.vel.x * pdt; p.pos.y += p.vel.y * pdt; p.pos.z += p.vel.z * pdt;
        if (p.bounce) {
          const fl = this.floorAt(p.pos) + 0.01;
          if (p.pos.y < fl) { p.pos.y = fl; p.vel.y = -p.vel.y * p.bounce; p.vel.x *= 0.7; p.vel.z *= 0.7; }
        }
      }
      if (p.onUpdate) p.onUpdate(p, pdt, u);
      p.s = p.size[0] + (p.size[1] - p.size[0]) * p.sizeEase(Math.min(1, u / p.grow));
      let a = p.alpha;
      if (p.fadeIn > 0 && p.t < p.fadeIn) a *= p.t / p.fadeIn;
      if (p.fadeOut > 0 && u > 1 - p.fadeOut) a *= (1 - u) / p.fadeOut;
      p.a = a;
      const eu = p.erodeStart < 1 ? Math.max(0, (u - p.erodeStart) / (1 - p.erodeStart)) : 0;
      p.e = p.erode[0] + (p.erode[1] - p.erode[0]) * eu;
      p.h = p.heat[0] + (p.heat[1] - p.heat[0]) * u;
      p.em = p.emis[0] + (p.emis[1] - p.emis[0]) * u;
      const c0 = p.color, c1 = p.color1;
      if (c1) { p.r = c0[0] + (c1[0] - c0[0]) * u; p.g = c0[1] + (c1[1] - c0[1]) * u; p.b = c0[2] + (c1[2] - c0[2]) * u; }
      else { p.r = c0[0]; p.g = c0[1]; p.b = c0[2]; }
      p.r_ = p.rot + p.spin * p.t;
    }
    this._write();
  }

  _write() {
    const L = this.list, n = L.length;
    const cam = this.camera.getPosition(), f = this.camera.forward;
    const depth = this._depth;
    const order = this._orderArr;
    order.length = 0;
    for (let i = 0; i < n; i++) {
      const p = L[i];
      if (p.t < 0 || p.a <= 0.002 || p.s <= 0.0005) continue;
      depth[i] = (p.pos.x - cam.x) * f.x + (p.pos.y - cam.y) * f.y + (p.pos.z - cam.z) * f.z;
      if (depth[i] < -2) continue;                        // well behind the camera
      order.push(i);
    }
    order.sort((a, b) => depth[b] - depth[a]);            // far first
    const d = this.data, S = this.stride;
    let k = 0;
    for (const i of order) {
      const p = L[i];
      const o = k * S;
      if (p.camOffset) {                                   // pulled toward the lens so the emitter can't hide it
        const dx = cam.x - p.pos.x, dy = cam.y - p.pos.y, dz = cam.z - p.pos.z;
        const l = Math.hypot(dx, dy, dz) || 1, m = Math.min(p.camOffset, l * 0.4) / l;
        d[o] = p.pos.x + dx * m; d[o + 1] = p.pos.y + dy * m; d[o + 2] = p.pos.z + dz * m;
      } else { d[o] = p.pos.x; d[o + 1] = p.pos.y; d[o + 2] = p.pos.z; }
      d[o + 3] = p.s;
      d[o + 4] = p.r; d[o + 5] = p.g; d[o + 6] = p.b; d[o + 7] = p.a;
      if (p.mode === MODE.STRETCH || p.mode === MODE.STRETCH_SOLID) {
        let ax = p.axis, asp = p.aspect;
        if (p.stretch && p.vel) {                          // velocity-aligned streak
          const sp = p.vel.length();
          if (sp > 1e-4) { d[o + 8] = p.vel.x / sp; d[o + 9] = p.vel.y / sp; d[o + 10] = p.vel.z / sp; }
          else { d[o + 8] = 0; d[o + 9] = 1; d[o + 10] = 0; }
          asp = Math.max(1, 1 + sp * p.stretch);
        } else { d[o + 8] = ax.x; d[o + 9] = ax.y; d[o + 10] = ax.z; }
        d[o + 11] = asp;
      } else if (p.mode === MODE.FLAT) {
        d[o + 8] = p.axis.x; d[o + 9] = p.axis.y; d[o + 10] = p.axis.z; d[o + 11] = p.r_;
      } else {
        d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0; d[o + 11] = p.r_;
      }
      d[o + 12] = p.cell; d[o + 13] = p.add; d[o + 14] = p.e; d[o + 15] = p.em;
      d[o + 16] = p.soft; d[o + 17] = p.h; d[o + 18] = p.ramp; d[o + 19] = p.mode;
      k++;
    }
    this.mi.instancingCount = k;
    if (k) this.vb.setData(this.data);
  }
}
