// Chainers Brawl: boot, lobby, match wiring and the frame loop.
import { loadBuffer, containerFromBuffer, assetURL } from './assets.js';
import { loadTextures, decodeImage, TEXTURE_COUNT } from './textures.js';
import { Look, STYLES } from './look.js';
import { FX } from './fx.js';
import { BrawlFX } from './bfx.js';
import { Sfx } from './audio.js';
import { Arena } from './arena.js';
import { Gas } from './gas.js';
import { ArenaView } from './arenaview.js';
import { Markers } from './markers.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Game } from './game.js';
import { Lobby, portrait } from './lobby.js';
import { Avatar } from './avatar.js';
import { DebugHud } from './debug.js';
import { BRAWLERS, ROSTER, MAP_SHOWDOWN, SHOWDOWN } from './config.js';

const pc = window.pc;
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('brawl.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('brawl.' + k, v); } catch (e) { /* private mode */ } },
};

async function boot() {
  const canvas = $('gl');
  const logoURL = assetURL('brawl-logo.webp', 'image/webp');
  $('loader-logo').src = logoURL;
  $('lobby-logo').src = logoURL;
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__PRESERVE__ },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  window.addEventListener('resize', () => app.resizeCanvas());
  app.start();
  // the pixel style's render size follows the window height

  // ---------------------------------------------------------------- assets
  const files = ['clips.json', 'icons.json', 'character.glb', 'weapon_pistol.glb', 'weapon_smg.glb', 'weapon_shotgun.glb', 'weapon_launcher.glb'];
  let done = 0;
  const total = files.length + TEXTURE_COUNT + 1;
  const tick = () => {
    done++;
    $('loader-fill').style.width = Math.round(done / total * 100) + '%';
    $('loader-text').textContent = done >= total ? 'Building the arena' : `Loading ${done} of ${total}`;
  };
  const bufs = {};
  const texP = loadTextures(app, tick);
  const facesP = decodeImage('faces.png').then((f) => { tick(); return f; });
  await Promise.all(files.map(async (f) => { bufs[f] = await loadBuffer(f); tick(); }));
  const meta = JSON.parse(new TextDecoder().decode(bufs['clips.json']));
  const icons = JSON.parse(new TextDecoder().decode(bufs['icons.json']));
  const T = await texP;
  const faces = await facesP;
  const charAsset = await containerFromBuffer(app, 'character.glb', bufs['character.glb']);
  const weapons = {};
  for (const w of ['Pistol', 'SMG', 'Shotgun', 'Launcher']) weapons[w] = await containerFromBuffer(app, 'weapon_' + w.toLowerCase() + '.glb', bufs['weapon_' + w.toLowerCase() + '.glb']);
  const ctx = { charAsset, meta, weapons, T };

  // ---------------------------------------------------------------- scene
  const camera = new pc.Entity('Camera');
  camera.addComponent('camera', { clearColor: new pc.Color(0.42, 0.55, 0.3), fov: 36, nearClip: 0.3, farClip: 140 });
  app.root.addChild(camera);
  const look = new Look(app, camera);
  const arena = new Arena();
  const view = new ArenaView(app, arena, T, { stage: true });
  const fx = new FX(app, camera, T);
  look.fx = fx;
  const bfx = new BrawlFX(fx);
  const sfx = new Sfx();
  fx.onSound = (n) => sfx.play(n, 0.5);
  fx.floorAt = () => 0;
  const markers = new Markers(app);
  const hud = new Hud(app, camera);
  const input = new Input(app, canvas, camera);
  const rig = new CameraRig(app, camera, arena);
  const game = new Game({ app, ctx, arena, view, fx, bfx, sfx, markers, hud, input, rig, look });
  // the Showdown arena is built the first time it is played
  let sd = null;
  const showdownArena = () => {
    if (!sd) {
      const a = new Arena(MAP_SHOWDOWN, { boxHp: SHOWDOWN.boxHp });
      const v = new ArenaView(app, a, T, { stage: false });
      v.root.enabled = false;
      game.gas = new Gas(app, fx, a.halfW);
      sd = { arena: a, view: v };
    }
    return sd;
  };
  const dbg = new DebugHud(app, camera, { charTris: meta.character.tris, clips: meta.clips.length, weaponTris: meta.weapons.reduce((a, w) => a + (w.tris || 0), 0), bones: 17 });
  dbg.look = look;
  dbg.game = game;

  // lobby showcase: one avatar per brawler on the blue spawn pad, only the picked one shown
  const lobbyAt = new pc.Vec3(view.stageAt.x, 0.18, view.stageAt.z);
  const showcase = {};
  for (const id of ROSTER) {
    const a = new Avatar(app, ctx, id);
    app.root.addChild(a.root);
    a.root.setPosition(lobbyAt);
    a.setVisible(false);
    showcase[id] = a;
  }
  let showId = null, showT = 0;
  const showcaseOn = (id) => {
    for (const [k, a] of Object.entries(showcase)) a.setVisible(k === id);
    if (id && id !== showId) { showT = 0; showcase[id].shootT = 0; showcase[id].flourish = 0.35; }
    showId = id;
  };
  rig.lobby(lobbyAt);

  // ---------------------------------------------------------------- UI
  let mode = 'lobby';
  let gameMode = store.get('mode', 'gemgrab') === 'showdown' ? 'showdown' : 'gemgrab';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  function rot() { $('rotate-hint').hidden = true; void coarse; }
  let difficulty = store.get('diff', 'normal');
  let style = store.get('style', 'toon');
  if (!STYLES.includes(style)) style = 'toon';
  const quality = !(/Mobi|Android/i.test(navigator.userAgent));
  look.setQuality(quality ? 'high' : 'low');
  window.addEventListener('resize', () => { if (style === 'pixel') look.apply(); });
  const setStyle = (s) => {
    style = s;
    store.set('style', s);
    look.setStyle(s);
    document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === s)));
  };
  setStyle(style);
  document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => { setStyle(b.dataset.style); sfx.play('ui', 0.6); }));
  const setDiff = (d) => {
    difficulty = d;
    store.set('diff', d);
    document.querySelectorAll('[data-diff]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === d)));
  };
  setDiff(difficulty);
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { setDiff(b.dataset.diff); sfx.play('ui', 0.6); }));
  const RULES_TEXT = {
    gemgrab: 'Grab gems from the mine. Hold <b>10</b> as a team for <b>15 s</b> to win. Knocked-out brawlers drop every gem they carry.',
    showdown: 'Six Chainers, no teams, no respawns. Break <b>power boxes</b> for cubes (+10% health and damage each) and stay out of the gas. Last one standing wins.',
  };
  const setMode = (m) => {
    gameMode = m;
    store.set('mode', m);
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
    $('rules').innerHTML = RULES_TEXT[m];
    $('mode-name').textContent = m === 'showdown' ? 'Solo Showdown · 6 players · bots' : 'Gem Grab · 3 vs 3 · bots';
    $('mode-chip').classList.toggle('sd', m === 'showdown');
  };
  setMode(gameMode);
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); sfx.play('ui', 0.6); }));
  $('btn-sound').addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    $('btn-sound').textContent = 'Sound ' + (sfx.enabled ? 'on' : 'off');
    $('btn-sound').setAttribute('aria-pressed', String(sfx.enabled));
  });

  const lobby = new Lobby({
    faces, icons,
    onPick: (id, user) => { showcaseOn(id); if (user) { sfx.play('select', 0.7); store.set('pick', id); } },
    onPlay: (id) => startMatch(id),
  });
  const last = store.get('pick', 'gaptooth');
  if (BRAWLERS[last]) lobby.select(last, false);

  const vsCard = (u) => {
    const i = ROSTER.indexOf(u.brawler);
    const c = portrait(faces, i, BRAWLERS[u.brawler].hat);
    const d = document.createElement('div');
    d.className = 'vs-card';
    d.appendChild(c);
    const b = document.createElement('b'); b.textContent = u.name; d.appendChild(b);
    const s = document.createElement('small'); s.textContent = BRAWLERS[u.brawler].name; d.appendChild(s);
    return d;
  };

  function enterLobby() {
    mode = 'lobby';
    game.cleanup();
    game.phase = 'lobby';
    game.setArena(arena, view);
    arena.reset();
    view.rebuildWalls();
    input.enabled = false;
    hud.show(false);
    $('results').hidden = true;
    $('vs').hidden = true;
    $('btn-leave').hidden = true;
    lobby.show(true);
    showcaseOn(lobby.pick);
    rig.lobby(lobbyAt);
    hud.clearBanner();
    document.body.classList.remove('in-match');
    rot();
  }

  function startMatch(id) {
    sfx.ensure();
    sfx.play('select', 0.8);
    mode = 'match';
    lobby.show(false);
    showcaseOn(null);
    $('results').hidden = true;
    game.resetEnd();
    if (gameMode === 'showdown') { const s2 = showdownArena(); game.setArena(s2.arena, s2.view); } else game.setArena(arena, view);
    game.start(id, difficulty, { mode: gameMode });
    hud.show(true);
    $('btn-leave').hidden = false;
    document.body.classList.add('in-match');
    rot();
    // VS splash while the camera flies in
    const vs = $('vs');
    $('vs-blue').textContent = ''; $('vs-red').textContent = '';
    if (gameMode === 'showdown') {
      // everyone against everyone: you below, the other five above
      for (const u of game.units) (u === game.player ? $('vs-blue') : $('vs-red')).appendChild(vsCard(u));
    } else for (const u of game.units) (u.team === 0 ? $('vs-blue') : $('vs-red')).appendChild(vsCard(u));
    vs.classList.toggle('sd', gameMode === 'showdown');
    vs.classList.remove('out');
    vs.hidden = false;
    setTimeout(() => { vs.classList.add('out'); }, 1500);
    setTimeout(() => { vs.hidden = true; }, 1900);
    const hint = $('hint');
    hint.classList.remove('gone');
    clearTimeout(hint._t);
    hint._t = setTimeout(() => hint.classList.add('gone'), 12000);
    canvas.focus();
  }

  const resRow = (u, extra) => {
    const row = document.createElement('div');
    row.className = 'res-row' + (u === game.player ? ' me' : '');
    row.appendChild(portrait(faces, ROSTER.indexOf(u.brawler), BRAWLERS[u.brawler].hat));
    const n = document.createElement('div'); n.className = 'n';
    const nb = document.createElement('b'); nb.textContent = u.name; n.appendChild(nb);
    const ns = document.createElement('small'); ns.textContent = BRAWLERS[u.brawler].name; n.appendChild(ns);
    row.appendChild(n);
    for (const txt of extra) { const k = document.createElement('span'); k.className = 'k'; k.textContent = txt; row.appendChild(k); }
    return row;
  };
  game.onEnd = (res, units) => {
    const t = $('res-title');
    if (res.mode === 'showdown') {
      t.textContent = res.won ? '#1 Victory!' : `You placed #${res.rank}`;
      t.className = 'res-title ' + (res.won ? 'win' : res.rank <= 3 ? 'draw' : 'lose');
      $('res-sub').textContent = res.won ? 'Last Chainer standing' : res.rank <= 3 ? 'Top three: not bad at all' : 'The gas and five rivals: try again';
      const box = $('res-teams');
      box.textContent = '';
      const col = document.createElement('div');
      col.className = 'res-team sd';
      for (const u of units.slice().sort((a, b) => (a.rank || 1) - (b.rank || 1))) {
        const row = resRow(u, [`#${u.rank || 1}`, `${u.stats.kills} KO`, `${u.cubes} power`]);
        col.appendChild(row);
      }
      box.appendChild(col);
      $('results').hidden = false;
      hud.clearBanner();
      return;
    }
    t.textContent = res.draw ? 'Draw' : res.won ? 'Victory!' : 'Defeat';
    t.className = 'res-title ' + (res.draw ? 'draw' : res.won ? 'win' : 'lose');
    const b = game.teamGems(0), r = game.teamGems(1);
    $('res-sub').textContent = `Gems at the end: blue ${b} · red ${r}`;
    // MVP: most knockouts + gems + damage/1000
    let mvp = null, best = -1;
    for (const u of units) { const s = u.stats.kills * 2 + u.stats.gems + u.stats.damage / 1500; if (s > best) { best = s; mvp = u; } }
    const box = $('res-teams');
    box.textContent = '';
    for (const team of [0, 1]) {
      const col = document.createElement('div');
      col.className = 'res-team t' + team;
      for (const u of units.filter((x) => x.team === team)) {
        const row = document.createElement('div');
        row.className = 'res-row' + (u === game.player ? ' me' : '') + (u === mvp ? ' mvp' : '');
        row.appendChild(portrait(faces, ROSTER.indexOf(u.brawler), BRAWLERS[u.brawler].hat));
        const n = document.createElement('div'); n.className = 'n';
        const nb = document.createElement('b'); nb.textContent = u.name; n.appendChild(nb);
        const ns = document.createElement('small'); ns.textContent = BRAWLERS[u.brawler].name; n.appendChild(ns);
        row.appendChild(n);
        const k1 = document.createElement('span'); k1.className = 'k'; k1.textContent = `${u.stats.kills} KO`; row.appendChild(k1);
        const k2 = document.createElement('span'); k2.className = 'k'; k2.textContent = `${u.stats.gems} gems`; row.appendChild(k2);
        col.appendChild(row);
      }
      box.appendChild(col);
    }
    $('results').hidden = false;
    hud.clearBanner();
  };
  $('btn-again').addEventListener('click', () => startMatch(lobby.pick));
  $('btn-lobby').addEventListener('click', () => { sfx.play('ui', 0.6); enterLobby(); });
  $('btn-leave').addEventListener('click', () => { sfx.play('ui', 0.6); enterLobby(); });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && !e.repeat) { dbg.toggle(); return; }
    if (e.code === 'KeyV' && !e.repeat) { setStyle(STYLES[(STYLES.indexOf(style) + 1) % STYLES.length]); return; }
    if (mode === 'lobby' && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); startMatch(lobby.pick); }
    if (mode === 'lobby' && !e.repeat && /^Digit[1-4]$/.test(e.code)) lobby.select(ROSTER[+e.code.slice(5) - 1], true);
    if (mode === 'match' && e.code === 'Escape' && game.phase === 'end') enterLobby();
  });
  document.addEventListener('pointerdown', () => sfx.ensure(), { once: true });

  // portrait phones: suggest landscape in the lobby
  const touch = window.matchMedia('(pointer: coarse)').matches;
  window.addEventListener('resize', rot);

  // ---------------------------------------------------------------- frame loop
  let lastReal = performance.now();
  app.on('update', (dt) => {
    const now = performance.now();
    const real = Math.min(0.1, (now - lastReal) / 1000);
    lastReal = now;
    if (mode === 'lobby') {
      const a = showcase[showId];
      if (a) {
        showT += dt;
        // a quick shot when picked, then the weapon idle with a slow turn
        if (a.flourish > 0) { a.flourish -= dt; if (a.flourish <= 0) a.shoot(4); }
        a.drive(dt, 0, 0, (-16 + Math.sin(showT * 0.45) * 12) * Math.PI / 180);
        a.post(dt);
      }
      view.update(dt, [], null);
    } else {
      game.update(dt, real);
      game.post(dt);
      const st = $('stick-super');
      if (st && game.player) { st.style.setProperty('--charge', Math.min(1, game.player.superCharge).toFixed(3)); st.classList.toggle('ready', game.player.superCharge >= 1 && game.player.alive); }
    }
    rig.update(dt);
    fx.update(dt);
    markers.update(dt);
    dbg.update();
  });

  // ---------------------------------------------------------------- go
  enterLobby();
  rot();
  $('loader').classList.add('done');
  setTimeout(() => { $('loader').hidden = true; }, 600);
  window.__app = { app, game, look, fx, bfx, arena, view, rig, input, lobby, hud, setStyle, setMode, startMatch, enterLobby, showcase, markers, sfx, showdownArena };
  window.__ready = true;
}

boot().catch((e) => {
  console.error(e);
  window.__err = String(e && e.stack || e);
  const t = $('loader-text');
  if (t) t.textContent = 'Could not start: ' + (e && e.message || e);
});
