// Chainers Homestead — boot: mock login, asset loading, wiring rules <-> 3D world <-> UI.
import './ui/style.css';
import { Engine, pc } from './world/engine.js';
import { HomeWorld } from './world/home.js';
import { FrontierWorld } from './world/frontier.js';
import { Fx } from './world/fx.js';
import { Seasons } from './world/seasons.js';
import { loadAvatarData, Studio } from './world/avatar.js';
import { Game } from './game/game.js';
import { UI, ic } from './ui/ui.js';
import { Sfx } from './audio.js';
import { USER_ADJ, USER_NOUN, CLEARABLES, BUILDINGS, CROPS } from './data/config.js';
import { pick, fmtTime, fmtEth } from './core/util.js';

const canvas = document.getElementById('app');
const engine = new Engine(canvas);
const sfx = new Sfx();
engine.start();
const seasons = engine.seasons = new Seasons(engine);
engine.rig.yaw = 36; engine.rig.dist = 120; engine.rig.curDist = 120;

const randomName = () => `${pick(USER_ADJ)}${pick(USER_NOUN)}_${String(Math.floor(1000 + Math.random() * 9000))}`;
const loginEl = document.getElementById('login');
let assetsReady = false, progress = 0, pendingUser = null, name = randomName();

function renderLogin() {
  const saved = Game.listUsers().slice(0, 4);
  loginEl.innerHTML = `<div class="box">
    <div class="logo">Chainer&rsquo;s<small>HOMESTEAD</small></div>
    <p style="margin-top:14px">Build your Homestead, send squads for loot, earn ETH from the Reward Pool.</p>
    <div class="name"><b id="lg-name">${name}</b><button class="btn ghost sm" id="lg-roll" title="New random name" aria-label="New random name">Reroll</button></div>
    <button class="btn green wide" id="lg-play">${assetsReady ? 'Play' : 'Loading…'}</button>
    ${saved.length ? `<div class="tiny">Continue as</div><div class="saved">${saved.map(u => `<button class="btn ghost sm" data-user="${u}">${u}</button>`).join('')}</div>` : ''}
    <div id="loading" class="${assetsReady ? 'hide' : ''}"><div class="bar"><i id="lg-bar" style="width:${progress * 100}%"></i></div></div>
    <div class="tiny">Test login: a random player name, saved in this browser. No account, no wallet.</div>
  </div>`;
  loginEl.querySelector('#lg-roll').onclick = () => { name = randomName(); sfx.play('click'); renderLogin(); };
  loginEl.querySelector('#lg-play').onclick = () => tryStart(name);
  loginEl.querySelectorAll('[data-user]').forEach(b => { b.onclick = () => tryStart(b.dataset.user); });
}
function tryStart(user) {
  sfx.play('open');
  if (!assetsReady) { pendingUser = user; const b = loginEl.querySelector('#lg-play'); if (b) b.textContent = 'Loading…'; return; }
  start(user);
}

(async function boot() {
  let auto = null;
  try { auto = sessionStorage.getItem('chainers_user'); } catch (e) { /* ignore */ }
  if (!auto) renderLogin(); else loginEl.innerHTML = '<div class="box"><div class="logo">Chainer&rsquo;s<small>HOMESTEAD</small></div><div id="loading"><div class="bar"><i id="lg-bar" style="width:0%"></i></div></div></div>';
  await engine.loadManifest();
  await Promise.all([
    engine.loadAssets((p) => { progress = p; const bar = document.getElementById('lg-bar'); if (bar) bar.style.width = (p * 100).toFixed(0) + '%'; }),
    loadAvatarData(),
  ]);
  assetsReady = true;
  if (auto) start(auto);
  else if (pendingUser) start(pendingUser);
  else renderLogin();
})();

