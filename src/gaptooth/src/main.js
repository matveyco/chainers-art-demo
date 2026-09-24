// Gaptooth Test Range — boot, modes (play / animation studio / reference match), input wiring.
import { loadBuffer, loadJSON, containerFromBuffer, assetURL } from './assets.js';
import { makeTextures, buildRange, buildCyclorama } from './scene.js';
import { loadTextures } from './textures.js';
import { Look, SKY_HORIZON } from './look.js';
import { Character } from './character.js';
import { Mover } from './physics.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';
import { Targets } from './targets.js';
import { Player, WEAPONS, ORDER } from './player.js';
import { UI } from './ui.js';
import { Juice } from './juice.js';
import { Score } from './score.js';
import { Challenge } from './challenge.js';
import { Decals } from './decals.js';
import { DebugHud } from './debug.js';

const pc = window.pc;
const D2R = Math.PI / 180;
const $ = (id) => document.getElementById(id);

async function boot() {
  const files = ['clips.json', 'icons.json', 'character.glb', 'weapon_pistol.glb', 'weapon_smg.glb', 'weapon_shotgun.glb', 'weapon_launcher.glb'];
  const canvas = $('gl');
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__PRESERVE__ },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  window.addEventListener('resize', () => app.resizeCanvas());
  app.start();

  // ---------------------------------------------------------------- assets (in parallel)
  const bufs = {};
  const sizes = {};
  let done = 0;
  const total = files.length + 1;
  const ui0 = { loaded: (p, t) => { $('loader-fill').style.width = Math.round(p * 100) + '%'; if (t) $('loader-text').textContent = t; } };
  ui0.loaded(0, 'Loading character, weapons and textures');
  const tick = () => { done++; ui0.loaded(done / total, done === total ? 'Building scene' : `Loaded ${done} of ${total}`); };
  const texP = loadTextures(app).then((t) => { tick(); return t; });
  const filesP = Promise.all(files.map(async (f) => {        // parallel fetches: one round trip, not seven
    bufs[f] = await loadBuffer(f);
    sizes[f] = bufs[f].byteLength;
    tick();
  }));

  // ---------------------------------------------------------------- scene
  const T = Object.assign(makeTextures(app), await texP);
  const range = buildRange(app, T);
  const cyc = buildCyclorama(app);
  const camera = new pc.Entity('Camera');
  camera.addComponent('camera', { clearColor: SKY_HORIZON, fov: 55, nearClip: 0.05, farClip: 220 });
  app.root.addChild(camera);
  camera.setPosition(0, 2.2, -4.5);
  camera.lookAt(0, 1.2, 0);
  const look = new Look(app, camera);

  await filesP;
  const meta = JSON.parse(new TextDecoder().decode(bufs['clips.json']));
  window.__ICONS__ = JSON.parse(new TextDecoder().decode(bufs['icons.json']));
  const charAsset = await containerFromBuffer(app, 'character.glb', bufs['character.glb']);
  const wAssets = {};
  for (const w of ORDER) wAssets[w] = await containerFromBuffer(app, 'weapon_' + w.toLowerCase() + '.glb', bufs['weapon_' + w.toLowerCase() + '.glb']);

  const ch = new Character(app, charAsset, meta, wAssets);
  app.root.addChild(ch.root);
  const dbg = new DebugHud(app, camera, {
    charTris: meta.character.tris, clips: meta.clips.length,
    weaponTris: meta.weapons.reduce((a, w) => a + (w.tris || 0), 0),
    bones: Object.keys(ch.bones).filter((n) => !/^(Root|Grip_)/.test(n)).length,
  });
  dbg.look = look;
  delete sizes['icons.json'];
  const ui = new UI(meta, sizes);
  const sfx = new Sfx();
  const fx = new FX(app, camera, T);
  look.fx = fx;
  fx.onSound = (n) => sfx.play(n);
  const mover = new Mover(range.colliders);
  fx.floorAt = (p) => mover.groundAt(p, 0.4);
  const targets = new Targets(app, T, range.props, range.colliders, fx, sfx);
  const player = new Player(app, ch, mover, camera, fx, sfx, targets, range.colliders, meta);

  // score & feedback
  const juice = new Juice(app, camera);
  const decals = new Decals(app, T.decals);
  const score = new Score(juice, sfx);
  player.score = score;
  player.decals = decals;
  score.onChange = (sc) => ui.score(sc);
  let lastBoomJuice = 0;
  function boomJuice(pos) {
    const d = camera.getPosition().distance(pos);
    const k = Math.max(0, 1 - d / 30);
    decals.add(new pc.Vec3(pos.x, 0.002, pos.z), pc.Vec3.UP, 2.2 + Math.random() * 0.5, 3);
    if (mode !== 'play' || k <= 0) return;
    juice.flash(0.15 + 0.5 * k, 280);
    player.fovKick = Math.min(10, player.fovKick + 5 * k);
    fx.addShake(0.6 * k);
    const now = performance.now();
    if (now - lastBoomJuice > 900) { juice.hitstop(30 + 50 * k, 0.05); juice.slowmo(280, 0.35); lastBoomJuice = now; }
  }
  targets.onHit = (t, info) => {
    if (mode !== 'play') return;
    if (t.kind === 'dummy') {
      const kind = [info.head ? 'head' : '', info.killed ? 'kill' : ''].join(' ').trim();
      juice.number(info.point || t.hinge.getPosition(), info.amount, kind, t);
    }
    if (info.source !== 'blast') {
      juice.hitmark(info.killed ? 'kill' : info.head ? 'head' : 'hit');
      sfx.play(info.head ? 'headshot' : 'tick', 0.9);
      if (!info.killed && info.head) juice.hitstop(30, 0.08);
      else if (!info.killed && info.weapon === 'Shotgun') juice.hitstop(42, 0.06);
    }
    score.hit(info);
  };
  targets.onKO = (t, info) => {
    if (mode !== 'play') return;
    sfx.play('ko');
    if (info.source !== 'blast') { juice.hitstop(info.weapon === 'SMG' ? 45 : 80, 0.03); juice.slowmo(170, 0.5); }
    score.ko(info);
  };
  targets.onBoom = (b, info) => { boomJuice(info.pos); if (mode === 'play') score.boom(); };
  targets.onPlayerBlast = (p, r) => {
    const d = new pc.Vec3(player.pos.x, 1, player.pos.z).distance(p);
    if (d < r * 0.9 && mode === 'play') {
      player.hit(new pc.Vec3(player.pos.x - p.x, 0, player.pos.z - p.z).normalize());
      juice.flash(0.6, 450, 'hurt');
    }
  };
  player.onExplosion = (at) => boomJuice(at);
  const challenge = new Challenge({ targets, score, juice, sfx, player });
  challenge.onPhase = (ph) => {
    $('btn-challenge').hidden = ph === 'countdown' || ph === 'run';
    document.body.classList.toggle('in-round', ph === 'countdown' || ph === 'run');
  };
  const startChallenge = () => { if (mode !== 'play') enterMode('play'); challenge.start(); canvas.focus(); };
  $('btn-challenge').addEventListener('click', startChallenge);
  const refreshWeapon = () => ui.weaponState(player.weapon, player.weapon ? player.ammo[player.weapon] : 0, !!player.reload);
  player.onChange = refreshWeapon;
  player.onToast = (m) => ui.toast(m);
  refreshWeapon();

  // ---------------------------------------------------------------- framing
  // Off-centre projection (lens shift) so the subject sits in the part of the screen that
  // panels don't cover. PlayCanvas calls calculateProjection wherever the projection is used.
  // The recoil FOV kick is applied here too, not through camera.fov: changing the fov would
  // resize the shadow cascades every shot and make the shadows crawl.
  const view = { cx: 0, cy: 0, area: null, dirty: true, baseFov: 55, kick: 0 };
  camera.camera.calculateProjection = (mat) => {
    if (view.kick) {
      const cam = camera.camera;
      const f = 1 / Math.tan((cam.fov + view.kick) * D2R / 2);
      const aspect = cam.aspectRatio || 1;
      if (cam.horizontalFov) { mat.data[0] = f; mat.data[5] = f * aspect; } else { mat.data[0] = f / aspect; mat.data[5] = f; }
    }
    mat.data[8] = -view.cx; mat.data[9] = -view.cy;
  };
  const markLayout = () => { view.dirty = true; };
  window.addEventListener('resize', markLayout);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(markLayout);
    document.querySelectorAll('.panel, .topbar').forEach((el) => ro.observe(el));
  }
  function freeArea() {
    const W = window.innerWidth, H = window.innerHeight;
    const vis = (el) => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const top = vis(document.querySelector('.topbar'));
    const a = { W, H, x0: 0, x1: W, y0: top ? top.bottom + 6 : 0, y1: H };
    const side = vis(document.querySelector('.panel.left:not([hidden])'));
    const info = vis($('panel-info'));
    if (W > 860) {
      if (side) a.x0 = side.right + 6;
      if (info) a.x1 = info.left - 6;
    } else if (side) a.y1 = Math.min(a.y1, side.top - 6);
    return a;
  }
  const REF_ASPECT = 406 / 668, REF_FOV = 20;
  const refFrame = $('ref-frame');
  function layoutView() {
    view.dirty = false;
    const a = view.area = freeArea();
    const portrait = a.W < a.H;
    camera.camera.horizontalFov = mode === 'play' && portrait;   // keep the range in view on phones
    if (mode === 'play') { view.baseFov = portrait ? 62 : 55; camera.camera.fov = view.baseFov; view.cx = 0; view.cy = 0; refFrame.hidden = true; return; }
    if (mode === 'studio') camera.camera.fov = 55;
    if (mode === 'studio') {
      view.cx = ((a.x0 + a.x1) / 2) / a.W * 2 - 1;
      view.cy = 1 - ((a.y0 + a.y1) / 2) / a.H * 2;
      refFrame.hidden = true;
      return;
    }
    // reference: portrait frame with the screenshot's aspect, fitted into the free area
    const pad = 16, bottomPad = 40;
    const fh = Math.max(120, Math.min(a.y1 - a.y0 - pad - bottomPad, (a.x1 - a.x0 - 2 * pad) / REF_ASPECT));
    const fw = fh * REF_ASPECT;
    const fx = (a.x0 + a.x1) / 2 - fw / 2, fy = a.y0 + pad + Math.max(0, (a.y1 - a.y0 - pad - bottomPad - fh) / 2);
    Object.assign(refFrame.style, { left: fx + 'px', top: fy + 'px', width: fw + 'px', height: fh + 'px' });
    refFrame.hidden = false;
    view.cx = (fx + fw / 2) / a.W * 2 - 1;
    view.cy = 1 - (fy + fh / 2) / a.H * 2;
    camera.camera.fov = 2 * Math.atan(Math.tan(REF_FOV * D2R / 2) * a.H / fh) / D2R;
  }
  // wipe / onion-skin compare
  const setSplit = (clientX) => {
    const r = refFrame.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    refFrame.style.setProperty('--split', (f * 100).toFixed(2) + '%');
  };
  refFrame.addEventListener('pointerdown', (e) => {
    if (refFrame.dataset.cmp !== 'wipe') return;
    refFrame.setPointerCapture(e.pointerId); setSplit(e.clientX);
  });
  refFrame.addEventListener('pointermove', (e) => { if (refFrame.hasPointerCapture && refFrame.hasPointerCapture(e.pointerId)) setSplit(e.clientX); });
  document.querySelectorAll('[data-cmp]').forEach((b) => {
    if (b === refFrame) return;
    b.addEventListener('click', () => {
      refFrame.dataset.cmp = b.dataset.cmp;
      document.querySelectorAll('.seg [data-cmp]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
  });

  // ---------------------------------------------------------------- modes
  let mode = 'play';
  const studio = { clip: 'Idle', playing: true, speed: 1, turn: true, bones: false, sockets: false, wire: false, yaw: 20, pitch: 8, dist: 3.9, hold: 0, spin: 0 };
  const refView = { yaw: 8, h: 0.96, dist: 6.1 };

  function applyQuality(high) {
    look.setQuality(high ? 'high' : 'low');
    $('btn-quality').textContent = 'FX ' + (high ? 'high' : 'low');
  }
  let quality = !(/Mobi|Android/i.test(navigator.userAgent));
  applyQuality(quality);
  $('btn-quality').addEventListener('click', () => { quality = !quality; applyQuality(quality); });
  $('btn-sound').addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    $('btn-sound').textContent = 'Sound ' + (sfx.enabled ? 'on' : 'off');
    $('btn-sound').setAttribute('aria-pressed', String(sfx.enabled));
  });

  function setWire(on) {
    const style = on ? pc.RENDERSTYLE_WIREFRAME : pc.RENDERSTYLE_SOLID;
    for (const mi of ch.meshInstances) mi.renderStyle = style;
    for (const w of Object.values(ch.weapons)) w.entity.findComponents('render').forEach((r) => r.meshInstances.forEach((mi) => { mi.renderStyle = style; }));
  }

  function enterMode(m) {
    const prev = mode;
    mode = m;
    view.dirty = true;
    juice.reset();
    juice.crosshair(false, 0, false);
    if (m !== 'play' && challenge.phase !== 'idle') challenge.stop();
    ui.setMode(m, false);
    if (document.pointerLockElement) document.exitPointerLock();
    player.keys.clear();
    player.trigger = false;
    // restore defaults
    range.world.enabled = m === 'play';
    range.props.enabled = m === 'play';
    cyc.enabled = m === 'studio';
    camera.camera.fov = 55;
    view.kick = 0;
    look.setMode(m, { refLit: $('opt-reflight').checked });
    ch.anim.speed = 1;
    setWire(false);
    if (m === 'play') {
      player.enabled = true;
      ch.root.setLocalPosition(player.pos);
      ch.playBase('Locomotion', 0.2); player.baseState = 'Locomotion';
      if (player.weapon) { ch.equip(player.weapon); ch.upperTarget = 1; }
      else ch.equip(null);
      refreshWeapon();
    } else {
      player.enabled = false;
      player.action = null;
      player.cancelReload();
      ch.upperTarget = 0; ch.upperWeight = 0; ch.upper.weight = 0;
      ch.aimEnabled = false;
      ch.root.setLocalPosition(0, 0, 0);
      if (m === 'studio') {
        studio.spin = 0;
        playStudioClip(studio.clip);
        setWire(studio.wire);
      } else {
        ch.equip(null);
        ch.root.setLocalEulerAngles(0, 0, 0);
        ch.playBase('Idle', 0, 0);
        ch.anim.speed = $('opt-refanim').checked ? 1 : 0;
      }
    }
  }

  $('opt-reflight').addEventListener('change', (e) => { if (mode === 'ref') look.setRefLight(e.target.checked); });
  $('opt-refanim').addEventListener('change', (e) => { if (mode === 'ref') ch.anim.speed = e.target.checked ? 1 : 0; });

  function playStudioClip(name) {
    studio.clip = name;
    const m = ch.clipMeta[name];
    ch.equip(m.weapon || null);
    // blend only while playing: a paused transport would freeze a cross-fade half way
    ch.playBase(name, studio.playing ? 0.15 : 0, 0);
    if (m.weapon) ch.playWeaponClip(name);
    studio.hold = 0;
    ui.activeClip(name);
  }
  ui.onClip = (name) => { if (mode !== 'studio') enterMode('studio'); playStudioClip(name); };
  ui.onMode = (m) => enterMode(m);
  ui.onWeapon = (w) => { if (mode === 'play') player.equip(w); };
  ui.onTransport = (o) => {
    if (o.toggle) studio.playing = !studio.playing;
    if (o.speed) studio.speed = o.speed;
    if (o.scrub !== undefined) {
      studio.playing = false;
      const d = ch.clipMeta[studio.clip].duration;
      if (ch.base.transitioning || ch.base.activeState !== studio.clip) ch.base.transition(studio.clip, 0);
      ch.base.activeStateCurrentTime = o.scrub * d;
      if (ch.weapon && ch.weapon.entity.anim && ch.weapon.clips.has(studio.clip)) {
        const wl = ch.weapon.entity.anim.baseLayer;
        if (wl.activeState !== studio.clip) wl.transition(studio.clip, 0);
        wl.activeStateCurrentTime = o.scrub * d;
      }
    }
    if (o.turn !== undefined) studio.turn = o.turn;
    if (o.bones !== undefined) studio.bones = o.bones;
    if (o.sockets !== undefined) studio.sockets = o.sockets;
    if (o.wire !== undefined) { studio.wire = o.wire; setWire(o.wire); }
    if (o.view) {
      const v = { front: [0, 6], three: [35, 10], side: [90, 4], back: [180, 8], top: [20, 62] }[o.view];
      studio.yaw = v[0]; studio.pitch = v[1]; studio.spin = 0;
      if (studio.turn) { studio.turn = false; $('opt-turn').checked = false; }
    }
    ch.anim.speed = studio.playing ? studio.speed : 0;
    if (ch.weapon && ch.weapon.entity.anim) ch.weapon.entity.anim.speed = ch.anim.speed;
  };

  // ---------------------------------------------------------------- input
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch) { $('touch').hidden = false; document.body.classList.add('touch-on'); $('lock-hint').textContent = 'Left stick moves (push fully to run). Drag the scene to look around.'; }
  const setStyle = (st) => {
    look.setStyle(st);
    document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === st)));
  };
  document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => setStyle(b.dataset.style)));
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Backquote' && !e.repeat) { dbg.toggle(); return; }
    if (e.code === 'KeyV' && !e.repeat) { setStyle(look.style === 'comic' ? 'pbr' : 'comic'); return; }
    if (mode === 'play') {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !challenge.active) {
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault(); startChallenge(); return;
      }
      if (!e.repeat) player.keyDown(e.code);
    } else if (mode === 'studio' && e.code === 'Space') { e.preventDefault(); ui.onTransport({ toggle: true }); }
  });
  window.addEventListener('keyup', (e) => player.keyUp(e.code));
  window.addEventListener('blur', () => { player.keys.clear(); player.trigger = false; });

  let dragging = false, lastX = 0, lastY = 0, dragBtn = 0;
  // Pointer lock is optional (embedded frames and some browsers refuse it). Without it:
  // left button fires and drags to aim, right button drags to look.
  let lockFailed = false;
  const noLock = () => { lockFailed = true; $('lock-hint').innerHTML = 'Drag to aim, left button fires. Right-drag looks around.'; };
  document.addEventListener('pointerlockerror', noLock);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    canvas.focus();
    sfx.ensure();
    if (mode === 'play') {
      if (document.pointerLockElement === canvas) {
        if (e.button === 0) player.triggerDown();
        return;
      }
      if (e.button === 0) {
        if (lockFailed || !canvas.requestPointerLock) player.triggerDown();
        else {
          try {
            const r = canvas.requestPointerLock();
            if (r && r.catch) r.catch(noLock);
          } catch (err) { noLock(); }
        }
      }
    }
    dragging = true; dragBtn = e.button; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) player.triggerUp(); dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (mode === 'play' && document.pointerLockElement === canvas) { player.look(e.movementX, e.movementY); return; }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (mode === 'play') player.look(dx * 1.4, dy * 1.4);
    else if (mode === 'studio') { studio.yaw -= dx * 0.4; studio.pitch = Math.max(-20, Math.min(70, studio.pitch + dy * 0.3)); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mode === 'play') player.zoom(e.deltaY);
    else if (mode === 'studio') studio.dist = Math.max(1.6, Math.min(10, studio.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    $('lock-hint').innerHTML = locked ? 'Mouse captured. <kbd>Esc</kbd> releases it.' : 'Click the scene to aim with the mouse. <kbd>Esc</kbd> releases it.';
  });

  // touch: stick + look-drag + buttons
  if (touch) {
    const stick = $('stick'), knob = stick.querySelector('i');
    let sid = null;
    const setStick = (t) => {
      const r = stick.getBoundingClientRect();
      let x = (t.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      player.touchMove = { x, y: -y };
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); sfx.ensure(); sid = e.changedTouches[0].identifier; setStick(e.changedTouches[0]); }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) setStick(t); }, { passive: false });
    const endStick = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; player.touchMove = null; knob.style.transform = ''; } };
    stick.addEventListener('touchend', endStick); stick.addEventListener('touchcancel', endStick);
    let lid = null, lx = 0, ly = 0;
    canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; sfx.ensure(); }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lid) {
        const dx = t.clientX - lx, dy = t.clientY - ly; lx = t.clientX; ly = t.clientY;
        if (mode === 'play') player.look(dx * 1.6, dy * 1.6);
        else if (mode === 'studio') { studio.yaw -= dx * 0.5; studio.pitch = Math.max(-20, Math.min(70, studio.pitch + dy * 0.3)); }
      }
    }, { passive: true });
    const hold = (id, down, up) => {
      const b = $(id);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); sfx.ensure(); down(); }, { passive: false });
      if (up) b.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
    };
    hold('t-fire', () => { if (!player.weapon) player.equip('Pistol'); player.triggerDown(); }, () => player.triggerUp());
    hold('t-jump', () => player.jump());
    hold('t-roll', () => player.roll());
    hold('t-reload', () => player.startReload());
    hold('t-challenge', () => { if (!challenge.active) startChallenge(); });
    hold('t-weapon', () => { const i = player.weapon ? ORDER.indexOf(player.weapon) : -1; player.equip(i + 1 < ORDER.length ? ORDER[i + 1] : null); });
  }

  // ---------------------------------------------------------------- loop
  const lineCols = { mid: new pc.Color(0.9, 0.76, 0.25), L: new pc.Color(0.2, 0.77, 0.7), R: new pc.Color(0.85, 0.45, 0.55) };
  const axes = (node, s) => {
    const p = node.getPosition();
    app.drawLine(p, p.clone().add(node.right.clone().mulScalar(s)), pc.Color.RED, false);
    app.drawLine(p, p.clone().add(node.up.clone().mulScalar(s)), pc.Color.GREEN, false);
    app.drawLine(p, p.clone().sub(node.forward.clone().mulScalar(s)), pc.Color.BLUE, false);
  };

  app.on('update', (rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (view.dirty) layoutView();
    juice.update();
    if (mode === 'play') {
      ch.applyAim();
      player.update(dt);
      ch.update(dt);
      player.updateCamera(dt);
      score.update(dt);
      challenge.update(dt);
      if (view.kick !== player.fovKick) { view.kick = player.fovKick; camera.camera.camera._projMatDirty = true; }
      if (player.weapon && !player.dead && !(player.action && player.action.full)) {
        const cam = camera.camera, W = canvas.clientWidth, H = canvas.clientHeight;
        const focal = (cam.horizontalFov ? W / 2 : H / 2) / Math.tan((cam.fov + view.kick) * D2R / 2);
        const r = player.aimRay();
        const h = player.raycastWorld(r.from, r.dir, 120);
        juice.crosshair(true, Math.tan(player.currentSpread() * D2R) * focal, !!(h && h.target && (h.target.kind === 'dummy' || !h.target.dead)));
      } else juice.crosshair(false, 0, false);
    } else if (mode === 'studio') {
      ch.update(dt);
      if (studio.turn) { studio.spin += dt * 24; ch.root.setLocalEulerAngles(0, studio.spin, 0); }
      else ch.root.setLocalEulerAngles(0, studio.spin, 0);
      const m = ch.clipMeta[studio.clip];
      const t = ch.base.activeStateCurrentTime;
      if (!m.loop && studio.playing && ch.base.activeStateProgress >= 1) {
        studio.hold += dt;
        if (studio.hold > 0.6) { ch.base.activeStateCurrentTime = 0; if (m.weapon) ch.playWeaponClip(studio.clip); studio.hold = 0; }
      }
      ui.transportState(m.loop ? t % m.duration : Math.min(t, m.duration), m.duration, studio.playing);
      const yaw = studio.yaw * D2R, pitch = studio.pitch * D2R;
      look.aimStudio(studio.yaw);                         // key light rides with the studio camera
      const tgt = new pc.Vec3(0, 0.95, 0);
      const fit = view.area ? Math.min(1.8, view.area.H / Math.max(1, view.area.y1 - view.area.y0)) : 1;
      const dist = studio.dist * fit;
      camera.setPosition(tgt.x + Math.sin(yaw) * Math.cos(pitch) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(tgt);
      if (studio.bones) {
        for (const [n, b] of Object.entries(ch.bones)) {
          if (!b.parent || !ch.bones[b.parent.name] || n === 'Root' || b.parent.name === 'Root') continue;
          const col = n.endsWith('_L') ? lineCols.L : n.endsWith('_R') ? lineCols.R : lineCols.mid;
          app.drawLine(b.parent.getPosition(), b.getPosition(), col, false);
        }
      }
      if (studio.sockets) {
        axes(ch.bones.Grip_R, 0.18); axes(ch.bones.Grip_L, 0.18);
        if (ch.weapon) for (const k of ['Muzzle', 'Eject', 'Support']) if (ch.weapon.nodes[k]) axes(ch.weapon.nodes[k], 0.1);
      }
    } else if (mode === 'ref') {
      ch.update(dt);
      const yaw = refView.yaw * D2R;
      camera.setPosition(Math.sin(yaw) * refView.dist, refView.h, Math.cos(yaw) * refView.dist);
      camera.lookAt(0, 0.96, 0);
    }
    fx.update(dt);
    targets.update(dt);
    decals.update();
    if (mode === 'play' && (player.reload || player.firing)) refreshWeapon();
    dbg.update();
  });

  // small screens start with the key list folded away
  if (window.innerWidth <= 560 || window.innerHeight <= 560) {
    const b = document.querySelector('[data-collapse="panel-play"]');
    if (b && !$('panel-play').classList.contains('collapsed')) b.click();
  }

  // ---------------------------------------------------------------- go
  $('ref-over').src = assetURL('reference.png', 'image/png');
  ui.setMode('play', false);
  ui.ready();
  window.__app = { app, ch, player, ui, enterMode, studio, juice, score, challenge, targets, decals, fx, look, dbg, setStyle };
  window.__ready = true;
  const start = (location.hash || '').replace('#', '');
  if (start === 'studio' || start === 'ref') enterMode(start);
}

boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('loader-text');
  if (t) t.textContent = 'Could not start: ' + (e && e.message ? e.message : e);
  window.__err = String(e && e.stack || e);
});
