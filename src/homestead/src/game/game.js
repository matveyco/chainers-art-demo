// Chainers Homestead — game rules. No rendering here: the 3D world and the UI listen to `game.bus`.
import {
  TILE, GRID, RES, RES_ORDER, BASE_CAP, CRATES, STAT_KEYS, ACTIVITIES, RARITY, RARITY_ORDER, TRAITS, NAMES, WISHES,
  COSY_TIERS, GRUDGE, BUILDINGS, BUILD_TIME, ETH_STEP, LAND, CROPS, UPKEEP, GUEST, CLEARABLES, CLEARABLE_WEIGHTS, CLEARABLE_WEIGHTS_YARD,
  REGIONS, POI_TYPES, CONDITIONS, CONDITION_KEYS, EXPEDITION, POOL, POOL_ETH_PER_EPOCH, BOT_NAMES, EXCHANGE,
  xpForLevel, QUESTS, START, APPROACH, TRANSPORT, LUCKY, UPGRADES, UPGRADE_ORDER, AUTO_DEFAULT, LARDER_CAP, LEVEL_PERKS,
} from '../data/config.js';
import { SITES, pathLen } from '../data/frontier.js';
import { SEASONS, DEFAULT_SEASON } from '../data/seasons.js';
import { Bus, mulberry32, hashStr, clamp, rand, randInt, pick, weighted, uid } from '../core/util.js';

const SAVE_PREFIX = 'chainers_homestead_v1_';
const SAVE_VERSION = 3;

export class Game {
  constructor(user) {
    this.user = user;
    this.bus = new Bus();
    this.s = null;
    this._saveT = 0;
    this._tickAcc = 0;
  }

  // ------------------------------------------------------------------------------------------
  // time
  // ------------------------------------------------------------------------------------------
  now() { return (Date.now() + this.s.clockOffsetMs) / 1000; }
  /** Test speed-up: adds extra game time for the real time that passed (independent of frame rate). */
  advanceClock() {
    const real = Date.now();
    const d = Math.min(5000, real - (this._lastReal || real));
    this._lastReal = real;
    const sp = this.s.settings.speed || 1;
    if (sp !== 1) this.s.clockOffsetMs += d * (sp - 1);
  }

