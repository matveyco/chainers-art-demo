// DOM UI core: HUD, world-anchored markers, toasts, loot flyers, modal host. Panels live in panels.js.
import { RES, HUD_RES, CRATES, RARITY, STATS, STAT_KEYS, xpForLevel, QUESTS, BUILDINGS, REGIONS, POI_TYPES, LUCKY } from '../data/config.js';
import { fmt, fmtEth, fmtTime, fmtClock, clamp, lerp } from '../core/util.js';
import { iconUrl } from '../core/assets.js';
import { SEASONS, SEASON_ORDER } from '../data/seasons.js';
import { ACTIONS, PANELS } from './panels.js';
import { FRONTIER_UI } from './frontier-ui.js';

/** A sticker icon. `alt` names a stand-in sticker used if this one is missing. */
export const ic = (name, size = 24, cls = '', alt = '') => `<img class="ic ${cls}" src="${iconUrl(name)}" width="${size}" height="${size}" alt="" draggable="false" ${alt ? `data-alt="${alt}"` : ''}>`;
// A sticker that fails to load falls back to its data-alt sticker, else hides. One listener for the whole page
// (error events do not bubble, hence capture) instead of an inline onerror on every image.
if (typeof document !== 'undefined') document.addEventListener('error', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || !/assets\/icons\//.test(t.getAttribute('src') || '')) return;
  if (t.dataset.alt) { const a = t.dataset.alt; delete t.dataset.alt; t.src = iconUrl(a); } else t.style.visibility = 'hidden';
}, true);
export const resIcon = (k) => (k === 'eth' ? 'item_eth' : CRATES[k] ? CRATES[k].icon : RES[k] ? RES[k].icon : 'item_star');
export const resName = (k) => (k === 'eth' ? 'ETH' : CRATES[k] ? CRATES[k].name : RES[k] ? RES[k].name : k);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { esc, fmt, fmtEth, fmtTime, fmtClock };

export class UI {
  constructor(ctx) {
    Object.assign(this, ctx);          // game, engine, home, exp, studio, sfx, fx
    this.root = document.getElementById('ui');
    this.root.innerHTML = `
      <div id="markers"></div>
      <div id="hud-top"></div><div id="hud-left"></div><div id="hud-track"></div><div id="hud-bottom"></div><div id="hud-right"></div>
      <div id="slot-ctx"></div><div id="slot-bar"></div><div id="slot-side"></div>
      <div id="modal-root"></div><div id="toasts"></div><div id="fly"></div>`;
    this.el = {};
    for (const id of ['markers', 'hud-top', 'hud-left', 'hud-track', 'hud-bottom', 'hud-right', 'slot-ctx', 'slot-bar', 'slot-side', 'modal-root', 'toasts', 'fly']) this.el[id] = document.getElementById(id);
    this.plan = null;                   // { id, team, approach, transport } while planning a trip
    this.partyId = null;                // the party whose sheet is open
    this.mode = 'home';
    this.modal = null; this.ctxPanel = null; this.selected = null;
    this.mk = new Map();
    this.prevRes = {};
    this.queue = [];                    // queued celebrations
    this._bindDom();
    this._bindGame();
    this.renderHud(true);
    setInterval(() => this.slowTick(), 500);
  }

