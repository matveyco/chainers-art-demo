// All panels and UI actions.
import {
  BUILD_GROUPS, BUILD_USE, BUILD_NEXT,
  RES, RES_ORDER, CRATES, STATS, STAT_KEYS, ACTIVITIES, RARITY, RARITY_ORDER, TRAITS, WISHES, COSY_TIERS, BUILDINGS, BUILD_CATS,
  CROPS, GUEST, REGIONS, POI_TYPES, CONDITIONS, POOL, POOL_ETH_PER_EPOCH, EXCHANGE, QUESTS, CLEARABLES, LAND, GRUDGE,
  UPGRADES, UPGRADE_ORDER, LEVEL_PERKS, XP_SOURCES, TRANSPORT,
} from '../data/config.js';
import { fmt, fmtEth, fmtTime, fmtClock, clamp } from '../core/util.js';
import { ic, resIcon, resName, esc } from './ui.js';

const head = (icon, title, sub = '', alt = '') => `<header>${icon ? ic(icon, 46, '', alt) : ''}<div>${title}${sub ? `<small>${sub}</small>` : ''}</div><button class="x" data-act="closeModal" data-quiet="1" aria-label="Close">✕</button></header>`;
const statusText = (g, c) => {
  const now = g.now();
  switch (c.status) {
    case 'expedition': return ['On the Frontier', 'navy'];
    case 'build': return ['Helping build', 'green'];
    case 'rest': return [`Resting ${fmtTime(c.restUntil - now)}`, 'gold'];
    case 'job': { const b = g.building(c.jobAt); return [`Working: ${b ? BUILDINGS[b.type].name : '—'}`, 'green']; }
    case 'clearing': return ['Clearing', 'green'];
    case 'train': return [`Training ${fmtTime(c.busyUntil - now)}`, 'pink'];
    default: return c.owned || c.fed ? ['Free', 'green'] : ['Hungry', 'red'];
  }
};
const moodTag = (g, c) => {
  const m = g.mood(c);
  if (m === 'delighted') return `<span class="tag pink">${ic('item_heart', 14)}Delighted</span>`;
  if (m === 'hungry') return '<span class="tag red">Hungry</span>';
  return '<span class="tag green">Happy</span>';
};
const lootRange = (loot, mul = 1) => Object.entries(loot).map(([k, [a, b]]) => `<span title="${resName(k)}">${ic(resIcon(k), 20)}${fmt(Math.round(a * mul))}–${fmt(Math.round(b * mul))}</span>`).join('');
const diffDots = (poi, regPower) => { const lv = clamp(Math.round((poi.hard - 0.8) / 0.9 * 4) + 1, 1, 5); return `<span class="diff">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</span>`; };

function chainerCard(ui, c, opts = {}) {
  const g = ui.game, R = RARITY[c.rarity];
  const [st, cls] = statusText(g, c);
  return `<button class="ccard ${opts.sel ? 'sel' : ''} ${opts.dim ? 'dim' : ''}" style="--rc:${R.color}" data-act="${opts.act || 'chainer'}" data-id="${c.id}">
    ${ui.face(c)}
    <div class="grow">
      <div class="cname">${esc(c.name)} ${ui.stars(c)}</div>
      ${ui.statChips(c, opts.hi)}
      <div class="row wrap" style="margin-top:5px;gap:5px">
        <span class="tag ${cls}">${st}</span>
        ${c.owned ? '' : `<span class="tag eth">${ic('item_eth', 14)}${fmtEth(g.recruitPrice(c), 4)}</span>`}
        ${opts.extra || ''}
      </div>
    </div>
  </button>`;
}

