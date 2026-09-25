// A brawler's body: the shared voxel character with the brawler's outfit atlas, a voxel hat on
// the head bone, and the weapon in hand. Drives the animation layers for top-down play: legs
// run in any direction relative to where the brawler faces, the weapon layer holds the gun up,
// shots restart the weapon's fire clip, and a white flash marks every hit taken.
import { Character } from './character.js';
import { chamferBoxes } from './props.js';
import { BRAWLERS, CHAR_SCALE } from './config.js';

const pc = window.pc;
const R2D = 180 / Math.PI;
const U = 0.04;                 // voxel unit (m), same grid as the character

// Hats in character units: x = the character's left, y = up from the soles, z = forward.
// The head spans x -4.5..4.5, z -3..3, top 45.5 (a stepped dome rises to 47.5).
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const HATS = {
  hardhat: () => {
    const Y = hex('#F5C61E'), Y2 = hex('#DDA812'), O = hex('#FF8A1F');
    return [
      { c: [0, 45.25, 0.35], s: [11.4, 0.55, 8.4], b: 0.22, tint: Y2 },           // brim all round
      { c: [0, 45.35, 4.55], s: [10.2, 0.6, 2.2], b: 0.22, tint: Y },             // front peak
      { c: [0, 46.75, 0.2], s: [10.0, 3.1, 7.2], b: 0.9, tint: Y },               // shell
      { c: [0, 48.35, 0.2], s: [1.8, 0.9, 7.5], b: 0.3, tint: Y2 },               // ridge
      { c: [0, 46.7, 3.84], s: [2.6, 1.5, 0.22], b: 0.08, tint: O },              // sticker
    ];
  },
  aviator: () => {
    const B = hex('#7A4A2A'), B2 = hex('#5E3920'), D = hex('#3A2414'), G = hex('#C99A3C'), L = hex('#7FE6FF');
    return [
      { c: [0, 46.3, -0.1], s: [9.9, 3.7, 6.9], b: 0.95, tint: B },               // leather cap
      { c: [4.98, 42.9, 0.35], s: [0.7, 4.6, 3.2], b: 0.25, tint: B2 },          // ear flaps
      { c: [-4.98, 42.9, 0.35], s: [0.7, 4.6, 3.2], b: 0.25, tint: B2 },
      { c: [0, 44.95, -0.1], s: [10.1, 0.9, 7.1], b: 0.3, tint: D },              // strap
      { c: [1.95, 45.75, 3.62], s: [2.9, 2.25, 0.9], b: 0.35, tint: G },          // goggles
      { c: [-1.95, 45.75, 3.62], s: [2.9, 2.25, 0.9], b: 0.35, tint: G },
      { c: [1.95, 45.75, 4.08], s: [2.1, 1.45, 0.22], b: 0.08, tint: L },
      { c: [-1.95, 45.75, 4.08], s: [2.1, 1.45, 0.22], b: 0.08, tint: L },
      { c: [0, 45.75, 3.6], s: [1.3, 0.55, 0.6], b: 0.1, tint: G },
    ];
  },
  cap: () => {
    const R = hex('#D8433A'), R2 = hex('#A92E27'), W = hex('#F4F2EC');
    return [
      { c: [0, 46.55, 0], s: [9.7, 2.9, 6.9], b: 0.95, tint: R },                 // crown
      { c: [0, 45.45, -4.5], s: [7.2, 0.6, 3.0], b: 0.24, tint: R2 },             // visor, worn backwards
      { c: [0, 46.45, 3.5], s: [4.6, 1.9, 0.22], b: 0.08, tint: W },              // front panel
      { c: [0, 48.1, 0], s: [1.3, 0.55, 1.3], b: 0.15, tint: R2 },                // button
      { c: [0, 45.25, 0], s: [9.9, 0.5, 7.1], b: 0.15, tint: R2 },                // band
    ];
  },
};

let hatMaterial = null;
function hatMat() {
  if (hatMaterial) return hatMaterial;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.vertexColorGamma = true;
  m.useMetalness = true; m.metalness = 0; m.gloss = 0.5;
  m.update();
  hatMaterial = m;
  return m;
}

const _m = new pc.Mat4(), _q = new pc.Quat(), _v = new pc.Vec3();

export class Avatar {
  // ctx: { charAsset, meta, weapons: {name: asset}, T (textures) }
  constructor(app, ctx, brawlerId) {
    this.app = app;
    this.id = brawlerId;
    this.def = BRAWLERS[brawlerId];
    const W = this.def.weapon;
    this.ch = new Character(app, ctx.charAsset, ctx.meta, { [W]: ctx.weapons[W] });
    this.root = this.ch.root;
    this.ch.model.setLocalScale(CHAR_SCALE, CHAR_SCALE, CHAR_SCALE);
    if (this.def.skin) this._skin(ctx.T['skin_' + this.def.skin], ctx.T['skin_' + this.def.skin + '_mr']);
    if (this.def.hat) this._hat(this.def.hat);
    this.ch.equip(W);
    this.weapon = W;
    this.ch.upperTarget = 1; this.ch.upperWeight = 1; this.ch.upper.weight = 1;
    this.ch.playUpper(W + '_Idle', 0);
    this.ch.aimEnabled = true;
    this.baseState = null;
    this.flash = 0;
    this.flashColor = [1, 1, 1];
    this.mis = [];
    this.root.findComponents('render').forEach((r) => this.mis.push(...r.meshInstances));
    this._emis = new Float32Array(3);
    this.dead = false;
    this.moveSpeed = 0;
    this.shootT = 0;
  }