  // ------------------------------------------------------------------------------------------
  // DOM events
  // ------------------------------------------------------------------------------------------
  _bindDom() {
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t || t.hasAttribute('disabled')) return;
      e.stopPropagation();
      const fn = ACTIONS[t.dataset.act];
      if (fn) { if (!t.dataset.quiet) this.sfx.play('click'); fn(this, t.dataset, t, e); }
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target.closest('[data-input]');
      if (!t) return;
      const fn = ACTIONS[t.dataset.input];
      if (fn) fn(this, t.dataset, t, e);
    });
    // never rebuild DOM under a finger: a re-render between pointerdown and pointerup would swallow the click
    const track = (e) => { this._ptr = { x: e.clientX, y: e.clientY, type: e.pointerType || 'mouse' }; };
    window.addEventListener('pointermove', track, { passive: true }); window.addEventListener('pointerdown', track, { passive: true, capture: true });
    this.root.addEventListener('pointerdown', (e) => { this._down = true; if (e.target.matches('input[type=range]')) this._sliding = true; });
    const release = () => { this._sliding = false; setTimeout(() => { this._down = false; }, 60); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // the season picker closes when you tap anywhere else
    window.addEventListener('pointerdown', (e) => {
      if (this.seasonOpen && !(e.target.closest && e.target.closest('.season-pop, [data-act="seasonMenu"]'))) { this.seasonOpen = false; this._hudDirty = true; }
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.seasonOpen) { this.seasonOpen = false; this._hudDirty = true; return; }
      if (e.key === 'Escape') { if (this._loot) return; if (this.modal) this.closeModal(); else if (this.home.place) ACTIONS.placeCancel(this, {}); else if (this.plan || this.partyId) { this.plan = null; this.partyId = null; this.renderSide(); } else this.closeCtx(); }
      if (e.key === 'r' || e.key === 'R') if (this.home.place) this.home.rotatePlace();
    });
  }
  _bindGame() {
    const bus = this.game.bus;
    bus.on('res', () => { this._hudDirty = true; this._modalDirty = true; });
    bus.on('xp', () => { this._hudDirty = true; });
    bus.on('cosy', () => { this._hudDirty = true; this._modalDirty = true; });
    bus.on('quest', (ready) => { this._hudDirty = true; if (ready) { this.sfx.play('success'); } });
    bus.on('quest:claimed', () => { this._hudDirty = true; });
    bus.on('building:change', () => { this._modalDirty = true; });
    bus.on('building:done', (b, isNew) => {
      this._hudDirty = true; this._modalDirty = true;
      const d = BUILDINGS[b.type];
      this.toast(isNew ? `${d.name} built!` : `${d.name} is now level ${b.level}!`, 'good', d.icon);
    });
    bus.on('chainer:change', () => { this._modalDirty = true; this._hudDirty = true; });
    bus.on('levelup', (lvl, reward) => this.celebrate({ title: `Level ${lvl}!`, hero: 'item_star', text: 'Your homestead grows. A little gift from the Council:', loot: reward, sfx: 'levelup' }));
    bus.on('guest:arrive', (c) => { this._hudDirty = true; this.toast(`${c.name}, a ${RARITY[c.rarity].name} Wanderer, has arrived!`, c.rarity === 'common' ? '' : 'good', 'item_flag'); });
    bus.on('chainer:leave', (c, how, gift) => {
      this._hudDirty = true; this._modalDirty = true;
      if (how === 'thanks') this.toast(`${c.name} moved on and left a thank-you gift`, 'good', resIcon(Object.keys(gift)[0]));
      else if (how === 'hungry') this.toast(`${c.name} left hungry… cosiness dropped`, 'bad', 'item_heart');
      else this.toast(`${c.name} was sent away. Cosiness dropped a little`, 'bad', 'item_heart');
    });
    bus.on('chainer:levelup', (c) => this.toast(`${c.name} reached level ${c.level}!`, 'good', 'item_star'));
    bus.on('chainer:trained', (c, stat) => this.toast(`${c.name} trained ${STATS[stat].name} +1`, 'good', STATS[stat].icon));
    bus.on('hungry', (h) => { this._hudDirty = true; if (h) this.toast('Out of Biopoints! Your Chainers are hungry and weaker', 'bad', 'res_bio'); });
    for (const ev of ['exp:launch', 'exp:claimed', 'exp:change', 'building:done', 'pois']) bus.on(ev, () => { this._hudDirty = true; this._sideDirty = true; if (this.mode === 'frontier') this.renderExpBar(); });
    bus.on('exp:back', (e) => { this._hudDirty = true; this._sideDirty = true; this.toast(`The party is back from ${POI_TYPES[e.poi.type].name}. Open the chest!`, 'good', 'item_chest'); this.sfx.play('return'); });
    bus.on('exp:phase', (e, ph) => { this._hudDirty = true; this._sideDirty = true; if (ph === 'work') this.toast(`The party reached ${POI_TYPES[e.poi.type].name}`, '', 'item_compass'); });
    bus.on('upgrade', () => { this._hudDirty = true; this._modalDirty = true; });
    bus.on('auto', () => { this._modalDirty = true; });
    bus.on('season', () => { this._hudDirty = true; });
    bus.on('pool:payout', (rec) => {
      this.celebrate({ title: 'Pool paid out!', titleCls: 'eth', hero: 'item_eth', text: `Your ${fmt(rec.points)} points were ${(rec.points / rec.total * 100).toFixed(1)}% of the round.`, loot: { eth: rec.eth }, sfx: 'payout' });
      this._hudDirty = true;
    });
    bus.on('pool:deposit', (pts) => { this.toast(`+${fmt(pts)} pool points uploaded`, 'eth', 'item_eth'); this.sfx.play('coin'); });
    bus.on('exchange:tick', () => { this._modalDirty = true; });
    bus.on('pois', () => { this._modalDirty = true; });
  }
  slowTick() {
    this._hudDirty = true;
    if (this.modal && this.modal.live) this._modalDirty = true;
    if (this.ctxPanel) this.renderCtx();
    if (this.plan || this.partyId) this._sideDirty = true;
  }

  // ------------------------------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------------------------------
  frame() {
    if (this.root.scrollLeft || this.root.scrollTop) { this.root.scrollLeft = 0; this.root.scrollTop = 0; }
    if (this._down) { this.syncMarkers(); this._syncPlacePin(); return; }
    if (this._hudDirty) { this._hudDirty = false; this.renderHud(); }
    if (this._modalDirty && this.modal && !this._sliding) { this._modalDirty = false; this.refreshModal(); }
    if (this._sideDirty) { this._sideDirty = false; this.renderSide(); }
    this.syncMarkers();
    this._syncPlacePin();
    if (!this.modal && this.queue.length && !this._celebrating && !this._loot && !this._coach && !this._how) this._showCelebration(this.queue.shift());
  }

  // ------------------------------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------------------------------
  renderHud(first = false) {
    const g = this.game, s = g.s, home = this.mode === 'home';
    const cosy = g.cosy(), tier = g.cosyTier(cosy), next = g.cosyNext(cosy);
    const xpMax = xpForLevel(s.level);
    // --- what you carry: one paper pill + the ETH pill -------------------------------------
    let chips = '';
    for (const k of HUD_RES) {
      const v = Math.floor(s.res[k] || 0), cap = g.capOf(k);
      const main = k === 'wood' || k === 'stone' || k === 'bio';
      if (!main && !v && !this.prevRes['seen_' + k]) continue;
      this.prevRes['seen_' + k] = true;
      chips += `<div class="chip ${main ? '' : 'extra'} ${v >= cap ? 'full' : ''} ${k === 'bio' && s.hungry ? 'low' : ''}" id="chip-${k}" title="${RES[k].name}: ${v} / ${cap}">${ic(RES[k].icon, 30)}<span>${fmt(v)}</span>${main ? `<small>/${fmt(cap)}</small>` : ''}</div>`;
    }
    const crates = s.crates.crate1 + s.crates.crate2 + s.crates.crate3;
    if (crates) chips += `<div class="chip" id="chip-crate" title="Crates ready for the Reward Pool">${ic('item_crate_1', 30)}<span>${crates}</span></div>`;
    const res = `<div class="res-wrap"><div class="respill" data-act="open" data-panel="storage" role="button" aria-label="Storage">${chips}</div>
      <div class="chip eth" id="chip-eth" data-act="open" data-panel="pool" role="button" title="ETH — earned only from the Reward Pool">${ic('item_eth', 30)}<span>${fmtEth(s.eth, 5)}</span><small>ETH</small></div></div>`;
    // --- sticker navigation --------------------------------------------------------------------
    const hungryGuests = g.guests().filter(c => !c.fed).length;
    const now = g.now();
    const back = s.expeditions.filter(e => now >= e.endAt).length;
    const q = g.quest(), pr = q ? g.questProgress(q) : null;
    const ONERR = '';
    const sb = (attrs, icon, label, n = 0, cls = '', aria = label, alt = '') => `<button class="sbtn ${cls}" ${attrs} aria-label="${aria}"><img src="${iconUrl(icon)}" alt="" draggable="false" ${alt ? `data-alt="${alt}"` : ''} ${ONERR}><span class="lb">${label}</span>${n ? `<span class="dot">${n}</span>` : ''}${cls.includes('locked') ? `<span class="lock">${ic('item_lock', 26)}</span>` : ''}</button>`;
    // the season switcher: a sticker of the current season that opens the four-season picker
    const cur = g.season(), sn = SEASONS[cur];
    const pop = this.seasonOpen ? `<div class="season-pop" role="radiogroup" aria-label="Season">
        <div class="sp-row">${SEASON_ORDER.map((id) => `<button class="sp ${id} ${id === cur ? 'on' : ''}" data-act="season" data-id="${id}" role="radio" aria-checked="${id === cur}"><img src="${iconUrl(SEASONS[id].icon)}" alt="" draggable="false"><b>${SEASONS[id].name}</b></button>`).join('')}</div>
        <div class="sp-d">${sn.blurb}</div></div>` : '';
    const seasonBtn = sb(`data-act="seasonMenu" aria-haspopup="true" aria-expanded="${!!this.seasonOpen}"`, sn.icon, sn.name, 0, this.seasonOpen ? 'open' : '', `Season: ${sn.name}`);
    // the Reward Pool and the Exchange belong to the whole world: you reach them through your own building
    const hasPool = !!g.first('pool_shrine'), hasEx = !!g.first('exchange');
    const left = home
      ? sb('data-act="open" data-panel="roster"', 'ui_chainers', 'Chainers', hungryGuests)
        + sb('data-act="open" data-panel="level"', 'ui_goals', 'Goals', pr && pr.done ? '!' : 0)
        + sb('data-act="open" data-panel="supply"', 'ui_supply', 'Supply', 0, '', 'Supply lines', 'ui_storage')
        + sb('data-act="open" data-panel="pool"', 'ui_pool', 'Pool', hasPool ? crates : 0, hasPool ? '' : 'locked', hasPool ? 'World Reward Pool' : 'World Reward Pool, build a Pool Shrine to reach it')
        + sb('data-act="open" data-panel="exchange"', 'ui_exchange', 'Trade', 0, hasEx ? '' : 'locked', hasEx ? 'World Exchange' : 'World Exchange, build a Trading Post to reach it')
      : sb('data-act="goHome"', 'item_house', 'Home', 0, '', 'Back to the homestead', 'ui_storage');
    const snd = !!s.settings.sfx;
    const soundBtn = sb(`data-act="sound" aria-pressed="${snd}"`, snd ? 'ui_sound_on' : 'ui_sound_off', snd ? 'Sound' : 'Muted', 0, snd ? '' : 'muted', snd ? 'Sound is on. Tap to mute' : 'Sound is off. Tap to turn it on');
    const right = soundBtn + seasonBtn + (home ? sb('data-act="open" data-panel="storage"', 'ui_storage', 'Storage', 0, 'opt') : '')
      + sb('data-act="open" data-panel="settings"', 'ui_settings', 'Settings', 0, home ? '' : 'opt');
    this._set('hud-top', `<nav class="snav" aria-label="Main">${left}</nav>${res}<nav class="snav world" aria-label="World">${right}${pop}</nav>`);
    // animate resource changes
    for (const k of [...HUD_RES, 'eth']) {
      const v = k === 'eth' ? s.eth : Math.floor(s.res[k] || 0);
      const p = this.prevRes[k];
      if (p !== undefined && Math.abs(v - p) > (k === 'eth' ? 1e-9 : 0.5) && !first) {
        const el = document.getElementById('chip-' + k);
        if (el) { el.classList.add('bump'); const d = v - p; el.insertAdjacentHTML('beforeend', `<span class="delta ${d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${k === 'eth' ? fmtEth(d, 6) : fmt(Math.abs(d)) === '0' ? '' : (d < 0 ? '-' : '') + fmt(Math.abs(d))}</span>`); }
      }
      this.prevRes[k] = v;
    }
    // --- goal card + alerts --------------------------------------------------------------------
    let side = '';
    if (q && home) {
      side += `<button class="quest ${pr.done ? 'ready' : ''}" data-act="quest">
        <div class="t"><span>${pr.done ? 'Goal complete. Tap to claim' : `Goal ${s.quest.idx + 1} / ${QUESTS.length}`}</span>${pr.done ? '' : `<i>${fmt(pr.cur)} / ${fmt(pr.max)}</i>`}</div>
        <div class="d">${esc(q.text)}</div>
        <div class="bar ${pr.done ? 'green' : ''}"><i style="width:${pr.cur / pr.max * 100}%"></i></div>
        <div class="rw"><small>Reward</small>${Object.entries(q.reward).map(([k, v]) => `<span>${ic(resIcon(k), 22)}${fmt(v)}</span>`).join('')}<em>${pr.done ? 'Claim' : 'Show me'}</em></div>
      </button>`;
    }
    if (s.hungry && home) side += `<button class="mini alert" data-act="hint" data-hint="farm">${ic('res_bio', 26)}<span><b>Hungry Chainers!</b> Harvest crops for Biopoints</span></button>`;
    this._set('hud-left', side);
    // --- parties on the frontier: always in sight ------------------------------------------------
    this._set('hud-track', FRONTIER_UI.tracker(this));
    // --- you + cosiness (bottom-left), the hammer (bottom-right) -------------------------------
    this._set('hud-bottom', home ? `
      <button class="player" data-act="open" data-panel="level" aria-label="Homestead level ${s.level}. What to do next">
        <div class="lvl"><small>Lv</small>${s.level}</div>
        <div><div class="nm">${esc(s.user)}</div><div class="bar green xp"><i style="width:${clamp(s.xp / xpMax * 100, 0, 100)}%"></i></div><div class="xpn">${fmt(Math.floor(s.xp))} / ${fmt(xpMax)} XP</div></div>
      </button>
      <button class="cosy" data-act="open" data-panel="cosy" aria-label="Cosiness ${cosy}, ${tier.name}">
        ${ic('ui_cosy', 40)}
        <div><small>${tier.name}</small><b>${cosy}</b><div class="bar pink"><i style="width:${next ? clamp((cosy - tier.min) / (next.min - tier.min) * 100, 0, 100) : 100}%"></i></div></div>
      </button>` : '');
    const wantBuild = q && !pr.done && /^build:/.test(q.hint || '') && !g.byType((q.hint || '').slice(6), false).length;
    // the two verbs of the game, always under the thumb: explore (loot and resources) and build
    const lodge = !!g.lodge(), wantFr = q && !pr.done && /frontier|exped/.test(q.hint || '');
    this._set('hud-right', home ? `<div class="tools">
      <button class="tool fr ${lodge ? '' : 'locked'} ${back || wantFr ? 'nudge' : ''}" data-act="expeditions" aria-label="${lodge ? `Frontier: send a party for loot and resources${back ? `. ${back} chest waiting` : ''}` : 'Frontier, build the Expedition Lodge to open it'}">
        ${ic('ui_expeditions', 54, '', 'item_compass')}<span>Frontier</span><small>${back ? 'Chest waiting!' : lodge ? 'Loot & resources' : 'Build the Lodge'}</small>${back ? `<i class="dot">${back}</i>` : ''}${lodge ? '' : `<i class="lock">${ic('item_lock', 22)}</i>`}</button>
      <button class="tool ${wantBuild ? 'nudge' : ''}" data-act="open" data-panel="build" aria-label="Build">
        ${ic('ui_build', 54, '', 'item_hammer')}<span>Build</span><small>Buildings & decor</small></button></div>` : '');
    this.root.classList.toggle('has-side', !!(this.plan || this.partyId));
  }
  _set(id, html) {
    this._html = this._html || {};
    if (this._html[id] === html) return false;
    this._html[id] = html;
    this.el[id].innerHTML = html;
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // markers
  // ------------------------------------------------------------------------------------------
  syncMarkers() {
    const list = this.mode === 'home' ? this.home.markers() : this.frontier.markers();
    const seen = new Set();
    const hide = !!this.modal || !!this._celebrating;
    for (const m of list) {
      seen.add(m.key);
      let n = this.mk.get(m.key);
      const sig = this._mkSig(m);
      if (!n) {
        n = { el: document.createElement('div'), sig: '' };
        this.el.markers.appendChild(n.el);
        this.mk.set(m.key, n);
      }
      if (n.sig !== sig) { n.sig = sig; n.el.className = 'mk ' + m.kind + (m.bounce ? ' bounce' : '') + (m.alert ? ' alert' : '') + (m.pulse ? ' pulse' : '') + (m.small ? ' small' : '') + (m.up ? ' up' : '') + (m.sel ? ' sel' : '') + (m.phase ? ' ' + m.phase : ''); n.el.innerHTML = this._mkHtml(m); }
      else if (m.kind === 'timer' || m.kind === 'pool' || m.kind === 'poi' || m.kind === 'party' || m.kind === 'tag') this._mkLive(n.el, m);
      const p = this.engine.toScreen(m.x, m.y, m.z);
      if (!p || hide) { n.el.style.display = 'none'; continue; }
      n.el.style.display = '';
      n.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      n.el.style.zIndex = String(Math.round(p.y));
    }
    for (const [k, n] of this.mk) if (!seen.has(k)) { n.el.remove(); this.mk.delete(k); }
  }
  _mkSig(m) {
    if (m.kind === 'action') return `a|${m.icon}|${m.label || ''}|${m.act}|${m.up ? 1 : 0}`;
    if (m.kind === 'timer') return `t|${m.icon}|${m.noBar ? 1 : 0}|${m.help ? 1 : 0}`;
    if (m.kind === 'tag') return `g|${m.text}|${m.mood}|${m.owned ? 1 : 0}|${m.level}|${m.sel ? 1 : 0}|${m.hungry ? 1 : 0}`;
    if (m.kind === 'lvl') return `l|${m.level}|${m.max ? 1 : 0}`;
    if (m.kind === 'poi') return FRONTIER_UI.pinSig(this, m);
    if (m.kind === 'party') return FRONTIER_UI.partySig(this, m);
    if (m.kind === 'zone') return `z|${m.reg.id}|${m.open ? 1 : 0}`;
    return m.kind;
  }
  _mkHtml(m) {
    if (m.kind === 'action') return `<div class="in"><div class="bub" data-act="marker" data-m="${m.act}" data-id="${m.id}" data-quiet="1">${ic(m.icon, 38, '', m.alt || '')}</div>${m.label ? `<span class="lab">${m.label}</span>` : ''}</div>`;
    if (m.kind === 'timer') return `<div class="in"><div class="pill">${ic(m.icon, 20)}<span class="tm">${fmtTime(m.left)}</span>${m.help ? ic('tool_hammer', 16, '', 'item_hammer') : ''}</div>${m.noBar ? '' : `<div class="tb"><i style="width:${(m.p * 100).toFixed(0)}%"></i></div>`}</div>`;
    if (m.kind === 'tag') {
      // yours: navy with the level. A visitor: cream, edged in the colour of their rarity, and how long they stay
      return m.owned
        ? `<div class="in"><button class="pill own" data-act="marker" data-m="chainer" data-id="${m.id}" data-quiet="1"><b>${esc(m.text)}</b><i>Lv ${m.level}</i></button></div>`
        : `<div class="in"><button class="pill guest ${m.hungry ? 'hungry' : ''}" style="--rc:${RARITY[m.rarity].color}" data-act="marker" data-m="chainer" data-id="${m.id}" data-quiet="1">${m.mood === 'delighted' ? ic('item_heart', 14) : ''}<b>${esc(m.text)}</b><i>${m.hungry ? 'Hungry' : 'Wanderer'}</i><span class="tm">${fmtTime(m.left)}</span></button></div>`;
    }
    if (m.kind === 'lvl') return `<div class="in"><span class="lvp ${m.max ? 'max' : ''}">Lv ${m.level}</span></div>`;
    if (m.kind === 'pool') return `<div class="in"><div class="pill" data-act="open" data-panel="pool">${ic('item_eth', 24)}<span class="tm">${fmtClock(m.left)}</span></div></div>`;
    if (m.kind === 'poi') return FRONTIER_UI.pin(this, m);
    if (m.kind === 'party') return FRONTIER_UI.partyPin(this, m);
    if (m.kind === 'zone') return FRONTIER_UI.zonePin(this, m);
    return '';
  }
  _mkLive(el, m) {
    const tm = el.querySelector('.tm');
    if (tm) { const txt = m.kind === 'pool' ? fmtClock(m.left) : m.kind === 'poi' ? 'closes ' + fmtTime(m.left) : fmtTime(m.left); if (tm.textContent !== txt) tm.textContent = txt; }
    const bar = el.querySelector('.tb i');
    if (bar && m.p !== undefined) bar.style.width = (m.p * 100).toFixed(0) + '%';
  }
  /** One short line on what a Chainer is doing. */
  statusOf(c) {
    const g = this.game, now = g.now();
    switch (c.status) {
      case 'expedition': { const e = g.s.expeditions.find(x => x.id === c.expId); return e ? `On the frontier: ${POI_TYPES[e.poi.type].name}` : 'On the frontier'; }
      case 'rest': return `Resting ${fmtTime(c.restUntil - now)}`;
      case 'job': { const b = g.building(c.jobAt); return `Working at the ${b ? BUILDINGS[b.type].name : 'job'}`; }
      case 'build': { const b = g.building(c.jobAt); return `Helping build the ${b ? BUILDINGS[b.type].name : 'site'}`; }
      case 'clearing': return 'Clearing land';
      case 'train': return `Training ${fmtTime(c.busyUntil - now)}`;
      default: return c.owned || c.fed ? 'Idle. Waiting for orders' : 'Hungry. Feed them or they leave';
    }
  }

  // ------------------------------------------------------------------------------------------
  // toasts, flyers, celebrations
  // ------------------------------------------------------------------------------------------
  toast(text, cls = '', icon = null) {
    const t = document.createElement('div');
    t.className = 'toast ' + cls;
    t.innerHTML = (icon ? ic(icon, 24) : '') + `<span>${esc(text)}</span>`;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 3100);
    if (cls === 'bad') this.sfx.play('error');
  }
  fail(res) { if (res && res.why) this.toast(res.why, 'bad'); else this.sfx.play('error'); }
  /** Icons fly from a world position (or screen point) into the HUD counters. */
  flyLoot(pos, got, screen = false) {
    const from = screen ? pos : this.engine.toScreen(pos.x, pos.y, pos.z);
    if (!from) return;
    let i = 0;
    for (const k in got) {
      if (k.startsWith('_') || !got[k]) continue;
      const amount = got[k];
      let target = document.getElementById(CRATES[k] ? 'chip-crate' : 'chip-' + k);
      if (!target || !target.offsetParent) target = document.querySelector('.respill') || document.getElementById('chip-eth');   // hidden on narrow screens: fly to the pill
      const tr = target ? target.getBoundingClientRect() : { left: window.innerWidth - 80, top: 20, width: 30, height: 30 };
      const n = clamp(Math.ceil(Math.log2(amount + 1)), 1, 7);
      const num = document.createElement('div');
      num.className = 'pop-num';
      num.style.left = (from.x + (i - (Object.keys(got).length - 1) / 2) * 54) + 'px'; num.style.top = (from.y - 10 - i * 4) + 'px';
      num.innerHTML = `${ic(resIcon(k), 22)}+${k === 'eth' ? fmtEth(amount, 6) : fmt(amount)}`;
      this.el.fly.appendChild(num);
      setTimeout(() => num.remove(), 1150);
      for (let j = 0; j < n; j++) {
        const f = document.createElement('div');
        f.className = 'flyer';
        f.innerHTML = `<img src="${iconUrl(resIcon(k))}" alt="">`;
        this.el.fly.appendChild(f);
        const sx = from.x - 17 + (Math.random() - 0.5) * 50, sy = from.y - 17 + (Math.random() - 0.5) * 36;
        const ex = tr.left + 4, ey = tr.top + tr.height / 2 - 17;
        const cx = lerp(sx, ex, 0.4) + (Math.random() - 0.5) * 160, cy = Math.min(sy, ey) - 80 - Math.random() * 90;
        const delay = 140 + j * 70 + i * 90, dur = 620 + Math.random() * 180;
        const t0 = performance.now() + delay;
        f.style.transform = `translate(${sx}px, ${sy}px) scale(0)`;
        const step = (now) => {
          let t = (now - t0) / dur;
          if (t < 0) { f.style.transform = `translate(${sx}px, ${sy}px) scale(${clamp(1 + t * 4, 0, 1)})`; requestAnimationFrame(step); return; }
          if (t >= 1) { f.remove(); if (target) { target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); } if (j === 0) this.sfx.play('coin'); return; }
          const e = t * t * (3 - 2 * t);
          const x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * ex, y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * ey;
          f.style.transform = `translate(${x}px, ${y}px) scale(${1 - e * 0.35}) rotate(${e * 200}deg)`;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      i++;
    }
    if (got._full) this.toast('Storage is full — some was left behind. Upgrade your Warehouse or Granary', 'bad');
  }
  /** A paper ribbon that names the new season while the world turns. */
  seasonBanner(id) {
    const S = SEASONS[id];
    const old = document.getElementById('season-banner');
    if (old) old.remove();
    const b = document.createElement('div');
    b.id = 'season-banner'; b.className = id;
    b.setAttribute('role', 'status');
    b.innerHTML = `<img src="${iconUrl(S.icon)}" alt="" draggable="false"><div><small>The season turns</small><b>${S.name}</b></div>`;
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 2700);
  }
  celebrate(c) { this.queue.push(c); }
  _showCelebration(c) {
    this._celebrating = true;
    const d = document.createElement('div');
    d.className = 'celebrate';
    const loot = c.loot ? `<div class="gifts">${Object.entries(c.loot).filter(([k, v]) => v && !k.startsWith('_')).map(([k, v], i) => `<div class="it" style="animation-delay:${0.25 + i * 0.09}s">${ic(resIcon(k), 40)}${k === 'eth' ? fmtEth(v, 6) : '+' + fmt(v)}</div>`).join('')}</div>` : '';
    d.innerHTML = `<div class="card"><div class="rays"></div>${c.hero ? `<div class="hero">${c.heroImg ? `<img src="${c.heroImg}">` : ic(c.hero, 120, '', c.heroAlt || '')}</div>` : ''}
      <h1 class="${c.titleCls || ''}">${esc(c.title)}</h1>${c.text ? `<p>${esc(c.text)}</p>` : ''}${c.html || ''}${loot}
      <button class="btn green" data-act="celebrateOk">${c.button || 'Awesome!'}</button></div>`;
    this.root.appendChild(d);
    this._celeb = { el: d, c };
    this.sfx.play(c.sfx || 'success');
    const cx = this.engine.rig.cur;
    if (!c.quiet) this.fx.burst('confetti', cx.x, cx.y + 3, cx.z, 40, 1.8);
  }
  closeCelebration() {
    const c = this._celeb;
    if (!c) return;
    const r = c.el.querySelector('.card').getBoundingClientRect();
    if (c.c.loot && !c.c.noFly) this.flyLoot({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, c.c.loot, true);
    c.el.remove();
    this._celeb = null; this._celebrating = false;
    if (c.c.then) c.c.then();
  }

  // ------------------------------------------------------------------------------------------
  // modal + context card
  // ------------------------------------------------------------------------------------------
  open(name, args = {}) {
    const P = PANELS[name];
    if (!P) return;
    if (P.guard) { const why = P.guard(this, args); if (why) { if (typeof why === 'object') this.open(why.redirect, why.args); else this.toast(why, 'bad'); return; } }
    this.closeCtx();
    this.modal = { name, args, state: (this.modal && this.modal.name === name ? this.modal.state : {}) || {}, live: P.live !== false };
    const root = this.el['modal-root'];
    root.innerHTML = `<div class="scrim" data-act="closeModal" data-quiet="1"></div><div class="panel ${P.cls || ''}" id="panel"></div>`;
    this.refreshModal(true);
    this.sfx.play('open');
  }
  refreshModal(first = false) {
    if (!this.modal) return;
    const P = PANELS[this.modal.name], el = document.getElementById('panel');
    if (!el) return;
    const body = el.querySelector('.body');
    const scroll = body ? body.scrollTop : 0;
    const html = P.render(this, this.modal.args, this.modal.state);
    if (html === null) { this.closeModal(); return; }
    if (!first && html === this.modal.html) return;
    this.modal.html = html;
    el.innerHTML = html;
    const nb = el.querySelector('.body');
    if (nb && !first) nb.scrollTop = scroll;
  }
  closeModal() {
    if (!this.modal) return;
    this.modal = null;
    this.el['modal-root'].innerHTML = '';
    this.sfx.play('close');
  }
  openCtx(kind, id) {
    this.ctxPanel = { kind, id };
    this.home.select(kind === 'chainer' ? id : null);
    this._chrome(false);
    this.renderCtx(true);
  }
  /** Pick a Chainer in the world: their card with everything you can tell them to do. */
  selectChainer(id) {
    const c = this.game.chainer(id);
    if (!c) return;
    if (this.mode !== 'home') return;
    this.closeModal();
    this.sfx.play('select');
    if (c.status !== 'expedition') this.home.focusChainer(c);
    this.openCtx('chainer', id);
  }
  renderCtx(first = false) {
    if (!this.ctxPanel) return;
    const html = PANELS.ctx(this, this.ctxPanel);
    if (!html) { this.closeCtx(); return; }
    if ((this._ctxHtml === html || this._down) && !first) return;
    this._ctxHtml = html;
    this.el['slot-ctx'].innerHTML = `<div id="ctx" class="${this.ctxPanel.kind}" ${first ? '' : 'style="animation:none"'}>${html}</div>`;
  }
  closeCtx() { if (this.ctxPanel && !this.home.place) this._chrome(true); this.ctxPanel = null; this._ctxHtml = ''; this.el['slot-ctx'].innerHTML = ''; this.home.select(null); }
  setBar(html) { this.el['slot-bar'].innerHTML = html || ''; }

  // ------------------------------------------------------------------------------------------
  // placement mode + expedition mode
  // ------------------------------------------------------------------------------------------
  beginPlacement(type, moveId) {
    const d = BUILDINGS[type];
    this.closeCtx();
    this.home.beginPlace(type, moveId, this._ptr);
    this.setBar(`<div id="placebar">${ic(d.icon, 40, '', d.alt || '')}<div><b>${moveId ? 'Moving the' : 'Placing the'} ${d.name}</b><div class="muted">${this.home.place && this.home.place.follow ? 'Move the mouse, click to set it down' : 'Drag it, or tap the ground'}</div></div></div>`);
    this._ppSig = null;
    this._chrome(false);
  }
  endPlacement() { this.setBar(''); this._chrome(true); this._hudDirty = true; this._syncPlacePin(); }
  /** The Build here pill: it lives on the site, right above the ghost, and follows it. */
  _syncPlacePin() {
    const p = this.home.place;
    let el = this._pp;
    if (!p || this.mode !== 'home') { if (el) { el.remove(); this._pp = null; } return; }
    if (!el) { el = this._pp = document.createElement('div'); el.id = 'placepin'; this.root.appendChild(el); this._ppSig = null; }
    const cost = p.moveId ? null : this.game.cost(p.type, 1);
    const sig = `${p.type}|${p.moveId || ''}|${p.ok ? 1 : 0}|${p.why || ''}|${p.follow ? 1 : 0}`;
    if (sig !== this._ppSig) {
      this._ppSig = sig;
      el.className = (p.ok ? 'ok' : 'no') + (p.follow ? ' follow' : '');
      const ROT = '<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3v5h-5"/></svg>';
      const X = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      el.innerHTML = p.follow
        ? `<div class="pp-in hint">${p.ok ? 'Click to set it down' : esc(p.why || 'Not here')}</div>`
        : `<div class="pp-in"><button class="pp-b" data-act="placeRotate" aria-label="Rotate">${ic('item_rotate', 34)}<span class="fb">${ROT}</span></button>
            <button class="pp-go" data-act="placeConfirm" ${p.ok ? '' : 'disabled'}>${p.ok ? `<b>${ic('item_check', 26)}${p.moveId ? 'Move here' : 'Build here'}</b>${cost ? this.costHtml(cost, { noTime: true }) : ''}` : `<b>Can't build here</b><small>${esc(p.why || 'Something is in the way')}</small>`}</button>
            <button class="pp-b x2" data-act="placeCancel" aria-label="Cancel">${ic('item_cancel', 34)}<span class="fb">${X}</span></button></div>`;
    }
    const a = this.home.placeAnchor();
    const top = this.engine.toScreen(a.x, a.y, a.z), foot = this.engine.toScreen(a.x, a.y0, a.z);
    if (!top) { el.style.display = 'none'; return; }
    el.style.display = '';
    const w = el.offsetWidth || 260, h = el.offsetHeight || 64, vw = innerWidth, vh = innerHeight;
    const x = clamp(top.x - w / 2, 8, vw - w - 8);
    let y = top.y - h - 10;
    if (y < 96) y = Math.min(vh - h - 84, (foot ? foot.y : top.y) + 46);      // no room above (the HUD is there): sit under the site instead
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  /** Show / hide the bottom corners (you, cosiness, hammer) while a card or the placement bar needs the room. */
  _chrome(on) {
    this.el['hud-bottom'].style.display = on ? '' : 'none'; this.el['hud-right'].style.display = on ? '' : 'none';
    // while placing, the goal card and the party tracker step aside too: on a phone they sit right where the site is
    const placing = !on && !!this.home.place;
    this.el['hud-left'].style.display = placing ? 'none' : ''; this.el['hud-track'].style.display = placing ? 'none' : '';
  }
  _wipe(fn) {
    let w = document.getElementById('cloudwipe');
    if (!w) { w = document.createElement('div'); w.id = 'cloudwipe'; document.body.appendChild(w); }
    w.classList.add('on');
    this.sfx.play('whoosh');
    setTimeout(() => { fn(); setTimeout(() => w.classList.remove('on'), 260); }, 330);
  }
  enterFrontier(then) {
    if (this.home.place) { this.home.cancelPlace(); this.endPlacement(); }
    this.closeCtx(); this.closeModal();
    if (this.mode === 'frontier') { if (then) then(); return; }
    this._wipe(() => {
      this.mode = 'frontier';
      this.home.active = false;
      this.frontier.show();
      const r = this.engine.rig; r.cur.copy(r.target); r.curDist = r.dist + 26;
      if (then) { then(); r.cur.copy(r.target); }
      this.renderExpBar();
      this.renderHud();
      if (this.sfx.ambience) this.sfx.ambience('frontier');
    });
  }
  exitFrontier() {
    this.closeModal();
    this.plan = null; this.partyId = null; this.renderSide();
    this._wipe(() => {
      this.mode = 'home';
      this.frontier.hide();
      this.home.active = true;
      this.engine.setCameraHome(this.home.origin, this.game.half() * 2 + 8, 58, true);
      const g = this.home.gateSpot();
      this.engine.focus(g.x, g.z - 8, 62);
      this.engine.rig.cur.copy(this.engine.rig.target); this.engine.rig.curDist = 96;
      this.setBar('');
      this.renderHud();
      if (this.sfx.ambience) this.sfx.ambience(this.game.season());
    });
  }
  renderExpBar() {
    const g = this.game;
    this.setBar(`<div id="expbar"><div class="rtabs" role="group" aria-label="Zones">
      ${REGIONS.map(r => `<button class="rtab ${g.regionOpen(r) ? '' : 'lock'}" data-act="zone" data-id="${r.id}">${g.regionOpen(r) ? '' : ic('item_lock', 16)}<span><b>${r.name}</b><small>${g.regionOpen(r) ? `${g.s.pois[r.id].length} places open` : `Lodge level ${r.dock}`}</small></span></button>`).join('')}</div>
      <span class="out">${ic('item_compass', 24)} ${g.s.expeditions.length} / ${g.parallelMax()} parties out</span></div>`);
  }
  // ---- the two side sheets of the frontier: plan a trip, follow a party ---------------------------
  renderSide() {
    const g = this.game;
    if (this.plan && !g.findPoi(this.plan.id)) this.plan = null;
    if (this.partyId && !g.s.expeditions.some(e => e.id === this.partyId)) this.partyId = null;
    const el = this.el['slot-side'], old = el.querySelector('.scroll');
    const top = old ? old.scrollTop : 0;
    const html = this.plan ? FRONTIER_UI.plan(this) : this.partyId ? FRONTIER_UI.party(this) : '';
    if (!this.plan) { const e = this.partyId && g.s.expeditions.find(x => x.id === this.partyId); this.frontier.showRoute(e ? e.poi.site : null); }
    const key = this.plan ? 'plan:' + this.plan.id : this.partyId ? 'party:' + this.partyId : '';
    if (html !== this._sideHtml && !(this._down && key === this._sideKey)) {
      this._sideHtml = html; el.innerHTML = html;
      const sc = el.querySelector('.scroll'); if (sc) sc.scrollTop = top;
      if (key === this._sideKey && el.firstElementChild) el.firstElementChild.style.animation = 'none';      // same sheet, new numbers: no slide-in, or it blinks
      this._sideKey = key;
    }
    if (!html) this._sideKey = '';
    this.root.classList.toggle('has-side', !!html);
    if (this.mode === 'frontier') { const b = this.el['slot-bar']; if (b) b.style.display = html ? 'none' : ''; }
  }
  openPlan(id) {
    const g = this.game, poi = g.findPoi(id);
    if (!poi) return;
    const reg = REGIONS.find(r => r.id === poi.region);
    if (!g.regionOpen(reg)) { this.toast(`${reg.name} opens when your Expedition Lodge reaches level ${reg.dock}`, 'bad', 'item_lock'); return; }
    this.partyId = null;
    this.plan = { id, team: g.bestTeam(poi), approach: 'balanced', transport: 'foot' };
    this.sfx.play('open');
    this.frontier.focusPoi(id, 50);
    this.renderSide();
    this.frontier.showRoute(poi.site);
  }
  openParty(eid) {
    const show = () => { this.plan = null; this.partyId = eid; this.frontier.focusParty(eid, 44); this.renderSide(); };
    if (this.mode !== 'frontier') this.enterFrontier(show); else { this.sfx.play('open'); show(); }
  }

  // ---- the chest: staged reveal + lucky draw --------------------------------------------------------
  lootReveal(r) {
    this.closeModal(); this.closeCtx();
    this.plan = null; this.partyId = null; this.renderSide();
    const el = FRONTIER_UI.loot(this, r);
    this.root.appendChild(el);
    this._loot = { el, r, stage: 0, bonus: {} };
    this.sfx.play('chest_shake');
    this._lootT = setTimeout(() => this.lootOpen(), 2200);
  }
  lootOpen() {
    const L = this._loot;
    if (!L || L.stage > 0) return;
    L.stage = 1;
    clearTimeout(this._lootT);
    L.el.classList.add('open');
    this.sfx.play('chest_open');
    const good = L.r.outcome === 'great' || L.r.outcome === 'success';
    const coins = L.el.querySelector('.coins'), n = { great: 38, success: 24, partial: 10, fail: 3 }[L.r.outcome];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, d = 160 + Math.random() * 260;
      c.style.cssText = `--x:${(Math.cos(a) * d).toFixed(0)}px;--y:${(Math.sin(a) * d).toFixed(0)}px;--d:${(0.7 + Math.random() * 0.7).toFixed(2)}s;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;--w:${(i % 5 === 0 ? 16 : 22)}px;animation-delay:${(Math.random() * 0.35).toFixed(2)}s`;
      if (i % 5 === 0) c.className = 'gem';
      coins.appendChild(c);
    }
    if (good) setTimeout(() => this.sfx.play(L.r.outcome === 'great' ? 'jackpot' : 'coins_shower'), 260);
    else setTimeout(() => this.sfx.play(L.r.outcome === 'fail' ? 'fail' : 'success'), 260);
    const cards = [...L.el.querySelectorAll('.lcard')];
    cards.forEach((card, i) => setTimeout(() => {
      if (this._loot !== L) return;
      card.classList.add('show');
      this.sfx.play(card.classList.contains('rare') ? 'card_rare' : 'card_common');
      const out = card.querySelector('.n'), to = +card.dataset.v || 0;
      if (!to) return;
      let k = 0; const steps = 14;
      const iv = setInterval(() => { k++; out.textContent = '+' + fmt(Math.round(to * (1 - Math.pow(1 - k / steps, 3)))); if (k >= steps) clearInterval(iv); }, 34);
    }, 750 + i * 330));
    const after = 750 + cards.length * 330;
    setTimeout(() => { if (this._loot === L) L.el.classList.add('team'); }, after + 150);
    setTimeout(() => { if (this._loot === L) { L.el.classList.add('drawing'); L.stage = 2; this.sfx.play('lucky_pick'); } }, after + 850);
  }
  lootPick(i) {
    const L = this._loot;
    if (!L || L.stage !== 2) return;
    const res = this.game.luckyPick(i);
    if (!res.ok) { L.stage = 3; L.el.querySelector('.collect').disabled = false; return; }
    L.stage = 3;
    L.bonus = res.got || {};
    const btns = [...L.el.querySelectorAll('.dcard')];
    btns.forEach((b, j) => { b.querySelector('.front').innerHTML = FRONTIER_UI.luckyFront(res.options[j]); b.disabled = true; });
    btns[i].classList.add('flip', 'mine');
    this.sfx.play('card_flip');
    setTimeout(() => {
      if (this._loot !== L) return;
      this.sfx.play(res.kind === 'jackpot' ? 'jackpot' : 'lucky_win');
      L.el.classList.add('picked');
      if (res.kind === 'jackpot') L.el.classList.add('jackpot');
      btns.forEach((b, j) => { if (j !== i) b.classList.add('flip', 'other'); });
      L.el.querySelector('.collect').disabled = false;
    }, 620);
  }
  lootCollect() {
    const L = this._loot;
    if (!L || L.stage < 3) return;
    const chest = L.el.querySelector('.chest').getBoundingClientRect();
    const all = { ...L.r.loot };
    for (const k in L.bonus) if (!k.startsWith('_')) all[k] = (all[k] || 0) + L.bonus[k];
    delete all._full;
    L.el.remove();
    this._loot = null;
    this.flyLoot({ x: chest.left + chest.width / 2, y: chest.top + chest.height / 2 }, all, true);
    this.sfx.play('collect');
    this._hudDirty = true;
  }

  // ---- a short guided tour: what is where -------------------------------------------------------------
  coach(steps) { this._coach = { steps, i: 0 }; this._coachShow(); }
  _coachShow() {
    const old = document.getElementById('coach');
    if (old) old.remove();
    const C = this._coach;
    if (!C) return;
    const seen = (sel) => { const e = document.querySelector(sel); return e && e.offsetParent !== null; };      // hidden at this screen size counts as absent
    while (C.i < C.steps.length && !seen(C.steps[C.i].sel)) C.i++;
    if (C.i >= C.steps.length) { this._coach = null; return; }
    const st = C.steps[C.i], r = document.querySelector(st.sel).getBoundingClientRect();
    const below = r.top < innerHeight / 2;
    const d = document.createElement('div');
    d.id = 'coach';
    const tipLeft = clamp(r.left + r.width / 2 - 160, 12, innerWidth - 332);
    d.innerHTML = `<div class="hole" style="left:${r.left - 8}px;top:${r.top - 8}px;width:${r.width + 16}px;height:${r.height + 16}px"></div>
      <div class="tip" style="left:${tipLeft}px;${below ? `top:${r.bottom + 22}px` : `bottom:${innerHeight - r.top + 22}px`}" role="dialog" aria-label="${esc(st.title)}">
        <b>${esc(st.title)}</b><p>${esc(st.text)}</p>
        <div class="row"><span class="muted">${C.i + 1} / ${C.steps.length}</span><span class="grow"></span><button class="btn sm ghost" data-act="coachSkip">Skip</button><button class="btn sm green" data-act="coachNext">${C.i === C.steps.length - 1 ? 'Got it' : 'Next'}</button></div>
      </div>`;
    this.root.appendChild(d);
  }
  // ---- how the game works: five illustrated cards --------------------------------------------------
  howto(then) {
    const AR = '<svg class="ar" aria-hidden="true" viewBox="0 0 28 24" width="28" height="24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h20M15 4l8 8-8 8"/></svg>';
    const it = (icon, label, alt = '') => `<span class="hi">${ic(icon, 76, '', alt)}<i>${label}</i></span>`;
    const flow = (...a) => a.join(AR);
    this._how = {
      i: 0, then,
      cards: [
        { h: 'Build your homestead', p: 'Tap a tree or a rock and a Chainer clears it. Press Build to put things up, then upgrade them.', pic: flow(it('item_axe', 'Clear'), it('home_1', 'Build'), it('item_arrow_up', 'Upgrade', 'item_star')) },
        { h: 'Chainers do the work', p: 'Tap any Chainer for a card of orders. A navy name tag is yours. A cream one is a Wanderer who is only visiting.', pic: flow(it('ui_chainers', 'Tap a Chainer'), `<span class="hstack">${it('item_hammer', 'Work')}${it('ui_build', 'Build', 'item_hammer')}${it('item_compass', 'Explore')}</span>`) },
        { h: 'Feed everyone', p: 'Farms grow Biopoints and everybody eats. A hungry Wanderer leaves. A fed one stays and works for you.', pic: flow(it('farm_plot', 'Farm'), it('res_bio', 'Biopoints'), it('item_food_bowl', 'Fed and happy')) },
        { h: 'Explore the Frontier', p: 'Send a party through your gate for Wood, Stone, Ore and lucky finds. Open the chest when they are back.', pic: flow(it('ui_expeditions', 'Frontier', 'item_compass'), it('item_boots', 'They walk', 'item_compass'), it('chest_gold', 'Chest', 'item_chest')) },
        { h: 'Crates earn ETH', p: 'Pack resources into Crates and upload them to the world Reward Pool. It pays ETH every 30 minutes. ETH is the only way to keep a Wanderer for good.', pic: flow(it('item_crate_1', 'Crates'), it('ui_pool', 'Reward Pool'), it('item_eth', 'ETH'), it('ui_wanderer', 'Recruit', 'ui_chainers')) },
      ],
    };
    this.closeModal(); this.closeCtx();
    this._howShow();
  }
  _howShow() {
    const H = this._how;
    let el = document.getElementById('howto');
    if (!H) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'howto'; this.root.appendChild(el); }
    const c = H.cards[H.i], last = H.i === H.cards.length - 1;
    el.innerHTML = `<div class="hcard" role="dialog" aria-label="How the game works, ${H.i + 1} of ${H.cards.length}">
      <button class="skip" data-act="howSkip">Skip</button>
      <div class="hpic n${H.i + 1}">${c.pic}</div>
      <small>How it works · ${H.i + 1} of ${H.cards.length}</small>
      <h2>${c.h}</h2><p>${c.p}</p>
      <div class="hdots" aria-hidden="true">${H.cards.map((_, i) => `<i class="${i === H.i ? 'on' : i < H.i ? 'done' : ''}"></i>`).join('')}</div>
      <div class="hrow">${H.i ? '<button class="btn ghost" data-act="howBack">Back</button>' : ''}<button class="btn green big" data-act="howNext">${last ? "Let's play" : 'Next'}</button></div></div>`;
  }
  howStep(d) {
    const H = this._how;
    if (!H) return;
    H.i += d;
    if (d === 99 || H.i >= H.cards.length) { this._how = null; this._howShow(); if (H.then) H.then(); return; }
    H.i = Math.max(0, H.i);
    this._howShow();
  }
  coachNext(skip) { if (!this._coach) return; if (skip) this._coach.i = 1e9; else this._coach.i++; this._coachShow(); }
  tour() {
    this.coach([
      { sel: '#hud-left .quest', title: 'Your next goal', text: 'Follow these and you see every part of the game. Tap the card and it takes you to the right place.' },
      { sel: '#hud-right .tool:not(.fr)', title: 'Build', text: 'One list of everything you can put up: what it is for, what it costs and exactly why something is still locked. The top card is what to build next.' },
      { sel: '#hud-right .tool.fr', title: 'Frontier', text: 'Where loot and resources come from. Build the Expedition Lodge, then send a party and open the chest when they are back.' },
      { sel: '.snav [data-act="sound"]', title: 'Sound', text: 'One tap mutes everything, one more brings it back.' },
      { sel: '.snav [data-panel="roster"]', title: 'Your Chainers', text: 'Or simply tap a Chainer in the yard: you get a card with everything you can tell them to do.' },
      { sel: '.snav [data-panel="supply"]', title: 'Supply lines', text: 'Upgrades that make the homestead run itself: feeding Wanderers, replanting, harvesting, crafting.' },
      { sel: '.snav [data-panel="level"]', title: 'Goals and level', text: 'Your Homestead level, how to earn experience, what each level opens and a list of what to do next.' },
    ]);
  }

  // helpers for panels
  costHtml(cost, opts = {}) {
    if (!cost) return '';
    const g = this.game;
    let h = '<span class="cost">';
    for (const k in (cost.res || {})) { const need = cost.res[k]; h += `<span class="${(g.s.res[k] || 0) < need ? 'no' : ''}" title="${resName(k)}">${ic(resIcon(k), 20)}${fmt(need)}</span>`; }
    if (cost.eth) h += `<span class="eth ${g.s.eth + 1e-12 < cost.eth ? 'no' : ''}" title="ETH">${ic('item_eth', 20)}${fmtEth(cost.eth, 5)}</span>`;
    if (cost.time && !opts.noTime) h += `<span title="Time">${ic('item_hourglass', 20)}${fmtTime(cost.time)}</span>`;
    return h + '</span>';
  }
  face(c, cls = '') {
    const R = RARITY[c.rarity];
    const url = this.studio ? this.studio.portrait(c, cls === 'big' ? 'full' : 'head') : '';
    return `<div class="face ${cls}" style="--rc:${R.color};--rbg:${R.color}33">${url ? `<img src="${url}" alt="">` : ''}<span class="lv">Lv ${c.level}</span></div>`;
  }
  stars(c) { const R = RARITY[c.rarity]; return `<span class="stars" style="--rc:${R.color}">${'★'.repeat(R.stars)}</span>`; }
  statChips(c, hi = null) {
    return `<div class="statrow">${STAT_KEYS.map(k => `<span class="st ${hi && hi[k] ? 'hi' : ''}" title="${STATS[k].name}">${ic(STATS[k].icon, 18)}${this.game.stat(c, k)}</span>`).join('')}</div>`;
  }
}