function start(user) {
  try { sessionStorage.setItem('chainers_user', user); } catch (e) { /* ignore */ }
  const game = new Game(user);
  game.load();
  sfx.on = game.s.settings.sfx;
  seasons.set(game.season(), true);          // the saved season is in place before the yard is built
  game.bus.on('season', (id) => seasons.set(id));
  const fx = new Fx(engine);
  fx.setLeaves(seasons.def.burst);
  seasons.onSwap(() => fx.setLeaves(seasons.def.burst));
  const home = new HomeWorld(engine, game, fx);
  const frontier = new FrontierWorld(engine, game, fx);
  const studio = new Studio(192);
  studio.load(engine.manifest.models.filter(n => n === 'chainer' || n.startsWith('acc_')));
  const ui = new UI({ game, engine, home, frontier, studio, sfx, fx });
  window.__game = { game, engine, home, frontier, ui, studio, fx, seasons, sfx };   // handy for debugging

  home.cb.sfx = (n) => sfx.play(n);
  home.cb.loot = (pos, got) => ui.flyLoot(pos, got);
  home.cb.toast = (text, cls, icon) => ui.toast(text, cls, icon);
  // sound: the season's ambience at home, the wild one on the frontier
  if (sfx.setVolume) { sfx.setVolume('ambience', game.s.settings.amb === false ? 0 : 0.5); sfx.setVolume('music', 0.3); }      // both sit well under the effects
  if (sfx.music) sfx.music(game.s.settings.music !== false);
  if (sfx.ambience) { sfx.ambience(game.season()); game.bus.on('season', (id) => { if (ui.mode === 'home') sfx.ambience(id); }); }

  engine.setCameraHome(home.origin, game.half() * 2 + 8, 58, true);
  const h = game.first('home');
  if (h) home.focusBuilding(h, 70);
  engine.rig.cur.copy(engine.rig.target); engine.rig.curDist = 150;

  engine.input.onTap = (sx, sy) => {
    if (ui.modal || ui._loot || ui._coach || ui._how) return;
    if (ui.mode === 'frontier') {
      const hit = frontier.pick(sx, sy);
      if (!hit) { if (ui.plan || ui.partyId) { ui.plan = null; ui.partyId = null; ui.renderSide(); } return; }
      if (hit.type === 'poi') ui.openPlan(hit.id); else ui.openParty(hit.id);
      return;
    }
    const hit = home.pick(sx, sy);
    if (home.place) { home.place.follow = false; if (hit && (hit.type === 'ground')) home.placeAt(hit.x, hit.z); else if (hit) { const g = engine.groundAt(sx, sy, 0); if (g) { const t = home.tileOf(g.x, g.z); home.placeAt(t.x, t.z); } } sfx.play('tick'); return; }
    if (!hit) return;
    if (hit.type === 'chainer') ui.selectChainer(hit.c.id);
    else if (hit.type === 'building') {
      const b = hit.b;
      sfx.play('click'); home.bounce(b.id);
      const now = game.now();
      if (b.type === 'farm_plot' && b.state === 'ready' && b.crop && now >= b.readyAt) { const r = game.harvest(b.id); if (!r.ok) ui.fail(r); return; }
      if (b.type === 'farm_plot' && b.state === 'ready' && !b.crop) { ui.open('crops', { id: b.id }); return; }
      ui.openCtx('building', b.id);
    } else if (hit.type === 'clearable') {
      const c = hit.c;
      if (c.by) { ui.toast('Already being cleared'); return; }
      // with a Chainer picked, that one goes; otherwise whoever is nearest
      const picked = ui.ctxPanel && ui.ctxPanel.kind === 'chainer' ? ui.ctxPanel.id : null;
      const r = game.startClear(c.id, picked);
      if (!r.ok) { if (r.locked) { ui.toast('That one is past your fence. Expand your land to reach it', '', 'item_flag'); ui.open('land'); } else ui.fail(r); return; }
      sfx.play(picked ? 'order' : 'click');
      const cv = home.cviews.get(c.id); if (cv) fx.squash(cv.m, 0.12, 0.3, c.sc);
      ui.toast(`${r.who.name} is clearing: ${CLEARABLES[c.type].name}`, '', 'item_axe');
      if (ui.ctxPanel) ui.renderCtx();
    } else ui.closeCtx();
  };

  engine.onUpdate((dt) => { game.update(dt); ui.frame(); });
  window.addEventListener('beforeunload', () => game.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

  loginEl.classList.add('out');
  setTimeout(() => { loginEl.style.display = 'none'; }, 600);

  if (game.isNew) {
    ui.celebrate({
      title: 'Welcome home!', hero: 'home_1', quiet: true, button: "Start",
      html: `<p style="max-width:400px;margin:6px auto">This land is yours. Clear it, farm it and build on it. Send squads to the Frontier for loot. Upload Crates to the <b>Reward Pool</b> to earn ETH every 30 minutes.</p><p class="muted">Next: a 1-minute tour.</p>`,
      then: () => setTimeout(() => ui.howto(() => setTimeout(() => ui.tour(), 300)), 300),
    });
  } else if (game.offlineReport && game.offlineReport.away > 120) {
    const r = game.offlineReport;
    ui.celebrate({ title: 'Welcome back!', hero: 'item_hourglass', quiet: true, text: `You were away for ${fmtTime(r.away)}. Your Homestead kept working.`, loot: r.eth > 0 ? { eth: r.eth } : null, noFly: true, button: 'Continue' });
  }
}
