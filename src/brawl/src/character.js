// Character: skinned voxel model + anim state graph (base full-body layer, masked upper-body
// weapon layer), weapon attachment on the Grip_R socket, procedural aim offset.
const pc = window.pc;

const _q0 = new pc.Quat(), _q1 = new pc.Quat(), _q2 = new pc.Quat();

export const LOCO = [
  { name: 'Idle', point: [0, 0] },
  { name: 'Walk_F', point: [0, 0.9] },
  { name: 'Walk_B', point: [0, -0.613] },
  { name: 'Walk_L', point: [-0.6875, 0] },
  { name: 'Walk_R', point: [0.6875, 0] },
  { name: 'Run_F', point: [0, 3.06] },
];

// A constant track holding every animated part of a weapon at its authored rest transform,
// so switching back to 'Rest' snaps slides, mags and pumps home.
function restTrack(name, clips, root) {
  const seen = new Map();
  for (const c of clips) for (const cv of c.curves) for (const p of cv.paths) {
    const key = p.entityPath.join('/') + '|' + p.propertyPath[0];
    if (!seen.has(key)) seen.set(key, p);
  }
  const inputs = [new pc.AnimData(1, new Float32Array([0, 1]))];
  const outputs = [], curves = [];
  for (const p of seen.values()) {
    const node = root.findByPath(p.entityPath) || root.findByPath(p.entityPath.slice(1));
    if (!node) continue;
    const prop = p.propertyPath[0];
    let v;
    if (prop === 'localPosition') { const q = node.getLocalPosition(); v = [q.x, q.y, q.z]; }
    else if (prop === 'localRotation') { const q = node.getLocalRotation(); v = [q.x, q.y, q.z, q.w]; }
    else if (prop === 'localScale') { const q = node.getLocalScale(); v = [q.x, q.y, q.z]; }
    else continue;
    outputs.push(new pc.AnimData(v.length, new Float32Array([...v, ...v])));
    curves.push(new pc.AnimCurve([p], 0, outputs.length - 1, 1));
  }
  return new pc.AnimTrack(name, 1, inputs, outputs, curves);
}

export class Character {
  constructor(app, container, meta, weaponAssets) {
    this.app = app;
    this.meta = meta;
    this.clipMeta = Object.fromEntries(meta.clips.map((c) => [c.name, c]));
    const root = container.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
    root.name = 'Character';
    this.root = new pc.Entity('CharacterRoot');   // controller moves/rotates this
    this.root.addChild(root);
    this.model = root;
    this.bones = {};
    root.forEach((e) => { this.bones[e.name] = e; });
    this.tracks = {};
    for (const a of container.resource.animations) {
      const tr = a.resource;
      const m = this.clipMeta[tr.name];
      if (m && m.events) tr.events = new pc.AnimEvents(m.events.map((e) => ({ time: e.time, name: e.name })));
      this.tracks[tr.name] = tr;
    }
    this._buildAnim();
    // weapons
    this.weapons = {};
    for (const [name, wa] of Object.entries(weaponAssets)) this._makeWeapon(name, wa);
    this.weapon = null;
    this.upperWeight = 0;
    this.upperTarget = 0;
    this.aimPitch = 0;
    this.aimEnabled = false;
    this.kick = 0; this.kickVel = 0; this.kickYaw = 0; this.kickYawVel = 0;
    // hip orientation of each weapon's standing stance: while running the legs swing and lean
    // the hips, and the upper body is counter-rotated back to this so the gun stays on target
    this.stanceHips = {};
    for (const n of Object.keys(this.tracks)) {
      if (!n.endsWith('_Idle')) continue;
      const q = this._trackRot(this.tracks[n], 'Hips');
      if (q) this.stanceHips[n.slice(0, -5)] = q;
    }
    this.meshInstances = [];
    root.findComponents('render').forEach((r) => this.meshInstances.push(...r.meshInstances));
  }

  // first-key local rotation of a bone in a track
  _trackRot(track, boneName) {
    for (const c of track.curves) {
      for (const p of c.paths) {
        if (p.propertyPath[0] !== 'localRotation' || p.entityPath[p.entityPath.length - 1] !== boneName) continue;
        const d = track.outputs[c.output].data;
        const q = new pc.Quat(d[0], d[1], d[2], d[3]);
        return q.normalize();
      }
    }
    return null;
  }

  _path(entity) {
    const parts = [];
    let e = entity;
    while (e && e !== this.model) { parts.unshift(e.name); e = e.parent; }
    return parts.join('/');
  }

