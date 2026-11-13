// Chainer avatars: the official mesh + rig, per-character outfits printed onto the official UV atlas,
// voxel hats / hair on the head bone, tools in the hand, and animation control.
import { pc, walk } from './engine.js';
import { asset } from '../core/assets.js';
import { mulberry32, pick } from '../core/util.js';
import { CHAINER_SCALE } from '../data/config.js';

const N = 128, EMPTY = 32767;
let TEXMAP = null;      // Int16Array rest position (mm) per atlas texel
let BASE_IMG = null;    // official 64x64 skin atlas

export async function loadAvatarData() {
  const buf = await (await fetch(asset('models/chainer_texmap.bin'))).arrayBuffer();
  TEXMAP = new Int16Array(buf);
  BASE_IMG = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = asset('textures/chainer_base.png'); });
}

// ----------------------------------------------------------------------------------------------
// looks
// ----------------------------------------------------------------------------------------------
const SKINS = ['#ffd400', '#ffd400', '#ffd400', '#ffd400', '#ffd400', '#ffd400', '#ffc21a', '#ffb347', '#ff9eb5', '#8fd96a', '#7fc8ff', '#c9a0ff', '#ffe27a'];
const SHIRTS = ['#c8362f', '#2f9c95', '#3d6fd6', '#7b5bd0', '#e9813a', '#4fa64a', '#f0705a', '#f2c84b', '#e8e2d0', '#b0305c', '#5b6c8f', '#f08fb0', '#36a6d9', '#8a5a3c'];
const PANTS = ['#4a5578', '#6b4a36', '#3f4a3c', '#5a5f6b', '#7a4f2e', '#2f3e5c', '#8a6f4d', '#444b52', '#3b6a8c'];
const BOOTS = ['#4b3324', '#2f2b2a', '#6b3f2a', '#8a5a3c', '#3a3f4a'];
const HAIRS = ['#8a3b1c', '#2f6fe0', '#3a2a22', '#f2c84b', '#e9813a', '#f08fb0', '#6b4a36', '#9aa3ad', '#2f9c95', '#7b5bd0', '#e8e2d0', '#c8362f'];
const STYLES = ['plaid', 'solid', 'stripes', 'overalls', 'vest', 'apron', 'coat', 'tee', 'overalls', 'plaid'];
const HEADGEAR = [null, 'acc_hat_straw', 'acc_hat_cowboy', 'acc_hair_spiky', 'acc_hair_pigtails', 'acc_hair_bob', 'acc_hair_mohawk', 'acc_beanie', 'acc_cap',
  'acc_flower_crown', 'acc_bandana', 'acc_hair_spiky', 'acc_hair_bob', 'acc_hair_pigtails', 'acc_hat_straw'];
const EXTRAS = [null, null, null, null, 'acc_goggles', 'acc_backpack', 'acc_scarf', 'acc_scarf', 'acc_backpack'];

