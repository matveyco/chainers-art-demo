// "Comic" render style: cel-banded sun light, crisp shadow terminators, flattened ambient,
// a thin rim highlight, and screen-space ink lines (silhouettes + creases) found in the
// compose pass from the depth prepass. Every material keeps its textures; the style is a set
// of shader-chunk overrides that can be switched on and off at runtime.
const pc = window.pc;

const DIFFUSE = `
float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
	float n = dot(worldNormal, -lightDirNorm);
	return smoothstep(0.0, 0.07, n) * 0.8 + smoothstep(0.5, 0.56, n) * 0.2;
}
`;

// rim + composition (replaces endPS). Rim uses the albedo so it reads as a colour-true edge light.
const END = `
	gl_FragColor.rgb = combineColor(litArgs_albedo, litArgs_sheen_specularity, litArgs_clearcoat_specularity);
	#ifdef LIT_NEEDS_NORMAL
		float toonRim = 1.0 - max(dot(litArgs_worldNormal, dViewDirW), 0.0);
		gl_FragColor.rgb += litArgs_albedo * smoothstep(0.66, 0.74, toonRim) * 0.28;
	#endif
	gl_FragColor.rgb += litArgs_emission;
	gl_FragColor.rgb = addFog(gl_FragColor.rgb);
	gl_FragColor.rgb = toneMap(gl_FragColor.rgb);
	gl_FragColor.rgb = gammaCorrectOutput(gl_FragColor.rgb);
`;

// ink: second derivative of reciprocal depth is zero on any plane, so it fires only on silhouettes
// and on creases between faces. Threshold is relative, so line weight holds at any distance.
const INK_DECL = (packed) => `
uniform highp sampler2D uSceneDepthMap;
uniform vec4 uInk;        // x: radius px, y: strength, z: threshold, w: far fade distance
uniform vec3 uInkColor;
${packed ? '#include "floatAsUintPS"' : ''}
float inkZ(vec2 uv) {
	${packed ? 'float d = uint2float(texelFetch(uSceneDepthMap, ivec2(uv * vec2(textureSize(uSceneDepthMap, 0))), 0));'
		: 'float d = texture2DLod(uSceneDepthMap, uv, 0.0).r;'}
	return d <= 0.0 ? 1e4 : d;
}
float inkEdge(vec2 uv) {
	vec2 o = sceneTextureInvRes * uInk.x;
	float z = inkZ(uv);
	float w = 1.0 / z;
	float wl = 1.0 / inkZ(uv - vec2(o.x, 0.0)), wr = 1.0 / inkZ(uv + vec2(o.x, 0.0));
	float wd = 1.0 / inkZ(uv - vec2(0.0, o.y)), wu = 1.0 / inkZ(uv + vec2(0.0, o.y));
	float wa = 1.0 / inkZ(uv + o), wb = 1.0 / inkZ(uv - o);
	float wc = 1.0 / inkZ(uv + vec2(o.x, -o.y)), we = 1.0 / inkZ(uv + vec2(-o.x, o.y));
	float lap = abs(wl + wr - 2.0 * w) + abs(wu + wd - 2.0 * w) + 0.5 * (abs(wa + wb - 2.0 * w) + abs(wc + we - 2.0 * w));
	float e = smoothstep(uInk.z, uInk.z * 2.5, lap / w);
	return e * (1.0 - smoothstep(uInk.w * 0.6, uInk.w, z));
}
`;
// scene alpha is lowered by smoke and fire sprites (see vfx.js), so lines behind them fade out
const INK_END = `
	result = mix(result, uInkColor, inkEdge(uv) * uInk.y * clamp(scene.a, 0.0, 1.0));
`;

export class Toon {
  constructor(app, look) {
    this.app = app;
    this.look = look;
    this.on = false;
    const chunks = pc.ShaderChunks.get(app.graphicsDevice, pc.SHADERLANGUAGE_GLSL);
    this.global = chunks;
    const harden = (name) => {
      const src = chunks.get(name) || '';
      // soft shadow filter -> crisp but anti-aliased terminator
      return src.replace(/return sum;/, 'return smoothstep(0.3, 0.7, sum);');
    };
    // ambient: look up the environment along a normal bent towards the sky, so shadowed sides get
    // one flat, slightly lifted tone instead of a gradient
    const ambient = (chunks.get('ambientPS') || '').replace(
      'vec3 dir = normalize(cubeMapRotate(worldNormal) * vec3(-1.0, 1.0, 1.0));',
      'vec3 dir = normalize(cubeMapRotate(normalize(worldNormal + vec3(0.0, 1.4, 0.0))) * vec3(-1.0, 1.0, 1.0));')
      .replace('dDiffuseLight += processEnvironment(linear);', 'dDiffuseLight += processEnvironment(linear * 1.3);');
    this.overrides = {
      lightDiffuseLambertPS: DIFFUSE,
      shadowPCF3PS: harden('shadowPCF3PS'),
      shadowPCF5PS: harden('shadowPCF5PS'),
      ambientPS: ambient,
      endPS: END,
    };
    this.packed = !app.graphicsDevice.textureFloatRenderable;
    this.ink = { radius: 1.25, strength: 1.0, threshold: 0.009, fade: 70, color: [0.03, 0.025, 0.045] };
  }

  materials() {
    const set = new Set();
    const add = (mi) => { const m = mi && mi.material; if (m && m instanceof pc.StandardMaterial) set.add(m); };
    for (const e of this.app.root.find(() => true)) {
      if (e.render) e.render.meshInstances.forEach(add);
      if (e.model && e.model.meshInstances) e.model.meshInstances.forEach(add);
    }
    for (const layer of this.app.scene.layers.layerList) (layer.meshInstances || []).forEach(add);
    return set;
  }

  apply(on, post) {
    const inkOn = on && post;
    const d = this.app.graphicsDevice;
    this.on = on;
    // every lit standard material in the scene follows the style, including ones created since
    // the last call (brawlers spawned for a match, cloned outfit materials)
    if (!this.state) this.state = new WeakMap();
    for (const m of this.materials()) {
      if (!m.useLighting) continue;
      if (this.state.get(m) === on) continue;
      this.state.set(m, on);
      const c = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
      for (const [k, v] of Object.entries(this.overrides)) { if (on) c.set(k, v); else c.delete(k); }
      m.shaderChunksVersion = '2.8';
      m.update();
    }
    // ink lines in the compose pass
    const g = this.global;
    g.set('composeDeclarationsPS', inkOn ? INK_DECL(this.packed) : '');
    g.set('composeMainEndPS', inkOn ? INK_END : '');
    const k = this.ink;
    d.scope.resolve('uInk').setValue([k.radius * Math.min(2, d.maxPixelRatio || 1), k.strength, k.threshold, k.fade]);
    d.scope.resolve('uInkColor').setValue(k.color);
  }
}