  _skin(tex, mr) {
    if (!tex) return;
    const done = new Map();
    for (const mi of this.ch.meshInstances) {
      let m = done.get(mi.material);
      if (!m) {
        m = mi.material.clone();
        m.diffuseMap = tex;
        if (mr) { m.metalnessMap = mr; m.glossMap = mr; }
        m.update();
        done.set(mi.material, m);
      }
      mi.material = m;
    }
  }

  // hat parented to the head bone, placed while the skeleton is still in its rest pose
  _hat(kind) {
    const boxes = HATS[kind]().map((b) => ({ c: b.c.map((v) => v * U), s: b.s.map((v) => v * U), b: b.b * U, tint: b.tint }));
    const mesh = chamferBoxes(this.app.graphicsDevice, boxes);
    const hat = new pc.Entity('Hat');
    hat.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, hatMat())], castShadows: true, receiveShadows: true });
    const head = this.ch.bones.Head;
    _m.copy(head.getWorldTransform()).invert().mul(this.ch.model.getWorldTransform());
    head.addChild(hat);
    hat.setLocalPosition(_m.getTranslation(_v));
    _q.setFromMat4(_m);
    hat.setLocalRotation(_q);
    const sc = _m.getScale(new pc.Vec3());
    hat.setLocalScale(sc.x, sc.y, sc.z);
    this.hat = hat;
  }

  // ------------------------------------------------------------------ per frame
  // vx, vz: velocity (m/s); yaw: facing (radians, 0 = +Z)
  drive(dt, vx, vz, yaw) {
    const ch = this.ch;
    this.root.setLocalEulerAngles(0, yaw * R2D, 0);
    if (this.dead) { ch.update(dt); return; }
    const speed = Math.hypot(vx, vz);
    this.moveSpeed = speed;
    const base = speed < 0.12 ? this.weapon + '_Idle' : 'Locomotion';
    if (base !== this.baseState) { ch.playBase(base, 0.16); this.baseState = base; }
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const vf = vx * fx + vz * fz, vr = -vx * fz + vz * fx;
    ch.setLocomotion(vr / CHAR_SCALE, vf / CHAR_SCALE);
    ch.update(dt);
    ch.updateKick(dt);
    this.shootT = Math.max(0, this.shootT - dt);
  }

  // after the animation pass
  post(dt) {
    this.ch.applyAim();
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      const f = this.flash * this.flash * 1.6;
      this._emis[0] = this.flashColor[0] * f; this._emis[1] = this.flashColor[1] * f; this._emis[2] = this.flashColor[2] * f;
      for (const mi of this.mis) mi.setParameter('material_emissive', this._emis);
      if (this.flash === 0) for (const mi of this.mis) mi.deleteParameter('material_emissive');
    }
  }

  hitFlash(color = [1, 1, 1]) { this.flash = 1; this.flashColor = color; }

  shoot(kick = 3) {
    const W = this.weapon;
    this.ch.restartUpper(W + '_Shoot', 0.02);
    this.ch.playWeaponClip(W + '_Shoot');
    this.ch.addKick(kick, (Math.random() - 0.5) * kick * 0.4);
    this.shootT = 0.35;
  }

  idleUpper() {
    this.ch.playUpper(this.weapon + '_Idle', 0.15);
  }

  die() {
    this.dead = true;
    this.ch.upperTarget = 0;
    this.ch.playBase('Death', 0.08, 0);
    this.baseState = 'Death';
  }

  revive() {
    this.dead = false;
    this.ch.upperTarget = 1;
    this.ch.upperWeight = 1;
    this.ch.upper.weight = 1;
    this.ch.playUpper(this.weapon + '_Idle', 0);
    this.baseState = null;
  }

  emote(name) {                  // 'Dance', 'Wave'
    this.ch.upperTarget = 0;
    this.ch.playBase(name, 0.2, 0);
    this.baseState = name;
  }

  setVisible(on) { if (this.root.enabled !== on) this.root.enabled = on; }

  // socket world position on the weapon (muzzle) or a fallback in front of the chest
  muzzle(out = new pc.Vec3()) {
    const w = this.ch.weapon;
    const sock = w && (w.nodes.Muzzle || w.nodes.Socket_Muzzle);
    if (sock) return out.copy(sock.getPosition());
    return out.copy(this.root.getPosition()).add(new pc.Vec3(0, 1.3, 0));
  }

  destroy() { this.root.destroy(); }
}

export { HATS };
