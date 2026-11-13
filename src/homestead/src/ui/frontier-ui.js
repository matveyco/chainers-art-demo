// Expedition UI: map pins, the "plan the trip" sheet, party tracking and the loot reveal.
import { REGIONS, POI_TYPES, ACTIVITIES, CONDITIONS, STATS, APPROACH, TRANSPORT, LUCKY, RES, CRATES } from '../data/config.js';
import { fmt, fmtTime, clamp } from '../core/util.js';
import { ic, resIcon, resName, esc } from './ui.js';

const PHASE = { out: 'On the way', work: 'At work', back: 'Heading home', home: 'Loot ready' };
const danger = (poi) => clamp(Math.round((poi.hard - 0.8) / 0.9 * 4) + 1, 1, 5);
const pips = (poi) => `<span class="diff" title="Danger ${danger(poi)} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= danger(poi) ? 'on' : ''}"></i>`).join('')}</span>`;
const lootRange = (loot, mul = 1) => Object.entries(loot).map(([k, [a, b]]) => `<span title="${resName(k)}">${ic(resIcon(k), 26)}<b>${fmt(Math.round(a * mul))}–${fmt(Math.round(b * mul))}</b></span>`).join('');
const faces = (ui, e, cls = 'xs') => `<span class="faces">${e.team.map((id) => { const c = ui.game.chainer(id); return c ? ui.face(c, cls) : ''; }).join('')}</span>`;
const seg = (g, e) => {
  const ph = g.expPhase(e), order = ['out', 'work', 'back'], i = order.indexOf(ph.phase);
  return `<span class="seg">${order.map((k, j) => `<i class="${ph.phase === 'home' || j < i ? 'done' : j === i ? 'on' : ''}"><u style="width:${j === i ? (ph.p * 100).toFixed(0) : 0}%"></u></i>`).join('')}</span>`;
};
const km = (m) => (m * 0.04).toFixed(1) + ' km';      // the map is drawn small; distances are told at walking scale
const costLine = (ui, cost) => Object.entries(cost.res).map(([k, v]) => `<span class="${(ui.game.s.res[k] || 0) < v ? 'no' : ''}">${ic(resIcon(k), 22)}${fmt(v)}</span>`).join('');

export const FRONTIER_UI = {
  PHASE,
  // ---- pins over the map ----------------------------------------------------------------------
  pinSig(ui, m) { return `p|${m.id}|${m.locked ? 1 : 0}|${ui.plan && ui.plan.id === m.id ? 1 : 0}|${m.left < 180 ? 1 : 0}`; },
  pin(ui, m) {
    const T = POI_TYPES[m.poi.type], A = ACTIVITIES[T.act], sel = ui.plan && ui.plan.id === m.id;
    const soon = m.left < 180;
    return `<div class="in"><button class="pin ${sel ? 'sel' : ''} ${m.locked ? 'locked' : ''}" data-act="planOpen" data-id="${m.id}" aria-label="${T.name}, danger ${danger(m.poi)} of 5">
      <span class="pic">${ic(m.locked ? 'item_lock' : A.icon, 38)}</span>
      <span class="tx"><b>${T.name}</b><small>${pips(m.poi)}${Object.keys(m.poi.loot).slice(0, 3).map((k) => ic(resIcon(k), 18)).join('')}</small>${soon ? `<em class="tm">closes ${fmtTime(m.left)}</em>` : ''}</span>
    </button></div>`;
  },
  partySig(ui, m) { return `y|${m.id}|${m.phase}`; },
  partyPin(ui, m) {
    const home = m.phase === 'home';
    return `<div class="in"><button class="ppin ${m.phase}" data-act="${home ? 'claimExp' : 'partyOpen'}" data-id="${m.id}">
      ${faces(ui, m.exp)}<span class="tx"><b>${home ? 'Claim loot' : PHASE[m.phase]}</b>${home ? '' : `<small class="tm">${fmtTime(m.left)}</small>`}</span>${home ? '' : `<span class="ride">${ic((TRANSPORT[m.exp.transport] || TRANSPORT.foot).icon, 30, '', 'item_backpack')}</span>`}</button></div>`;
  },
  zonePin(ui, m) { return `<div class="in"><div class="zpin ${m.open ? '' : 'locked'}">${m.open ? '' : ic('item_lock', 18)}<b>${m.reg.name}</b>${m.open ? '' : `<small>Lodge level ${m.reg.dock}</small>`}</div></div>`; },

  // ---- the tracker: every party that is out, always on screen ---------------------------------
  tracker(ui) {
    const g = ui.game, now = g.now();
    if (!g.s.expeditions.length) return '';
    return `<div class="trk-col" aria-label="Squads on the Frontier">${g.s.expeditions.map((e) => {
      const T = POI_TYPES[e.poi.type], ph = g.expPhase(e, now), home = ph.phase === 'home';
      return `<button class="trk ${ph.phase}" data-act="${home ? 'claimExp' : 'partyOpen'}" data-id="${e.id}">
        ${faces(ui, e)}
        <span class="tx"><b>${T.name}</b><small>${home ? 'Loot ready!' : esc(g.expStatus(e, now))}</small>${seg(g, e)}</span>
        <span class="eta">${home ? ic('chest_wood', 34, '', 'item_chest') + '<em>Claim</em>' : `<em>${PHASE[ph.phase]}</em><i>${fmtTime(ph.left)}</i>`}</span>
      </button>`;
    }).join('')}</div>`;
  },

  // ---- plan the trip ---------------------------------------------------------------------------
  plan(ui) {
    const g = ui.game, st = ui.plan;
    const poi = st && g.findPoi(st.id);
    if (!poi) return '';
    const reg = REGIONS.find((r) => r.id === poi.region), T = POI_TYPES[poi.type], A = ACTIVITIES[T.act], cond = poi.cond ? CONDITIONS[poi.cond] : null;
    const open = g.regionOpen(reg);
    st.team = st.team.filter((id) => { const c = g.chainer(id); return c && g.isFree(c); }).slice(0, T.team);
    if (!g.transportOpen(st.transport)) st.transport = 'foot';
    const ev = g.evalTeam(poi, st.team, st.approach, st.transport);
    const p = Math.round(ev.chance * 100), tone = p >= 75 ? 'good' : p >= 45 ? 'mid' : 'bad';
    const slots = Array.from({ length: T.team }, (_, i) => {
      const c = g.chainer(st.team[i]);
      return c ? `<button class="slot on" data-act="planTeam" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">${ui.face(c)}<b>${esc(c.name)}</b><small>${ic(A.icon, 14)}${Math.round(g.power(c, T.act, cond))}</small></button>`
        : `<div class="slot"><span class="plus">+</span><small>Empty slot</small></div>`;
    }).join('');
    const pool = g.s.chainers.filter((c) => g.canWork(c) && !st.team.includes(c.id)).sort((a, b) => (g.isFree(b) - g.isFree(a)) || (g.power(b, T.act, cond) - g.power(a, T.act, cond)));
    const bench = pool.map((c) => {
      const free = g.isFree(c);
      return `<button class="bench ${free ? '' : 'dim'}" data-act="planTeam" data-id="${c.id}" ${free ? '' : 'aria-disabled="true"'}>${ui.face(c, 'sm')}<span><b>${esc(c.name)}</b><small>${free ? `${ic(A.icon, 14)}${Math.round(g.power(c, T.act, cond))}${c.owned ? '' : ' · Wanderer'}` : ui.statusOf(c)}</small></span></button>`;
    }).join('');
    const approach = Object.entries(APPROACH).map(([k, a]) => `<button class="opt ${st.approach === k ? 'on' : ''}" data-act="planSet" data-key="approach" data-val="${k}" aria-pressed="${st.approach === k}">
      ${ic(a.icon, 44, '', 'item_scales')}<b>${a.name}</b><small class="pro">${a.pros}</small>${a.cons ? `<small class="con">${a.cons}</small>` : ''}</button>`).join('');
    const transport = Object.entries(TRANSPORT).map(([k, v]) => {
      const ok = g.transportOpen(k);
      return `<button class="opt ${st.transport === k ? 'on' : ''} ${ok ? '' : 'locked'}" data-act="planSet" data-key="transport" data-val="${k}" aria-pressed="${st.transport === k}">
        ${ic(v.icon, 44, '', k === 'foot' ? 'item_compass' : 'item_backpack')}<b>${v.name}</b><small class="pro">${ok ? v.note : `Lodge level ${v.lodge}`}</small>${v.cost ? `<small class="cost">${Object.entries(v.cost).map(([r, n]) => `<span class="${(g.s.res[r] || 0) < n ? 'no' : ''}">${ic(resIcon(r), 16)}${n}</span>`).join('')}</small>` : ''}</button>`;
    }).join('');
    const full = g.s.expeditions.length >= g.parallelMax();
    const why = !open ? `Upgrade the Expedition Lodge to level ${reg.dock}` : full ? 'All squads are out' : !st.team.length ? 'Add a Chainer first' : !g.canAfford(ev.cost) ? 'Not enough for rations and transport' : '';
    return `<aside class="sheet-side plan" aria-label="Send a squad">
      <button class="x" data-act="planClose" data-quiet="1" aria-label="Close">✕</button>
      <header>${ic(A.icon, 56)}<div><small>Expedition · ${reg.name}</small><h2>${T.name}</h2></div></header>
      <div class="scroll">
        <div class="row wrap tags"><span class="tag gold">${ic(A.icon, 14)}${A.name}</span><span class="tag">Danger ${pips(poi)}</span><span class="tag navy">${Object.keys(A.w).map((k) => `${ic(STATS[k].icon, 14)}${STATS[k].name}`).join(' + ')}</span>${T.risky ? '<span class="tag red">Dangerous</span>' : ''}<span class="tag">${km(poi.dist)} from your gate</span><span class="tag">closes in ${fmtTime(poi.expires - g.now())}</span></div>
        ${cond ? `<div class="cond">${ic(cond.icon, 34)}<div><b>${cond.name}</b><small>${cond.desc}</small></div></div>` : ''}
        <h3>Possible loot</h3>
        <div class="loot-range">${lootRange(poi.loot, ev.n ? ev.lootMul : APPROACH[st.approach].loot * TRANSPORT[st.transport].carry)}</div>
        <p class="trip-note">Your squad is away ${fmtTime(ev.time)} and then rests. They cannot work at home meanwhile.</p>
        <h3>Squad <span>${st.team.length} / ${T.team}</span><button class="btn sm ghost" data-act="planBest">Best squad</button></h3>
        <div class="slots">${slots}</div>
        ${bench ? `<div class="benches">${bench}</div>` : '<p class="muted">No one else is free.</p>'}
        <h3>Approach</h3>
        <div class="opts">${approach}</div>
        <h3>Transport</h3>
        <div class="opts">${transport}</div>
      </div>
      <footer>
        <div class="sum">
          <div class="ring sm ${tone}" style="--p:${ev.n ? p : 0}"><div><b>${ev.n ? p + '%' : '—'}</b><small>success</small></div></div>
          <div class="trip"><div class="legs"><span><i></i>Walk out<b>${fmtTime(ev.tOut)}</b></span><span><i></i>${A.verb}<b>${fmtTime(ev.tWork)}</b></span><span><i></i>Walk back<b>${fmtTime(ev.tBack)}</b></span></div>
            <div class="cost">${costLine(ui, ev.cost)}<span class="muted">rations${TRANSPORT[st.transport].cost ? ' + rent' : ''}</span>${ev.n ? `<span class="muted">· jackpot ${Math.round(ev.crit * 100)}%</span>` : ''}</div>
            ${ev.staPenalty ? '<div class="tag red">Low Stamina: −25% power</div>' : ''}</div>
        </div>
        <button class="btn green big" data-act="planGo" ${why ? 'disabled' : ''}>${ic('item_compass', 28)}Send squad${why ? `<span class="sub">${why}</span>` : `<span class="sub">back in ${fmtTime(ev.time)}</span>`}</button>
      </footer>
    </aside>`;
  },

  // ---- one party: who, where, what they are doing --------------------------------------------
  party(ui) {
    const g = ui.game, e = g.s.expeditions.find((x) => x.id === ui.partyId);
    if (!e) return '';
    const now = g.now(), T = POI_TYPES[e.poi.type], A = ACTIVITIES[T.act], reg = REGIONS.find((r) => r.id === e.region);
    const ph = g.expPhase(e, now), home = ph.phase === 'home';
    const who = e.team.map((id) => { const c = g.chainer(id); return c ? `<div class="who">${ui.face(c, 'sm')}<span><b>${esc(c.name)}</b><small>${c.owned ? 'Lv ' + c.level : 'Wanderer'}</small></span></div>` : ''; }).join('');
    const log = (e.log || []).filter((l) => l.t <= now).reverse().map((l, i) => `<li class="${i === 0 ? 'now' : ''}"><time>${i === 0 && !home ? 'now' : fmtTime(now - l.t) + ' ago'}</time><span>${esc(l.text)}</span></li>`).join('');
    const V = TRANSPORT[e.transport] || TRANSPORT.foot, AP = APPROACH[e.approach] || APPROACH.balanced;
    return `<aside class="sheet-side party" aria-label="Squad">
      <button class="x" data-act="partyClose" data-quiet="1" aria-label="Close">✕</button>
      <header>${ic(A.icon, 56)}<div><small>${reg.name} · ${PHASE[ph.phase]}</small><h2>${T.name}</h2></div></header>
      <div class="scroll">
        <div class="whos">${who}</div>
        <div class="journey">${seg(g, e)}<div class="legs"><span>Walk out</span><span>${A.verb}</span><span>Walk back</span></div>
          <div class="eta">${home ? 'Loot ready at the gate' : `Home in <b>${fmtTime(ph.left)}</b>`}</div></div>
        <div class="row wrap tags"><span class="tag">${ic(AP.icon, 16, '', 'item_scales')}${AP.name}</span><span class="tag">${ic(V.icon, 16, '', 'item_backpack')}${V.name}</span><span class="tag">Chance ${Math.round(e.chance * 100)}%</span></div>
        <h3>Travel log</h3>
        <ol class="log">${log}</ol>
        <h3>Possible loot</h3>
        <div class="loot-range">${lootRange(e.poi.loot, e.lootMul)}</div>
      </div>
      <footer>
        ${home ? `<button class="btn green big" data-act="claimExp" data-id="${e.id}">${ic('chest_wood', 28, '', 'item_chest')}Claim loot</button>`
          : `<button class="btn navy" data-act="partyShow" data-id="${e.id}">Show on map</button>
             ${(ph.phase === 'out' || ph.phase === 'work') && !e.recalled ? `<button class="btn line red" data-act="partyRecall" data-id="${e.id}">Recall</button>` : ''}`}
      </footer>
    </aside>`;
  },

  // ---- the chest: a staged reveal with a lucky draw --------------------------------------------
  loot(ui, r) {
    const g = ui.game, T = POI_TYPES[r.exp.poi.type];
    const titles = { great: 'Jackpot!', success: 'Great loot!', partial: 'Partial loot', fail: 'Failed' };
    const subs = { great: 'Perfect run. Extra loot.', success: `${T.name} is cleared.`, partial: 'The squad brought back part of the loot.', fail: 'Almost no loot. The squad needs a long rest.' };
    const chest = `chest_${r.tier}`;
    const entries = Object.entries(r.loot).filter(([k, v]) => v > 0 && !k.startsWith('_'));
    const cards = entries.map(([k, v], i) => {
      const rare = k === 'crystal' || k === 'ingot' || (r.find && r.find[k]);
      return `<div class="lcard ${rare ? 'rare' : ''}" data-v="${v}" style="--i:${i}"><div class="in">${ic(resIcon(k), 64)}<b class="n">0</b><small>${resName(k)}</small>${r.find && r.find[k] ? '<em>Lucky find</em>' : ''}</div></div>`;
    }).join('') || `<div class="lcard empty" style="--i:0"><div class="in"><b class="n">—</b><small>${r.loot._full ? "Storage full" : "No loot this time"}</small></div></div>`;
    const team = r.results.map((x) => { const c = g.chainer(x.id); return c ? `<div class="lwho">${ui.face(c, 'sm')}<span><b>${esc(c.name)}</b><small>+${x.xp} XP${x.rest > 1 ? ' · rests ' + fmtTime(x.rest) : ''}</small></span>${x.leveled ? '<em>Level up!</em>' : ''}</div>` : ''; }).join('');
    // what shaped the haul: the odds they went in with, the approach, the ride, a lucky find
    const e = r.exp, AP = APPROACH[e.approach] || APPROACH.balanced, V = TRANSPORT[e.transport] || TRANSPORT.foot, good = r.outcome === 'great' || r.outcome === 'success';
    const chance = Math.round(e.chance * 100);
    const chips = [
      `<span class="lchip tier ${r.tier}">${{ gold: 'Gold chest', silver: 'Silver chest', wood: 'Wooden chest' }[r.tier]}</span>`,
      `<span class="lchip">${good && chance < 60 ? 'Lucky! Chance was ' : 'Success chance '}<b>${chance}%</b></span>`,
      e.approach !== 'balanced' ? `<span class="lchip">${ic(AP.icon, 18, '', 'item_scales')}${AP.name} approach <b>×${AP.loot}</b></span>` : '',
      V.carry > 1 ? `<span class="lchip">${ic(V.icon, 18, '', 'item_backpack')}${V.name} <b>+${Math.round((V.carry - 1) * 100)}% loot</b></span>` : '',
      r.find ? `<span class="lchip gold">${ic('item_clover', 18)}Lucky find!</span>` : '',
      e.recalled ? '<span class="lchip">Recalled early</span>' : '',
    ].join('');
    const d = document.createElement('div');
    d.className = `loot ${r.outcome}`;
    d.innerHTML = `<div class="stage">
        <div class="rays"></div>
        <div class="coins"></div>
        <button class="chest" data-act="lootOpen" aria-label="Open the chest">${ic(chest, 220, 'closed', 'item_chest')}${ic(chest + '_open', 220, 'opened', 'item_chest_open')}</button>
        <div class="banner"><small>${T.name}</small><h1>${titles[r.outcome]}</h1><p>${subs[r.outcome]}</p><div class="lchips">${chips}</div></div>
        <p class="tap">Tap the chest</p>
        <div class="lcards">${cards}</div>
        ${r.loot._full ? `<p class="full">${ic('ui_storage', 22)}Storage full: ${Object.entries(r.loot._lost || {}).map(([k, n]) => `${fmt(n)} ${resName(k)}`).join(', ') || 'some loot'} lost. Get more storage.</p>` : ''}
        <div class="lteam">${team}</div>
        <div class="draw">
          <h2>Lucky draw <small>pick one card</small></h2>
          <div class="dcards">${[0, 1, 2].map((i) => `<button class="dcard" data-act="lootPick" data-i="${i}" aria-label="Lucky card ${i + 1}"><span class="back">${ic('item_card', 96, '', 'item_clover')}</span><span class="front"></span></button>`).join('')}</div>
        </div>
        <button class="btn green big collect" data-act="lootCollect" disabled>Claim all<span class="sub">to your Storage</span></button>
      </div>`;
    return d;
  },
  luckyFront(o) {
    const L = LUCKY[o.kind];
    const what = Object.entries(o.grant).map(([k, v]) => (k === '_xp' ? `<span>+${v} XP each</span>` : `<span>${ic(resIcon(k), 22)}+${fmt(v)}</span>`)).join('');
    return `${ic(L.icon, 64)}<b>${L.name}</b><small>${what || L.text}</small>`;
  },
};
