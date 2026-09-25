// Showdown poison gas: everything outside a shrinking square is covered by a green, churning
// haze (a ground overlay shader with a bright rim), a translucent curtain along the square's
// edges, and poison clouds that roll off the boundary.
const pc = window.pc;

const VS = `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vW;
varying float vH;
void main(void) {
	vec4 w = matrix_model * vec4(vertex_position, 1.0);
	vW = w.xyz;
	vH = vertex_position.y;
	gl_Position = matrix_viewProjection * w;
}
`;

const FS = `
#include "gammaPS"
#include "tonemappingPS"
uniform float uSafe;
uniform float uTime;
uniform float uCurtain;
varying vec3 vW;
varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(void) {
	float a;
	vec3 col;
	vec2 q = floor(vW.xz * 8.0) / 8.0;                    // chunky 12.5 cm cells, like the pixel textures
	float n = noise(q * 0.9 + vec2(uTime * 0.35, -uTime * 0.22)) * 0.6 + noise(q * 2.3 - vec2(uTime * 0.5, uTime * 0.3)) * 0.4;
	if (uCurtain > 0.5) {
		// vertical curtain: dense at the bottom, fading upward, with drifting streaks
		float fade = 1.0 - smoothstep(0.0, 1.0, vH);
		a = fade * (0.28 + 0.3 * n);
		col = mix(vec3(0.16, 0.55, 0.12), vec3(0.55, 0.95, 0.35), n);
	} else {
		float d = max(abs(vW.x), abs(vW.z)) - uSafe;        // > 0 in the gas
		if (d < 0.0) discard;
		float rim = 1.0 - smoothstep(0.0, 0.35, d);
		a = 0.42 + 0.22 * n + rim * 0.3;
		col = mix(vec3(0.12, 0.42, 0.1), vec3(0.45, 0.9, 0.3), n);
		col = mix(col, vec3(0.75, 1.0, 0.55), rim * 0.6);
	}
	col = gammaCorrectOutput(toneMap(col));
	gl_FragColor = vec4(col * a, a);
}
`;

function material(curtain) {
  const m = new pc.ShaderMaterial({ uniqueName: curtain ? 'gas-curtain' : 'gas-floor', vertexGLSL: VS, fragmentGLSL: FS, attributes: { vertex_position: pc.SEMANTIC_POSITION } });
  m.blendState = new pc.BlendState(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA,
    pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA);
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.setParameter('uSafe', 100);
  m.setParameter('uTime', 0);
  m.setParameter('uCurtain', curtain ? 1 : 0);
  m.update();
  return m;
}

export class Gas {
  constructor(app, fx, half) {
    this.app = app;
    this.fx = fx;
    this.half = half;                  // arena half size (m)
    this.safe = 100;
    this.time = 0;
    this.root = new pc.Entity('Gas');
    app.root.addChild(this.root);
    const device = app.graphicsDevice;
    // ground overlay covering the arena and a margin
    const R = half + 1;
    const floor = new pc.Mesh(device);
    floor.setPositions([-R, 0.06, -R, R, 0.06, -R, R, 0.06, R, -R, 0.06, R]);
    floor.setIndices([0, 2, 1, 0, 3, 2]);
    floor.update();
    this.floorMat = material(false);
    const fe = new pc.Entity('GasFloor');
    fe.addComponent('render', { meshInstances: [new pc.MeshInstance(floor, this.floorMat)], castShadows: false, receiveShadows: false });
    this.root.addChild(fe);
    // curtain: one unit-square wall (x -1..1, y 0..1) placed and scaled along each edge
    const wall = new pc.Mesh(device);
    wall.setPositions([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]);
    wall.setIndices([0, 1, 2, 0, 2, 3]);
    wall.update();
    this.curtainMat = material(true);
    this.walls = [];
    for (let i = 0; i < 4; i++) {
      const e = new pc.Entity('GasCurtain');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(wall, this.curtainMat)], castShadows: false, receiveShadows: false });
      this.root.addChild(e);
      this.walls.push(e);
    }
    this.cloudT = 0;
    this.root.enabled = false;
  }

  show(on) { this.root.enabled = on; }

  set(safe) {
    this.safe = safe;
    this.floorMat.setParameter('uSafe', safe);
    const h = 2.4, s = Math.min(safe, this.half + 1);
    const place = (e, x, z, yaw) => { e.setLocalPosition(x, 0, z); e.setLocalEulerAngles(0, yaw, 0); e.setLocalScale(s, h, 1); };
    place(this.walls[0], 0, -s, 0);
    place(this.walls[1], 0, s, 0);
    place(this.walls[2], -s, 0, 90);
    place(this.walls[3], s, 0, 90);
    for (const w of this.walls) w.enabled = safe < this.half + 0.5;
  }

  update(dt) {
    if (!this.root.enabled) return;
    this.time += dt;
    this.floorMat.setParameter('uTime', this.time);
    this.curtainMat.setParameter('uTime', this.time);
    // poison clouds rolling off the boundary, inside the arena
    const s = this.safe;
    if (s > this.half + 0.5) return;
    this.cloudT += dt;
    const rate = 0.07;
    while (this.cloudT > rate) {
      this.cloudT -= rate;
      const side = Math.floor(Math.random() * 4), u = (Math.random() * 2 - 1) * s;
      const out = 0.3 + Math.random() * 1.5;
      let x, z, vx = 0, vz = 0;
      if (side === 0) { x = u; z = -s - out; vz = 0.5; } else if (side === 1) { x = u; z = s + out; vz = -0.5; }
      else if (side === 2) { x = -s - out; z = u; vx = 0.5; } else { x = s + out; z = u; vx = -0.5; }
      if (Math.abs(x) > this.half || Math.abs(z) > this.half) continue;
      this.fx.puff(new pc.Vec3(x, 0.3 + Math.random() * 0.7, z), 'smoke', 0.55 + Math.random() * 0.4, 1.6 + Math.random() * 0.8,
        new pc.Vec3(vx * (0.5 + Math.random()), 0.25 + Math.random() * 0.3, vz * (0.5 + Math.random())),
        { color: [0.4, 0.95, 0.3], color1: [0.25, 0.7, 0.2], alpha: 0.55, drag: 0.8, erodeStart: 0.15, soft: 0.4, fadeIn: 0.2 });
    }
  }
}
