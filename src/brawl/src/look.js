// Render styles for the arena: 'toon' (cel light, crisp shadows, ink lines, punchy grade),
// 'pbr' (physically based, SSAO, bloom, soft grade) and 'pixel' (the toon look rendered at a
// quarter of the resolution and blown up with hard pixels). Plus the quality tier.
import { buildEnvironment, rangeSky, rangeLight, dirFrom } from './env.js';
import { Toon } from './toon.js';

const pc = window.pc;
const D2R = Math.PI / 180;

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

export const SUN = { az: 335, el: 57 };       // from the front-left, high: short shadows up and right
export const STYLES = ['toon', 'pbr', 'pixel'];

export class Look {
  constructor(app, camera) {
    this.app = app;
    this.camera = camera;
    this.device = app.graphicsDevice;
    this.quality = 'high';
    this.style = 'toon';
    const scene = app.scene;
    scene.exposure = 1;
    const sunDir = dirFrom(SUN.az, SUN.el);
    this.env = buildEnvironment(app, 'arena', rangeLight(sunDir), { skybox: rangeSky(sunDir), skyboxSize: 128 });
    scene.envAtlas = this.env.envAtlas;
    scene.skybox = this.env.skybox;
    scene.skyboxIntensity = 1;
    this.sun = new pc.Entity('Sun');
    this.sun.addComponent('light', {
      type: 'directional', color: new pc.Color(1.0, 0.94, 0.84), intensity: 2.2, castShadows: true,
      shadowType: pc.SHADOW_PCF5_32F, shadowResolution: 2048, numCascades: 1, shadowDistance: 44,
      shadowBias: 0.2, normalOffsetBias: 0.04, shadowIntensity: 1,
    });
    app.root.addChild(this.sun);
    aimLight(this.sun, SUN.az, SUN.el);
    const cam = camera.camera;
    cam.toneMapping = pc.TONEMAP_NEUTRAL;
    this.cf = null;
    try { this.cf = new pc.CameraFrame(app, cam); } catch (e) { console.warn('CameraFrame unavailable', e); }
    this.toon = new Toon(app, this);
    this.toon.ink = { radius: 1.1, strength: 0.95, threshold: 0.01, fade: 90, color: [0.05, 0.035, 0.07] };
    this.fx = null;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = this.device.canvas;
  }

  setQuality(q) { this.quality = q; this.apply(); }
  setStyle(s) { this.style = s; this.apply(); }

  // call after creating new materials (a match spawned its brawlers)
  refresh() { this.toon.apply(this.style !== 'pbr', this._post); }

  apply() {
    const { app, camera, sun } = this;
    const scene = app.scene;
    const high = this.quality === 'high';
    const st = this.style;
    const toon = st !== 'pbr';
    const pixel = st === 'pixel';
    const cam = camera.camera;
    const sl = sun.light;

    // resolution: pixel style renders small and lets the browser scale it up with hard edges
    const ratio = pixel ? Math.max(0.2, Math.min(0.34, 300 / Math.max(1, window.innerHeight))) : (high ? this.basePixelRatio : Math.min(this.basePixelRatio, 1.25));
    if (this.device.maxPixelRatio !== ratio) {
      this.device.maxPixelRatio = ratio;
      app.resizeCanvas();
    }
    this.canvas.classList.toggle('pixelated', pixel);

    sl.intensity = st === 'pbr' ? 2.35 : 2.05;
    sl.color = st === 'pbr' ? new pc.Color(1.0, 0.93, 0.82) : new pc.Color(1.0, 0.96, 0.9);
    sl.shadowResolution = pixel ? 1024 : high ? 2048 : 1024;
    sl.shadowType = high && !pixel ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;
    scene.skyboxIntensity = st === 'pbr' ? 1 : 1.12;
    scene.fog.type = pc.FOG_NONE;

    const cf = this.cf;
    const post = !!cf && (high || toon);
    this._post = post;
    if (cf) {
      cf.enabled = post;
      if (post) {
        const r = cf.rendering;
        r.samples = pixel ? 1 : high ? 4 : 1;
        r.renderFormats = toon ? [pc.PIXELFORMAT_RGBA16F, pc.PIXELFORMAT_RGBA32F] : [pc.PIXELFORMAT_111110F, pc.PIXELFORMAT_RGBA16F, pc.PIXELFORMAT_RGBA32F];
        r.toneMapping = pc.TONEMAP_NEUTRAL;
        r.sharpness = 0;
        r.sceneDepthMap = true;
        const ss = cf.ssao;
        ss.type = high && st === 'pbr' ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
        ss.blurEnabled = true; ss.randomize = false;
        ss.intensity = 0.55; ss.radius = 0.8; ss.samples = 12; ss.power = 1.3; ss.minAngle = 10; ss.scale = 1;
        cf.bloom.intensity = pixel ? 0 : high ? (toon ? 0.008 : 0.014) : 0;
        cf.bloom.blurLevel = 12;
        cf.vignette.intensity = pixel ? 0.08 : 0.14;
        cf.vignette.inner = 0.6; cf.vignette.outer = 1.45; cf.vignette.curvature = 0.5;
        cf.vignette.color = new pc.Color(0.05, 0.04, 0.08);
        cf.grading.enabled = true;
        cf.grading.brightness = st === 'pbr' ? 1.0 : 1.03;
        cf.grading.contrast = st === 'pbr' ? 1.05 : 1.1;
        cf.grading.saturation = st === 'pbr' ? 1.02 : pixel ? 1.12 : 1.06;
        cf.grading.tint = new pc.Color(1, 1, 1);
        if (cf.colorEnhance) {
          cf.colorEnhance.enabled = st === 'pbr';
          cf.colorEnhance.shadows = -0.04; cf.colorEnhance.highlights = -0.06; cf.colorEnhance.vibrance = 0.15;
          cf.colorEnhance.midtones = 0; cf.colorEnhance.dehaze = 0;
        }
        cf.update();
      }
    }
    cam.toneMapping = pc.TONEMAP_NEUTRAL;
    this.toon.ink.radius = pixel ? 1.0 / ratio : 1.1;
    this.toon.ink.strength = pixel ? 0.8 : 0.95;
    this.toon.apply(toon, post);
    if (this.fx) {
      this.fx.sprites.setSoft(post);
      this.fx.sprites.budget = high ? 1 : 0.6;
      this.fx.lightScale = toon ? 0.35 : 1;
      this.fx.sprites.setLight(toon ? [1.32, 1.28, 1.22] : [1.38, 1.32, 1.24]);
    }
  }
}
