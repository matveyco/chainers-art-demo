// Ground markers drawn with small procedural shaders: team rings under the brawlers, the
// player's aim indicators (line, cone, target circle, area), and warning circles for incoming
// barrage rockets. Each marker is a flat quad; the shape is computed per pixel.
const pc = window.pc;

const VS = `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vP;
void main(void) {
	vP = vertex_position.xz;
	gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`;

// uShape: x = length (m), y = width (m) or arc (radians), z = progress 0..1, w = kind-specific
const FS = `
#include "gammaPS"
#include "tonemappingPS"
uniform vec4 uColor;
uniform vec4 uShape;
uniform float uTime;
varying vec2 vP;
float aa(float d, float w) { return clamp(0.5 - d / w, 0.0, 1.0); }
void main(void) {
	float a = 0.0;
	vec3 col = uColor.rgb;
	float fw = max(fwidth(vP.x), fwidth(vP.y)) * 1.5;
#if defined(RING)
	// team ring: bright band with a soft inner fill, a small notch marks the facing direction
	float r = length(vP);
	float band = aa(abs(r - 0.76) - 0.085, fw);
	float fill = (1.0 - smoothstep(0.6, 0.68, r)) * 0.2;
	a = max(band, fill);
	#ifdef NOTCH
		// small arrow ahead of the ring
		float notch = aa(max(abs(vP.x) - 0.16 * (1.0 - vP.y) / 0.14, abs(vP.y - 0.93) - 0.07), fw);
		a = max(a, notch);
	#endif
#elif defined(LINE)
	// straight shot: local x in -1..1 across, y (quad z) 0..1 along; uShape.x length, uShape.y width
	float along = vP.y * uShape.x;
	float halfW = uShape.y * 0.5;
	float across = abs(vP.x) * halfW;
	float end = uShape.x - along;
	float capD = end < halfW ? length(vec2(across, halfW - end)) - halfW : across - halfW;
	float body = aa(capD, fw * halfW);
	float edge = aa(abs(capD + 0.04) - 0.03, fw * halfW);
	float dash = step(0.5, fract(along / 0.8 - uTime * 1.4)) * 0.18 + 0.42;
	a = body * mix(dash, 1.0, edge) * smoothstep(0.0, 0.5, along);
#elif defined(CONE)
	// fan: local -1..1 (x) by 0..1 (y) scaled by range; uShape.y = half arc (radians)
	float r = length(vP);
	float ang = abs(atan(vP.x, vP.y));
	float inR = aa(r - 1.0, fw);
	float inA = aa((ang - uShape.y) * r, fw);
	float body = inR * inA;
	float rim = max(aa(abs(r - 0.98) - 0.02, fw), aa(abs((ang - uShape.y) * r) - 0.018, fw)) * body;
	float waves = step(0.5, fract(r * uShape.x / 0.8 - uTime * 1.4)) * 0.18 + 0.42;
	a = body * mix(waves, 1.0, rim) * smoothstep(0.0, 0.12, r);
#elif defined(CIRCLE)
	// area: ring + fill; uShape.z = progress (warning circles fill up), uShape.w = 1 pulses
	float r = length(vP);
	float rim = aa(abs(r - 0.955) - 0.045, fw);
	float fill = aa(r - 1.0, fw) * (0.28 + 0.12 * sin(uTime * 8.0) * uShape.w);
	float prog = aa(r - uShape.z, fw) * 0.35 * step(0.001, uShape.z);
	a = max(rim, max(fill, prog));
#endif
	a *= uColor.a;
	if (a < 0.004) discard;
	col = gammaCorrectOutput(toneMap(col));
	gl_FragColor = vec4(col * a, a);
}
`;

const _quads = {};
function quad(device, kind) {
  // RING/CIRCLE: -1..1 square; LINE/CONE: x -1..1, z 0..1
  const key = kind === 'LINE' || kind === 'CONE' ? 'half' : 'full';
  if (_quads[key]) return _quads[key];
  const m = new pc.Mesh(device);
  const z0 = key === 'half' ? 0 : -1;
  m.setPositions([-1, 0, z0, 1, 0, z0, 1, 0, 1, -1, 0, 1]);
  m.setIndices([0, 2, 1, 0, 3, 2]);
  m.update();
  _quads[key] = m;
  return m;
}