export function lookOf(chainer) {
  const r = mulberry32(chainer.look >>> 0);
  const rarityStars = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[chainer.rarity] || 1;
  const look = {
    skin: pick(SKINS, r), style: pick(STYLES, r), shirt: pick(SHIRTS, r), shirt2: pick(SHIRTS, r), pants: pick(PANTS, r), boots: pick(BOOTS, r),
    hair: pick(HAIRS, r), hair2: pick(SHIRTS, r), head: pick(HEADGEAR, r), extra: pick(EXTRAS, r), sleeves: r() < 0.6 ? 'long' : 'short',
  };
  if (rarityStars >= 4 && r() < 0.6) look.extra = 'acc_goggles';
  if (rarityStars === 5) look.head = r() < 0.6 ? 'acc_crown' : look.head || 'acc_hair_spiky';
  if (chainer.trait === 'stonehand' && r() < 0.5) look.head = 'acc_helmet_miner';
  return look;
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mul = (c, k) => [Math.min(255, c[0] * k) | 0, Math.min(255, c[1] * k) | 0, Math.min(255, c[2] * k) | 0];
const stepf = (v, s) => Math.floor((v + 10.0001) / s);

/** Paints the outfit for a look. Returns a 128x128 canvas in the official atlas layout. */
export function paintOutfit(look) {
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(BASE_IMG, 0, 0, N, N);
  const img = g.getImageData(0, 0, N, N), d = img.data;
  const skin = hex(look.skin), shirt = hex(look.shirt), shirt2 = hex(look.shirt2), pants = hex(look.pants), boots = hex(look.boots);
  const sleeveEnd = look.sleeves === 'long' ? 0.976 : 0.56;
  const denim = hex('#4a6fa8');
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    // skin recolour of the official atlas (keeps the little painted details as darker tones)
    const r0 = d[o], g0 = d[o + 1], b0 = d[o + 2];
    const isYellow = r0 > 200 && g0 > 150 && b0 < 90;
    const isDetail = r0 > 170 && g0 > 90 && g0 <= 170 && b0 < 90;
    if (isYellow) { d[o] = skin[0]; d[o + 1] = skin[1]; d[o + 2] = skin[2]; }
    else if (isDetail) { const c = mul(skin, 0.78); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; }
    const mx = TEXMAP[i * 3];
    if (mx === EMPTY) continue;
    const x = mx / 1000, y = TEXMAP[i * 3 + 1] / 1000, z = TEXMAP[i * 3 + 2] / 1000, ax = Math.abs(x);
    const front = y < 0.05;
    let top = Math.min(1.5, 1.3 + Math.floor((ax + 0.0001) / 0.05) * 0.05);
    if (y > 0.145) top = 1.5;
    const onTorso = ax <= 0.2265 && z >= 0.7 && z < top;
    const onSleeve = ax > 0.2265 && ax < sleeveEnd && z > 1.3;
    let c = null;
    if (z < 0.1) c = boots;
    else if (z < 0.7) {
      c = pants;
      if (z > 0.655) c = mul(pants, 0.72);                          // belt
      if (front && ax < 0.035 && z > 0.655) c = hex('#e9b23f');     // buckle
    } else if (onTorso || onSleeve) {
      const a = onTorso ? x : ax - 0.2265;
      switch (look.style) {
        case 'plaid': {
          const sa = (stepf(a, 0.05) % 4) < 2, sb = (stepf(z, 0.05) % 4) < 2;
          c = mul(shirt, [1.0, 0.72, 0.5][(sa ? 1 : 0) + (sb ? 1 : 0)]);
          break;
        }
        case 'stripes': c = (stepf(z, 0.1) % 2) ? shirt : shirt2; break;
        case 'overalls': {
          c = shirt;
          if (onTorso && (z < 1.12 || (ax > 0.09 && ax < 0.165))) c = denim;
          if (onTorso && front && z > 1.04 && z < 1.12 && ax > 0.09 && ax < 0.165) c = hex('#e9b23f');
          if (onTorso && front && ax < 0.08 && z > 0.84 && z < 1.0) c = mul(denim, 0.82);
          break;
        }
        case 'vest': c = onSleeve || (front && ax < 0.045) ? shirt2 : shirt; break;
        case 'apron': c = (onTorso && front && ax < 0.17 && z < 1.26) ? hex('#f4ead2') : shirt; if (onTorso && front && ax < 0.17 && z > 1.2 && z < 1.26) c = mul(hex('#f4ead2'), 0.8); break;
        case 'coat': {
          c = shirt;
          if (onTorso && front) {
            if (ax < 0.02) c = mul(shirt, 0.6);
            if (Math.abs(ax - (z - 0.98) * 0.47) < 0.02 && z > 1.01 && z < 1.4) c = mul(shirt, 1.35);
            if (ax < 0.016 && (stepf(z - 0.78, 0.14) * 0.14 + 0.78 - z) > -0.03 && ((z - 0.78) % 0.14) < 0.03) c = hex('#e9b23f');
          }
          break;
        }
        case 'tee': c = shirt; if (onTorso && front && ax < 0.1 && z > 1.0 && z < 1.2) c = shirt2; break;
        default: c = shirt;
      }
      if (onSleeve && ax > sleeveEnd - 0.05) c = mul(c, 0.72);       // cuff
      if (onTorso && z < 0.73) c = mul(c, 0.8);                      // hem
    }
    if (look.style === 'overalls' && z >= 0.1 && z < 0.7) c = z > 0.655 ? mul(denim, 0.8) : denim;
    if (look.style === 'coat' && z >= 0.5 && z < 0.7 && Math.abs(x) <= 0.2265) c = mul(shirt, 0.9);
    if (!c) continue;
    // tiny cloth dither so flat fields still read as pixel art
    const n = ((i * 2654435761) >>> 28) / 15;
    const k = 0.96 + n * 0.08;
    d[o] = Math.min(255, c[0] * k); d[o + 1] = Math.min(255, c[1] * k); d[o + 2] = Math.min(255, c[2] * k); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// ----------------------------------------------------------------------------------------------
// Avatar
// ----------------------------------------------------------------------------------------------
export class Avatar {
  /** host: { app, containers(Map), model(name) } — the main Engine or the portrait Studio */
  constructor(host, chainer, opts = {}) {
    this.host = host;
    this.chainer = chainer;
    this.look = lookOf(chainer);
    const asset = host.containers.get('chainer');
    const e = asset.resource.instantiateRenderEntity({ castShadows: opts.castShadows !== false });
    this.entity = new pc.Entity('avatar_' + chainer.id, host.app);
    this.body = e;
    this.entity.addChild(e);
    e.setLocalScale(CHAINER_SCALE, CHAINER_SCALE, CHAINER_SCALE);
    this.attached = [];
    this._restInv = {};
    this._prepareBones();
    this._applyOutfit();
    this._attachGear();
    // animation
    e.addComponent('anim', { activate: true });
    this.clips = new Set();
    for (const a of asset.resource.animations) {
      const tr = a.resource;
      const name = (tr && tr.name) || a.name;
      if (!tr) continue;
      const speed = name === 'walk' || name === 'carry' ? 1.25 : 1;
      e.anim.assignAnimation(name, tr, undefined, speed, true);
      this.clips.add(name);
    }
    this.anim = null;
    this.play('idle', 0);
    this.tool = null; this.toolName = null;
  }
  _prepareBones() {
    const root = this.body;
    const rw = root.getWorldTransform().clone();
    for (const bone of ['Head', 'Hand_Right', 'UpperChest']) {
      const b = root.findByName(bone);
      if (!b) continue;
      const inv = b.getWorldTransform().clone().invert();
      this._restInv[bone] = { node: b, m: inv.mul(rw) };
    }
  }
  _applyOutfit() {
    const dev = this.host.app.graphicsDevice;
    const cv = paintOutfit(this.look);
    walk(this.body, (n) => {
      if (!n.render) return;
      for (const mi of n.render.meshInstances) {
        const mat = mi.material;
        if (!mat || !/Chainer_material/i.test(mat.name || '')) continue;
        const orig = mat.diffuseMap;
        const tex = new pc.Texture(dev, {
          width: N, height: N, format: orig ? orig.format : pc.PIXELFORMAT_SRGBA8, mipmaps: true,
          minFilter: pc.FILTER_NEAREST_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST,
          addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, flipY: orig ? orig.flipY : false,
        });
        tex.setSource(cv);
        const m = mat.clone();
        m.diffuseMap = tex;
        m.gloss = 0.08;
        m.update();
        mi.material = m;
        this._tex = tex; this._mat = m;
      }
    });
  }
  _attach(modelName, bone, tints) {
    const slot = this._restInv[bone];
    if (!slot || !this.host.containers.has(modelName)) return null;
    const acc = this.host.model(modelName);
    const m = slot.m;
    acc.setLocalPosition(m.getTranslation());
    acc.setLocalEulerAngles(m.getEulerAngles());
    acc.setLocalScale(m.getScale());
    slot.node.addChild(acc);
    if (tints) {
      walk(acc, (n) => {
        if (!n.render) return;
        for (const mi of n.render.meshInstances) {
          const nm = (mi.material && mi.material.name) || '';
          const t = nm.startsWith('tint_main') ? tints[0] : nm.startsWith('tint_alt') ? tints[1] : null;
          if (!t) continue;
          const c = mi.material.clone();
          c.diffuse = new pc.Color().fromString(t);
          c.update();
          mi.material = c;
        }
      });
    }
    this.attached.push(acc);
    return acc;
  }
  _attachGear() {
    const L = this.look;
    if (L.head) this._attach(L.head, 'Head', [L.hair, L.hair2]);
    if (L.extra) this._attach(L.extra, L.extra === 'acc_goggles' ? 'Head' : 'UpperChest', [L.shirt2, L.hair2]);
  }
  setTool(name) {
    if (this.toolName === name) return;
    if (this.tool) { this.tool.destroy(); this.tool = null; }
    this.toolName = name;
    if (!name || !this.host.containers.has(name)) return;
    const slot = this._restInv.Hand_Right;
    if (!slot) return;
    const t = this.host.model(name);
    // rest space: right hand at x=-1.05, y=1.425; handle points up (+Y)
    const holder = new pc.Entity('toolholder', this.host.app);
    const m = slot.m;
    holder.setLocalPosition(m.getTranslation()); holder.setLocalEulerAngles(m.getEulerAngles()); holder.setLocalScale(m.getScale());
    t.setLocalPosition(-1.06, 1.42, -0.02);
    holder.addChild(t);
    slot.node.addChild(holder);
    this.tool = holder;
  }
  play(name, fade = 0.18) {
    if (!this.clips.has(name)) name = 'idle';
    if (this.anim === name) return;
    this.anim = name;
    const layer = this.body.anim.baseLayer;
    try { if (fade > 0 && layer.activeState) layer.transition(name, fade); else layer.play(name); } catch (e) { /* anim not ready yet */ }
  }
  destroy() {
    if (this._tex) this._tex.destroy();
    this.entity.destroy();
  }
}

// ----------------------------------------------------------------------------------------------
// Portrait studio: a tiny second PlayCanvas app that renders real 3D head shots for the UI.
// ----------------------------------------------------------------------------------------------
export class Studio {
  constructor(size = 192) {
    const cv = document.createElement('canvas');
    cv.id = 'portrait-studio';
    cv.width = size; cv.height = size;
    this.canvas = cv;
    this.app = new pc.Application(cv, { graphicsDeviceOptions: { antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false } });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE, size, size);
    this.app.setCanvasResolution(pc.RESOLUTION_FIXED, size, size);
    this.app.autoRender = false;
    this.containers = new Map();
    this.cache = new Map();
    this.app.scene.ambientLight = new pc.Color(0.62, 0.64, 0.72);
    const sun = new pc.Entity('sun', this.app);
    sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.96, 0.88), intensity: 1.5, castShadows: false });
    sun.setEulerAngles(40, 150, 0);
    this.app.root.addChild(sun);
    const cam = new pc.Entity('cam', this.app);
    cam.addComponent('camera', { fov: 24, nearClip: 0.2, farClip: 50, clearColor: new pc.Color(0, 0, 0, 0) });
    cam.camera.gammaCorrection = pc.GAMMA_SRGB; cam.camera.toneMapping = pc.TONEMAP_NEUTRAL;
    this.app.root.addChild(cam);
    this.cam = cam;
    this.ready = false;
  }
  async load(names) {
    await Promise.all(names.map((name) => new Promise((resolve) => {
      this.app.assets.loadFromUrlAndFilename(asset(`models/${name}.glb`), name + '.glb', 'container', (err, a) => { if (!err && a) this.containers.set(name, a); resolve(); });
    })));
    this.ready = this.containers.has('chainer');   // rendered on demand only: the studio never runs its own loop
  }
  model(name) {
    const a = this.containers.get(name);
    return a ? a.resource.instantiateRenderEntity({ castShadows: false }) : new pc.Entity(name, this.app);
  }
  /** kind: 'head' (bust) or 'full' */
  portrait(chainer, kind = 'head') {
    const key = chainer.id + ':' + chainer.look + ':' + kind;
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.ready) return '';
    let url = '';
    try {
      const av = new Avatar(this, chainer, { castShadows: false });
      this.app.root.addChild(av.entity);
      av.entity.setEulerAngles(0, 24, 0);
      const s = CHAINER_SCALE;
      if (kind === 'head') { this.cam.setPosition(0.25, 1.88 * s, 4.3 * s); this.cam.lookAt(0, 1.62 * s, 0); }
      else { this.cam.setPosition(0.6, 1.5 * s, 8.4 * s); this.cam.lookAt(0, 1.08 * s, 0); }
      this.app.update(0.6);
      this.app.update(0.1);
      this.app.render();
      url = this.canvas.toDataURL('image/png');
      av.destroy();
    } catch (e) { console.warn('portrait failed', e); }
    if (url) this.cache.set(key, url);
    return url;
  }
}