  // ------------------------------------------------------------------------------------------
  // save / load
  // ------------------------------------------------------------------------------------------
  static listUsers() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SAVE_PREFIX)) out.push(k.slice(SAVE_PREFIX.length));
      }
    } catch (e) { /* storage unavailable */ }
    return out;
  }
  load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_PREFIX + this.user); } catch (e) { /* ignore */ }
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && s.v === SAVE_VERSION) { this.s = s; this.isNew = false; this._afterLoad(); return; }
      } catch (e) { console.warn('save corrupted, starting fresh', e); }
    }
    this.isNew = true;
    this.s = this._newState();
    this._afterLoad();
  }
  save() {
    try { this.s.savedAt = Date.now(); localStorage.setItem(SAVE_PREFIX + this.user, JSON.stringify(this.s)); } catch (e) { /* ignore */ }
  }
  /** The season is a look, not a rule: it changes the world's dress and weather, never the numbers. */
  season() { return SEASONS[this.s.season] ? this.s.season : DEFAULT_SEASON; }
  setSeason(id) {
    if (!SEASONS[id] || id === this.season()) return false;
    this.s.season = id;
    this.bus.emit('season', id);
    this.save();
    return true;
  }
  wipe() { try { localStorage.removeItem(SAVE_PREFIX + this.user); } catch (e) { /* ignore */ } }

  _newState() {
    const seed = hashStr(this.user + ':' + Date.now());
    const r = mulberry32(seed);
    const s = {
      v: SAVE_VERSION, user: this.user, seed, createdAt: Date.now(), clockOffsetMs: 0, savedAt: Date.now(),
      res: { ...START.res }, eth: START.eth, crates: { crate1: 0, crate2: 0, crate3: 0 },
      xp: 0, level: 1, land: 0,
      buildings: [], clearables: [], chainers: [], expeditions: [], pois: {},
      guestTimer: 0, grudge: 0, upkeepAcc: 0, hungry: false, nextClearableAt: 0,
      pool: { epoch: 0, myPoints: 0, lifetime: 0, history: [], earned: 0 },
      exchange: null,
      quest: { idx: 0, c: { cleared: 0, harvest: 0, fed: 0, expeditions: 0, crates: 0, crate2: 0, deposits: 0, swaps: 0, recruited: 0, land: 0, ethEarned: 0 }, ready: false },
      settings: { sfx: true, speed: 1 }, artV: 2, season: DEFAULT_SEASON, rulesV: 2,
      upg: {}, auto: {}, larder: 0, draw: null,
      tally: { expeditions: 0, success: 0, harvests: 0, wanderers: 0 },
    };
    this.s = s;
    const now = this.now();
    s.lastTick = now;
    s.pool.epoch = Math.floor(now / POOL.epochSec);
    // the basic set: the home, the Wanderer Camp and your first Chainer
    const c = GRID / 2;
    s.buildings.push({ id: uid('b'), type: 'home', x: c - 2, z: c - 3, rot: 0, level: 1, state: 'ready', doneAt: 0 });
    s.buildings.push({ id: uid('b'), type: 'camp', x: c + START.camp[0], z: c + START.camp[1], rot: 0, level: 1, state: 'ready', doneAt: 0 });
    s.guestTimer = now + START.firstGuestSec;
    const first = this.makeChainer(r, 'common', true);
    first.stats = { might: 5, agility: 4, wits: 4, stamina: 4, luck: 3 };
    first.trait = 'lumberjack';
    s.chainers.push(first);
    this._scatterClearables(r);
    s.exchange = this._newExchange();
    s.nextClearableAt = now + 120;
    return s;
  }
  _afterLoad() {
    for (const k in this.s.res) this.s.res[k] = Math.min(this.s.res[k], this.capOf(k));      // storage is a hard limit now: trim what an old save held above it
    const s = this.s;
    for (const reg of REGIONS) if (!s.pois[reg.id]) s.pois[reg.id] = [];
    // saves from before the frontier: places and trips had no trail; start the frontier fresh and bring everyone home
    if ((s.rulesV | 0) < 2) {
      for (const e of s.expeditions || []) for (const id of e.team) { const c = s.chainers.find(x => x.id === id); if (c) { c.status = 'idle'; c.expId = null; } }
      s.expeditions = [];
      for (const reg of REGIONS) s.pois[reg.id] = [];
      s.upg = s.upg || {}; s.auto = s.auto || {}; s.larder = s.larder || 0; s.draw = null;
      s.rulesV = 2;
    }
    if (s.draw) this.luckyPick(Math.floor(Math.random() * 3));       // a lucky draw left open: keep a random card
    this._grantCamp();
    if ((s.artV | 0) < 2) {
      const busy = s.clearables.filter(c => c.by);
      s.clearables = busy;
      this._scatterClearables(mulberry32((s.seed | 0) + 77));
      s.artV = 2;
    }
    this.offlineReport = null;
    const before = { eth: s.eth, t: s.lastTick };
    this.tick(0, true);
    const away = this.now() - before.t;
    if (!this.isNew && away > 60) this.offlineReport = { away, eth: s.eth - before.eth };
  }

  /** Saves from before the camp was part of the basic set get one on the nearest free spot. */
  _grantCamp() {
    const s = this.s;
    if (s.buildings.some(b => b.type === 'camp')) return;
    const c = GRID / 2, tx = c + START.camp[0], tz = c + START.camp[1];
    let best = null;
    for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
      if (!this.canPlace('camp', x, z, 0)) continue;
      const d = Math.hypot(x - tx, z - tz);
      if (!best || d < best.d) best = { x, z, d };
    }
    if (!best) return;
    s.buildings.push({ id: uid('b'), type: 'camp', x: best.x, z: best.z, rot: 0, level: 1, state: 'ready', doneAt: 0 });
    if (!s.guestTimer) s.guestTimer = this.now() + START.firstGuestSec;
  }

  // ------------------------------------------------------------------------------------------
  // helpers: buildings, grid, costs
  // ------------------------------------------------------------------------------------------
  def(type) { return BUILDINGS[type]; }
  building(id) { return this.s.buildings.find(b => b.id === id); }
  byType(type, readyOnly = true) { return this.s.buildings.filter(b => b.type === type && (!readyOnly || b.level > 0 && b.state !== 'building')); }
  first(type) { return this.byType(type)[0] || null; }
  homeLevel() { const h = this.s.buildings.find(b => b.type === 'home'); return h ? h.level : 1; }
  countOf(type) { return this.s.buildings.filter(b => b.type === type).length; }
  maxOf(type) { const m = BUILDINGS[type].max; return Array.isArray(m) ? m[this.homeLevel() - 1] : m; }
  footprint(b) { const d = BUILDINGS[b.type].size; return (b.rot % 2) ? [d[1], d[0]] : [d[0], d[1]]; }
  sizeOf(type, rot = 0) { const d = BUILDINGS[type].size; return (rot % 2) ? [d[1], d[0]] : [d[0], d[1]]; }
  half() { return LAND.startHalf + this.s.land * LAND.ringTiles; }
  isUnlocked(x, z) { const h = this.half(), c = GRID / 2; return x >= c - h && x < c + h && z >= c - h && z < c + h; }
  inGrid(x, z) { return x >= 0 && z >= 0 && x < GRID && z < GRID; }
  occupancy(ignoreId = null) {
    const g = new Map();
    for (const b of this.s.buildings) {
      if (b.id === ignoreId) continue;
      const [w, d] = this.footprint(b);
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) g.set((b.x + i) + ',' + (b.z + j), b.id);
    }
    for (const c of this.s.clearables) g.set(c.x + ',' + c.z, c.id);
    return g;
  }
  canPlace(type, x, z, rot, ignoreId = null) {
    const [w, d] = this.sizeOf(type, rot);
    const occ = this.occupancy(ignoreId);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const tx = x + i, tz = z + j;
      if (!this.inGrid(tx, tz) || !this.isUnlocked(tx, tz) || occ.has(tx + ',' + tz)) return false;
    }
    return true;
  }
  cost(type, level) {
    const d = BUILDINGS[type];
    const out = {};
    const mul = Math.pow(d.growth || 1, level - 1);
    for (const k in d.base) { const v = d.base[k] * mul; out[k] = v > 40 ? Math.round(v / 5) * 5 : Math.round(v); }
    if (d.add && d.add[level]) for (const k in d.add[level]) out[k] = (out[k] || 0) + d.add[level][k];
    // refined goods never scale wildly with the base curve
    const eth = +(((ETH_STEP[level] || 0) * (d.ethMul || 0)) + (level === 1 ? (d.eth || 0) : 0)).toFixed(5);
    return { res: out, eth, time: Math.round((BUILD_TIME[level] || 8) * (d.cat === 'decor' ? 0.4 : 1) * (type === 'home' ? 1.5 : 1)) };
  }
  homeReqFor(type, level) {
    const d = BUILDINGS[type];
    if (type === 'home') return 1;
    if (d.homeReq) return d.homeReq[level - 1] || 1;
    return level <= 1 ? 1 : level;
  }
  canAfford(c) {
    if (!c) return true;
    for (const k in (c.res || {})) if ((this.s.res[k] || 0) < c.res[k]) return false;
    return (this.s.eth + 1e-12) >= (c.eth || 0);
  }
  missing(c) {
    const out = [];
    for (const k in (c.res || {})) if ((this.s.res[k] || 0) < c.res[k]) out.push(k);
    if ((this.s.eth + 1e-12) < (c.eth || 0)) out.push('eth');
    return out;
  }
  pay(c) {
    for (const k in (c.res || {})) this.s.res[k] -= c.res[k];
    if (c.eth) this.s.eth = Math.max(0, this.s.eth - c.eth);
    this.bus.emit('res');
  }
  capOf(k) {
    let cap = BASE_CAP[k] || 0;
    if (k === 'bio') { for (const g of this.byType('granary')) cap += BUILDINGS.granary.bioCap[g.level - 1]; return cap; }
    let mul = 1;
    for (const w of this.byType('warehouse')) mul += BUILDINGS.warehouse.capMul[w.level - 1];
    return Math.round(cap * mul);
  }
  /** Ways to get more room for a resource: [{ type, id?, text, cap }] with the cap you would have after each. */
  storageOptions(k) {
    const type = k === 'bio' ? 'granary' : 'warehouse', d = BUILDINGS[type], now = this.capOf(k), out = [];
    const step = (lv) => (k === 'bio' ? d.bioCap[lv - 1] : Math.round((BASE_CAP[k] || 0) * d.capMul[lv - 1]));
    for (const b of this.byType(type)) {
      if (b.level >= d.maxLevel || b.level < 1) continue;
      out.push({ type, id: b.id, text: `Upgrade the ${d.name} to level ${b.level + 1}`, cap: now - step(b.level) + step(b.level + 1) });
    }
    if (this.countOf(type) < this.maxOf(type)) out.push({ type, text: `Build ${this.countOf(type) ? 'another' : 'a'} ${d.name}`, cap: now + step(1) });
    else if (!out.length) { const nx = Array.isArray(d.max) ? d.max.findIndex(m => m > this.countOf(type)) : -1; if (nx >= 0) out.push({ type, locked: true, text: `Another ${d.name} at Chainer Home level ${nx + 1}`, cap: now + step(1) }); }
    return out.sort((x, y) => x.cap - y.cap);
  }
  /** Adds resources respecting caps. Returns what was actually added. */
  give(map, opts = {}) {
    const got = {};
    for (const k in map) {
      if (k === 'eth') { this.s.eth += map[k]; got[k] = map[k]; continue; }
      if (CRATES[k]) { this.s.crates[k] += map[k]; got[k] = map[k]; continue; }
      // Storage is a hard limit, for rewards too: what does not fit is lost, and the player is told (build more storage)
      const room = Math.max(0, this.capOf(k) - (this.s.res[k] || 0));
      const add = Math.min(room, Math.floor(map[k]));
      this.s.res[k] = (this.s.res[k] || 0) + add;
      got[k] = add;
      if (add < Math.floor(map[k])) { got._full = true; (got._lost = got._lost || {})[k] = Math.floor(map[k]) - add; }
    }
    this.bus.emit('res');
    if (got._lost && !opts.quiet) this.bus.emit('waste', got._lost);
    return got;
  }
  addXp(n) {
    const s = this.s;
    s.xp += n;
    let up = false;
    while (s.xp >= xpForLevel(s.level)) { s.xp -= xpForLevel(s.level); s.level++; up = true; }
    if (up) {
      const reward = { bio: 40 + s.level * 15, wood: 30 + s.level * 10, stone: 30 + s.level * 10 };
      const got = this.give(reward, { quiet: true });      // the card itself says what a full Storage cost you
      this.bus.emit('levelup', s.level, got);
    }
    this.bus.emit('xp');
  }
  activeBuilds() { return this.s.buildings.filter(b => b.state === 'building' || b.state === 'upgrading').length; }
  builderSlots() { return BUILDINGS.home.builders[this.homeLevel() - 1]; }

  // ------------------------------------------------------------------------------------------
  // building actions
  // ------------------------------------------------------------------------------------------
  checkBuild(type) {
    const d = BUILDINGS[type];
    if (this.countOf(type) >= this.maxOf(type)) {
      const next = Array.isArray(d.max) ? d.max.findIndex(m => m > this.countOf(type)) : -1;
      return { ok: false, why: next >= 0 ? `Needs Chainer Home level ${next + 1} to build more` : 'Maximum built', home: next >= 0 ? next + 1 : 0 };
    }
    const req = this.homeReqFor(type, 1);
    if (this.homeLevel() < req) return { ok: false, why: `Needs Chainer Home level ${req}`, home: req };
    const c = this.cost(type, 1);
    if (!this.canAfford(c)) return { ok: false, why: 'Not enough resources', cost: c, afford: false };
    if (this.activeBuilds() >= this.builderSlots()) return { ok: false, why: 'All builders are busy', cost: c };
    return { ok: true, cost: c };
  }
  build(type, x, z, rot = 0) {
    const chk = this.checkBuild(type);
    if (!chk.ok) return chk;
    if (!this.canPlace(type, x, z, rot)) return { ok: false, why: 'Cannot build here' };
    this.pay(chk.cost);
    const b = { id: uid('b'), type, x, z, rot, level: 0, state: 'building', startAt: this.now(), doneAt: this.now() + chk.cost.time };
    this.s.buildings.push(b);
    this.bus.emit('building:add', b);
    this.save();
    return { ok: true, b };
  }
  checkUpgrade(b) {
    const d = BUILDINGS[b.type];
    if (b.state !== 'ready') return { ok: false, why: 'This building is busy' };
    if (b.level >= d.maxLevel) return { ok: false, why: 'Max level', max: true };
    const next = b.level + 1;
    const c = this.cost(b.type, next);
    const req = this.homeReqFor(b.type, next);
    if (b.type !== 'home' && this.homeLevel() < req) return { ok: false, why: `Needs Chainer Home level ${req}`, cost: c, home: req };
    if (b.type === 'home' && this.s.level < (next - 1) * 2) return { ok: false, why: `Needs Homestead level ${(next - 1) * 2}`, cost: c, level: (next - 1) * 2 };
    if (!this.canAfford(c)) return { ok: false, why: c.eth > this.s.eth ? 'Not enough ETH. Earn it from the Reward Pool' : 'Not enough resources', cost: c, afford: false };
    if (this.activeBuilds() >= this.builderSlots()) return { ok: false, why: 'All builders are busy', cost: c };
    return { ok: true, cost: c };
  }
  upgrade(id) {
    const b = this.building(id);
    const chk = this.checkUpgrade(b);
    if (!chk.ok) return chk;
    this.pay(chk.cost);
    b.state = 'upgrading'; b.startAt = this.now(); b.doneAt = this.now() + chk.cost.time;
    this.bus.emit('building:change', b);
    this.save();
    return { ok: true };
  }
  move(id, x, z, rot) {
    const b = this.building(id);
    if (!b || !this.canPlace(b.type, x, z, rot, id)) return false;
    b.x = x; b.z = z; b.rot = rot;
    this.bus.emit('building:move', b);
    this.save();
    return true;
  }
  demolish(id) {
    const b = this.building(id);
    if (!b || BUILDINGS[b.type].cat !== 'decor' && b.type !== 'well' && b.type !== 'farm_plot') return false;
    if (b.worker) this.unassign(b.worker);
    const refund = {};
    const c = this.cost(b.type, 1).res;
    for (const k in c) refund[k] = Math.floor(c[k] * 0.5);
    this.s.buildings = this.s.buildings.filter(x => x.id !== id);
    this.give(refund);
    this.bus.emit('building:remove', b);
    this.bus.emit('cosy');
    this.save();
    return true;
  }
  _finishBuilding(b) {
    b.level += 1;
    const wasNew = b.state === 'building';
    b.state = 'ready';
    if (b.builder) { const c = this.chainer(b.builder); if (c && c.status === 'build') { c.status = 'idle'; c.jobAt = null; this.chainerXp(c, 6); this.bus.emit('chainer:change', c); } b.builder = null; b.builderK = 0; }
    const d = BUILDINGS[b.type];
    this.addXp(8 + b.level * 6 + (d.cat === 'decor' ? 0 : 6));
    if (b.type === 'camp' && wasNew) this.s.guestTimer = this.now() + 6;
    this.bus.emit('building:done', b, wasNew);
    this.bus.emit('cosy');
  }

  // ------------------------------------------------------------------------------------------
  // land
  // ------------------------------------------------------------------------------------------
  /** What the next expansion adds: tiles, and the trees, rocks and bushes standing on them with what they hold. */
  landPreview() {
    const h = this.half(), c = GRID / 2, n = h + LAND.ringTiles;
    const inNew = (x, z) => x >= c - n && x < c + n && z >= c - n && z < c + n && !this.isUnlocked(x, z);
    const out = { tiles: (2 * n) * (2 * n) - (2 * h) * (2 * h), count: 0, give: {}, from: h, to: n };
    for (const cl of this.s.clearables) {
      if (!inNew(cl.x, cl.z)) continue;
      out.count++;
      const g = (CLEARABLES[cl.type] || {}).give || {};
      for (const k in g) out.give[k] = (out.give[k] || 0) + Math.round((g[k][0] + g[k][1]) / 2);
    }
    return out;
  }
  landCost() { const r = LAND.rings[this.s.land]; return r ? { res: r.cost, eth: r.eth } : null; }
  expandLand() {
    const c = this.landCost();
    if (!c) return { ok: false, why: 'Your land is at max size' };
    if (!this.canAfford(c)) return { ok: false, why: c.eth > this.s.eth ? 'Not enough ETH' : 'Not enough resources' };
    this.pay(c);
    this.s.land++;
    this.s.quest.c.land++;
    this.addXp(40);
    this.bus.emit('land');
    this.save();
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------
  // clearables
  // ------------------------------------------------------------------------------------------
  _scatterClearables(r) {
    const s = this.s;
    const occ = this.occupancy();
    const c = GRID / 2;
    // keep a one-tile apron around the starting buildings (two in front, where Chainers gather)
    const apron = new Set();
    for (const b of s.buildings) {
      const [w, d] = this.footprint(b);
      for (let i = -1; i <= w; i++) for (let j = -1; j <= d + 1; j++) apron.add((b.x + i) + ',' + (b.z + j));
    }
    for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
      if (occ.has(x + ',' + z) || apron.has(x + ',' + z)) continue;
      const dx = x - c + 0.5, dz = z - c + 0.5;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 3.6) continue;                    // keep the heart of the home clear
      const yard = this.isUnlocked(x, z);
      if (r() < (yard ? 0.12 : 0.27)) s.clearables.push({ id: uid('c'), type: weighted(yard ? CLEARABLE_WEIGHTS_YARD : CLEARABLE_WEIGHTS, r), x, z, rot: Math.floor(r() * 4), sc: 0.85 + r() * 0.3 });
    }
    // the first quest says "tap a tree": make sure a new player's own land has trees to tap (at least three)
    const mineTrees = () => s.clearables.filter(cl => cl.type.startsWith('tree') && this.isUnlocked(cl.x, cl.z)).length;
    for (let tries = 0; tries < 400 && mineTrees() < 3; tries++) {
      const h = this.half(), x = Math.floor(c - h + r() * h * 2), z = Math.floor(c - h + r() * h * 2);
      const d = Math.max(Math.abs(x - c + 0.5), Math.abs(z - c + 0.5));
      if (d < 3.6 || occ.has(x + ',' + z) || apron.has(x + ',' + z) || s.clearables.some(cl => cl.x === x && cl.z === z)) continue;
      s.clearables.push({ id: uid('c'), type: ['tree_a', 'tree_b', 'tree_pine'][Math.floor(r() * 3)], x, z, rot: Math.floor(r() * 4), sc: 0.85 + r() * 0.3 });
    }
  }
  startClear(cid, whoId = null) {
    const c = this.s.clearables.find(x => x.id === cid);
    if (!c) return { ok: false, why: 'Already cleared' };
    if (c.by) return { ok: false, why: 'Already being cleared' };
    if (!this.isUnlocked(c.x, c.z)) return { ok: false, why: 'Expand your land to reach it', locked: true };
    const asked = whoId ? this.chainer(whoId) : null;
    const who = asked && this.isFree(asked) ? asked : this.nearestFree(c.x, c.z);
    if (!who) return { ok: false, why: 'No free Chainer. Everyone is busy or resting' };
    const def = CLEARABLES[c.type];
    const wx = (c.x + 0.5 - GRID / 2) * TILE, wz = (c.z + 0.5 - GRID / 2) * TILE;
    const dist = Math.hypot((who.px ?? 0) - wx, (who.pz ?? 0) - wz);
    const walk = dist / 3.4;
    const score = this.actScore(who, def.act);
    const work = def.time * clamp(1.25 - score * 0.05, 0.55, 1.2);
    c.by = who.id; c.workAt = this.now() + walk; c.endsAt = this.now() + walk + work;
    who.status = 'clearing'; who.target = c.id; who.busyUntil = c.endsAt;
    this.bus.emit('clear:start', c, who);
    return { ok: true, c, who };
  }
  _finishClear(c) {
    const who = this.chainer(c.by);
    const def = CLEARABLES[c.type];
    const loot = {};
    for (const k in def.give) {
      let n = randInt(def.give[k][0], def.give[k][1]);
      if (who) n = Math.round(n * this.traitLoot(who, k));
      loot[k] = n;
    }
    this.s.clearables = this.s.clearables.filter(x => x.id !== c.id);
    const got = this.give(loot);
    if (who) { who.status = 'idle'; who.target = null; who.px = (c.x + 0.5 - GRID / 2) * TILE; who.pz = (c.z + 0.5 - GRID / 2) * TILE; this.chainerXp(who, 4); }
    this.s.quest.c.cleared++;
    this.addXp(def.xp);
    this.bus.emit('clear:done', c, got, who);
  }
  _spawnClearable() {
    const s = this.s;
    const limit = 10 + this.half() * 2;
    const mine = s.clearables.filter(c => this.isUnlocked(c.x, c.z)).length;
    if (mine >= limit) return;
    const occ = this.occupancy();
    const h = this.half(), c0 = GRID / 2;
    for (let tries = 0; tries < 30; tries++) {
      const x = randInt(c0 - h, c0 + h - 1), z = randInt(c0 - h, c0 + h - 1);
      if (occ.has(x + ',' + z)) continue;
      // avoid spawning right against buildings
      let near = false;
      for (let i = -1; i <= 1 && !near; i++) for (let j = -1; j <= 1; j++) { const o = occ.get((x + i) + ',' + (z + j)); if (o && o.startsWith('b_')) { near = true; break; } }
      if (near) continue;
      const cl = { id: uid('c'), type: weighted(CLEARABLE_WEIGHTS_YARD), x, z, rot: randInt(0, 3), sc: 0.85 + Math.random() * 0.3, fresh: true };
      s.clearables.push(cl);
      this.bus.emit('clear:spawn', cl);
      return;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Chainers
  // ------------------------------------------------------------------------------------------
  makeChainer(r, rarity, owned = false) {
    const R = RARITY[rarity];
    const budget = randInt(R.budget[0], R.budget[1], r);
    const stats = { might: 1, agility: 1, wits: 1, stamina: 1, luck: 1 };
    const mains = ['might', 'agility', 'wits'];
    const primary = pick(mains, r);
    const w = { might: 0.6 + r(), agility: 0.6 + r(), wits: 0.6 + r(), stamina: 0.5 + r() * 0.8, luck: 0.4 + r() * 0.8 };
    w[primary] += 1.3;
    let left = budget - 5;
    const tot = STAT_KEYS.reduce((a, k) => a + w[k], 0);
    for (const k of STAT_KEYS) { const add = Math.floor(left * w[k] / tot); stats[k] += add; }
    let spent = STAT_KEYS.reduce((a, k) => a + stats[k], 0);
    while (spent < budget) { stats[pick(STAT_KEYS, r)]++; spent++; }
    for (const k of STAT_KEYS) stats[k] = Math.min(stats[k], k === 'stamina' || k === 'luck' ? 10 : 12);
    const price = +(rand(R.price[0], R.price[1], r) * (0.9 + (budget - R.budget[0]) / Math.max(1, R.budget[1] - R.budget[0]) * 0.25)).toFixed(4);
    const used = new Set(this.s ? this.s.chainers.map(c => c.name) : []);
    let name = pick(NAMES, r);
    for (let i = 0; i < 20 && used.has(name); i++) name = pick(NAMES, r);
    return {
      id: uid('ch'), name, rarity, stats, trained: {}, trait: pick(Object.keys(TRAITS), r), level: 1, xp: 0,
      look: Math.floor(r() * 2147483647), owned, status: 'idle', px: (r() - 0.5) * 6, pz: (r() - 0.5) * 6 + 3,
      price, wish: pick(Object.keys(WISHES), r), fed: owned, arrivedAt: 0, leavesAt: 0,
    };
  }
  chainer(id) { return this.s.chainers.find(c => c.id === id); }
  owned() { return this.s.chainers.filter(c => c.owned); }
  guests() { return this.s.chainers.filter(c => !c.owned); }
  ownedSlots() { return BUILDINGS.home.slots[this.homeLevel() - 1]; }
  guestSlots() { const c = this.first('camp'); return c ? BUILDINGS.camp.guests[c.level - 1] : 0; }
  stat(c, k) { return c.stats[k] + (c.trained[k] || 0); }
  wishMet(c) {
    const w = WISHES[c.wish];
    if (!w) return false;
    for (const t in w.need) if (this.byType(t).length < w.need[t]) return false;
    return true;
  }
  mood(c) {
    if (!c.owned) { if (!c.fed) return 'hungry'; return this.wishMet(c) ? 'delighted' : 'happy'; }
    return this.s.hungry ? 'hungry' : 'happy';
  }
  moodMul(c) {
    const m = this.mood(c);
    if (m === 'delighted') return GUEST.delightedStat;
    if (m === 'hungry') return c.owned ? UPKEEP.hungryStatMul : 0;
    return 1;
  }
  levelMul(c) { return 1 + 0.05 * (c.level - 1); }
  /** weighted stat score for an activity, 0..12-ish (no mood) */
  actScore(c, act, cond = null) {
    const w = ACTIVITIES[act].w;
    let v = 0;
    for (const k in w) v += w[k] * this.stat(c, k) * ((cond && cond.stat && cond.stat[k]) || 1);
    return v;
  }
  power(c, act, cond = null) {
    let p = this.actScore(c, act, cond) * 10 * this.levelMul(c) * this.moodMul(c);
    if (act === 'fight' && c.trait === 'brawler') p *= 1.2;
    return p;
  }
  traitLoot(c, res) {
    if (c.trait === 'lumberjack' && res === 'wood') return 1.25;
    if (c.trait === 'stonehand' && (res === 'stone' || res === 'ore')) return 1.25;
    return 1;
  }
  isFree(c) { return c.status === 'idle' && (c.owned || c.fed); }
  canWork(c) { return c.owned || c.fed; }
  nearestFree(tx, tz) {
    const wx = (tx + 0.5 - GRID / 2) * TILE, wz = (tz + 0.5 - GRID / 2) * TILE;
    let best = null, bd = 1e9;
    for (const c of this.s.chainers) {
      if (!this.isFree(c)) continue;
      const d = Math.hypot((c.px ?? 0) - wx, (c.pz ?? 0) - wz) + (c.owned ? 0 : 4);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  chainerXp(c, n) {
    c.xp += n;
    let up = false;
    while (c.level < 10 && c.xp >= 30 * c.level * c.level) { c.xp -= 30 * c.level * c.level; c.level++; up = true; }
    if (up) this.bus.emit('chainer:levelup', c);
  }
  assign(cid, bid) {
    const c = this.chainer(cid), b = this.building(bid);
    if (!c || !b || !this.isFree(c)) return { ok: false, why: 'That Chainer is busy' };
    if (!BUILDINGS[b.type].job) return { ok: false, why: 'No job here' };
    if (b.worker) this.unassign(b.worker);
    b.worker = c.id; c.status = 'job'; c.jobAt = b.id;
    this.bus.emit('chainer:change', c); this.bus.emit('building:change', b);
    return { ok: true };
  }
  unassign(cid) {
    const c = this.chainer(cid);
    if (!c) return;
    if (c.status === 'build') { this.stopBuild(cid); return; }
    const b = this.building(c.jobAt);
    if (b && b.worker === cid) { b.worker = null; this.bus.emit('building:change', b); }
    if (c.status === 'job') c.status = 'idle';
    c.jobAt = null;
    this.bus.emit('chainer:change', c);
  }
  jobBonus(b) {
    const d = BUILDINGS[b.type];
    if (!b.worker || !d.job) return 0;
    const c = this.chainer(b.worker);
    if (!c) return 0;
    let bonus = this.actScore(c, d.job) * 0.035 * this.levelMul(c) * Math.max(0.5, this.moodMul(c));
    if (b.type === 'farm_plot' && c.trait === 'greenthumb') bonus += 0.3;
    if (b.type !== 'farm_plot' && c.trait === 'tinkerer') bonus += 0.25;
    return bonus;
  }
  release(cid) {
    const c = this.chainer(cid);
    if (!c) return { ok: false };
    if (c.status === 'expedition' || c.status === 'clearing') return { ok: false, why: 'Wait until they are back' };
    if (c.owned && this.owned().length <= 1) return { ok: false, why: 'You need at least one Chainer' };
    this.unassign(cid);
    this.s.chainers = this.s.chainers.filter(x => x.id !== cid);
    this.s.grudge += GRUDGE.kick;
    this.bus.emit('chainer:leave', c, 'kicked');
    this.bus.emit('cosy');
    this.save();
    return { ok: true };
  }
  // ---- guests ---------------------------------------------------------------------------------
  feedCost(c) { return GUEST.feedCost[c.rarity]; }
  feed(cid) {
    const c = this.chainer(cid);
    if (!c || c.owned) return { ok: false };
    const cost = Math.round(this.feedCost(c) * (c.fed ? GUEST.extendCostMul : 1));
    if (this.s.res.bio < cost) return { ok: false, why: 'Not enough Biopoints. Harvest crops for more' };
    this.s.res.bio -= cost;
    if (!c.fed) { c.fed = true; c.leavesAt = this.now() + GUEST.fedStay; this.s.quest.c.fed++; this.addXp(10); }
    else c.leavesAt = Math.min(c.leavesAt + GUEST.extendStay, this.now() + GUEST.fedStay * 2);
    this.bus.emit('res'); this.bus.emit('chainer:change', c); this.bus.emit('guest:fed', c);
    this.save();
    return { ok: true };
  }
  recruitPrice(c) { return +(c.price * (this.mood(c) === 'delighted' ? 1 - GUEST.delightedDiscount : 1)).toFixed(4); }
  recruit(cid) {
    const c = this.chainer(cid);
    if (!c || c.owned) return { ok: false };
    if (this.owned().length >= this.ownedSlots()) return { ok: false, why: 'Chainer Home is full. Upgrade it for more beds' };
    const price = this.recruitPrice(c);
    if (this.s.eth + 1e-12 < price) return { ok: false, why: 'Not enough ETH. Earn it from the Reward Pool' };
    this.s.eth = Math.max(0, this.s.eth - price);
    c.owned = true; c.fed = true; c.leavesAt = 0;
    this.s.quest.c.recruited++;
    this.addXp(60);
    this.bus.emit('res'); this.bus.emit('chainer:change', c); this.bus.emit('chainer:recruited', c);
    this.save();
    return { ok: true };
  }
  _rollRarity() {
    const tier = this.cosyTier();
    return weighted(RARITY_ORDER.map((k, i) => [k, tier.odds[i]]));
  }
  _guestArrive() {
    const c = this.makeChainer(Math.random, this._rollRarity(), false);
    c.fed = false; c.arrivedAt = this.now(); c.leavesAt = this.now() + GUEST.hungryStay;
    const camp = this.first('camp');
    if (camp) { c.px = (camp.x + 1.5 - GRID / 2) * TILE + rand(-1, 1); c.pz = (camp.z + 3.4 - GRID / 2) * TILE; }
    this.s.chainers.push(c);
    this.s.tally.wanderers++;
    this.bus.emit('guest:arrive', c);
  }
  _scheduleGuest() {
    const camp = this.first('camp');
    const f = camp ? [1, 0.88, 0.76, 0.64][camp.level - 1] : 1;
    this.s.guestTimer = this.now() + this.cosyTier().interval * f * rand(0.8, 1.2);
  }
  _guestLeave(c) {
    this.unassign(c.id);
    this.s.chainers = this.s.chainers.filter(x => x.id !== c.id);
    if (c.fed) {
      const k = pick(['wood', 'stone', 'bio']);
      const gift = { [k]: 15 + RARITY[c.rarity].stars * 12 };
      this.give(gift);
      this.bus.emit('chainer:leave', c, 'thanks', gift);
    } else {
      this.s.grudge += GRUDGE.leftHungry;
      this.bus.emit('chainer:leave', c, 'hungry');
      this.bus.emit('cosy');
    }
  }
  // ---- training ------------------------------------------------------------------------------------
  trainedTotal(c) { return STAT_KEYS.reduce((a, k) => a + (c.trained[k] || 0), 0); }
  trainCost(c) { const n = this.trainedTotal(c) + 1; return { res: { bio: 50 * n, wood: 25 * n, stone: 25 * n }, eth: 0, time: 20 + 15 * n }; }
  train(cid, stat) {
    const c = this.chainer(cid), a = this.first('arena');
    if (!a) return { ok: false, why: 'Build a Training Ground first' };
    if (!c || !c.owned) return { ok: false, why: 'Only your own Chainers can train' };
    if (!this.isFree(c)) return { ok: false, why: 'That Chainer is busy' };
    if (this.trainedTotal(c) >= BUILDINGS.arena.trainCap[a.level - 1]) return { ok: false, why: 'Training limit reached. Upgrade the Training Ground' };
    if (this.stat(c, stat) >= 15) return { ok: false, why: 'This stat is at max' };
    const cost = this.trainCost(c);
    if (!this.canAfford(cost)) return { ok: false, why: 'Not enough resources' };
    this.pay(cost);
    c.status = 'train'; c.trainStat = stat; c.busyUntil = this.now() + cost.time;
    this.bus.emit('chainer:change', c);
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------
  // cosiness
  // ------------------------------------------------------------------------------------------
  cosy() {
    let v = 0;
    for (const b of this.s.buildings) { if (b.level < 1) continue; const cz = BUILDINGS[b.type].cosy; v += cz[Math.min(cz.length, b.level) - 1] || 0; }
    return Math.max(0, Math.round(v - this.s.grudge));
  }
  cosyTier(v = this.cosy()) { let t = COSY_TIERS[0]; for (const x of COSY_TIERS) if (v >= x.min) t = x; return t; }
  cosyNext(v = this.cosy()) { return COSY_TIERS.find(x => x.min > v) || null; }

  // ------------------------------------------------------------------------------------------
  // farm
  // ------------------------------------------------------------------------------------------
  plant(bid, crop, at = this.now(), auto = false) {
    const b = this.building(bid), cr = CROPS[crop];
    if (!b || b.type !== 'farm_plot' || b.state === 'building' || b.crop) return { ok: false, why: 'This plot is busy' };
    if (this.homeLevel() < cr.home) return { ok: false, why: `Needs Home level ${cr.home}` };
    b.crop = crop; b.plantedAt = at; b.readyAt = at + cr.time; b.lastCrop = crop;
    this.bus.emit('farm:plant', b, auto);
    return { ok: true };
  }
  farmYield(b, crop = b.crop) {
    const cr = CROPS[crop];
    return Math.round(cr.bio * BUILDINGS.farm_plot.yieldMul[Math.max(1, b.level) - 1] * (1 + this.jobBonus(b)));
  }
  harvest(bid, auto = false) {
    const b = this.building(bid);
    if (!b || !b.crop || this.now() < b.readyAt) return { ok: false };
    const cr = CROPS[b.crop];
    const loot = { bio: this.farmYield(b) };
    if (cr.bonus) for (const k in cr.bonus) loot[k] = randInt(cr.bonus[k][0], cr.bonus[k][1]);
    if (this.s.res.bio >= this.capOf('bio')) return { ok: false, why: 'Biopoints storage is full. Build or upgrade a Granary' };
    const got = this.give(loot);
    const crop = b.crop;
    b.crop = null; b.plantedAt = 0; b.readyAt = 0;
    this.s.quest.c.harvest++; this.s.tally.harvests++;
    this.addXp(cr.xp);
    if (b.worker) { const w = this.chainer(b.worker); if (w) this.chainerXp(w, 3); }
    this.bus.emit('farm:harvest', b, got, crop, auto);
    return { ok: true, got, crop };
  }

  // ------------------------------------------------------------------------------------------
  // producers (sawmill / stonecutter / smelter) and the crate workshop
  // ------------------------------------------------------------------------------------------
  batchTime(b) {
    const d = BUILDINGS[b.type];
    return d.recipe.time / (d.speed[b.level - 1] * (1 + this.jobBonus(b)));
  }
  queueCap(b) { return BUILDINGS[b.type].queue[b.level - 1]; }
  enqueue(bid, n) {
    const b = this.building(bid), d = BUILDINGS[b.type];
    if (!b || !d.recipe || b.state === 'building') return { ok: false };
    const room = this.queueCap(b) - (b.queue || 0) - (b.stored || 0);
    n = Math.min(n, room);
    for (const k in d.recipe.in) n = Math.min(n, Math.floor(this.s.res[k] / d.recipe.in[k]));
    if (n <= 0) return { ok: false, why: room <= 0 ? 'Collect the finished goods first' : 'Not enough resources' };
    for (const k in d.recipe.in) this.s.res[k] -= d.recipe.in[k] * n;
    if (!b.queue) { b.batchStart = this.now(); b.batchEnd = this.now() + this.batchTime(b); }
    b.queue = (b.queue || 0) + n;
    this.bus.emit('res'); this.bus.emit('building:change', b);
    return { ok: true, n };
  }
  collect(bid, auto = false) {
    const b = this.building(bid), d = BUILDINGS[b.type];
    if (!b) return { ok: false };
    if (b.type === 'workshop') {
      const done = b.done || {};
      let any = false; const got = {};
      for (const k in done) if (done[k] > 0) { this.s.crates[k] += done[k]; got[k] = done[k]; any = true; }
      b.done = {};
      if (!any) return { ok: false };
      this.bus.emit('res'); this.bus.emit('building:change', b);
      return { ok: true, got };
    }
    if (!d.recipe || !(b.stored > 0)) return { ok: false };
    const out = {};
    for (const k in d.recipe.out) out[k] = d.recipe.out[k] * b.stored;
    const got = this.give(out);
    let took = b.stored;
    for (const k in d.recipe.out) took = Math.min(took, Math.floor(got[k] / d.recipe.out[k]));
    b.stored -= took;
    if (took <= 0) return { ok: false, why: 'Storage is full. Upgrade the Warehouse' };
    this.addXp(took);
    this.bus.emit('building:change', b);
    if (auto) this.bus.emit('supply:stored', b, got);
    return { ok: true, got };
  }
  _advanceProducer(b, now) {
    const d = BUILDINGS[b.type];
    let changed = false;
    while (b.queue > 0 && now >= b.batchEnd) {
      b.queue--; b.stored = (b.stored || 0) + 1; changed = true;
      if (b.queue > 0) { b.batchStart = b.batchEnd; b.batchEnd = b.batchStart + this.batchTime(b); }
      if (b.worker) { const w = this.chainer(b.worker); if (w) this.chainerXp(w, 1); }
    }
    if (changed) this.bus.emit('building:change', b, 'produced');
    return d;
  }
  crateTime(b, key) { return CRATES[key].time / (BUILDINGS.workshop.speed[b.level - 1] * (1 + this.jobBonus(b))); }
  craftCrate(key) {
    const b = this.first('workshop'), cr = CRATES[key];
    if (!b) return { ok: false, why: 'Build the Crate Workshop first' };
    if (b.state === 'upgrading') return { ok: false, why: 'The Workshop is being upgraded' };
    if (b.level < cr.workshop) return { ok: false, why: `Needs Workshop level ${cr.workshop}` };
    b.jobs = b.jobs || [];
    const waiting = Object.values(b.done || {}).reduce((a, v) => a + v, 0);
    if (b.jobs.length + waiting >= BUILDINGS.workshop.queue[b.level - 1]) return { ok: false, why: 'Workshop queue is full. Collect finished Crates' };
    if (!this.canAfford({ res: cr.cost })) return { ok: false, why: 'Not enough resources' };
    this.pay({ res: cr.cost });
    const start = b.jobs.length ? b.jobs[b.jobs.length - 1].end : this.now();
    b.jobs.push({ key, start, end: start + this.crateTime(b, key) });
    this.bus.emit('building:change', b);
    return { ok: true };
  }
  _advanceWorkshop(b, now) {
    let changed = false;
    b.jobs = b.jobs || []; b.done = b.done || {};
    while (b.jobs.length && now >= b.jobs[0].end) {
      const j = b.jobs.shift();
      b.done[j.key] = (b.done[j.key] || 0) + 1;
      this.s.quest.c.crates++;
      if (j.key === 'crate2') this.s.quest.c.crate2++;
      this.addXp(CRATES[j.key].xp);
      if (b.worker) { const w = this.chainer(b.worker); if (w) this.chainerXp(w, 4); }
      changed = true;
    }
    if (changed) this.bus.emit('building:change', b, 'produced');
  }

  // ------------------------------------------------------------------------------------------
  // expeditions: a party walks out along a trail of the frontier, works at a place and walks home
  // ------------------------------------------------------------------------------------------
  lodge() { return this.first('balloon_dock'); }
  regionOpen(reg) { const d = this.lodge(); return !!d && BUILDINGS.balloon_dock.regions[d.level - 1] >= reg.dock; }
  parallelMax() { const d = this.lodge(); return d ? BUILDINGS.balloon_dock.parallel[d.level - 1] : 0; }
  transportOpen(key) { const d = this.lodge(); return !!d && d.level >= TRANSPORT[key].lodge; }
  allPois() { const out = []; for (const r of REGIONS) for (const p of this.s.pois[r.id]) out.push(p); return out; }
  findPoi(id) { for (const r of REGIONS) { const p = this.s.pois[r.id].find(x => x.id === id); if (p) return p; } return null; }
  expOf(poiId) { return this.s.expeditions.find(e => e.poi.id === poiId) || null; }
  _makePoi(reg) {
    const list = this.s.pois[reg.id];
    const taken = new Set([...this.allPois().map(p => p.site), ...this.s.expeditions.map(e => e.poi.site)]);
    const free = SITES.filter(s => s.zone === reg.id && !taken.has(s.id));
    if (!free.length) return null;
    const used = new Set(list.map(p => p.type));
    let pool = reg.pois.filter(t => !used.has(t));
    if (!pool.length) pool = reg.pois;
    // piers and flooded gardens need a pond: they only turn up at the sites that have one
    const wet = free.filter(s => s.water), dry = free.filter(s => !s.water);
    if (!wet.length) { const p2 = pool.filter(t => !POI_TYPES[t].water); pool = p2.length ? p2 : reg.pois.filter(t => !POI_TYPES[t].water); }
    const type = pick(pool), T = POI_TYPES[type];
    const site = T.water ? pick(wet) : pick(dry.length ? dry : free);
    const hard = rand(0.8, 1.7);
    const durMul = [1, 1.2, 1.45, 1.8][reg.dock - 1];
    const cond = Math.random() < 0.55 ? pick(CONDITION_KEYS) : null;
    const lootScale = Math.pow(reg.power, 0.55) * (0.75 + hard * 0.35);
    const loot = {};
    for (const k in T.loot) {
      const sc = RES[k].tier === 'raw' ? lootScale : (0.75 + hard * 0.35) * Math.pow(reg.power, 0.2);
      loot[k] = [Math.max(k === 'crystal' ? 0 : 1, Math.round(T.loot[k][0] * sc)), Math.max(1, Math.round(T.loot[k][1] * sc))];
    }
    if (T.extra) for (const k in T.extra) loot[k] = [Math.round(T.extra[k][0] * lootScale), Math.round(T.extra[k][1] * lootScale)];
    return {
      id: uid('poi'), region: reg.id, type, site: site.id, cond, hard,
      diff: Math.round(T.diff * reg.power * hard),
      work: Math.round(rand(T.time[0], T.time[1]) * durMul * (0.8 + hard * 0.25)),
      dist: Math.round(pathLen(site.id)),
      loot, expires: this.now() + rand(EXPEDITION.poiLife[0], EXPEDITION.poiLife[1]), seed: Math.floor(Math.random() * 1e9),
    };
  }
  _refreshPois(now) {
    const busy = new Set(this.s.expeditions.map(e => e.poi.id));
    for (const reg of REGIONS) {
      const list = this.s.pois[reg.id];
      let changed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i], T = POI_TYPES[p.type];
        const stray = !T || (T.water && !(SITES[p.site] && SITES[p.site].water));      // from before ponds: a pier on dry land
        if ((now >= p.expires || stray) && !busy.has(p.id)) { list.splice(i, 1); changed = true; }
      }
      for (let guard = 0; list.length < reg.active && guard < 12; guard++) { const p = this._makePoi(reg); if (!p) break; list.push(p); changed = true; }
      if (changed) this.bus.emit('pois', reg.id);
    }
  }
  /** Preview numbers for a team on a place, going about it a certain way with a certain transport. */
  evalTeam(poi, ids, approach = 'balanced', transport = 'foot') {
    const T = POI_TYPES[poi.type], cond = poi.cond ? CONDITIONS[poi.cond] : null;
    const A = APPROACH[approach] || APPROACH.balanced, V = TRANSPORT[transport] || TRANSPORT.foot;
    const team = ids.map(id => this.chainer(id)).filter(Boolean);
    let power = 0, luck = 0, sta = 0;
    for (const c of team) { power += this.power(c, T.act, cond); luck += this.stat(c, 'luck'); sta += this.stat(c, 'stamina'); }
    const n = Math.max(1, team.length);
    let avgLuck = luck / n + (team.some(c => c.trait === 'charmer') ? 3 : 0);
    const avgSta = sta / n;
    if (cond && cond.luckMul) avgLuck *= cond.luckMul;
    let staPenalty = false;
    if (cond && cond.staminaReq && avgSta < cond.staminaReq) { power *= cond.powerMul; staPenalty = true; }
    const ratio = power / poi.diff;
    const chance = team.length ? clamp(0.15 + 0.75 * (ratio - 0.5) / 0.7 + avgLuck * EXPEDITION.luckChance + A.chance, 0.03, 0.97) : 0;
    let speed = EXPEDITION.walk * V.speed / ((cond && cond.timeMul) || 1);
    if (team.some(c => c.trait === 'pathfinder')) speed *= 1.25;
    const tOut = poi.dist / speed, tWork = poi.work, tBack = tOut;
    const time = tOut + tWork + tBack;
    const rations = Math.ceil(team.reduce((a, c) => a + (c.trait === 'lightfoot' ? 0.5 : 1), 0) * (time / 60) * EXPEDITION.rationPerChainerPerMin);
    const carry = (0.6 + 0.4 * n) * V.carry;
    const lootMul = carry * ((cond && cond.lootMul) || 1) * A.loot;
    const cost = { res: { bio: rations } };
    if (V.cost) for (const k in V.cost) cost.res[k] = (cost.res[k] || 0) + V.cost[k];
    return {
      power: Math.round(power), chance, time: Math.round(time), tOut: Math.round(tOut), tWork: Math.round(tWork), tBack: Math.round(tBack),
      rations, cost, avgLuck, avgSta, staPenalty, lootMul, crit: clamp(avgLuck * EXPEDITION.critPerLuck * A.crit, 0, 0.6), n: team.length, max: T.team,
    };
  }
  /** The strongest free team for a place (greedy by power). */
  bestTeam(poi) {
    const T = POI_TYPES[poi.type], cond = poi.cond ? CONDITIONS[poi.cond] : null;
    return this.s.chainers.filter(c => this.isFree(c)).sort((a, b) => this.power(b, T.act, cond) - this.power(a, T.act, cond)).slice(0, T.team).map(c => c.id);
  }
  launch(poiId, ids, approach = 'balanced', transport = 'foot') {
    const poi = this.findPoi(poiId);
    if (!poi) return { ok: false, why: 'This place has closed' };
    const reg = REGIONS.find(r => r.id === poi.region);
    if (!this.lodge()) return { ok: false, why: 'Build the Expedition Lodge first' };
    if (!this.regionOpen(reg)) return { ok: false, why: `Upgrade the Expedition Lodge to level ${reg.dock} to unlock ${reg.name}` };
    if (this.expOf(poiId)) return { ok: false, why: 'A squad is already there' };
    if (this.s.expeditions.length >= this.parallelMax()) return { ok: false, why: 'All squads are out. Upgrade the Lodge for more' };
    if (!TRANSPORT[transport] || !this.transportOpen(transport)) return { ok: false, why: 'This transport is locked' };
    const T = POI_TYPES[poi.type];
    if (!ids.length) return { ok: false, why: 'Pick at least one Chainer' };
    if (ids.length > T.team) return { ok: false, why: `Max squad size here is ${T.team}` };
    for (const id of ids) { const c = this.chainer(id); if (!c || !this.isFree(c)) return { ok: false, why: 'Someone in the squad is busy' }; }
    const ev = this.evalTeam(poi, ids, approach, transport);
    if (!this.canAfford(ev.cost)) return { ok: false, why: this.s.res.bio < ev.cost.res.bio ? `Need ${ev.cost.res.bio} Biopoints for rations and transport` : 'Not enough resources to rent this transport' };
    this.pay(ev.cost);
    const now = this.now();
    const exp = {
      id: uid('e'), region: reg.id, poi: { ...poi }, team: [...ids], approach, transport,
      startAt: now, tArrive: now + ev.tOut, tLeave: now + ev.tOut + ev.tWork, endAt: now + ev.time,
      chance: ev.chance, crit: ev.crit, lootMul: ev.lootMul, seed: Math.floor(Math.random() * 1e9), back: false,
    };
    exp.log = this._makeLog(exp);
    this.s.expeditions.push(exp);
    poi.expires = Math.max(poi.expires, exp.endAt + 5);
    for (const id of ids) { const c = this.chainer(id); this.unassign(id); c.status = 'expedition'; c.expId = exp.id; }
    this.s.quest.c.expeditions++; this.s.tally.expeditions++;
    this.bus.emit('res'); this.bus.emit('exp:launch', exp);
    this.save();
    return { ok: true, exp };
  }
  /** Where a party is: phase out | work | back | home, progress within it, how far along the trail (0 gate .. 1 place). */
  expPhase(e, now = this.now()) {
    const far = e.turnAt ?? 1;
    if (now >= e.endAt) return { phase: 'home', p: 1, along: 0, left: 0 };
    if (now >= e.tLeave) { const p = clamp((now - e.tLeave) / Math.max(0.01, e.endAt - e.tLeave), 0, 1); return { phase: 'back', p, along: far * (1 - p), left: e.endAt - now }; }
    if (now >= e.tArrive) return { phase: 'work', p: clamp((now - e.tArrive) / Math.max(0.01, e.tLeave - e.tArrive), 0, 1), along: 1, left: e.endAt - now };
    const p = clamp((now - e.startAt) / Math.max(0.01, e.tArrive - e.startAt), 0, 1);
    return { phase: 'out', p, along: p, left: e.endAt - now };
  }
  /** The newest line of the travel log. */
  expStatus(e, now = this.now()) {
    let line = e.log && e.log[0];
    for (const l of (e.log || [])) if (l.t <= now) line = l;
    return line ? line.text : '';
  }
  _outcome(e) {
    const r = mulberry32(e.seed), u = r();
    let outcome;
    if (u < e.chance) outcome = r() < e.crit ? 'great' : 'success';
    else outcome = r() < 0.55 ? 'partial' : 'fail';
    if (e.cut !== undefined && e.cut < 0.9 && (outcome === 'great' || outcome === 'success')) outcome = 'partial';
    return { outcome, r };
  }
  _makeLog(e) {
    const T = POI_TYPES[e.poi.type], r = mulberry32(e.seed ^ 0x5bd1), names = e.team.map(id => this.chainer(id)).filter(Boolean).map(c => c.name);
    const who = () => pick(names, r) || 'The squad';
    const V = TRANSPORT[e.transport] || TRANSPORT.foot;
    const road = {
      woods: ['Walking the forest trail', `${who()} found a shortcut`, 'Crossing a stream', 'Spotted a deer in the trees'],
      ridge: ['Climbing the ridge', `${who()} is checking the map`, 'Strong wind on the ridge', 'Climbing over loose rocks'],
      ruins: ['Walking through the reeds', 'Passing fallen pillars', `${who()} is reading old carvings`, 'Fog between the stones'],
      outpost: ['Hiding behind the rocks', 'A Perfect patrol is close', `${who()} found a way past the guards`, 'Moving quietly past the towers'],
    }[e.region] || ['On the way'];
    const work = {
      lumber: ['First tree is down', 'Stacking logs', `${who()} is chopping wood`],
      mining: ['Mining the rock', 'Found a rich vein', `${who()} is carrying rocks`],
      forage: ['Baskets are filling up', `${who()} found a good spot`, 'Sorting the harvest'],
      fight: ['Enemy spotted', 'The fight has started', `${who()} is fighting hard`],
      explore: ['Searching the area', `${who()} found a hidden spot`, 'Marking it on the map'],
      craft: ['Working'],
    }[T.act] || ['Working'];
    const { outcome } = this._outcome(e);
    const end = { great: 'Found something special!', success: 'Got good loot', partial: 'Left some loot behind', fail: 'It failed. Heading home' }[outcome];
    const home = ['Carrying the loot home', 'Singing on the way home', `${who()} is leading the way`, 'Almost home'];
    const out = e.tArrive - e.startAt, wk = e.tLeave - e.tArrive, bk = e.endAt - e.tLeave;
    const two = (list) => { const a = pick(list, r); const rest = list.filter(x => x !== a); return [a, rest.length ? pick(rest, r) : a]; };
    const [road1, road2] = two(road), [work1, work2] = two(work);
    return [
      { t: e.startAt, text: `Left the gate ${e.transport === 'foot' ? 'on foot' : 'with the ' + V.name.toLowerCase()}` },
      { t: e.startAt + out * 0.35, text: road1 },
      { t: e.startAt + out * 0.72, text: road2 },
      { t: e.tArrive, text: `Reached ${T.name}` },
      { t: e.tArrive + wk * 0.3, text: work1 },
      { t: e.tArrive + wk * 0.68, text: work2 },
      { t: e.tLeave, text: end },
      { t: e.tLeave + bk * 0.5, text: pick(home, r) },
      { t: e.endAt, text: 'Back at the gate' },
    ];
  }
  /** Call a party home early: turn around on the trail, or pack up with what they have so far. */
  recall(eid) {
    const e = this.s.expeditions.find(x => x.id === eid), now = this.now();
    if (!e) return { ok: false };
    const ph = this.expPhase(e, now);
    if (ph.phase === 'back' || ph.phase === 'home') return { ok: false, why: 'They are already on the way home' };
    if (e.recalled) return { ok: false, why: 'Already recalled' };
    e.recalled = true;
    e.log = (e.log || []).filter(l => l.t <= now);
    if (ph.phase === 'out') {
      const walked = now - e.startAt;
      e.turnAt = ph.p; e.cut = 0;
      e.tArrive = now; e.tLeave = now; e.endAt = now + walked;
      e.log.push({ t: now, text: 'Recalled. Heading home' });
    } else {
      const back = e.endAt - e.tLeave;
      e.cut = ph.p;
      e.tLeave = now; e.endAt = now + back;
      e.log.push({ t: now, text: 'Recalled. Bringing part of the loot' });
    }
    e.log.push({ t: e.endAt, text: 'Back at the gate' });
    this.bus.emit('exp:change', e);
    this.save();
    return { ok: true };
  }
  /** Open the chest of a party that is back. Loot is granted here; the lucky draw is offered on top. */
  claimExpedition(eid) {
    const s = this.s, exp = s.expeditions.find(e => e.id === eid);
    if (!exp || this.now() < exp.endAt) return { ok: false };
    const { outcome, r } = this._outcome(exp);
    const T = POI_TYPES[exp.poi.type], cond = exp.poi.cond ? CONDITIONS[exp.poi.cond] : null, A = APPROACH[exp.approach] || APPROACH.balanced;
    const team = exp.team.map(id => this.chainer(id)).filter(Boolean);
    const cut = exp.cut === undefined ? 1 : exp.cut;
    const loot = {};
    for (const k in exp.poi.loot) {
      let n = rand(exp.poi.loot[k][0], exp.poi.loot[k][1], r) * exp.lootMul * EXPEDITION.lootMul[outcome] * cut;
      let tm = 1; for (const c of team) tm = Math.max(tm, this.traitLoot(c, k));
      n = Math.round(n * tm);
      if (n > 0) loot[k] = n;
    }
    let find = null;
    if ((outcome === 'great' || outcome === 'success') && T.find && r() < T.find * (outcome === 'great' ? 2 : 1)) {
      find = pick([{ crystal: 1 }, { ingot: 2 }, { planks: 6 }, { bricks: 6 }, { bio: 80 }], r);
      for (const k in find) loot[k] = (loot[k] || 0) + find[k];
    }
    const got = this.give(loot);
    const lodge = this.first('rest_lodge');
    const lodgeCut = lodge ? BUILDINGS.rest_lodge.rest[lodge.level - 1] : 0;
    const results = [];
    const xp = Math.round(EXPEDITION.xp[outcome] * Math.max(0.3, cut));
    for (const c of team) {
      let rest = Math.max(EXPEDITION.restMin, (exp.endAt - exp.startAt) * EXPEDITION.restBase) * EXPEDITION.restMul[outcome] * A.rest;
      rest *= clamp(1 - this.stat(c, 'stamina') * EXPEDITION.staminaRest, 0.4, 1) * (1 - lodgeCut) * ((cond && cond.restMul) || 1);
      if (c.trait === 'nightowl') rest *= 0.7;
      const until = exp.endAt + rest;
      c.expId = null;
      if (until > this.now()) { c.status = 'rest'; c.restUntil = until; c.restFrom = exp.endAt; } else c.status = 'idle';
      const lv0 = c.level;
      this.chainerXp(c, xp);
      results.push({ id: c.id, rest: Math.max(0, until - this.now()), leveled: c.level > lv0, xp });
      this.bus.emit('chainer:change', c);
    }
    s.expeditions = s.expeditions.filter(e => e.id !== eid);
    const list = s.pois[exp.region];
    const i = list.findIndex(p => p.id === exp.poi.id);
    if (i >= 0) list.splice(i, 1);
    if (outcome === 'great' || outcome === 'success') s.tally.success++;
    this.addXp({ great: 30, success: 20, partial: 10, fail: 4 }[outcome]);
    // the lucky draw: three hidden cards, the player keeps one
    const avgLuck = team.reduce((a, c) => a + this.stat(c, 'luck'), 0) / Math.max(1, team.length);
    const zone = Math.max(0, REGIONS.findIndex(x => x.id === exp.region));
    const pool = Object.entries(LUCKY).map(([k, L]) => [k, L.w + (L.lucky ? avgLuck * L.lucky : 0) + (k === 'jackpot' && exp.approach === 'bold' ? 2 : 0)]);
    const options = [];
    while (options.length < 3) {
      const k = weighted(pool.filter(([x]) => !options.some(o => o.kind === x)), r);
      let grant = {};
      if (k === 'haul') for (const x in got) { if (!x.startsWith('_') && got[x] > 0) grant[x] = Math.max(1, Math.round(got[x] * 0.3)); }
      else if (k === 'jackpot') for (const x in got) { if (!x.startsWith('_') && got[x] > 0) grant[x] = got[x]; }
      else if (k === 'bio') grant = { bio: 40 + zone * 30 };
      else if (k === 'goods') grant = { planks: 4 + zone * 2, bricks: 4 + zone * 2 };
      else if (k === 'crate') grant = { crate1: 1 };
      else if (k === 'crystal') grant = { crystal: 1 };
      else if (k === 'xp') grant = { _xp: xp };
      if ((k === 'haul' || k === 'jackpot') && !Object.keys(grant).length) grant = { bio: 30 };
      options.push({ kind: k, grant });
    }
    s.draw = { id: exp.id, team: exp.team.slice(), options };
    const tier = outcome === 'great' ? 'gold' : outcome === 'success' ? 'silver' : 'wood';
    this._refreshPois(this.now());
    this.bus.emit('exp:claimed', exp, { outcome, loot: got, find, results });
    this.save();
    return { ok: true, outcome, loot: got, find, results, exp, tier, draw: options };
  }
  /** Keep one card of the lucky draw. Returns what it gave and what the other two were. */
  luckyPick(i) {
    const d = this.s.draw;
    if (!d) return { ok: false };
    const o = d.options[clamp(i | 0, 0, d.options.length - 1)];
    const grant = { ...o.grant };
    let xp = 0;
    if (grant._xp) { xp = grant._xp; delete grant._xp; for (const id of d.team) { const c = this.chainer(id); if (c) this.chainerXp(c, xp); } }
    const got = Object.keys(grant).length ? this.give(grant, { overflow: true }) : {};
    this.s.draw = null;
    this.save();
    return { ok: true, kind: o.kind, got, xp, options: d.options, picked: i | 0 };
  }

  // ------------------------------------------------------------------------------------------
  // supply lines: upgrades that let the homestead run itself
  // ------------------------------------------------------------------------------------------
  hasUpg(k) { return !!this.s.upg[k]; }
  autoOn(k) { return this.hasUpg(k) && this.s.auto[k] && this.s.auto[k].on; }
  checkUpgradeBuy(k) {
    const U = UPGRADES[k];
    if (!U) return { ok: false };
    if (this.hasUpg(k)) return { ok: false, why: 'Already unlocked', owned: true };
    if (U.at && !U.at.some(t => this.first(t))) return { ok: false, why: `Build a ${BUILDINGS[U.at[0]].name} first`, needs: U.at[0] };
    if (this.s.level < U.level) return { ok: false, why: `Needs Homestead level ${U.level}`, level: U.level };
    if (!this.canAfford({ res: U.cost })) return { ok: false, why: 'Not enough resources', afford: false, miss: this.missing({ res: U.cost })[0] };
    return { ok: true };
  }
  buyUpgrade(k) {
    const chk = this.checkUpgradeBuy(k);
    if (!chk.ok) return chk;
    this.pay({ res: UPGRADES[k].cost });
    this.s.upg[k] = true;
    this.s.auto[k] = { ...JSON.parse(JSON.stringify(AUTO_DEFAULT[k])), on: true };
    this.addXp(30);
    this.bus.emit('upgrade', k);
    this.save();
    return { ok: true };
  }
  setAuto(k, patch) {
    if (!this.hasUpg(k)) return false;
    const a = this.s.auto[k];
    for (const key in patch) {
      if (patch[key] && typeof patch[key] === 'object') a[key] = { ...(a[key] || {}), ...patch[key] }; else a[key] = patch[key];
    }
    this.bus.emit('auto', k);
    return true;
  }
  larderCap() { const c = this.first('camp'); return c ? LARDER_CAP[c.level - 1] : 0; }
  /** One pass of every line that is switched on. Works on timestamps, so it also catches up after time away. */
  _runSupply(now, silent) {
    const s = this.s;
    // Camp Kitchen: stock the larder from the store (never below the floor you set), feed whoever arrived
    if (this.hasUpg('kitchen')) {
      const a = s.auto.kitchen, cap = this.larderCap();
      if (a.on && cap > 0) {
        const want = Math.min(a.stock, cap) - s.larder, spare = Math.floor(s.res.bio - a.floor);
        const move = Math.min(want, spare);
        if (move >= 1) { s.res.bio -= move; s.larder += move; this.bus.emit('res'); }
        for (const c of s.chainers) {
          if (c.owned || c.fed) continue;
          const cost = this.feedCost(c);
          if (s.larder < cost) break;
          s.larder -= cost;
          c.fed = true; c.leavesAt = now + GUEST.fedStay; s.quest.c.fed++;
          this.addXp(10);
          this.bus.emit('chainer:change', c); this.bus.emit('guest:fed', c, true);
        }
      }
    }
    // farm: baskets harvest, the drill replants (looped so hours away are farmed, until the store is full)
    const baskets = this.autoOn('baskets'), drill = this.autoOn('seeddrill');
    if (baskets || drill) {
      for (const b of s.buildings) {
        if (b.type !== 'farm_plot' || b.level < 1) continue;
        for (let guard = 0; guard < 400; guard++) {
          if (b.crop && baskets && now >= b.readyAt) {
            const at = b.readyAt, r = this.harvest(b.id, true);
            if (!r.ok) break;
            if (drill && b.lastCrop && this.homeLevel() >= CROPS[b.lastCrop].home) this.plant(b.id, b.lastCrop, Math.min(now, at + 2), true); else break;
          } else if (!b.crop && drill && b.lastCrop && b.state === 'ready' && this.homeLevel() >= CROPS[b.lastCrop].home) { this.plant(b.id, b.lastCrop, now, true); break; } else break;
        }
      }
    }
    // Foreman's Bell: keep the saws going above the reserve, and store what is made
    if (this.autoOn('bell')) {
      const keep = s.auto.bell.keep || {};
      for (const b of s.buildings) {
        const d = BUILDINGS[b.type];
        if (!d.recipe || b.level < 1 || b.state !== 'ready') continue;
        if (b.stored > 0) this.collect(b.id, true);
        if (!(b.queue > 0)) {
          let n = this.queueCap(b) - (b.stored || 0);
          for (const k in d.recipe.in) n = Math.min(n, Math.floor(((s.res[k] || 0) - (keep[k] || 0)) / d.recipe.in[k]));
          const outK = Object.keys(d.recipe.out)[0];
          n = Math.min(n, Math.floor((this.capOf(outK) - (s.res[outK] || 0)) / d.recipe.out[outK]));
          // stop at the stock you asked for, so it never turns all your Wood and Stone into goods you do not need
          n = Math.min(n, Math.floor(((s.auto.bell.upTo ?? 40) - (s.res[outK] || 0) - (b.stored || 0)) / d.recipe.out[outK]));
          if (n > 0) this.enqueue(b.id, n);
        }
      }
    }
    // Crate Line: assemble the chosen crate while resources last; shelve finished ones
    const ws = this.first('workshop');
    if (ws && this.autoOn('crateline')) {
      const a = s.auto.crateline, cr = CRATES[a.key];
      if (Object.values(ws.done || {}).some(n => n > 0)) this.collect(ws.id, true);
      if (cr && ws.state === 'ready' && ws.level >= cr.workshop && (ws.jobs || []).length < 2) {
        // never dig into what you asked to keep: its own reserves, and the Foreman's Bell's for the same goods
        const bell = (this.hasUpg('bell') && s.auto.bell.keep) || {};
        const keep = (k) => (k === 'bio' ? a.keepBio || 0 : Math.max((a.keep || {})[k] || 0, bell[k] || 0));
        if (Object.keys(cr.cost).every(k => (s.res[k] || 0) - keep(k) >= cr.cost[k])) this.craftCrate(a.key);
      }
    }
    // Courier: carry every finished crate to the pool
    if (this.autoOn('courier') && this.first('pool_shrine')) {
      for (const k in CRATES) if (s.crates[k] > 0) this.deposit(k, s.crates[k], silent);
    }
  }

  // ------------------------------------------------------------------------------------------
  // builders: a free Chainer can lend a hand on a building site
  // ------------------------------------------------------------------------------------------
  buildBonus(c) { return clamp(this.actScore(c, 'craft') * 0.07 * this.levelMul(c), 0.15, 1.2); }
  helpBuild(cid, bid) {
    const c = this.chainer(cid), b = this.building(bid);
    if (!c || !b || !(b.state === 'building' || b.state === 'upgrading')) return { ok: false, why: 'Nothing is being built there' };
    if (!this.isFree(c)) return { ok: false, why: 'That Chainer is busy' };
    if (b.builder) return { ok: false, why: 'Someone is already helping there' };
    const now = this.now(), k = 1 + this.buildBonus(c);
    b.doneAt = now + Math.max(0, b.doneAt - now) / k;
    b.builder = c.id; b.builderK = k;
    c.status = 'build'; c.jobAt = b.id;
    this.bus.emit('chainer:change', c); this.bus.emit('building:change', b);
    return { ok: true, k };
  }
  stopBuild(cid) {
    const c = this.chainer(cid);
    if (!c || c.status !== 'build') return;
    const b = this.building(c.jobAt), now = this.now();
    if (b && b.builder === cid) { if (b.state !== 'ready') b.doneAt = now + Math.max(0, b.doneAt - now) * (b.builderK || 1); b.builder = null; b.builderK = 0; this.bus.emit('building:change', b); }
    c.status = 'idle'; c.jobAt = null;
    this.bus.emit('chainer:change', c);
  }

  // ------------------------------------------------------------------------------------------
  // Homestead level, and what to do next
  // ------------------------------------------------------------------------------------------
  levelInfo() {
    const s = this.s, need = xpForLevel(s.level);
    const next = Object.keys(LEVEL_PERKS).map(Number).filter(l => l > s.level).sort((a, b) => a - b)[0] || null;
    return { level: s.level, xp: Math.floor(s.xp), need, left: Math.max(0, Math.ceil(need - s.xp)), nextPerk: next };
  }
  /** Plain-language suggestions, most useful first. Each: { icon, text, why, act, args, locked }. */
  advice() {
    const s = this.s, out = [], now = this.now();
    const back = s.expeditions.filter(e => now >= e.endAt);
    if (back.length) out.push({ icon: 'chest_wood', alt: 'item_chest', text: `${back.length} ${back.length > 1 ? 'squads are' : 'squad is'} back from the Frontier`, why: 'Loot ready!', act: 'claimExp', args: { id: back[0].id }, btn: 'Claim' });
    const hungry = this.guests().filter(c => !c.fed);
    if (hungry.length) out.push({ icon: 'item_food_bowl', text: `${hungry[0].name} the Wanderer is hungry`, why: 'A fed Wanderer works for you and can be recruited', act: 'selectChainer', args: { id: hungry[0].id }, btn: 'Feed' });
    if (s.hungry) out.push({ icon: 'res_bio', text: 'Your Chainers are out of Biopoints', why: 'Hungry Chainers work at 70%. Plant and harvest crops', act: 'hint', args: { hint: 'farm' }, btn: 'Farm' });
    const q = this.quest();
    if (q) { const pr = this.questProgress(q); out.push({ icon: 'ui_goals', text: q.text, why: pr.done ? 'Quest complete! Claim your reward' : `Current quest · ${pr.cur} / ${pr.max}`, act: 'quest', btn: pr.done ? 'Claim' : 'Go' }); }
    const idle = this.owned().filter(c => c.status === 'idle');
    if (idle.length && this.lodge() && s.expeditions.length < this.parallelMax()) out.push({ icon: 'item_compass', text: `${idle[0].name} is free`, why: 'Send a squad to the Frontier for loot', act: 'expeditions', btn: 'Frontier' });
    else if (idle.length && s.clearables.some(c => !c.by && this.isUnlocked(c.x, c.z))) out.push({ icon: 'item_axe', text: `${idle[0].name} is free`, why: 'Tap a tree, rock or bush on your land to clear it', act: 'selectChainer', args: { id: idle[0].id }, btn: 'Go' });
    // upgrades that are ready, then the ones that are close
    const ups = [];
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (b.state !== 'ready' || b.level >= d.maxLevel || d.maxLevel <= 1) continue;
      const chk = this.checkUpgrade(b);
      ups.push({ b, d, chk, rank: (b.type === 'home' ? 0 : b.type === 'balloon_dock' ? 1 : b.type === 'camp' ? 2 : 3) + (chk.ok ? 0 : 10) });
    }
    ups.sort((a, b) => a.rank - b.rank);
    for (const u of ups.slice(0, 2)) {
      out.push({ icon: u.d.icon, text: `Upgrade ${u.d.name} to level ${u.b.level + 1}`, why: u.chk.ok ? this.upgradeGain(u.b) : u.chk.why, act: 'focusBuilding', args: { id: u.b.id }, btn: u.chk.ok ? 'Upgrade' : 'Go', locked: !u.chk.ok });
    }
    for (const t of ['farm_plot', 'balloon_dock', 'workshop', 'pool_shrine', 'sawmill', 'stonecutter', 'granary', 'warehouse', 'exchange', 'rest_lodge']) {
      if (this.countOf(t)) continue;
      const chk = this.checkBuild(t), d = BUILDINGS[t];
      out.push({ icon: d.icon, text: `Build ${/^[aeiou]/i.test(d.name) ? 'an' : 'a'} ${d.name}`, why: chk.ok ? d.desc : chk.why, act: 'buildPick', args: { type: t }, btn: 'Build', locked: !chk.ok });
      if (out.length >= 7) break;
    }
    for (const k of UPGRADE_ORDER) {
      if (this.hasUpg(k)) continue;
      const chk = this.checkUpgradeBuy(k);
      out.push({ icon: UPGRADES[k].icon, alt: UPGRADES[k].alt, text: `Unlock ${UPGRADES[k].name}`, why: chk.ok ? UPGRADES[k].desc : chk.why, act: 'open', args: { panel: 'supply' }, btn: 'Go', locked: !chk.ok });
      break;
    }
    return out.slice(0, 7);
  }
  /** One line on what the next level of a building gives. */
  upgradeGain(b) {
    const d = BUILDINGS[b.type], n = b.level + 1, i = n - 1;
    switch (b.type) {
      case 'home': return `${d.slots[i]} beds, ${d.builders[i]} builders, new buildings`;
      case 'camp': return `${d.guests[i]} Wanderers at once, more Kitchen food`;
      case 'farm_plot': return `+${Math.round((d.yieldMul[i] / d.yieldMul[i - 1] - 1) * 100)}% harvest`;
      case 'warehouse': return 'More storage for everything';
      case 'granary': return 'More storage for Biopoints';
      case 'balloon_dock': return `${d.parallel[i]} squads at once${d.regions[i] > d.regions[i - 1] ? ', a new zone' : ''}${n === 2 ? ', the Wagon' : ''}`;
      case 'workshop': return `Faster, and ${Object.values(CRATES).find(c => c.workshop === n)?.name || 'a longer queue'}`;
      case 'pool_shrine': return `+${Math.round(d.bonus[i] * 100)}% pool points for every Crate`;
      case 'exchange': return `Lower fee: ${Math.round(d.fee[i] * 100)}%`;
      case 'rest_lodge': return `Rest ${Math.round(d.rest[i] * 100)}% shorter`;
      case 'arena': return `Train up to +${d.trainCap[i]} per Chainer`;
      default: return d.recipe ? 'Faster, longer queue' : 'A little more of everything';
    }
  }

  // ------------------------------------------------------------------------------------------
  // reward pool
  // ------------------------------------------------------------------------------------------
  epochNow() { return Math.floor(this.now() / POOL.epochSec); }
  epochLeft() { return POOL.epochSec - (this.now() % POOL.epochSec); }
  /** Simulated other players. Deterministic per epoch so the totals never jump on reload. */
  bots(epoch, frac = 1) {
    const out = [];
    for (let i = 0; i < POOL.bots; i++) {
      const base = mulberry32(hashStr('bot' + i));
      const size = 25 + Math.pow(base(), 2.2) * 420;           // a few whales, many small farmers
      const r = mulberry32(hashStr(`e${epoch}b${i}`));
      const active = r() < 0.72;
      const pts = Math.round(size * (0.5 + r()));
      const drops = 1 + Math.floor(r() * 3);
      let cur = 0;
      if (active) for (let d = 0; d < drops; d++) { const at = 0.04 + r() * 0.94; if (at <= frac) cur += pts / drops; }
      out.push({ name: BOT_NAMES[i % BOT_NAMES.length], points: Math.round(cur) });
    }
    return out;
  }
  poolStatus() {
    const e = this.epochNow(), frac = 1 - this.epochLeft() / POOL.epochSec;
    const bots = this.bots(e, frac);
    const others = bots.reduce((a, b) => a + b.points, 0);
    const mine = this.s.pool.epoch === e ? this.s.pool.myPoints : 0;
    const total = others + mine;
    const finalOthers = this.bots(e, 1).reduce((a, b) => a + b.points, 0);
    const board = [...bots.filter(b => b.points > 0), { name: this.user, points: mine, me: true }].sort((a, b) => b.points - a.points);
    return {
      epoch: e, left: this.epochLeft(), mine, total, others, share: total > 0 ? mine / total : 0,
      projected: (finalOthers + mine) > 0 ? POOL_ETH_PER_EPOCH * mine / (finalOthers + mine) : 0, reward: POOL_ETH_PER_EPOCH, board,
      rank: board.findIndex(b => b.me) + 1,
    };
  }
  poolBonus() { const p = this.first('pool_shrine'); return p ? BUILDINGS.pool_shrine.bonus[p.level - 1] : 0; }
  deposit(key, n, quiet = false) {
    const p = this.first('pool_shrine');
    if (!p) return { ok: false, why: 'Build the Pool Shrine first' };
    n = Math.min(n, this.s.crates[key] || 0);
    if (n <= 0) return { ok: false, why: 'No Crates of that kind. Craft some in the Workshop' };
    this._settlePool(this.now());
    const pts = Math.round(CRATES[key].points * n * (1 + this.poolBonus()));
    this.s.crates[key] -= n;
    this.s.pool.myPoints += pts; this.s.pool.lifetime += pts;
    this.s.quest.c.deposits += n;
    this.addXp(Math.round(pts / 2));
    this.bus.emit('res'); if (!quiet) this.bus.emit('pool:deposit', pts, key, n);
    this.save();
    return { ok: true, pts };
  }
  _settlePool(now) {
    const p = this.s.pool, e = Math.floor(now / POOL.epochSec);
    if (e <= p.epoch) return;
    if (p.myPoints > 0) {
      const others = this.bots(p.epoch, 1).reduce((a, b) => a + b.points, 0);
      const total = others + p.myPoints;
      const eth = POOL_ETH_PER_EPOCH * p.myPoints / total;
      this.s.eth += eth; p.earned += eth; this.s.quest.c.ethEarned += eth;
      const rec = { epoch: p.epoch, points: p.myPoints, total, eth, at: (p.epoch + 1) * POOL.epochSec };
      p.history.unshift(rec);
      if (p.history.length > 40) p.history.length = 40;
      this.bus.emit('res'); this.bus.emit('pool:payout', rec);
    } else this.bus.emit('pool:epoch');
    p.epoch = e; p.myPoints = 0;
  }

  // ------------------------------------------------------------------------------------------
  // exchange: one shared liquidity pool, constant-product between any pair
  // ------------------------------------------------------------------------------------------
  _newExchange() {
    const reserves = {}, base = {};
    for (const k of EXCHANGE.assets) { base[k] = EXCHANGE.depth / RES[k].value; reserves[k] = base[k] * rand(0.85, 1.2); }
    return { reserves, base, history: [], lastTick: this.now() };
  }
  exFee() { const x = this.first('exchange'); return x ? BUILDINGS.exchange.fee[x.level - 1] : 0.05; }
  /** how many `to` you get for one `from` right now (before fee and slippage) */
  exRate(from, to) { const R = this.s.exchange.reserves; return R[to] / R[from]; }
  exFair(from, to) { const B = this.s.exchange.base; return B[to] / B[from]; }
  exQuote(from, to, amount) {
    const R = this.s.exchange.reserves, fee = this.exFee();
    const eff = amount * (1 - fee);
    const raw = R[to] * eff / (R[from] + eff);
    const out = Math.floor(raw + 1e-9);
    const spot = R[to] / R[from];
    return { out, rate: amount > 0 ? out / amount : spot * (1 - fee), spot, impact: amount > 0 ? Math.max(0, 1 - (raw / amount) / (spot * (1 - fee))) : 0, fee };
  }
  swap(from, to, amount) {
    if (!this.first('exchange')) return { ok: false, why: 'Build the Trading Post first' };
    amount = Math.floor(amount);
    if (from === to || amount <= 0) return { ok: false, why: 'Pick an amount' };
    if ((this.s.res[from] || 0) < amount) return { ok: false, why: `Not enough ${RES[from].name}` };
    const q = this.exQuote(from, to, amount);
    if (q.out <= 0) return { ok: false, why: 'Amount too small' };
    const room = this.capOf(to) - this.s.res[to];
    if (room < q.out) return { ok: false, why: `Not enough storage for ${RES[to].name}` };
    const R = this.s.exchange.reserves;
    this.s.res[from] -= amount; this.s.res[to] += q.out;
    R[from] += amount; R[to] -= q.out;
    this.s.quest.c.swaps++;
    this.addXp(4);
    this._exSnap();
    this.bus.emit('res'); this.bus.emit('exchange', { from, to, amount, out: q.out });
    this.save();
    return { ok: true, out: q.out };
  }
  _exSnap() {
    const x = this.s.exchange;
    x.history.push({ t: this.now(), r: { ...x.reserves } });
    if (x.history.length > EXCHANGE.historyLen) x.history.shift();
  }
  _exTick(now) {
    const x = this.s.exchange;
    let steps = Math.floor((now - x.lastTick) / EXCHANGE.tickSec);
    if (steps <= 0) return;
    x.lastTick += steps * EXCHANGE.tickSec;
    steps = Math.min(steps, 240);
    for (let i = 0; i < steps; i++) {
      // other traders
      const a = pick(EXCHANGE.assets); let b = pick(EXCHANGE.assets);
      if (a !== b) {
        const amt = x.reserves[a] * rand(0.01, 0.07);
        const out = x.reserves[b] * amt / (x.reserves[a] + amt);
        x.reserves[a] += amt; x.reserves[b] -= out;
      }
      // slow pull back toward the healthy depth (liquidity providers topping up)
      for (const k of EXCHANGE.assets) x.reserves[k] += (x.base[k] - x.reserves[k]) * EXCHANGE.revert;
      if (steps - i <= EXCHANGE.historyLen) this._exSnap();
    }
    this.bus.emit('exchange:tick');
  }

  // ------------------------------------------------------------------------------------------
  // quests
  // ------------------------------------------------------------------------------------------
  quest() { return QUESTS[this.s.quest.idx] || null; }
  questProgress(q = this.quest()) {
    if (!q) return { cur: 0, max: 1, done: false };
    const g = q.goal, c = this.s.quest.c;
    let cur = 0, max = 1;
    if (g.build) { cur = this.byType(g.build).length; }
    else if (g.buildAll) { max = g.buildAll.length; cur = g.buildAll.filter(t => this.byType(t).length).length; }
    else if (g.level) { max = g.level[1]; const b = this.first(g.level[0]); cur = b ? b.level : 0; }
    else if (g.cosy) { max = g.cosy; cur = this.cosy(); }
    else if (g.upg) { cur = this.hasUpg(g.upg) ? 1 : 0; }
    else { const k = Object.keys(g)[0]; max = g[k]; cur = c[k] || 0; }
    if (max < 1) return { cur: cur >= max ? 1 : 0, max: 1, done: cur >= max };      // "earn any ETH": show 0 / 1, not 0 / 0.0000001
    return { cur: Math.min(cur, max), max, done: cur >= max };
  }
  claimQuest() {
    const q = this.quest();
    if (!q || !this.questProgress(q).done) return { ok: false };
    const got = this.give(q.reward, { quiet: true });
    this.s.quest.idx++;
    this.addXp(25);
    this.bus.emit('quest:claimed', q, got);
    this.save();
    return { ok: true, got };
  }

  // ------------------------------------------------------------------------------------------
  // upkeep per minute (for the HUD)
  // ------------------------------------------------------------------------------------------
  upkeepPerMin() {
    let v = 0;
    for (const c of this.s.chainers) {
      if (c.status === 'expedition') continue;
      const m = c.trait === 'lightfoot' ? 0.5 : 1;
      if (c.owned) v += UPKEEP.perChainerPerMin * m; else if (c.fed) v += UPKEEP.guestPerMin * m;
    }
    return v;
  }

  // ------------------------------------------------------------------------------------------
  // main tick: everything is timestamp based, so it also catches up after being away
  // ------------------------------------------------------------------------------------------
  update(realDt) {
    this.advanceClock(realDt);
    this._tickAcc += realDt;
    if (this._tickAcc >= 0.2) { this.tick(this._tickAcc); this._tickAcc = 0; }
    this._saveT += realDt;
    if (this._saveT > 8) { this._saveT = 0; this.save(); }
  }
  tick(_dt, silent = false) {
    const s = this.s, now = this.now();
    const elapsed = Math.max(0, now - (s.lastTick || now));
    s.lastTick = now;

    // construction
    for (const b of s.buildings) if ((b.state === 'building' || b.state === 'upgrading') && now >= b.doneAt) this._finishBuilding(b);
    // production
    for (const b of s.buildings) {
      if (b.level < 1) continue;
      const d = BUILDINGS[b.type];
      if (d.recipe && b.queue > 0) this._advanceProducer(b, now);
      if (b.type === 'workshop') this._advanceWorkshop(b, now);
    }
    // clearing jobs
    for (const c of [...s.clearables]) if (c.by && now >= c.endsAt) this._finishClear(c);
    // chainer timers
    for (const c of s.chainers) {
      if (c.status === 'rest' && now >= c.restUntil) { c.status = 'idle'; this.bus.emit('chainer:change', c, 'rested'); }
      if (c.status === 'train' && now >= c.busyUntil) {
        c.trained[c.trainStat] = (c.trained[c.trainStat] || 0) + 1; c.status = 'idle';
        this.bus.emit('chainer:change', c, 'trained'); this.bus.emit('chainer:trained', c, c.trainStat);
      }
      if (c.status === 'clearing' && !s.clearables.some(x => x.id === c.target)) c.status = 'idle';
    }
    // upkeep
    const perMin = this.upkeepPerMin();
    s.upkeepAcc += perMin * Math.min(elapsed, 3600 * 6) / 60;
    if (s.upkeepAcc >= 1) {
      const eat = Math.floor(s.upkeepAcc); s.upkeepAcc -= eat;
      const was = s.hungry;
      if (s.res.bio >= eat) { s.res.bio -= eat; s.hungry = false; } else { s.res.bio = 0; s.hungry = perMin > 0; }
      if (was !== s.hungry) this.bus.emit('hungry', s.hungry);
      this.bus.emit('res');
    } else if (s.hungry && s.res.bio > 5) { s.hungry = false; this.bus.emit('hungry', false); }
    // guests
    for (const c of [...s.chainers]) if (!c.owned && now >= c.leavesAt && (c.status === 'idle' || c.status === 'job' || c.status === 'build')) this._guestLeave(c);
    if (this.first('camp')) {
      if (!s.guestTimer) this._scheduleGuest();
      if (now >= s.guestTimer) {
        if (this.guests().length < this.guestSlots()) this._guestArrive();
        this._scheduleGuest();
      }
    }
    // grudge fades slowly
    if (s.grudge > 0) { const g0 = Math.round(s.grudge); s.grudge = Math.max(0, s.grudge - GRUDGE.decayPerMin * elapsed / 60); if (Math.round(s.grudge) !== g0) this.bus.emit('cosy'); }
    // expeditions: tell the world when a party reaches the place, turns for home, and is back
    for (const e of s.expeditions) {
      const ph = this.expPhase(e, now).phase;
      if (ph !== e.ph) { e.ph = ph; if (!silent) this.bus.emit('exp:phase', e, ph); }
      if (!e.back && now >= e.endAt) { e.back = true; this.bus.emit('exp:back', e); }
    }
    this._refreshPois(now);
    this._runSupply(now, silent);
    // new debris now and then
    if (now >= s.nextClearableAt) { s.nextClearableAt = now + rand(70, 130); if (!silent) this._spawnClearable(); }
    // economy
    this._settlePool(now);
    this._exTick(now);
    // quest readiness
    const q = this.quest();
    const ready = !!q && this.questProgress(q).done;
    if (ready !== s.quest.ready) { s.quest.ready = ready; this.bus.emit('quest', ready); }
  }
}