  _buildAnim() {
    const clipNames = Object.keys(this.tracks);
    const base = [{ name: 'START' }, {
      name: 'Locomotion', speed: 1, loop: true,
      blendTree: { type: pc.ANIM_BLEND_2D_CARTESIAN, parameters: ['strafe', 'forward'], syncAnimations: true, children: LOCO.map((c) => ({ name: c.name, point: c.point })) },
    }];
    for (const n of clipNames) base.push({ name: n, speed: 1, loop: !!this.clipMeta[n]?.loop });
    base.push({ name: 'END' });
    const weaponClips = clipNames.filter((n) => this.clipMeta[n]?.weapon);
    const upper = [{ name: 'START' }, { name: 'None', speed: 1, loop: true }];
    for (const n of weaponClips) upper.push({ name: n, speed: 1, loop: !!this.clipMeta[n]?.loop });
    upper.push({ name: 'END' });
    const graph = {
      layers: [
        { name: 'Base', states: base, transitions: [{ from: 'START', to: 'Locomotion' }] },
        { name: 'Upper', states: upper, transitions: [{ from: 'START', to: 'None' }] },
      ],
      parameters: {
        strafe: { name: 'strafe', type: pc.ANIM_PARAMETER_FLOAT, value: 0 },
        forward: { name: 'forward', type: pc.ANIM_PARAMETER_FLOAT, value: 0 },
      },
    };
    this.model.addComponent('anim', { activate: true, speed: 1 });
    const anim = this.model.anim;
    anim.loadStateGraph(graph);
    for (const c of LOCO) anim.assignAnimation('Locomotion.' + c.name, this.tracks[c.name], 'Base');
    for (const n of clipNames) anim.assignAnimation(n, this.tracks[n], 'Base');
    for (const n of weaponClips) anim.assignAnimation(n, this.tracks[n], 'Upper');
    // every state needs a track before the component counts as playable
    anim.assignAnimation('None', pc.AnimTrack.EMPTY, 'Upper');
    anim.playing = true;
    this.anim = anim;
    this.base = anim.findAnimationLayer('Base');
    this.upper = anim.findAnimationLayer('Upper');
    // Mask paths are matched from the root of the animated hierarchy, so they have to start with
    // the root's name (the anim entity, or the glTF scene node the clips were authored against).
    // Without the root prefix nothing matches and the weapon layer silently does nothing whenever
    // the legs play a different clip: the arms swing with the walk/run and the gun hangs down.
    const spinePath = this._path(this.bones.Spine);
    const roots = new Set([this.model.name, 'Scene']);
    for (const t of Object.values(this.tracks)) for (const c of t.curves) { roots.add(c.paths[0].entityPath[0]); break; }
    this.upper.mask = Object.fromEntries([...roots].map((r) => [`${r}/${spinePath}`, { children: true }]));
    this.upper.weight = 0;
    this.spinePath = spinePath;
  }

  _makeWeapon(name, asset) {
    const ent = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
    ent.name = 'Weapon_' + name;
    const nodes = {};
    ent.forEach((e) => { nodes[e.name.replace(name + '_', '')] = e; });
    const clips = asset.resource.animations.map((a) => a.resource);
    if (clips.length) {
      const states = [{ name: 'START' }, { name: 'Rest', speed: 1, loop: true }];
      for (const c of clips) states.push({ name: c.name, speed: 1, loop: !!this.clipMeta[c.name]?.loop });
      states.push({ name: 'END' });
      ent.addComponent('anim', { activate: true });
      ent.anim.loadStateGraph({ layers: [{ name: 'Base', states, transitions: [{ from: 'START', to: 'Rest' }] }], parameters: {} });
      for (const c of clips) ent.anim.assignAnimation(c.name, c, 'Base');
      ent.anim.assignAnimation('Rest', restTrack(name + '_Rest', clips, ent), 'Base');
      ent.anim.playing = true;
    }
    ent.enabled = false;
    this.weapons[name] = { name, entity: ent, nodes, clips: new Set(clips.map((c) => c.name)) };
  }