// ================================================================================================
export const PANELS = {
  // ---- build menu ----------------------------------------------------------------------------
  build: {
    cls: 'sheet-up',
    render(ui, args, st) {
      const g = ui.game;
      const q = g.quest();
      const goal = q && /^build:/.test(q.hint || '') ? q.hint.slice(6) : (q && q.goal.buildAll ? q.goal.buildAll.find(t => !g.countOf(t)) : null);
      const goalOpen = goal && BUILDINGS[goal] && !g.countOf(goal) ? goal : null;
      // what to put on top: the building the current goal asks for, else the first useful thing you can build and do not have
      const next = goalOpen || BUILD_NEXT.find(t => !g.countOf(t) && g.checkBuild(t).ok) || null;
      const stateOf = (t) => {
        const chk = g.checkBuild(t), cost = g.cost(t, 1);
        if (chk.ok) return { k: 'go', html: '<em class="go">Build</em>', cost };
        if (chk.why === 'Maximum built') return { k: 'done', html: `<em class="done">Built ${g.countOf(t)} / ${g.maxOf(t)}</em>`, cost: null };
        if (chk.home) return { k: 'lock', html: `<em class="lock">${ic('item_lock', 16)}Chainer Home ${chk.home}</em>`, cost };
        if (chk.afford === false) { const k = g.missing(chk.cost)[0]; return { k: 'need', html: `<em class="need">${k && k !== 'eth' ? `Need ${fmt(Math.ceil(chk.cost.res[k] - (g.s.res[k] || 0)))} more ${resName(k)}` : 'Needs ETH from the Reward Pool'}</em>`, cost }; }
        return { k: 'need', html: `<em class="need">${chk.why}</em>`, cost };
      };
      const row = (t) => {
        const d = BUILDINGS[t], S = stateOf(t), cnt = g.countOf(t), max = g.maxOf(t);
        if (st.can && S.k !== 'go') return '';
        return `<button class="brow ${S.k} ${t === goalOpen ? 'want' : ''}" data-act="buildPick" data-type="${t}">
          <span class="pic">${ic(d.icon, 60, '', d.alt || '')}</span>
          <span class="tx"><span class="nm"><b>${d.name}</b>${max > 1 || cnt ? `<i>${cnt} / ${max}</i>` : ''}${t === goalOpen ? '<span class="tag gold">Quest</span>' : ''}</span>
            <small>${BUILD_USE[t] || d.desc}${d.cat === 'decor' ? ` · ${ic('item_heart', 14)}+${d.cosy[0]}` : ''}</small>
            ${S.cost ? ui.costHtml(S.cost) : ''}</span>
          <span class="bst">${S.html}</span></button>`;
      };
      let top = '';
      if (next && !st.can) {
        const d = BUILDINGS[next], S = stateOf(next);
        top = `<button class="bnext ${S.k}" data-act="buildPick" data-type="${next}">
          <span class="lb">${goalOpen ? `For your quest · ${esc(q.text)}` : 'Build this next'}</span>
          <span class="in"><span class="pic">${ic(d.icon, 84, '', d.alt || '')}</span>
            <span class="tx"><b>${d.name}</b><small>${d.global ? `Unlocks the ${d.global}. ` : ''}${d.desc}</small>${S.cost ? ui.costHtml(S.cost) : ''}</span></span>
          <span class="cta ${S.k}">${S.k === 'go' ? `${ic('item_hammer', 24)}Build the ${d.name}` : S.html}</span></button>`;
      }
      const groups = BUILD_GROUPS.map((G) => {
        const rows = G.types.filter(t => BUILDINGS[t]).map(row).join('');
        if (!rows) return '';
        return `<section id="bg-${G.id}"><h3>${ic(G.icon, 22, '', 'item_star')}<b>${G.name}</b><span>${G.why}</span></h3>${rows}</section>`;
      }).join('');
      const jump = `<div class="jump" role="group" aria-label="Jump to">
        <button class="jchip ${st.can ? 'on' : ''}" data-act="buildCan" aria-pressed="${!!st.can}">Can build now</button>
        ${BUILD_GROUPS.map(G => `<button class="jchip" data-act="buildJump" data-id="${G.id}">${G.name}</button>`).join('')}</div>`;
      return `${head('ui_build', 'Build', `All buildings in one list · free builders ${g.builderSlots() - g.activeBuilds()} / ${g.builderSlots()}`, 'item_hammer')}
        ${jump}
        <div class="body blist">${top}${groups || '<p class="muted">Nothing you can build right now. Get more Wood and Stone, or upgrade the Chainer Home.</p>'}
        <p class="muted" style="margin-top:12px">To upgrade, tap a building in the yard. A green Upgrade arrow shows what you can afford.</p></div>`;
    },
  },

  // ---- storage (the barn sticker) -------------------------------------------------------------
  storage: {
    cls: 'narrow',
    render(ui) {
      const g = ui.game, s = g.s;
      const rows = RES_ORDER.map((k) => {
        const v = Math.floor(s.res[k] || 0), cap = g.capOf(k);
        return `<div class="line">${ic(RES[k].icon, 34)}<b class="grow">${RES[k].name}</b><div class="bar ${v >= cap ? '' : 'green'}" style="width:110px"><i style="width:${clamp(v / cap * 100, 0, 100)}%"></i></div><span style="min-width:86px;text-align:right"><b>${fmt(v)}</b> <span class="muted">/ ${fmt(cap)}</span></span></div>`;
      }).join('');
      const crates = Object.keys(CRATES).map(k => `<div class="line">${ic(CRATES[k].icon, 34)}<b class="grow">${CRATES[k].name}</b><span class="muted">${CRATES[k].points} points each</span><b style="min-width:40px;text-align:right">${s.crates[k] || 0}</b></div>`).join('');
      const up = g.upkeepPerMin();
      return `${head('ui_storage', 'Storage', 'Warehouse: more of everything. Granary: more Biopoints')}
        <div class="body">
          ${rows}
          <h3 style="margin-top:14px">Crates for the Reward Pool</h3>
          ${crates}
          <div class="sheet" style="margin-top:12px"><div class="row">${ic('item_food_bowl', 34)}<div><b>Upkeep ${(up * 60).toFixed(0)} Biopoints / hour</b><div class="muted">Every Chainer and fed Wanderer eats. At 0 Biopoints they get hungry and work at 70%.</div></div></div></div>
        </div>`;
    },
  },

  // ---- cosiness ------------------------------------------------------------------------------
  cosy: {
    cls: 'narrow',
    render(ui) {
      const g = ui.game, v = g.cosy(), tier = g.cosyTier(v), next = g.cosyNext(v);
      const rows = COSY_TIERS.map((t) => `<div class="line ${t === tier ? 'me' : ''}"><div class="grow"><b>${t.name}</b> <span class="muted">from ${t.min}</span><div class="row" style="gap:4px;margin-top:4px;flex-wrap:wrap">${RARITY_ORDER.map((r, i) => (t.odds[i] ? `<span class="tag" style="background:${RARITY[r].color}22;color:${RARITY[r].color}">${RARITY[r].name} ${t.odds[i]}%</span>` : '')).join('')}</div></div><span class="tag">every ~${fmtTime(t.interval)}</span></div>`).join('');
      return `${head('item_heart', 'Cosiness', 'A cosy home attracts better Wanderers, more often')}
        <div class="body">
          <div class="row" style="margin-bottom:10px"><div class="big-num" style="color:var(--crimson)">${v}</div><div class="grow"><b>${tier.name}</b>${next ? `<div class="bar pink" style="margin-top:4px"><i style="width:${(v - tier.min) / (next.min - tier.min) * 100}%"></i></div><span class="muted">${next.min - v} more to reach ${next.name}</span>` : '<div class="muted">Max cosiness level reached.</div>'}</div></div>
          ${g.s.grudge >= 1 ? `<p><span class="tag red">−${Math.round(g.s.grudge)} from unhappy Wanderers</span> <span class="muted">Recovers slowly. Dismissing a Wanderer costs ${GRUDGE.kick}.</span></p>` : ''}
          <p class="muted">Buildings add a little cosiness. Decor adds a lot. Upgrades add more.</p>
          ${rows}
        </div>
        <footer><button class="btn" data-act="open" data-panel="build" data-cat="decor">${ic('decor_flowerbed', 22)}Decorate</button></footer>`;
    },
  },

  // ---- supply lines: what runs by itself ------------------------------------------------------
  supply: {
    cls: 'wide',
    render(ui) {
      const g = ui.game, s = g.s;
      const node = (icon, label, alt = '') => `<span class="cn">${ic(icon, 44, '', alt)}<small>${label}</small></span>`;
      const arrow = (on) => `<i class="ar ${on ? 'on' : ''}" aria-hidden="true"></i>`;
      const chain = `<div class="chains">
        <div class="chain">${node('farm_plot', 'Farm')}${arrow(g.autoOn('baskets'))}${node('granary', 'Storage')}${arrow(g.autoOn('kitchen'))}${node('upg_kitchen', 'Kitchen', 'item_food_bowl')}${arrow(g.autoOn('kitchen'))}${node('camp_1', 'Wanderers')}</div>
        <div class="chain">${node('res_wood', 'Wood, Stone')}${arrow(g.autoOn('bell'))}${node('sawmill', 'Materials')}${arrow(g.autoOn('crateline'))}${node('workshop', 'Crates')}${arrow(g.autoOn('courier'))}${node('pool_shrine', 'Reward Pool')}</div>
      </div>`;
      const rows = UPGRADE_ORDER.map((k) => {
        const U = UPGRADES[k], own = g.hasUpg(k), a = s.auto[k] || {}, chk = own ? null : g.checkUpgradeBuy(k);
        let body = '';
        if (own) {
          if (k === 'kitchen') {
            const cap = g.larderCap(), meals = Math.floor(s.larder / 20);
            body = `<div class="set"><label>Keep up to <b id="au-kitchen-stock">${a.stock}</b> Biopoints in the Kitchen<input type="range" min="0" max="${cap}" step="10" value="${Math.min(a.stock, cap)}" data-input="autoNum" data-k="kitchen" data-key="stock"></label>
              <label>Keep at least <b id="au-kitchen-floor">${a.floor}</b> in Storage<input type="range" min="0" max="300" step="10" value="${a.floor}" data-input="autoNum" data-k="kitchen" data-key="floor"></label>
              <div class="now">${ic('res_bio', 22)}Kitchen now <b>${Math.floor(s.larder)} / ${Math.min(a.stock, cap)}</b> · about ${meals} ${meals === 1 ? 'meal' : 'meals'} · Camp level ${g.first('camp') ? g.first('camp').level : 0} holds ${cap}</div></div>`;
          } else if (k === 'bell') {
            body = `<div class="set three">${['wood', 'stone', 'ore'].map((r) => `<label>${ic(RES[r].icon, 20)}Keep at least <b id="au-bell-${r}">${(a.keep || {})[r] || 0}</b><input type="range" min="0" max="${Math.max(100, g.capOf(r))}" step="10" value="${(a.keep || {})[r] || 0}" data-input="autoNum" data-k="bell" data-key="keep.${r}"></label>`).join('')}</div>`;
          } else if (k === 'crateline') {
            const ws = g.first('workshop');
            body = `<div class="set"><div class="pickres">${Object.entries(CRATES).map(([ck, c]) => `<button class="${a.key === ck ? 'on' : ''}" data-act="autoPick" data-k="crateline" data-key="key" data-val="${ck}" ${ws && ws.level >= c.workshop ? '' : 'disabled'}>${ic(c.icon, 28)}${c.name}</button>`).join('')}</div>
              <div class="set three"><label>${ic('res_bio', 20)}Keep at least <b id="au-crateline-keepBio">${a.keepBio}</b><input type="range" min="0" max="${Math.max(200, g.capOf('bio'))}" step="10" value="${a.keepBio}" data-input="autoNum" data-k="crateline" data-key="keepBio"></label>
              ${['wood', 'stone'].map((r) => `<label>${ic(RES[r].icon, 20)}Keep at least <b id="au-crateline-${r}">${(a.keep || {})[r] || 0}</b><input type="range" min="0" max="${Math.max(100, g.capOf(r))}" step="10" value="${(a.keep || {})[r] || 0}" data-input="autoNum" data-k="crateline" data-key="keep.${r}"></label>`).join('')}</div></div>`;
          }
          return `<div class="sline own ${a.on ? 'on' : 'off'}">${ic(U.icon, 64, '', U.alt)}<div class="grow"><div class="t"><b>${U.name}</b><span class="tag ${a.on ? 'green' : ''}">${a.on ? 'Running' : 'Paused'}</span></div><p>${U.desc}</p>${a.on ? body : ''}</div>
            <button class="switch ${a.on ? 'on' : ''}" role="switch" aria-checked="${!!a.on}" aria-label="${U.name}" data-act="autoToggle" data-k="${k}"><i></i></button></div>`;
        }
        const needB = U.needs && !g.first(U.needs);
        return `<div class="sline locked">${ic(U.icon, 64, '', U.alt)}<div class="grow"><div class="t"><b>${U.name}</b></div><p>${U.desc}</p>
            <div class="row wrap" style="gap:8px 14px">${ui.costHtml({ res: U.cost }, { noTime: true })}${s.level < U.level ? `<span class="req">Needs Homestead level ${U.level} · you are ${s.level}</span>` : ''}${needB ? `<span class="req">Needs a ${BUILDINGS[U.needs].name}</span>` : ''}</div></div>
          <button class="btn ${chk.ok ? 'green' : 'off'}" data-act="buyUpg" data-k="${k}">${chk.ok ? 'Unlock' : 'Locked'}</button></div>`;
      }).join('');
      return `${head('ui_supply', 'Supply lines', 'Turn it on once. It runs automatically while you have resources.', 'ui_storage')}
        <div class="body">${chain}${rows}
          <p class="muted" style="margin-top:10px">A lit arrow means that step is automatic. Automation also works while you are away. Workers still make everything faster.</p></div>`;
    },
  },

  // ---- Homestead level + what to do next ------------------------------------------------------
  level: {
    cls: 'wide',
    render(ui) {
      const g = ui.game, s = g.s, L = g.levelInfo(), q = g.quest(), pr = q ? g.questProgress(q) : null;
      const track = Object.keys(LEVEL_PERKS).map(Number).sort((a, b) => a - b).map((l) => `<div class="lv ${s.level >= l ? 'done' : l === L.nextPerk ? 'next' : ''}"><span class="n">${l}</span><div>${LEVEL_PERKS[l].map((p) => `<span>${p}</span>`).join('')}</div>${s.level >= l ? '<em>Unlocked</em>' : ''}</div>`).join('');
      const advice = g.advice().map((a) => {
        const args = Object.entries(a.args || {}).map(([k, v]) => `data-${k}="${v}"`).join(' ');
        return `<div class="adv ${a.locked ? 'locked' : ''}">${ic(a.icon, 46, '', a.alt || '')}<div class="grow"><b>${esc(a.text)}</b><small>${esc(a.why || '')}</small></div><button class="btn sm ${a.locked ? 'ghost' : 'green'}" data-act="${a.act}" ${args}>${a.btn}</button></div>`;
      }).join('');
      return `${head('ui_level', 'Your Homestead', `${esc(s.user)} · ${g.owned().length} Chainers · cosiness ${g.cosy()}`, 'item_star')}
        <div class="body"><div class="lvl-grid">
          <div>
            <div class="lvl-card"><div class="badge"><small>Level</small>${s.level}</div><div class="grow"><b>Homestead level ${s.level}</b><div class="bar green"><i style="width:${clamp(L.xp / L.need * 100, 0, 100)}%"></i></div><small>${fmt(L.xp)} / ${fmt(L.need)} XP · ${fmt(L.left)} to level ${s.level + 1}</small></div></div>
            <h3>How to earn XP</h3>
            <div class="xps">${XP_SOURCES.map(([i, t]) => `<span>${ic(i, 22)}${t}</span>`).join('')}</div>
            <h3>Level unlocks</h3>
            <div class="track">${track}</div>
            <p class="muted">Homestead level and building levels are different things. Chainer Home upgrades need Homestead level 2, 4, 6 and 8. Most other buildings need a higher Chainer Home level.</p>
          </div>
          <div>
            <h3>What to do next</h3>
            ${advice || '<p class="muted">Nothing to do right now.</p>'}
          </div>
        </div></div>`;
    },
  },

  // ---- a world object you cannot reach yet -----------------------------------------------------
  locked: {
    cls: 'narrow', live: false,
    render(ui, args) {
      const g = ui.game, d = BUILDINGS[args.type], chk = g.checkBuild(args.type);
      const what = args.type === 'pool_shrine'
        ? 'All players share one Reward Pool. Everyone uploads Crates to it. Every 30 minutes it pays ETH by share.'
        : 'The Exchange is one market for all players. Prices change with what players trade.';
      return `${head('item_globe', d.global, 'Shared by all players', 'item_eth')}
        <div class="body"><p>${what}</p>
          <div class="sheet"><div class="row">${ic(d.icon, 64)}<div class="grow"><b style="color:var(--navy)">Build your ${d.name} to unlock it</b><div class="muted">${d.desc}</div></div></div>
            <div class="row wrap" style="margin-top:10px;gap:8px 14px">${ui.costHtml(g.cost(args.type, 1))}${chk.ok ? '' : `<span class="req">${chk.why}</span>`}</div></div></div>
        <footer><button class="btn ${chk.ok ? 'green' : 'off'}" data-act="buildPick" data-type="${args.type}">${ic(d.icon, 24)}Build the ${d.name}</button></footer>`;
    },
  },

  // ---- pick who lends a hand on a building site / which site a Chainer helps -------------------
  helpers: {
    cls: 'narrow',
    render(ui, args) {
      const g = ui.game, b = g.building(args.id);
      if (!b || !(b.state === 'building' || b.state === 'upgrading')) return null;
      const list = g.s.chainers.filter((c) => g.isFree(c)).sort((x, y) => g.buildBonus(y) - g.buildBonus(x));
      const rows = list.map((c) => chainerCard(ui, c, { act: 'helpBuild', extra: `<span class="tag green">${Math.round(g.buildBonus(c) * 100)}% faster</span>` }).replace('data-id=', `data-b="${b.id}" data-id=`)).join('');
      return `${head('item_hammer', 'Who helps build?', `${BUILDINGS[b.type].name} · ${fmtTime(b.doneAt - g.now())} left`)}<div class="body">${rows ? `<div class="grid two">${rows}</div>` : '<p>No one is free right now.</p>'}</div>`;
    },
  },
  sites: {
    cls: 'narrow',
    render(ui, args) {
      const g = ui.game, c = g.chainer(args.id);
      if (!c) return null;
      const list = g.s.buildings.filter((b) => (b.state === 'building' || b.state === 'upgrading') && !b.builder);
      const rows = list.map((b) => `<div class="line">${ic(BUILDINGS[b.type].icon, 40)}<div class="grow"><b style="color:var(--navy)">${BUILDINGS[b.type].name}</b><div class="muted">${fmtTime(b.doneAt - g.now())} left · ${esc(c.name)} makes it ${Math.round(g.buildBonus(c) * 100)}% faster</div></div><button class="btn sm green" data-act="helpBuild" data-id="${c.id}" data-b="${b.id}">Help here</button></div>`).join('');
      return `${head('item_hammer', `Where does ${esc(c.name)} help?`)}<div class="body">${rows || '<p>Nothing is being built right now.</p>'}</div>`;
    },
  },

  // ---- chainer roster ------------------------------------------------------------------------
  roster: {
    render(ui, args, st) {
      const g = ui.game;
      st.tab = st.tab || args.tab || 'mine';
      const mine = g.owned(), guests = g.guests();
      const camp = g.first('camp');
      let body = '';
      if (st.tab === 'mine') {
        body = `<p class="muted">Your Chainers live in the Chainer Home. Each eats Biopoints: total upkeep <b>${(g.upkeepPerMin() * 60).toFixed(0)}</b> / hour.</p><div class="grid two">${mine.map(c => chainerCard(ui, c)).join('')}</div>`;
      } else {
        const now = g.now();
        const tier = g.cosyTier();
        body = camp
          ? `<p class="muted">Wanderers visit your Camp. Feed them and they work for you while they stay. Like one? Recruit them with ETH from the Reward Pool. Cosiness <b>${g.cosy()}</b> (${tier.name}).</p>
             ${guests.length ? `<div class="grid two">${guests.map(c => chainerCard(ui, c, { extra: `<span class="tag">${c.fed ? 'Stays' : 'Leaves in'} ${fmtTime(c.leavesAt - now)}</span>` })).join('')}</div>` : '<div class="sheet"><p>The camp is empty right now.</p></div>'}
             <p class="muted" style="margin-top:10px">${guests.length < g.guestSlots() ? `Next Wanderer in about <b>${fmtTime(Math.max(0, g.s.guestTimer - now))}</b>.` : 'Camp is full. Upgrade it for more beds.'}</p>`
          : `<div class="sheet"><p>Build a <b>Wanderer Camp</b> and Wanderers will start to visit.</p><button class="btn" data-act="buildPick" data-type="camp">${ic('camp_1', 24)}Build Camp</button></div>`;
      }
      return `${head('ui_chainers', 'Chainers')}
        <div class="tabs"><button class="tab ${st.tab === 'mine' ? 'on' : ''}" data-act="tab" data-key="tab" data-val="mine">My Chainers ${mine.length}/${g.ownedSlots()}</button>
        <button class="tab ${st.tab === 'guests' ? 'on' : ''}" data-act="tab" data-key="tab" data-val="guests">Wanderers ${guests.length}/${g.guestSlots()}${guests.some(c => !c.fed) ? '<span class="n">!</span>' : ''}</button></div>
        <div class="body">${body}</div>`;
    },
  },

  // ---- single chainer ------------------------------------------------------------------------
  chainer: {
    render(ui, args) {
      const g = ui.game, c = g.chainer(args.id);
      if (!c) return null;
      const R = RARITY[c.rarity], T = TRAITS[c.trait];
      const [st, cls] = statusText(g, c);
      const arena = g.first('arena');
      const canTrain = c.owned && arena && g.isFree(c);
      const tc = g.trainCost(c);
      const stats = STAT_KEYS.map((k) => {
        const v = g.stat(c, k), S = STATS[k];
        return `<div class="statline" title="${S.desc}">${ic(S.icon, 24)}<span>${S.name}</span><div class="bar ${S.main ? 'blue' : ''}" ${S.main ? '' : 'style="height:9px"'}><i style="width:${v / 15 * 100}%"></i></div><span class="v">${v}${c.trained[k] ? `<span class="up"> +${c.trained[k]}</span>` : ''}</span>${canTrain ? `<button class="btn sm green" data-act="train" data-id="${c.id}" data-stat="${k}">+1</button>` : '<span></span>'}</div>`;
      }).join('');
      const best = Object.keys(ACTIVITIES).filter(a => a !== 'craft').map(a => [a, g.power(c, a) || g.actScore(c, a) * 10]).sort((a, b) => b[1] - a[1]);
      let acts = '';
      if (!c.owned) {
        const price = g.recruitPrice(c), fc = Math.round(g.feedCost(c) * (c.fed ? GUEST.extendCostMul : 1));
        acts = `<button class="btn green" data-act="feed" data-id="${c.id}">${ic('res_bio', 22)}${c.fed ? 'Feed again' : 'Feed'} <span class="sub">${fc}</span></button>
          <button class="btn eth" data-act="recruit" data-id="${c.id}">${ic('item_eth', 22)}Recruit <span class="sub">${fmtEth(price, 4)} ETH</span></button>
          <button class="btn red sm" data-act="kick" data-id="${c.id}">Dismiss</button>`;
      } else {
        acts = `${c.status === 'job' ? `<button class="btn ghost" data-act="unassign" data-id="${c.id}">Stop work</button>` : `<button class="btn" data-act="open" data-panel="jobs" data-id="${c.id}" ${g.isFree(c) ? '' : 'disabled'}>${ic('item_hammer', 22)}Assign job</button>`}
          ${g.owned().length > 1 ? `<button class="btn red sm" data-act="kick" data-id="${c.id}">Dismiss</button>` : ''}`;
      }
      const wish = WISHES[c.wish];
      return `${head(null, esc(c.name), `${R.name} Chainer · level ${c.level}`)}
        <div class="body">
          <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:wrap">
            <div style="text-align:center">${ui.face(c, 'big')}<div style="margin-top:6px">${ui.stars(c)}</div></div>
            <div class="grow" style="min-width:240px">
              <div class="row wrap" style="gap:5px;margin-bottom:6px"><span class="tag ${cls}">${st}</span>${st === 'Hungry' ? '' : moodTag(g, c)}<span class="tag navy">${R.name}</span></div>
              ${stats}
              ${canTrain ? `<div class="muted" style="margin-top:2px">Training +1 costs ${ui.costHtml(tc)}</div>` : c.owned && !arena ? '<div class="muted">Build a Training Ground to raise stats.</div>' : ''}
              <div class="sheet" style="margin-top:8px"><div class="row">${ic(T.icon, 30)}<div><b style="color:var(--navy)">${T.name}</b><div class="muted">${T.desc}</div></div></div></div>
              ${!c.owned ? `<div class="sheet" style="margin-top:8px"><b style="color:var(--navy)">Wish:</b> ${esc(wish.text)} ${g.wishMet(c) ? `<span class="tag pink">${ic('item_heart', 14)}Granted: +20% stats, −15% price</span>` : '<span class="tag">Not yet</span>'}<div class="muted">${c.fed ? `Staying for ${fmtTime(c.leavesAt - g.now())}` : `Hungry. Leaves in ${fmtTime(c.leavesAt - g.now())} unless fed`}</div></div>` : ''}
              <div class="muted" style="margin-top:8px">Best at: ${best.slice(0, 3).map(([a]) => `<span class="tag">${ic(ACTIVITIES[a].icon, 14)}${ACTIVITIES[a].name}</span>`).join(' ')}</div>
            </div>
          </div>
        </div>
        <footer>${acts}</footer>`;
    },
  },

  // ---- pick a job for a chainer --------------------------------------------------------------
  jobs: {
    cls: 'narrow',
    render(ui, args) {
      const g = ui.game, c = g.chainer(args.id);
      if (!c) return null;
      const list = g.s.buildings.filter(b => BUILDINGS[b.type].job && b.level > 0);
      const rows = list.map((b) => {
        const d = BUILDINGS[b.type], w = b.worker ? g.chainer(b.worker) : null;
        const bonus = Math.round(g.actScore(c, d.job) * 3.5 * g.levelMul(c));
        return `<div class="line">${ic(d.icon, 40)}<div class="grow"><b style="color:var(--navy)">${d.name}</b> <span class="muted">Lv ${b.level}</span><div class="muted">${w ? `Worker: ${esc(w.name)}` : 'No worker'} · ${esc(c.name)} gives <span class="up">+${bonus}%</span></div></div><button class="btn sm green" data-act="assign" data-id="${c.id}" data-b="${b.id}">Assign</button></div>`;
      }).join('');
      return `${head('item_hammer', `Job for ${esc(c.name)}`, 'Workers speed up production and raise farm yields')}<div class="body">${rows || '<p>No workplaces yet. Build a Farm Plot, Sawmill or Workshop.</p>'}</div>`;
    },
  },
  // ---- pick a worker for a building ----------------------------------------------------------
  workers: {
    cls: 'narrow',
    render(ui, args) {
      const g = ui.game, b = g.building(args.id);
      if (!b) return null;
      const d = BUILDINGS[b.type], A = ACTIVITIES[d.job];
      const hi = {}; for (const k in A.w) hi[k] = true;
      const list = g.s.chainers.filter(c => g.canWork(c)).sort((x, y) => g.actScore(y, d.job) - g.actScore(x, d.job));
      const rows = list.map((c) => chainerCard(ui, c, { act: 'assign2', hi, dim: !g.isFree(c) && b.worker !== c.id, sel: b.worker === c.id, extra: `<span class="tag green">+${Math.round(g.actScore(c, d.job) * 3.5 * g.levelMul(c))}%</span>` }).replace('data-id=', `data-b="${b.id}" data-id=`)).join('');
      return `${head(d.icon, `Worker for ${d.name}`, `${A.name}: ${Object.keys(A.w).map(k => STATS[k].name).join(' + ')}`)}<div class="body"><div class="grid two">${rows}</div></div>
        <footer>${b.worker ? `<button class="btn ghost" data-act="unassign" data-id="${b.worker}">Remove worker</button>` : ''}</footer>`;
    },
  },

  // ---- farm crops ----------------------------------------------------------------------------
  crops: {
    render(ui, args) {
      const g = ui.game, b = g.building(args.id);
      if (!b) return null;
      const cards = Object.entries(CROPS).map(([k, c]) => {
        const locked = g.homeLevel() < c.home;
        return `<button class="bcard ${locked ? 'locked' : ''}" data-act="plant" data-id="${b.id}" data-crop="${k}">
          <div class="pic" style="background:radial-gradient(circle at 50% 60%,#8a5a3c,#5a3a2a)">${ic(c.model, 84)}</div>
          <div class="nm">${c.name}</div>
          <div class="row wrap" style="gap:5px"><span class="tag green">${ic('res_bio', 14)}+${g.farmYield(b, k)}</span><span class="tag">${ic('item_hourglass', 14)}${fmtTime(c.time)}</span>${c.bonus ? `<span class="tag eth">${ic('res_crystal', 14)}bonus</span>` : ''}</div>
          ${locked ? `<div class="why">Needs Home level ${c.home}</div>` : `<div class="ds">${(g.farmYield(b, k) / c.time * 60).toFixed(0)} Biopoints / min</div>`}
        </button>`;
      }).join('');
      return `${head('farm_plot', 'Plant a crop', `Farm Plot level ${b.level}${b.worker ? ' · worker bonus +' + Math.round(g.jobBonus(b) * 100) + '%' : ''}`)}<div class="body"><div class="grid">${cards}</div></div>`;
    },
  },

  // ---- crate workshop ------------------------------------------------------------------------
  workshop: {
    guard: (ui) => (ui.game.first('workshop') ? null : 'Build the Crate Workshop first'),
    render(ui) {
      const g = ui.game, b = g.first('workshop'), now = g.now();
      if (!b) return null;
      const cards = Object.entries(CRATES).map(([k, c]) => {
        const locked = b.level < c.workshop;
        const ok = !locked && g.canAfford({ res: c.cost });
        return `<div class="bcard ${locked ? 'locked' : ''}" style="cursor:default">
          <div class="pic" style="background:radial-gradient(circle at 50% 60%,#e3e8ff,#c2cbff)">${ic(c.icon, 84)}</div>
          <div class="nm">${c.name}</div>
          <div class="row wrap" style="gap:5px"><span class="tag eth">${ic('item_eth', 14)}${c.points} pool points</span><span class="tag">${ic('item_hourglass', 14)}${fmtTime(g.crateTime(b, k))}</span></div>
          <div>${ui.costHtml({ res: c.cost }, { noTime: true })}</div>
          ${locked ? `<div class="why">Needs Workshop level ${c.workshop}</div>` : `<button class="btn sm ${ok ? 'green' : 'off'}" data-act="craft" data-key="${k}">Craft</button>`}
          <div class="muted">You have: <b>${g.s.crates[k]}</b></div>
        </div>`;
      }).join('');
      const jobs = (b.jobs || []).map((j, i) => `<span class="tag ${i === 0 ? 'gold' : ''}">${ic(CRATES[j.key].icon, 16)}${i === 0 ? fmtTime(j.end - now) : 'queued'}</span>`).join(' ');
      const done = Object.entries(b.done || {}).filter(([, n]) => n > 0);
      return `${head('workshop', 'Crate Workshop', `Level ${b.level} · queue ${(b.jobs || []).length}/${BUILDINGS.workshop.queue[b.level - 1]}${b.worker ? ' · worker +' + Math.round(g.jobBonus(b) * 100) + '% speed' : ''}`)}
        <div class="body">
          <p class="muted">Crates earn ETH. Craft them from resources, then upload them to the Reward Pool for a share of the ETH.</p>
          <div class="grid">${cards}</div>
          <div class="sheet" style="margin-top:10px"><h3>In progress</h3>${jobs || '<span class="muted">Queue is empty.</span>'}
          ${done.length ? `<div style="margin-top:8px"><button class="btn green sm" data-act="collect" data-id="${b.id}">Collect ${done.map(([k, n]) => `${ic(CRATES[k].icon, 18)}x${n}`).join(' ')}</button></div>` : ''}</div>
        </div>
        <footer><button class="btn ghost" data-act="open" data-panel="workers" data-id="${b.id}">${ic('ui_chainers', 22)}Worker</button><button class="btn eth" data-act="open" data-panel="pool">${ic('item_eth', 22)}Go to Reward Pool</button></footer>`;
    },
  },

  // ---- reward pool ---------------------------------------------------------------------------
  pool: {
    guard: (ui) => (ui.game.first('pool_shrine') ? null : { redirect: 'locked', args: { type: 'pool_shrine' } }),
    render(ui, args, st) {
      const g = ui.game, P = g.poolStatus(), s = g.s;
      st.tab = st.tab || 'now';
      const pct = (1 - P.left / POOL.epochSec) * 100;
      let body = '';
      if (st.tab === 'now') {
        const dep = Object.entries(CRATES).map(([k, c]) => {
          const n = s.crates[k];
          const pts = Math.round(c.points * (1 + g.poolBonus()));
          return `<div class="line">${ic(c.icon, 44)}<div class="grow"><b style="color:var(--navy)">${c.name}</b><div class="muted">${pts} points each · you have <b>${n}</b></div></div>
            <button class="btn sm eth ${n ? '' : 'off'}" data-act="deposit" data-key="${k}" data-n="1">Upload 1</button>
            ${n > 1 ? `<button class="btn sm eth" data-act="deposit" data-key="${k}" data-n="${n}">All ${n}</button>` : ''}</div>`;
        }).join('');
        body = `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
            <div class="ring" style="--p:${pct}"><div><div class="muted">pays out in</div><div class="big-num">${fmtClock(P.left)}</div><div class="eth-num">${fmtEth(P.reward, 5)} ETH</div></div></div>
            <div class="grow" style="min-width:220px">
              <div class="kv"><span>Your points</span><b>${fmt(P.mine)}</b><span>All players</span><b>${fmt(P.total)}</b><span>Your share now</span><b>${(P.share * 100).toFixed(2)}%</b>
              <span>Estimated payout</span><b class="eth-num">${fmtEth(P.projected, 6)} ETH</b><span>Your rank</span><b>${P.mine ? '#' + P.rank : '—'} of ${P.board.length}</b></div>
              <div class="bar eth" style="margin-top:8px;height:12px"><i style="width:${clamp(P.share * 100, 0, 100)}%"></i></div>
              <div class="muted" style="margin-top:6px">1 ETH is shared every day, in ${Math.round(86400 / POOL.epochSec)} rounds of 30 minutes. You get ETH by your share of the points uploaded in that round${g.poolBonus() ? ` (your Pool Shrine adds +${Math.round(g.poolBonus() * 100)}% points)` : ''}.</div>
            </div></div>
          <h3>Upload Crates</h3>${dep}
          ${s.crates.crate1 + s.crates.crate2 + s.crates.crate3 === 0 ? `<button class="btn" data-act="open" data-panel="workshop">${ic('workshop', 22)}Craft Crates</button>` : ''}`;
      } else if (st.tab === 'board') {
        body = P.board.slice(0, 30).map((b, i) => `<div class="line ${b.me ? 'me' : ''}"><div class="rk">${i + 1}</div><div class="grow"><b style="color:var(--navy)">${esc(b.name)}</b>${b.me ? ' <span class="tag gold">You</span>' : ''}</div><b>${fmt(b.points)}</b><span class="muted" style="width:60px;text-align:right">${P.total ? (b.points / P.total * 100).toFixed(1) : 0}%</span></div>`).join('');
      } else {
        body = (s.pool.history.length ? s.pool.history.map(h => `<div class="line">${ic('item_eth', 30)}<div class="grow"><b class="eth-num">+${fmtEth(h.eth, 6)} ETH</b><div class="muted">${fmt(h.points)} of ${fmt(h.total)} points · ${(h.points / h.total * 100).toFixed(1)}%</div></div><span class="muted">${fmtTime(g.now() - h.at)} ago</span></div>`).join('') : '<div class="sheet"><p>No payouts yet. Upload a Crate and wait for the round to end.</p></div>')
          + `<p class="muted" style="margin-top:8px">Total earned: <b class="eth-num">${fmtEth(s.pool.earned, 6)} ETH</b> · all-time points: <b>${fmt(s.pool.lifetime)}</b></p>`;
      }
      return `${head('item_eth', 'World Reward Pool', `${ic('item_globe', 16, '', 'item_star')} Shared by all players · your balance ${fmtEth(s.eth, 6)} ETH`)}
        <div class="tabs">${[['now', 'This round'], ['board', 'Leaderboard'], ['hist', 'My payouts']].map(([k, n]) => `<button class="tab ${st.tab === k ? 'on' : ''}" data-act="tab" data-key="tab" data-val="${k}">${n}</button>`).join('')}</div>
        <div class="body">${body}</div>`;
    },
  },

  // ---- exchange ------------------------------------------------------------------------------
  exchange: {
    guard: (ui) => (ui.game.first('exchange') ? null : { redirect: 'locked', args: { type: 'exchange' } }),
    render(ui, args, st) {
      const g = ui.game, x = g.s.exchange;
      st.from = st.from || 'wood'; st.to = st.to || 'stone';
      const have = Math.floor(g.s.res[st.from] || 0);
      st.amt = clamp(st.amt ?? Math.min(have, 20), 0, have);
      const q = g.exQuote(st.from, st.to, st.amt);
      const fair = g.exFair(st.from, st.to), spot = g.exRate(st.from, st.to);
      const vsFair = (spot / fair - 1) * 100;
      const pick = (key, cur) => `<div class="pickres">${EXCHANGE.assets.map(k => `<button class="${k === cur ? 'on' : ''}" data-act="exPick" data-key="${key}" data-val="${k}" ${key === 'to' && k === st.from ? 'disabled' : ''}>${ic(RES[k].icon, 26)}${key === 'from' ? fmt(g.s.res[k] || 0) : ''}</button>`).join('')}</div>`;
      // sparkline of the price for this pair
      const hist = x.history.map(h => h.r[st.to] / h.r[st.from]);
      hist.push(spot);
      const mn = Math.min(...hist, fair) * 0.97, mx = Math.max(...hist, fair) * 1.03;
      const pts = hist.map((v, i) => `${(i / Math.max(1, hist.length - 1) * 300).toFixed(1)},${(60 - (v - mn) / (mx - mn || 1) * 56).toFixed(1)}`).join(' ');
      const fy = (60 - (fair - mn) / (mx - mn || 1) * 56).toFixed(1);
      const depth = EXCHANGE.assets.map((k) => {
        const r = x.reserves[k] / x.base[k];
        return `<div class="row" style="gap:6px;margin:3px 0">${ic(RES[k].icon, 20)}<div class="bar ${r > 1.05 ? 'green' : r < 0.95 ? 'pink' : ''}" style="flex:1"><i style="width:${clamp(r * 50, 3, 100)}%"></i></div><span class="muted" style="width:92px;text-align:right">${r > 1.05 ? 'a lot · cheap' : r < 0.95 ? 'low · expensive' : 'normal'}</span></div>`;
      }).join('');
      return `${head('item_scales', 'World Exchange', `${ic('item_globe', 16, '', 'item_star')} One market for all players · your Trading Post fee ${(q.fee * 100).toFixed(0)}%`)}
        <div class="body">
          <div class="grid two">
            <div>
              <h3>You give</h3>${pick('from', st.from)}
              <div class="row" style="margin:10px 0 4px"><input type="range" min="0" max="${Math.max(1, have)}" value="${st.amt}" data-input="exAmt"><b class="big-num" id="ex-amt" style="font-size:22px;min-width:64px;text-align:right">${fmt(st.amt)}</b></div>
              <div class="row" style="gap:6px">${[25, 50, 100].map(p => `<button class="btn sm ghost" data-act="exPct" data-p="${p}">${p}%</button>`).join('')}</div>
              <h3 style="margin-top:12px">You get</h3>${pick('to', st.to)}
            </div>
            <div>
              <div class="sheet" style="text-align:center">
                <div class="row" style="justify-content:center;gap:10px">${ic(RES[st.from].icon, 44)}<b class="big-num" id="ex-in">${fmt(st.amt)}</b><span style="font-size:24px;font-weight:900;color:var(--gold)">→</span>${ic(RES[st.to].icon, 44)}<b class="big-num up" id="ex-out">${fmt(q.out)}</b></div>
                <div class="kv" style="margin-top:10px;text-align:left" id="ex-kv">
                  <span>Rate</span><b>1 ${RES[st.from].name} = ${spot.toFixed(spot < 0.1 ? 3 : 2)} ${RES[st.to].name}</b>
                  <span>vs. usual</span><b class="${vsFair >= 0 ? 'up' : ''}" style="${vsFair < 0 ? 'color:var(--red)' : ''}">${vsFair >= 0 ? '▲ +' : '▼ '}${vsFair.toFixed(0)}% ${vsFair >= 3 ? 'good deal' : vsFair <= -3 ? 'bad deal' : ''}</b>
                  <span>Price impact</span><b>${(q.impact * 100).toFixed(1)}%</b>
                </div>
                <svg class="spark" viewBox="0 0 300 64" preserveAspectRatio="none"><line x1="0" x2="300" y1="${fy}" y2="${fy}" stroke="#c9b98a" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="#4b57c9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>
                <div class="muted">Price of ${RES[st.from].name} in ${RES[st.to].name} · dashed = usual</div>
              </div>
              <button class="btn green wide" style="margin-top:10px" data-act="swap" ${st.amt > 0 && q.out > 0 ? '' : 'disabled'}>${ic('item_scales', 24)}Swap</button>
            </div>
          </div>
          <h3 style="margin-top:12px">Market stock</h3><p class="muted">The more of a resource is in the market, the cheaper it is. Other players change prices all the time.</p>${depth}
        </div>`;
    },
  },

  // ---- land ----------------------------------------------------------------------------------
  land: {
    cls: 'narrow',
    render(ui) {
      const g = ui.game, c = g.landCost();
      if (!c) return `${head('item_flag', 'Land')}<div class="body"><p>Your land is at max size. Nothing left to unlock.</p></div>`;
      return `${head('item_flag', 'Expand your land', `Expansion ${g.s.land + 1} of ${LAND.rings.length}`)}
        <div class="body"><p>Adds one tile on every side: more room to build, and new trees and rocks to clear.</p><div>${ui.costHtml(c, { noTime: true })}</div></div>
        <footer><button class="btn green ${g.canAfford(c) ? '' : 'off'}" data-act="expand">Expand</button></footer>`;
    },
  },

  // ---- settings ------------------------------------------------------------------------------
  settings: {
    cls: 'narrow', live: false,
    render(ui) {
      const g = ui.game, s = g.s;
      return `${head('ui_settings', esc(s.user), `Level ${s.level} · ${g.owned().length} Chainers · ${fmtEth(s.pool.earned, 5)} ETH earned`)}
        <div class="body">
          <div class="kv" style="margin-bottom:12px"><span>Expeditions</span><b>${s.tally.expeditions} sent · ${s.tally.success} successful</b><span>Harvests</span><b>${s.tally.harvests}</b><span>Wanderers met</span><b>${s.tally.wanderers}</b><span>Pool points</span><b>${fmt(s.pool.lifetime)}</b></div>
          <h3>Sound</h3>
          <div class="row wrap" style="margin-bottom:12px"><button class="btn sm ${s.settings.sfx ? 'navy' : 'ghost'}" data-act="sound">${s.settings.sfx ? 'Sound on' : 'Sound off'}</button><button class="btn sm ${s.settings.music === false ? 'ghost' : 'navy'}" data-act="music">${s.settings.music === false ? 'Music off' : 'Music on'}</button><button class="btn sm ${s.settings.amb === false ? 'ghost' : 'navy'}" data-act="amb">${s.settings.amb === false ? 'Ambience off' : 'Ambience on'}</button></div>
          <h3>Help</h3>
          <div class="row wrap" style="margin-bottom:12px"><button class="btn sm ghost" data-act="howto">How to play</button><button class="btn sm ghost" data-act="tour">Replay tour</button><button class="btn sm ghost" data-act="open" data-panel="level">What to do next</button></div>
          <h3>Game speed (for testing)</h3>
          <div class="row wrap">${[1, 5, 20, 60].map(v => `<button class="btn sm ${s.settings.speed === v ? 'navy' : 'ghost'}" data-act="speed" data-v="${v}">×${v}</button>`).join('')}</div>
          <p class="muted" style="margin-top:6px">Normal speed is ×1 (the Reward Pool pays every 30 minutes). Higher speeds make every timer faster, including the pool.</p>
          <h3 style="margin-top:12px">Account</h3>
          <p class="muted">Test login. Progress is saved in this browser under this name.</p>
          <div class="row wrap"><button class="btn ghost sm" data-act="logout">Switch player</button><button class="btn red sm" data-act="reset">Reset progress</button></div>
        </div>`;
    },
  },

  // ---- context card: a selected building or a selected Chainer --------------------------------
  ctx(ui, sel) {
    return sel.kind === 'chainer' ? PANELS.ctxChainer(ui, sel) : PANELS.ctxBuilding(ui, sel);
  },
  ctxChainer(ui, sel) {
    const g = ui.game, c = g.chainer(sel.id);
    if (!c) return '';
    const R = RARITY[c.rarity], T = TRAITS[c.trait], free = g.isFree(c), now = g.now();
    const stats = STAT_KEYS.map((k) => `<div class="sb ${STATS[k].main ? 'main' : ''}" title="${STATS[k].name}: ${STATS[k].desc}">${ic(STATS[k].icon, 18)}<small>${STATS[k].short}</small><div class="bar ${STATS[k].main ? 'blue' : ''}"><i style="width:${g.stat(c, k) / 15 * 100}%"></i></div><b>${g.stat(c, k)}</b></div>`).join('');
    const act = (a, icon, label, on = true, why = '', cls = '', extra = '', alt = '') => `<button class="abtn ${cls} ${on ? '' : 'off'}" data-act="${a}" data-id="${c.id}" ${extra} ${on ? '' : `data-why="${why}"`} title="${why}"><span class="pic">${ic(icon, 40, '', alt)}</span><b>${label}</b>${why && !on ? `<small>${why}</small>` : ''}</button>`;
    const busy = free ? '' : 'Busy';
    let acts = '';
    const canWork = g.canWork(c);
    if (c.owned || c.fed) {
      const sites = g.s.buildings.filter((b) => (b.state === 'building' || b.state === 'upgrading') && !b.builder).length;
      acts += act('cExp', 'item_compass', 'Expedition', free && !!g.lodge(), g.lodge() ? busy : 'Build the Expedition Lodge');
      acts += c.status === 'job' ? act('unassign', 'item_hammer', 'Stop work') : act('cWork', 'item_hammer', 'Work', free, busy);
      acts += act('cClear', 'item_axe', 'Clear land', free, busy);
      acts += c.status === 'build' ? act('unassign', 'tool_hammer', 'Stop building', true, '', '', '', 'item_hammer') : act('cBuild', 'site', 'Help build', free && sites > 0, free ? 'Nothing is being built' : busy, '', '', 'item_hammer');
      if (c.owned) acts += act('cTrain', 'item_dumbbell', 'Train', free && !!g.first('arena'), g.first('arena') ? busy : 'Build a Training Ground');
    }
    if (!c.owned) {
      const price = g.recruitPrice(c), fc = Math.round(g.feedCost(c) * (c.fed ? GUEST.extendCostMul : 1));
      acts = act('feed', 'item_food_bowl', c.fed ? 'Feed again' : 'Feed', g.s.res.bio >= fc, 'Not enough Biopoints', 'feed', '', '') .replace('</b>', `</b><em>${ic('res_bio', 16)}${fc}</em>`)
        + act('recruit', 'item_eth', 'Recruit', g.s.eth + 1e-12 >= price, 'Earn ETH from the Reward Pool', 'eth').replace('</b>', `</b><em>${fmtEth(price, 4)} ETH</em>`)
        + acts;
    }
    acts += act('cDetails', 'item_book', 'Details', true, '', 'quiet');
    if (!c.owned) acts += act('kick', 'item_flag', 'Dismiss', c.status !== 'expedition' && c.status !== 'clearing', 'Wait until they are back', 'quiet red');
    const wish = WISHES[c.wish];
    const sub = c.owned
      ? `<span class="tag navy">Your Chainer</span><span class="tag">Lv ${c.level}</span><span class="tag" style="box-shadow:inset 0 0 0 2px ${R.color}">${R.name}</span>`
      : `<span class="tag" style="background:${R.color};color:#fff;box-shadow:none">Wanderer · ${R.name}</span><span class="tag">Lv ${c.level}</span><span class="tag ${c.fed ? '' : 'red'}">${c.fed ? 'Stays' : 'Leaves in'} ${fmtTime(c.leavesAt - now)}</span>`;
    return `<button class="x" data-act="closeCtx" data-quiet="1" aria-label="Close">✕</button>
      <div class="chd">${ui.face(c)}<div class="grow"><div class="nm"><b>${esc(c.name)}</b>${ui.stars(c)}</div><div class="row wrap" style="gap:5px">${sub}</div>
        <div class="state">${esc(ui.statusOf(c))}</div></div>
        <div class="sbs">${stats}</div></div>
      <div class="trait">${ic(T.icon, 22)}<b>${T.name}</b><span>${T.desc}</span>${!c.owned ? `<span class="wish">${ic('item_heart', 18)}Wish: ${esc(wish.text)}${g.wishMet(c) ? ' · granted: 15% cheaper' : ''}</span>` : ''}</div>
      <div class="abtns">${acts}</div>
      ${!c.owned ? '<p class="note">Recruiting costs ETH from the Reward Pool.</p>' : ''}`;
  },
  ctxBuilding(ui, sel) {
    const g = ui.game, b = g.building(sel.id);
    if (!b) return '';
    const d = BUILDINGS[b.type], now = g.now();
    const building = b.state === 'building' || b.state === 'upgrading';
    let info = '', acts = '', main = '';
    const w = b.worker ? g.chainer(b.worker) : null;
    const auto = (k, label) => (g.hasUpg(k) ? `<button class="tag ${g.autoOn(k) ? 'green' : ''}" data-act="open" data-panel="supply">${label}: ${g.autoOn(k) ? 'on' : 'off'}</button>` : '');
    if (building) {
      const h = b.builder ? g.chainer(b.builder) : null;
      info = `<span class="tag gold">${b.state === 'building' ? 'Building' : 'Upgrading'} · ${fmtTime(b.doneAt - now)}</span>${h ? `<span class="tag green">${esc(h.name)} is helping: ${Math.round(((b.builderK || 1) - 1) * 100)}% faster</span>` : ''}`;
      acts += h ? `<button class="btn sm ghost" data-act="unassign" data-id="${h.id}">Stop helping</button>` : `<button class="btn sm green" data-act="open" data-panel="helpers" data-id="${b.id}">${ic('item_hammer', 20)}Add a helper</button>`;
    } else {
      switch (b.type) {
        case 'home': info = `<span class="tag navy">Beds ${g.owned().length}/${g.ownedSlots()}</span><span class="tag">Builders ${g.builderSlots()}</span>`; acts += `<button class="btn sm" data-act="open" data-panel="roster">Chainers</button>`; break;
        case 'camp':
          info = `<span class="tag navy">Wanderers ${g.guests().length}/${g.guestSlots()}</span>${g.hasUpg('kitchen') ? `<button class="tag ${g.autoOn('kitchen') ? 'green' : ''}" data-act="open" data-panel="supply">${ic('res_bio', 14)}Kitchen ${Math.floor(g.s.larder)} / ${Math.min(g.s.auto.kitchen.stock, g.larderCap())}</button>` : `<button class="tag" data-act="open" data-panel="supply">Auto-feed: unlock the Camp Kitchen</button>`}`;
          acts += `<button class="btn sm" data-act="open" data-panel="roster" data-tab="guests">Wanderers</button>`; break;
        case 'farm_plot':
          info = (b.crop ? `<span class="tag green">${CROPS[b.crop].name} · ${now >= b.readyAt ? 'Ready' : fmtTime(b.readyAt - now)}</span><span class="tag">${ic('res_bio', 14)}+${g.farmYield(b)}</span>` : '<span class="tag">Empty</span>') + auto('seeddrill', 'Auto-plant') + auto('baskets', 'Auto-harvest');
          acts += b.crop ? (now >= b.readyAt ? `<button class="btn sm green" data-act="marker" data-m="harvest" data-id="${b.id}">Harvest</button>` : '') : `<button class="btn sm green" data-act="open" data-panel="crops" data-id="${b.id}">Plant</button>`;
          if (!g.hasUpg('seeddrill')) acts += `<button class="btn sm ghost" data-act="open" data-panel="supply">Automate</button>`;
          break;
        case 'warehouse': info = `<span class="tag navy">Storage ×${(1 + g.byType('warehouse').reduce((a, x) => a + BUILDINGS.warehouse.capMul[x.level - 1], 0)).toFixed(1)}</span>`; break;
        case 'granary': info = `<span class="tag navy">Biopoints cap ${fmt(g.capOf('bio'))}</span>`; break;
        case 'workshop': info = auto('crateline', 'Crate Line'); acts += `<button class="btn sm green" data-act="open" data-panel="workshop">Craft Crates</button>`; break;
        case 'pool_shrine': info = `<span class="tag eth">${ic('item_globe', 14, '', 'item_star')}Reward Pool pays in ${fmtClock(g.epochLeft())}</span>${g.poolBonus() ? `<span class="tag">+${Math.round(g.poolBonus() * 100)}% points</span>` : ''}${auto('courier', 'Courier')}`; acts += `<button class="btn sm eth" data-act="open" data-panel="pool">Go to Reward Pool</button>`; break;
        case 'exchange': info = `<span class="tag navy">${ic('item_globe', 14, '', 'item_star')}World Exchange · fee ${(g.exFee() * 100).toFixed(0)}%</span>`; acts += `<button class="btn sm green" data-act="open" data-panel="exchange">Trade</button>`; break;
        case 'balloon_dock': info = `<span class="tag navy">Squads ${g.s.expeditions.length}/${g.parallelMax()}</span><span class="tag">Zones ${BUILDINGS.balloon_dock.regions[b.level - 1]}/4</span><span class="tag">${Object.keys(TRANSPORT).filter((k) => g.transportOpen(k)).map((k) => TRANSPORT[k].name).join(', ')}</span>`; main = `<button class="btn green big wide" data-act="expeditions">${ic('ui_expeditions', 34, '', 'item_compass')}Go to Frontier<span class="sub">send a squad for loot and resources</span></button>`; break;
        case 'rest_lodge': info = `<span class="tag navy">Rest −${Math.round(BUILDINGS.rest_lodge.rest[b.level - 1] * 100)}%</span>`; break;
        case 'arena': info = `<span class="tag navy">Training cap +${BUILDINGS.arena.trainCap[b.level - 1]}</span>`; acts += `<button class="btn sm" data-act="open" data-panel="roster">Train a Chainer</button>`; break;
        default: break;
      }
      if (d.recipe) {
        const inK = Object.keys(d.recipe.in), outK = Object.keys(d.recipe.out)[0];
        const room = g.queueCap(b) - (b.queue || 0) - (b.stored || 0);
        let can = room; for (const k of inK) can = Math.min(can, Math.floor((g.s.res[k] || 0) / d.recipe.in[k]));
        info = `<span class="cost">${inK.map(k => `<span>${ic(resIcon(k), 20)}${d.recipe.in[k]}</span>`).join('')}<span>→</span><span>${ic(resIcon(outK), 20)}${d.recipe.out[outK]}</span><span>${ic('item_hourglass', 18)}${fmtTime(g.batchTime(b))}</span></span>
          <span class="tag ${b.queue ? 'gold' : ''}">Queue ${b.queue || 0}${b.stored ? ` · ready ${b.stored}` : ''} / ${g.queueCap(b)}</span>${auto('bell', "Foreman's Bell")}`;
        acts += `<button class="btn sm green ${can > 0 ? '' : 'off'}" data-act="enqueue" data-id="${b.id}" data-n="1">+1</button><button class="btn sm green ${can > 1 ? '' : 'off'}" data-act="enqueue" data-id="${b.id}" data-n="5">+5</button><button class="btn sm green ${can > 0 ? '' : 'off'}" data-act="enqueue" data-id="${b.id}" data-n="999">Max ${Math.max(0, can)}</button>`;
        if (b.stored) acts += `<button class="btn sm" data-act="collect" data-id="${b.id}">Collect</button>`;
      }
      if (d.job) acts += `<button class="btn sm ghost" data-act="open" data-panel="workers" data-id="${b.id}">${w ? `${esc(w.name)} +${Math.round(g.jobBonus(b) * 100)}%` : 'Assign worker'}</button>`;
    }
    const chk = building ? null : g.checkUpgrade(b);
    let up = '';
    if (chk && !chk.max) {
      // ONE obvious button. It says what you get, what it costs, and when it is locked exactly what is missing
      const miss = chk.cost && !g.canAfford(chk.cost) ? g.missing(chk.cost)[0] : null;
      const need = miss ? (miss === 'eth' ? 'Needs ETH from the Reward Pool' : `Need ${fmt(Math.ceil(chk.cost.res[miss] - (g.s.res[miss] || 0)))} more ${resName(miss)}`) : '';
      const how = chk.ok ? '' : chk.level ? `<div class="req">${ic('item_lock', 18)}<span>You are Homestead level ${g.s.level}.</span><button class="btn sm ghost" data-act="open" data-panel="level">How to level up</button></div>`
        : chk.home ? `<div class="req">${ic('item_lock', 18)}<span>Your Chainer Home is level ${g.homeLevel()}.</span><button class="btn sm ghost" data-act="hint" data-hint="home">Go to Home</button></div>`
          : need ? '' : `<div class="req"><span>${chk.why}</span></div>`;
      up = `<div class="upg ${chk.ok ? 'ok' : ''}">
        <div class="gain">${ic('item_arrow_up', 22, '', 'item_star')}<span>Level ${b.level + 1} gives you <b>${g.upgradeGain(b)}</b></span></div>
        <button class="btn upcta wide ${chk.ok ? '' : 'off'}" data-act="upgrade" data-id="${b.id}"><b>${chk.ok ? ic('item_upgrade', 30, '', 'item_arrow_up') : ''}${chk.ok ? `Upgrade to level ${b.level + 1}` : chk.level ? `Locked until Homestead level ${chk.level}` : chk.home ? `Locked until Chainer Home level ${chk.home}` : need || chk.why}</b>${ui.costHtml(chk.cost)}</button>
        ${how}</div>`;
    }
    const canRemove = d.cat === 'decor' || b.type === 'well' || b.type === 'farm_plot';
    return `<button class="x" data-act="closeCtx" data-quiet="1" aria-label="Close">✕</button>
      <div class="hd">${ic(d.icon, 52, '', d.alt || '')}<div class="grow"><b>${d.name}</b> ${d.maxLevel > 1 ? `<span class="tag navy">Lv ${Math.max(1, b.level)} / ${d.maxLevel}</span>` : ''} <span class="tag pink">${ic('item_heart', 14)}${d.cosy[Math.max(1, Math.min(b.level, d.cosy.length)) - 1]}</span><div class="muted">${d.desc}</div></div></div>
      <div class="row wrap" style="gap:6px">${info}</div>
      ${main}
      <div class="acts">${acts}${building ? '' : `<button class="btn sm ghost" data-act="moveB" data-id="${b.id}">Move</button>`}${canRemove && !building ? `<button class="btn sm line red" data-act="removeB" data-id="${b.id}">Remove</button>` : ''}</div>${up}`;
  },
};

