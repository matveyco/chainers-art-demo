// Look development: lighting rigs, image-based lighting, shadows and post-processing per mode
// (play range / studio / reference), quality tier and render style (Studio PBR or Comic).
import { buildEnvironment, rangeSky, rangeLight, studioRoom, dirFrom } from './env.js';
import { Toon } from './toon.js';

const pc = window.pc;
const D2R = Math.PI / 180;

// Orient a directional light so it shines FROM the given azimuth/elevation (degrees).
// Azimuth 0 = from +Z, 90 = from +X. Directional lights shine along their -Y axis.
const _q = new pc.Quat(), _ax = new pc.Vec3(), _up = new pc.Vec3(0, 1, 0), _from = new pc.Vec3();
export function aimLight(entity, azDeg, elDeg) {
  const d = dirFrom(azDeg, elDeg);
  _from.set(d[0], d[1], d[2]);
  _ax.cross(_up, _from);
  const len = _ax.length();
  if (len < 1e-5) { entity.setEulerAngles(0, 0, 0); return; }
  _ax.mulScalar(1 / len);
  _q.setFromAxisAngle(_ax, Math.acos(Math.max(-1, Math.min(1, _from.y))) / D2R);
  entity.setRotation(_q);
}

// Sun position for the range (also baked into the sky's warm halo)
export const SUN = { az: 245, el: 36 };
export const SKY_HORIZON = new pc.Color(0.80, 0.86, 0.93);     // fog colour = displayed horizon
const STUDIO_KEY = { el: 40, off: -48 };                        // key rides the studio camera

export class Look {
  constructor(app, camera) {
    this.app = app;
    this.camera = camera;
    this.device = app.graphicsDevice;
    this.mode = 'play';
    this.quality = 'high';
    this.style = 'pbr';
    const scene = app.scene;
    scene.exposure = 1;
    scene.skyboxMip = 0;
    scene.skyboxIntensity = 1;

    // environments (built once, swapped per mode)
    const sunDir = dirFrom(SUN.az, SUN.el);
    this.envs = {
      range: buildEnvironment(app, 'range', rangeLight(sunDir), { skybox: rangeSky(sunDir), skyboxSize: 256 }),
      studio: buildEnvironment(app, 'studio', studioRoom()),
      flat: buildEnvironment(app, 'flat', () => [0.941, 0.941, 0.941]),
    };

    // lights
    const L = (name, o) => { const e = new pc.Entity(name); e.addComponent('light', Object.assign({ type: 'directional' }, o)); app.root.addChild(e); return e; };
    this.sun = L('Sun', {
      color: new pc.Color(1.0, 0.93, 0.83), intensity: 2.35, castShadows: true,
      shadowType: pc.SHADOW_PCF5_32F, shadowResolution: 2048, numCascades: 3, shadowDistance: 42,
      cascadeDistribution: 0.62, shadowBias: 0.12, normalOffsetBias: 0.035, shadowIntensity: 1,
    });
    this.sun.light.cascadeBlend = 0;          // dithered cascade blending adds screen-space noise; hard splits are steadier
    this.rim = L('Rim', { color: new pc.Color(0.78, 0.86, 1.0), intensity: 0, castShadows: false });
    this.flat = L('RefLight', { color: new pc.Color(1, 1, 1), intensity: 0.933, castShadows: false });
    this.flat.setEulerAngles(7.7, 0, 0);
    this.flat.enabled = false;
    aimLight(this.sun, SUN.az, SUN.el);

    // camera post
    const cam = camera.camera;
    cam.toneMapping = pc.TONEMAP_NEUTRAL;
    this.cf = null;
    try { this.cf = new pc.CameraFrame(app, cam); } catch (e) { console.warn('CameraFrame unavailable', e); }
    this.toon = new Toon(app, this);
    this.skyLayer = app.scene.layers.getLayerById(pc.LAYERID_SKYBOX);
  }

  // ------------------------------------------------------------------ public
  setQuality(q) { this.quality = q; this.apply(); }
  setStyle(s) { this.style = s; this.apply(); }
  setMode(m, opts = {}) { this.mode = m; this.refLit = !!opts.refLit; this.apply(); }
  setRefLight(on) { this.refLit = on; this.apply(); }

  // studio: key light rides with the orbit camera so the figure is always modelled from the front-side
  aimStudio(camYawDeg) {
    if (this.mode !== 'studio') return;
    aimLight(this.sun, camYawDeg + STUDIO_KEY.off, STUDIO_KEY.el);
    aimLight(this.rim, camYawDeg + 150, 26);
  }