  // ---------------------------------------------------------------- weapons
  equip(name) {
    if (this.weapon) {
      this.weapon.entity.enabled = false;
      if (this.weapon.entity.parent) this.weapon.entity.parent.removeChild(this.weapon.entity);
    }
    this.weapon = name ? this.weapons[name] : null;
    if (this.weapon) {
      const grip = this.bones.Grip_R;
      grip.addChild(this.weapon.entity);
      this.weapon.entity.setLocalPosition(0, 0, 0);
      this.weapon.entity.setLocalEulerAngles(0, 0, 0);
      this.weapon.entity.enabled = true;
    }
  }

  playWeaponClip(clip, time = 0) {
    const w = this.weapon;
    if (!w || !w.entity.anim) return;
    const layer = w.entity.anim.baseLayer;
    if (w.clips.has(clip)) { layer.transition(clip, 0); if (time) layer.activeStateCurrentTime = time; }
    else layer.transition('Rest', 0);
  }

  // ---------------------------------------------------------------- anim helpers
  playBase(state, blend = 0.15, time = null) {
    if (this.base.activeState === state && time === null) return;
    this.base.transition(state, blend, time);
  }

  playUpper(state, blend = 0.1) {
    this.upper.transition(state, blend);
  }

  restartUpper(state, blend = 0.02) {
    if (this.upper.activeState === state) this.upper.activeStateCurrentTime = 0;
    else this.upper.transition(state, blend, 0);
  }

  setLocomotion(strafe, forward) {
    this.moveSpeed = Math.hypot(strafe, forward);
    this.anim.setFloat('strafe', strafe);
    this.anim.setFloat('forward', forward);
  }

  update(dt) {
    // smooth upper-body layer weight (weapon layer on/off)
    const k = 1 - Math.exp(-dt * 14);
    this.upperWeight += (this.upperTarget - this.upperWeight) * k;
    if (Math.abs(this.upperWeight - this.upperTarget) < 0.002) this.upperWeight = this.upperTarget;
    this.upper.weight = this.upperWeight;
  }

  // Run-and-gun: the masked weapon layer drives spine and arms relative to the hips, so the run
  // cycle's lean and sway would tip the gun down. Rebuild the spine as if the hips were in the
  // weapon's standing stance (keeping a little of the motion so the run still reads).
  _steadyUpperBody() {
    const want = this.weapon && this.stanceHips[this.weapon.name];
    const w = this.upperWeight * 0.88 * Math.min(1, (this.moveSpeed || 0) / 0.8);
    if (!want || w < 0.01 || !this.aimEnabled) return;
    const hips = this.bones.Hips, spine = this.bones.Spine;
    const parent = hips.parent.getRotation();
    const cur = hips.getLocalRotation();
    if (Math.abs(cur.dot(want)) > 0.99995) return;                // already standing
    const hipsWant = _q0.copy(parent).mul(want);                   // hips in stance, world
    const target = _q1.copy(hipsWant).mul(spine.getLocalRotation()); // spine riding stance hips
    const now = spine.getRotation();
    _q2.slerp(now, target, w);
    spine.setRotation(_q2);
  }

  // weapon recoil on the upper body: an impulse into a damped spring (degrees, + = muzzle up)
  addKick(pitchDeg, yawDeg = 0) { this.kickVel += pitchDeg * 30; this.kickYawVel += yawDeg * 30; }

  updateKick(dt) {
    this.kickVel += (-this.kick * 320 - this.kickVel * 21) * dt;
    this.kick += this.kickVel * dt;
    this.kickYawVel += (-this.kickYaw * 320 - this.kickYawVel * 21) * dt;
    this.kickYaw += this.kickYawVel * dt;
  }

  // procedural aim offset + recoil, applied after the animation pass (the app 'update' event)
  applyAim() {
    this._steadyUpperBody();
    const aim = this.aimEnabled ? this.aimPitch * this.upperWeight : 0;
    const kick = this.kick * this.upperWeight, yaw = this.kickYaw * this.upperWeight;
    if (Math.abs(aim) < 0.01 && Math.abs(kick) < 0.01 && Math.abs(yaw) < 0.01) return;
    const right = this.root.right;               // local +X of the rig (the model faces +Z)
    const q = new pc.Quat(), qy = new pc.Quat();
    for (const [bone, aimShare, kickShare] of [['Spine', 0.45, 0.3], ['Chest', 0.55, 0.7]]) {
      const b = this.bones[bone];
      q.setFromAxisAngle(right, -(aim * aimShare + kick * kickShare));
      qy.setFromAxisAngle(pc.Vec3.UP, yaw * kickShare);
      const w = b.getRotation().clone();
      b.setRotation(qy.mul(q).mul(w));
    }
  }
}