function material(kind, opts = {}) {
  const m = new pc.ShaderMaterial({ uniqueName: 'marker-' + kind + (opts.notch ? '-n' : ''), vertexGLSL: VS, fragmentGLSL: FS, attributes: { vertex_position: pc.SEMANTIC_POSITION } });
  m.setDefine(kind, '');
  if (opts.notch) m.setDefine('NOTCH', '');
  m.blendState = new pc.BlendState(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA,
    pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE);
  m.depthWrite = false;
  m.depthTest = opts.depthTest ?? true;
  m.cull = pc.CULLFACE_NONE;
  m.setParameter('uColor', [1, 1, 1, 1]);
  m.setParameter('uShape', [1, 1, 0, 0]);
  m.setParameter('uTime', 0);
  m.update();
  return m;
}

export class Marker {
  constructor(app, parent, kind, opts = {}) {
    this.kind = kind;
    this.mat = material(kind, opts);
    this.mi = new pc.MeshInstance(quad(app.graphicsDevice, kind), this.mat);
    this.mi.castShadow = false;
    this.e = new pc.Entity('Marker_' + kind);
    this.e.addComponent('render', { meshInstances: [this.mi], castShadows: false, receiveShadows: false });
    // drawn after the opaque scene, before the sprites
    this.mi.drawOrder = opts.order ?? 0;
    parent.addChild(this.e);
    this.color = new Float32Array([1, 1, 1, 1]);
    this.shape = new Float32Array([1, 1, 0, 0]);
    this.e.enabled = false;
  }

  show(on) { if (this.e.enabled !== on) this.e.enabled = on; }

  set(color, alpha, shape) {
    this.color[0] = color[0]; this.color[1] = color[1]; this.color[2] = color[2]; this.color[3] = alpha;
    this.mi.setParameter('uColor', this.color);
    if (shape) { for (let i = 0; i < 4; i++) this.shape[i] = shape[i] ?? 0; this.mi.setParameter('uShape', this.shape); }
  }

  place(x, y, z, yaw, sx, sz) {
    this.e.setPosition(x, y, z);
    this.e.setEulerAngles(0, yaw * 180 / Math.PI, 0);
    this.e.setLocalScale(sx, 1, sz);
  }

  destroy() { this.e.destroy(); }
}

export class Markers {
  constructor(app) {
    this.app = app;
    this.root = new pc.Entity('Markers');
    app.root.addChild(this.root);
    this.time = 0;
    this.all = [];
    this.pool = { CIRCLE: [] };
  }
  ring(notch = false) { const m = new Marker(this.app, this.root, 'RING', { notch }); this.all.push(m); return m; }
  line() { const m = new Marker(this.app, this.root, 'LINE', { depthTest: false, order: 5 }); this.all.push(m); return m; }
  cone() { const m = new Marker(this.app, this.root, 'CONE', { depthTest: false, order: 5 }); this.all.push(m); return m; }
  circle(depthTest = false) { const m = new Marker(this.app, this.root, 'CIRCLE', { depthTest, order: 4 }); this.all.push(m); return m; }

  // short-lived warning circles (barrage) from a pool
  warn(x, z, r, color, dur) {
    let m = this.pool.CIRCLE.find((q) => !q.busy);
    if (!m) { m = this.circle(true); this.pool.CIRCLE.push(m); }
    m.busy = true; m.t = 0; m.dur = dur; m.r = r; m.col = color;
    m.place(x, 0.03, z, 0, r, r);
    m.set(color, 0.9, [r, 0, 0.01, 1]);
    m.show(true);
    return m;
  }

  update(dt) {
    this.time += dt;
    for (const m of this.all) if (m.e.enabled) m.mi.setParameter('uTime', this.time);
    for (const m of this.pool.CIRCLE) {
      if (!m.busy) continue;
      m.t += dt;
      const u = Math.min(1, m.t / m.dur);
      m.set(m.col, 0.9, [m.r, 0, Math.max(0.01, u), 1]);
      if (u >= 1) { m.busy = false; m.show(false); }
    }
  }

  clearWarnings() { for (const m of this.pool.CIRCLE) { m.busy = false; m.show(false); } }
}