  // ------------------------------------------------------------------ internals
  apply() {
    const { app, camera, sun, rim, flat } = this;
    const scene = app.scene;
    const high = this.quality === 'high';
    const comic = this.style === 'comic';
    const cam = camera.camera;
    const ref = this.mode === 'ref';
    const sl = sun.light;

    // environment + sky
    const env = ref ? this.envs.flat : this.mode === 'studio' ? this.envs.studio : this.envs.range;
    scene.envAtlas = env.envAtlas;
    scene.skybox = this.envs.range.skybox;
    const showSky = this.mode === 'play';
    const layers = cam.layers.slice();
    const hasSky = layers.includes(pc.LAYERID_SKYBOX);
    if (showSky && !hasSky) cam.layers = [pc.LAYERID_SKYBOX, ...layers];
    if (!showSky && hasSky) cam.layers = layers.filter((l) => l !== pc.LAYERID_SKYBOX);

    // lights
    sun.enabled = !ref || !this.refLit;
    flat.enabled = ref && this.refLit;
    rim.enabled = this.mode === 'studio';
    if (this.mode === 'play') {
      aimLight(sun, SUN.az, SUN.el);
      sl.intensity = comic ? 2.0 : 2.35;
      sl.color = new pc.Color(1.0, 0.93, 0.83);
      sl.shadowDistance = 42;
      sl.numCascades = high ? 3 : 2;
      sl.shadowResolution = high ? 2048 : 1024;
      sl.cascadeDistribution = 0.62;
      scene.skyboxIntensity = 1;
    } else if (this.mode === 'studio') {
      sl.intensity = comic ? 1.7 : 2.0;
      sl.color = new pc.Color(1.0, 0.95, 0.88);
      sl.shadowDistance = 9;
      sl.numCascades = 1;
      sl.shadowResolution = high ? 2048 : 1024;
      rim.light.intensity = comic ? 0.0 : 1.1;
    } else {
      aimLight(sun, 200, 55);
      sl.intensity = 1.6;
      sl.shadowDistance = 12;
      sl.numCascades = 1;
    }
    sl.shadowType = high ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;
    sl.castShadows = !ref;

    // fog
    if (this.mode === 'play') {
      scene.fog.type = pc.FOG_LINEAR;
      scene.fog.color = SKY_HORIZON;
      scene.fog.start = 45; scene.fog.end = 230;
    } else {
      scene.fog.type = pc.FOG_NONE;
    }
    cam.clearColor = ref ? new pc.Color(0.925, 0.937, 0.957) : this.mode === 'studio' ? new pc.Color(0.2, 0.2, 0.21) : SKY_HORIZON;

    // post
    const cf = this.cf;
    const wantCf = cf && (ref ? comic : (high || comic));
    if (cf) {
      cf.enabled = wantCf;
      if (wantCf) {
        const r = cf.rendering;
        r.samples = high ? 4 : 1;
        r.toneMapping = pc.TONEMAP_NEUTRAL;
        r.sharpness = 0;
        r.sceneDepthMap = comic;
        const ss = cf.ssao;
        ss.type = high && !ref ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
        ss.blurEnabled = true;
        ss.randomize = false;
        ss.intensity = this.mode === 'studio' ? 0.55 : 0.5;
        ss.radius = this.mode === 'studio' ? 0.45 : 0.9;
        ss.samples = 14;
        ss.power = 1.4;
        ss.minAngle = 10;
        ss.scale = 1;
        cf.bloom.intensity = high && !ref ? (comic ? 0.006 : 0.012) : 0;
        cf.bloom.blurLevel = 14;
        cf.vignette.intensity = ref ? 0 : comic ? 0.12 : 0.24;
        cf.vignette.inner = 0.55;
        cf.vignette.outer = 1.4;
        cf.vignette.curvature = 0.5;
        cf.vignette.color = new pc.Color(0.06, 0.05, 0.08);
        cf.grading.enabled = true;
        cf.grading.brightness = 1.0;
        cf.grading.contrast = comic ? 1.08 : 1.06;
        cf.grading.saturation = comic ? 1.1 : 1.06;
        cf.grading.tint = new pc.Color(1, 1, 1);
        if (cf.colorEnhance) {
          cf.colorEnhance.enabled = !comic;
          cf.colorEnhance.shadows = -0.05;
          cf.colorEnhance.highlights = -0.08;
          cf.colorEnhance.vibrance = 0.12;
          cf.colorEnhance.midtones = 0;
          cf.colorEnhance.dehaze = 0;
        }
        cf.update();
      }
    }
    cam.toneMapping = pc.TONEMAP_NEUTRAL;
    this.toon.apply(comic, wantCf);
  }
}