// ================================================================================================
const refresh = (ui) => { ui._modalDirty = true; ui._hudDirty = true; if (ui.ctxPanel) ui.renderCtx(); };

export const ACTIONS = {
  noop() {},
  open(ui, d) { const args = { ...d }; delete args.act; delete args.panel; ui.open(d.panel, args); },
  closeModal(ui) { ui.closeModal(); },
  closeCtx(ui) { ui.closeCtx(); },
  celebrateOk(ui) { ui.closeCelebration(); },
  tab(ui, d) { if (ui.modal) { ui.modal.state[d.key] = d.val; ui.refreshModal(true); } },
  seasonMenu(ui) { ui.seasonOpen = !ui.seasonOpen; ui.renderHud(); },
  season(ui, d) {
    if (ui.game.setSeason(d.id)) { ui.seasonBanner(d.id); ui.sfx.play('season'); }
    ui._hudDirty = true;
  },
  sound(ui) { const s = ui.game.s.settings; s.sfx = !s.sfx; ui.sfx.on = s.sfx; ui.game.save(); ui._hudDirty = true; ui.refreshModal(); ui.toast(s.sfx ? 'Sound on' : 'Sound off', '', s.sfx ? 'ui_sound_on' : 'ui_sound_off'); },
  howto(ui) { ui.closeModal(); ui.howto(); },
  howNext(ui) { ui.howStep(1); }, howBack(ui) { ui.howStep(-1); }, howSkip(ui) { ui.howStep(99); },
  speed(ui, d) { ui.game.s.settings.speed = +d.v; ui.refreshModal(); ui.toast(`Game speed ×${d.v}`); },
  reset(ui) { if (confirm('Reset all progress for this player?')) { ui.game.wipe(); location.reload(); } },
  logout(ui) { ui.game.save(); try { sessionStorage.removeItem('chainers_user'); } catch (e) { /* ignore */ } location.reload(); },
  chainer(ui, d) { ui.open('chainer', { id: d.id }); },

  quest(ui) {
    const g = ui.game, q = g.quest();
    if (!q) return;
    if (g.questProgress(q).done) {
      const r = g.claimQuest();
      if (r.ok) { if (ui.modal) ui.closeModal(); ui.celebrate({ title: 'Quest complete!', hero: 'item_trophy', text: q.text, loot: r.got, sfx: 'fanfare', button: 'Claim' }); }
    } else ACTIONS.hint(ui, { hint: q.hint });
  },
  hint(ui, d) {
    const g = ui.game, h = d.hint || '';
    if (ui.modal) ui.closeModal();
    if (h.startsWith('build:')) {
      const t = h.slice(6);
      if (g.byType(t, false).length && t !== 'decor_flowerbed' && t !== 'sawmill') { const b = g.s.buildings.find(x => x.type === t); ui.home.focusBuilding(b, 46); ui.openCtx('building', b.id); if (t === 'pool_shrine') ui.open('pool'); }
      else ui.open('build', { cat: BUILDINGS[t].cat });
    } else if (h === 'farm') { const b = g.s.buildings.find(x => x.type === 'farm_plot'); if (b) { ui.home.focusBuilding(b, 40); ui.openCtx('building', b.id); } else ui.open('build', { cat: 'produce' }); }
    else if (h === 'camp') ui.open('roster', { tab: 'guests' });
    else if (h === 'expedition') ACTIONS.expeditions(ui);
    else if (h === 'supply') ui.open('supply');
    else if (h === 'workshop') ui.open('workshop');
    else if (h === 'pool') ui.open('pool');
    else if (h === 'land') ui.open('land');
    else if (h === 'home') { const b = g.first('home'); ui.home.focusBuilding(b, 46); ui.openCtx('building', b.id); }
    else if (h === 'clear') ui.toast('Tap a tree, rock or bush on your land', '', 'item_axe');
  },

  // ---- markers in the world -------------------------------------------------------------------
  marker(ui, d) {
    const g = ui.game;
    switch (d.m) {
      case 'plant': { const b = g.building(d.id); if (b && b.lastCrop && g.homeLevel() >= CROPS[b.lastCrop].home) { const r = g.plant(b.id, b.lastCrop); if (!r.ok) ui.fail(r); } else ui.open('crops', { id: d.id }); break; }
      case 'harvest': { const r = g.harvest(d.id); if (!r.ok) ui.fail(r); break; }
      case 'collect': {
        const b = g.building(d.id), r = g.collect(d.id);
        if (r.ok) { const c = ui.home.center(b); ui.flyLoot({ x: c.x, y: 3, z: c.z }, r.got); ui.sfx.play('collect'); ui.home.bounce(b.id); } else ui.fail(r);
        break;
      }
      case 'chainer': ui.selectChainer(d.id); return;
      case 'building': { const b = g.building(d.id); if (b) { ui.home.focusBuilding(b); ui.openCtx('building', b.id); ui.sfx.play('click'); } return; }
      case 'claim': ACTIONS.claimExp(ui, { id: d.id }); return;
      case 'frontier': ACTIONS.expeditions(ui); return;
      case 'home': ui.exitFrontier(); return;
      case 'land': ui.open('land'); break;
      default: break;
    }
    refresh(ui);
  },

  // ---- building -------------------------------------------------------------------------------
  buildCan(ui) { if (ui.modal) { ui.modal.state.can = !ui.modal.state.can; ui.refreshModal(true); } },
  buildJump(ui, d) { const el = document.getElementById('bg-' + d.id); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  buildPick(ui, d) {
    const g = ui.game, chk = g.checkBuild(d.type);
    if (!chk.ok) { ui.fail(chk); return; }
    ui.closeModal();
    ui.beginPlacement(d.type, null);
  },
  moveB(ui, d) { const b = ui.game.building(d.id); if (!b) return; ui.closeCtx(); ui.beginPlacement(b.type, b.id); },
  removeB(ui, d) { const b = ui.game.building(d.id); if (b && confirm(`Remove ${BUILDINGS[b.type].name}? You get half the cost back.`)) { ui.game.demolish(d.id); ui.closeCtx(); } },
  placeConfirm(ui) {
    const type = ui.home.place && ui.home.place.type, moving = ui.home.place && ui.home.place.moveId;
    const r = ui.home.confirmPlace();
    if (!r.ok) { ui.fail(r); return; }
    ui.endPlacement();
    if (!moving && BUILDINGS[type].cat === 'decor' && ui.game.checkBuild(type).ok) ui.beginPlacement(type, null);   // keep placing decor
  },
  placeCancel(ui) { ui.home.cancelPlace(); ui.endPlacement(); },
  placeRotate(ui) { ui.home.rotatePlace(); },
  upgrade(ui, d) { const r = ui.game.upgrade(d.id); if (!r.ok) ui.fail(r); else { ui.sfx.play('place'); ui.renderCtx(); } },
  expand(ui) { const r = ui.game.expandLand(); if (!r.ok) ui.fail(r); else { ui.closeModal(); ui.celebrate({ title: 'New land!', hero: 'item_flag', text: 'Your land is bigger. New trees and rocks to clear.', sfx: 'fanfare' }); } },

  // ---- farm / production ------------------------------------------------------------------------
  plant(ui, d) { const r = ui.game.plant(d.id, d.crop); if (!r.ok) ui.fail(r); else ui.closeModal(); },
  enqueue(ui, d) { const r = ui.game.enqueue(d.id, +d.n); if (!r.ok) ui.fail(r); else { ui.sfx.play('place'); ui.home.bounce(d.id); } ui.renderCtx(); },
  collect(ui, d) { ACTIONS.marker(ui, { m: 'collect', id: d.id }); },
  craft(ui, d) { const r = ui.game.craftCrate(d.key); if (!r.ok) ui.fail(r); else { ui.sfx.play('place'); ui.toast(`Crafting: ${CRATES[d.key].name}`, 'good', CRATES[d.key].icon); } refresh(ui); },
  deposit(ui, d) { const r = ui.game.deposit(d.key, +d.n); if (!r.ok) ui.fail(r); refresh(ui); },

  // ---- chainers ---------------------------------------------------------------------------------
  feed(ui, d, el) { if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not enough Biopoints', 'bad'); return; } const r = ui.game.feed(d.id); if (!r.ok) ui.fail(r); refresh(ui); },
  recruit(ui, d) {
    const g = ui.game, c = g.chainer(d.id), r = g.recruit(d.id);
    if (!r.ok) { ui.fail(r); return; }
    ui.closeModal(); ui.closeCtx();
    ui.celebrate({ title: `${c.name} joined!`, hero: 'x', heroImg: ui.studio.portrait(c, 'full'), text: `New ${RARITY[c.rarity].name} Chainer. Yours forever.`, sfx: 'fanfare' });
  },
  kick(ui, d) {
    const g = ui.game, c = g.chainer(d.id);
    if (!c || !confirm(`Dismiss ${c.name}? Your cosiness drops by ${GRUDGE.kick}.`)) return;
    const r = g.release(d.id);
    if (!r.ok) ui.fail(r); else { ui.closeModal(); ui.closeCtx(); }
  },
  assign(ui, d) { const r = ui.game.assign(d.id, d.b); if (!r.ok) ui.fail(r); else { ui.closeModal(); ui.sfx.play('order'); ui.toast('Job assigned', 'good', 'item_hammer'); refresh(ui); } },
  assign2(ui, d) { const r = ui.game.assign(d.id, d.b); if (!r.ok) ui.fail(r); else { ui.closeModal(); ui.openCtx('building', d.b); } },
  unassign(ui, d) { ui.game.unassign(d.id); refresh(ui); if (ui.modal && (ui.modal.name === 'workers')) ui.closeModal(); },
  train(ui, d) { const r = ui.game.train(d.id, d.stat); if (!r.ok) ui.fail(r); else ui.toast('Training started', 'good', STATS[d.stat].icon); refresh(ui); },

  // ---- exchange ---------------------------------------------------------------------------------
  exPick(ui, d) { const st = ui.modal.state; st[d.key] = d.val; if (st.from === st.to) st.to = EXCHANGE.assets.find(k => k !== st.from); st.amt = undefined; ui.refreshModal(); },
  exAmt(ui, d, el) {
    const st = ui.modal.state, g = ui.game;
    st.amt = +el.value;
    const q = g.exQuote(st.from, st.to, st.amt);
    for (const [id, v] of [['ex-amt', fmt(st.amt)], ['ex-in', fmt(st.amt)], ['ex-out', fmt(q.out)]]) { const e = document.getElementById(id); if (e) e.textContent = v; }
  },
  exPct(ui, d) { const st = ui.modal.state; st.amt = Math.floor((ui.game.s.res[st.from] || 0) * (+d.p) / 100); ui.refreshModal(); },
  swap(ui) {
    const st = ui.modal.state, g = ui.game;
    const r = g.swap(st.from, st.to, st.amt);
    if (!r.ok) { ui.fail(r); return; }
    ui.sfx.play('swap');
    const el = document.getElementById('ex-out');
    const rc = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    ui.flyLoot({ x: rc.left + rc.width / 2, y: rc.top }, { [st.to]: r.out }, true);
    st.amt = undefined;
    ui.refreshModal();
  },

  // ---- the frontier ------------------------------------------------------------------------------
  expeditions(ui) {
    if (!ui.game.lodge()) { ui.toast('Build the Expedition Lodge first. It sends squads to the Frontier', 'bad', 'item_compass'); ui.open('build', { cat: 'core' }); return; }
    ui.enterFrontier();
  },
  frontier(ui) { ACTIONS.expeditions(ui); },
  goHome(ui) { ui.exitFrontier(); },
  zone(ui, d) {
    const reg = REGIONS.find(r => r.id === d.id);
    if (!ui.game.regionOpen(reg)) ui.toast(`${reg.name} is locked. Upgrade the Expedition Lodge to level ${reg.dock}`, 'bad', 'item_lock');
    ui.frontier.focusZone(d.id);
  },
  planOpen(ui, d) { ui.openPlan(d.id); },
  planClose(ui) { ui.plan = null; ui.renderSide(); ui.sfx.play('close'); },
  planTeam(ui, d) {
    const st = ui.plan, g = ui.game, c = g.chainer(d.id), poi = st && g.findPoi(st.id);
    if (!st || !c || !poi) return;
    const i = st.team.indexOf(d.id);
    if (i >= 0) st.team.splice(i, 1);
    else {
      if (!g.isFree(c)) { ui.toast(`${c.name} is busy: ${ui.statusOf(c).toLowerCase()}`, 'bad'); return; }
      if (st.team.length >= POI_TYPES[poi.type].team) { ui.toast('Squad is full. Tap a member to remove them', 'bad'); return; }
      st.team.push(d.id);
    }
    ui.renderSide();
  },
  planBest(ui) { const st = ui.plan, poi = st && ui.game.findPoi(st.id); if (poi) { st.team = ui.game.bestTeam(poi); ui.renderSide(); } },
  planSet(ui, d) {
    const st = ui.plan;
    if (!st) return;
    if (d.key === 'transport' && !ui.game.transportOpen(d.val)) { ui.toast(`${TRANSPORT[d.val].name} unlocks at Expedition Lodge level ${TRANSPORT[d.val].lodge}`, 'bad', 'item_lock'); return; }
    st[d.key] = d.val;
    ui.renderSide();
  },
  planGo(ui) {
    const st = ui.plan;
    if (!st) return;
    const r = ui.game.launch(st.id, st.team, st.approach, st.transport);
    if (!r.ok) { ui.fail(r); return; }
    ui.plan = null; ui.partyId = r.exp.id;
    ui.renderSide();
    ui.toast('Squad sent. Watch them on the map', 'good', 'item_compass');
    ui.frontier.focusParty(r.exp.id, 44);
  },
  partyOpen(ui, d) { ui.openParty(d.id); },
  partyClose(ui) { ui.partyId = null; ui.renderSide(); ui.sfx.play('close'); },
  partyShow(ui, d) { ui.frontier.focusParty(d.id, 36); },
  partyRecall(ui, d) {
    if (!confirm('Recall the squad now? On the way out they come back with no loot. At work they bring part of the loot.')) return;
    const r = ui.game.recall(d.id);
    if (!r.ok) ui.fail(r); else { ui.toast('Squad recalled. Heading home', '', 'item_compass'); ui.renderSide(); }
  },
  claimExp(ui, d) {
    const r = ui.game.claimExpedition(d.id);
    if (!r.ok) return;
    ui.lootReveal(r);
  },
  lootOpen(ui) { ui.lootOpen(); },
  lootPick(ui, d) { ui.lootPick(+d.i); },
  lootCollect(ui) { ui.lootCollect(); },

  // ---- a selected Chainer: orders ------------------------------------------------------------------
  cExp(ui, d, el) {
    if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not now', 'bad'); return; }
    ui.enterFrontier();
    ui.toast('Pick a place on the map to send a squad', '', 'item_compass');
  },
  cWork(ui, d, el) { if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not now', 'bad'); return; } ui.open('jobs', { id: d.id }); },
  cClear(ui, d, el) {
    if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not now', 'bad'); return; }
    const g = ui.game, c = g.chainer(d.id);
    // the nearest thing on your land that nobody is clearing yet
    let best = null, bd = 1e9;
    for (const cl of g.s.clearables) {
      if (cl.by || !g.isUnlocked(cl.x, cl.z)) continue;
      const wx = ui.home.tx(cl.x + 0.5), wz = ui.home.tx(cl.z + 0.5), dist = Math.hypot((c.px ?? 0) - wx, (c.pz ?? 0) - wz);
      if (dist < bd) { bd = dist; best = cl; }
    }
    if (!best) { ui.toast('Nothing to clear. New trees grow over time, or expand your land', '', 'item_axe'); return; }
    const r = g.startClear(best.id, c.id);
    if (!r.ok) { ui.fail(r); return; }
    ui.sfx.play('order');
    ui.toast(`${c.name} is clearing: ${CLEARABLES[best.type].name}`, '', 'item_axe');
    ui.renderCtx();
  },
  cBuild(ui, d, el) {
    if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not now', 'bad'); return; }
    const g = ui.game, sites = g.s.buildings.filter(b => (b.state === 'building' || b.state === 'upgrading') && !b.builder);
    if (sites.length === 1) ACTIONS.helpBuild(ui, { id: d.id, b: sites[0].id }); else ui.open('sites', { id: d.id });
  },
  cTrain(ui, d, el) { if (el && el.classList.contains('off')) { ui.toast(el.dataset.why || 'Not now', 'bad'); return; } ui.open('chainer', { id: d.id }); },
  cDetails(ui, d) { ui.open('chainer', { id: d.id }); },
  helpBuild(ui, d) {
    const g = ui.game, c = g.chainer(d.id), r = g.helpBuild(d.id, d.b);
    if (!r.ok) { ui.fail(r); return; }
    ui.closeModal();
    ui.sfx.play('order');
    ui.toast(`${c.name} is helping: ${Math.round((r.k - 1) * 100)}% faster`, 'good', 'item_hammer');
    refresh(ui);
  },
  selectChainer(ui, d) { ui.closeModal(); ui.selectChainer(d.id); },
  focusBuilding(ui, d) { const b = ui.game.building(d.id); if (!b) return; ui.closeModal(); ui.home.focusBuilding(b, 46); ui.openCtx('building', b.id); },

  // ---- supply lines ---------------------------------------------------------------------------------
  buyUpg(ui, d) {
    const r = ui.game.buyUpgrade(d.k);
    if (!r.ok) { ui.fail(r); return; }
    ui.sfx.play('unlock');
    ui.celebrate({ title: UPGRADES[d.k].name, hero: UPGRADES[d.k].icon, heroAlt: UPGRADES[d.k].alt, text: UPGRADES[d.k].desc, sfx: 'upgrade', button: 'Nice' });
    refresh(ui);
  },
  autoToggle(ui, d) { const a = ui.game.s.auto[d.k]; if (!a) return; ui.game.setAuto(d.k, { on: !a.on }); ui.sfx.play('auto_on'); ui.refreshModal(); },
  autoPick(ui, d) { ui.game.setAuto(d.k, { [d.key]: d.val }); ui.refreshModal(); },
  autoNum(ui, d, el) {
    const v = +el.value, path = d.key.split('.');
    ui.game.setAuto(d.k, path.length > 1 ? { [path[0]]: { [path[1]]: v } } : { [path[0]]: v });
    const out = document.getElementById(`au-${d.k}-${path[path.length - 1]}`);
    if (out) out.textContent = v;
  },
  music(ui) { const s = ui.game.s.settings; s.music = s.music === false; if (ui.sfx.music) ui.sfx.music(s.music); ui.refreshModal(); },
  amb(ui) { const s = ui.game.s.settings; s.amb = s.amb === false; if (ui.sfx.setVolume) ui.sfx.setVolume('ambience', s.amb ? 0.5 : 0); ui.refreshModal(); },
  tour(ui) { ui.closeModal(); if (ui.mode !== 'home') return; setTimeout(() => ui.tour(), 250); },
  coachNext(ui) { ui.coachNext(false); },
  coachSkip(ui) { ui.coachNext(true); },
};
