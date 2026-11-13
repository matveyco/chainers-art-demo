// Sound: sampled effects, seasonal ambience loops and a quiet music loop, all through WebAudio.
// The files are public/assets/sfx/<name>.mp3, listed in assets/manifest.json under `sfx` (tools/gen_sfx.py
// makes them). A name with no file, or one that fails to load, falls back to the old synthesised blip,
// so the game never goes silent.
//
//   sfx.on = false / true                 everything off (ambience and music fade out) / back on
//   sfx.play('coin')                      one-shot
//   sfx.ambience('spring')                crossfade to the loop amb_spring; sfx.ambience(null) fades it out
//   sfx.music(true)                       quiet music_home loop; sfx.musicOn reads or sets the same switch
//   sfx.setVolume('sfx' | 'ambience' | 'music', 0..1)     sfx.vol holds the current values
//
// Browsers keep audio locked until the first tap or key press; ambience and music asked for earlier start then.

import { asset, audioUrl } from './core/assets.js';
const MUSIC = 'music_home';
const LEVEL = { sfx: 1, ambience: 0.9, music: 0.6 };     // bus gain at volume 1 (the loudest a slider can go)
const VOLUME = { sfx: 0.8, ambience: 0.6, music: 0.5 };  // where the volumes start
const FADE = 1.5;          // ambience / music crossfade, seconds
const QUICK = 0.5;         // fade when the sound switch is flipped
const MAX_VOICES = 3;      // overlapping copies of one sound
const LATE = 350;          // ms a sound that is still loading may start late; after that this play is skipped
const SEAM = 0.2;          // seconds of a loop's tail folded over its head (hides the mp3 padding at both ends)

// Per-sound volume; anything not listed plays at 0.9.
const VOL = {
  click: 0.5, tick: 0.4, open: 0.55, close: 0.5, error: 0.7, swap: 0.7, select: 0.6, order: 0.7, auto_on: 0.7, unlock: 0.8, season: 0.8,
  place: 0.85, hammer: 0.7, chop: 0.7, clink: 0.6, plant: 0.7, harvest: 0.8, collect: 0.7, coin: 0.55, yum: 0.8, supply: 0.8,
  arrive: 0.75, whoosh: 0.6, chest_shake: 0.8, card_flip: 0.7, card_common: 0.7, coins_shower: 0.8, lucky_pick: 0.8,
  amb_spring: 1, amb_summer: 0.9, amb_autumn: 1, amb_winter: 1, amb_frontier: 1.5,
};
// Sounds that repeat a lot get a little random [pitch +-, volume -] so they do not machine-gun.
const VARY = {
  chop: [0.07, 0.25], clink: [0.07, 0.25], coin: [0.05, 0.2], click: [0.04, 0.15], card_flip: [0.06, 0.2],
  tick: [0.04, 0.15], hammer: [0.05, 0.2], plant: [0.06, 0.2],
};
// Decoded as soon as the manifest is in; the other one-shots follow one by one while the page is idle.
const PRELOAD = ['click', 'tick', 'open', 'close', 'error', 'select', 'order', 'swap', 'auto_on', 'coin', 'collect', 'place', 'whoosh'];
// Newer names that never had a synthesised version borrow the nearest old one for the fallback.
const SYNTH_AS = {
  select: 'click', order: 'click', auto_on: 'open', unlock: 'success', season: 'whoosh', hammer: 'chop', supply: 'place',
  depart: 'whoosh', return: 'arrive', chest_shake: 'place', chest_open: 'open', card_flip: 'tick', card_common: 'collect',
  card_rare: 'harvest', coins_shower: 'payout', jackpot: 'fanfare', lucky_pick: 'tick', lucky_win: 'success',
};
const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.bus = null; this.synth = null;
    this._on = true; this._musicOn = false; this._amb = null; this._unlocked = false;
    this.last = {};
    this.vol = { ...VOLUME };
    this.files = null;            // Set of names that have a file, once the manifest is in
    this.buffers = new Map();     // name -> AudioBuffer
    this.loading = new Map();     // name -> Promise<AudioBuffer | null>
    this.missing = new Set();     // no file, or it failed: use the synth
    this.voices = {};             // name -> playing one-shots
    this._loop = null;            // the ambience loop that is playing: { name, src, g, ...fade state }
    this._wantLoop = null;        // the ambience loop that should be playing
    this._mus = null;             // the music element: { el, g, playing, timer, ...fade state }
    if (typeof window === 'undefined') { this.ready = this._listed = Promise.resolve(); return; }
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    try { this._dec = Off ? new Off(2, 1, 44100) : null; } catch (e) { this._dec = null; }   // decodes before the first tap
    this._listed = this._list();                       // resolves once this.files is known
    this.ready = this._listed.then(() => this._preload());   // resolves once the UI sounds are decoded
    this._unlock();
    document.addEventListener('visibilitychange', () => this._sync());
  }

  // ---------------------------------------------------------------- public
  get on() { return this._on; }
  set on(v) {
    this._on = !!v;
    this._gain('sfx', 0.03);
    this._sync(QUICK);
  }

  play(name) {
    if (!this._on) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 45) return;
    this.last[name] = now;
    const c = this._ctx(); if (!c) return;
    if (c.state !== 'running' && !this._unlocked) return;   // still locked: do not queue up a burst for the first tap
    const buf = this.buffers.get(name);
    if (buf) return this._sample(name, buf);
    if (this.missing.has(name)) return this._synth(name);
    this._load(name).then((b) => {
      if (!this._on || performance.now() - now > LATE) return;
      if (b) this._sample(name, b); else this._synth(name);
    });
  }

  // Seasonal background loop: 'spring' plays amb_spring. null (or an id with no file) fades to silence.
  ambience(id) {
    this._amb = id == null || id === '' ? null : String(id).replace(/^amb_/, '');
    this._sync();
  }

  music(on = true) { this.musicOn = on; }
  get musicOn() { return this._musicOn; }
  set musicOn(v) { this._musicOn = !!v; this._sync(); }

  setVolume(kind, v) {
    if (!(kind in this.vol)) return;
    this.vol[kind] = clamp01(v);
    this._gain(kind, 0.05);
  }

  // ---------------------------------------------------------------- context
  _ctx() {
    if (!this.ctx) {
      try {
        const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = c.createGain(); this.master.connect(c.destination);
        this.bus = {};
        for (const k in LEVEL) { const g = this.bus[k] = c.createGain(); g.gain.value = this._level(k); g.connect(this.master); }
        this.synth = c.createGain(); this.synth.gain.value = 0.26; this.synth.connect(this.bus.sfx);
        c.onstatechange = () => { if (c.state === 'running') this._sync(); };
      } catch (e) { this.ctx = null; this._on = false; }
    }
    const c = this.ctx;
    if (c && c.state !== 'running' && c.state !== 'closed') { const p = c.resume(); if (p && p.catch) p.catch(() => {}); }
    return c;
  }
  _level(kind) { return this.vol[kind] * LEVEL[kind] * (kind === 'sfx' && !this._on ? 0 : 1); }
  _gain(kind, tau) { if (this.ctx) this.bus[kind].gain.setTargetAtTime(this._level(kind), this.ctx.currentTime, tau); }
  // Fades v.g from wherever it is now to `to`. v = { g, from, to, t0, dur } remembers the last fade, because
  // reading gain.value back in the middle of a ramp is not reliable in every browser.
  _fade(v, to, secs) {
    const t = this.ctx.currentTime, p = v.g.gain;
    const k = v.dur > 0 ? Math.min(1, Math.max(0, (t - v.t0) / v.dur)) : 1;
    const from = v.from + (v.to - v.from) * k;
    p.cancelScheduledValues(t); p.setValueAtTime(from, t); p.linearRampToValueAtTime(to, t + secs);
    v.from = from; v.to = to; v.t0 = t; v.dur = secs;
  }
  // The first tap or key press opens the audio and starts whatever ambience / music is waiting.
  _unlock() {
    const evs = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
    const off = () => evs.forEach((e) => window.removeEventListener(e, go, true));
    const go = () => {
      this._unlocked = true;
      const c = this._ctx();
      if (!c) return off();
      if (c.state === 'running') { off(); this._sync(); }   // otherwise resume() is on its way and onstatechange syncs
    };
    evs.forEach((e) => window.addEventListener(e, go, { capture: true, passive: true }));
  }

  // ---------------------------------------------------------------- files
  async _list() {
    try { this.files = new Set((await (await fetch(asset('manifest.json'), { cache: 'no-cache' })).json()).sfx || []); }
    catch (e) { this.files = new Set(); }
    this._sync();
  }
  async _preload() {
    await Promise.all(PRELOAD.map((n) => this._load(n)));
    // then the rest of the one-shots, one at a time while the page is idle, so a first fanfare is not late
    const rest = [...this.files].filter((n) => !n.startsWith('amb_') && !n.startsWith('music_') && !this.buffers.has(n));
    const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 2000 }) : (f) => setTimeout(f, 150);
    const next = () => { const n = rest.shift(); if (n) this._load(n).then(() => idle(next)); };
    idle(next);
  }
  _load(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.loading.has(name)) return this.loading.get(name);
    const p = (async () => {
      if (!this.files) await this._listed;
      if (!this.files.has(name)) throw new Error('no file');
      const res = await fetch(audioUrl(name));
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.arrayBuffer(), dec = this._dec || this._ctx();
      let buf = await new Promise((ok, bad) => { const r = dec.decodeAudioData(data, ok, bad); if (r && r.catch) r.catch(bad); });
      if (name.startsWith('amb_')) buf = this._seamless(buf);
      this.buffers.set(name, buf);
      return buf;
    })().catch(() => { this.missing.add(name); return null; }).finally(() => this.loading.delete(name));
    this.loading.set(name, p);
    return p;
  }
  // Fold the last SEAM seconds over the first so the loop point is a short equal-power crossfade. An mp3 decodes
  // with a few ms of padding at both ends in some browsers, which would otherwise tick once per loop.
  _seamless(buf) {
    const n = buf.length, k = Math.min(Math.floor(SEAM * buf.sampleRate), n >> 2);
    const out = (this._dec || this.ctx).createBuffer(buf.numberOfChannels, n - k, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const a = buf.getChannelData(ch), o = out.getChannelData(ch);
      o.set(a.subarray(0, n - k));
      for (let i = 0; i < k; i++) { const th = (i / k) * Math.PI / 2; o[i] = a[n - k + i] * Math.cos(th) + a[i] * Math.sin(th); }
    }
    return out;
  }

  // ---------------------------------------------------------------- one-shots
  _sample(name, buf) {
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain(), vary = VARY[name];
    let vol = VOL[name] ?? 0.9;
    if (vary) { src.playbackRate.value = 1 + (Math.random() * 2 - 1) * vary[0]; vol *= 1 - Math.random() * vary[1]; }
    src.buffer = buf; g.gain.value = vol;
    src.connect(g); g.connect(this.bus.sfx);
    const list = this.voices[name] || (this.voices[name] = []), voice = { src, g, from: vol, to: vol, t0: 0, dur: 0 };
    while (list.length >= MAX_VOICES) {            // the oldest copy makes room
      const old = list.shift();
      this._fade(old, 0, 0.04);
      try { old.src.stop(c.currentTime + 0.05); } catch (e) { /* already stopped */ }
    }
    list.push(voice);
    src.onended = () => { const i = list.indexOf(voice); if (i >= 0) list.splice(i, 1); g.disconnect(); };
    src.start();
  }

  // ---------------------------------------------------------------- ambience + music
  // Brings what is playing in line with what is wanted (on, ambience id, music switch). Safe to call any time.
  _sync(fade = FADE) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.files) return;
    const live = this._on && !document.hidden;
    this._syncAmbience(live && this._amb ? 'amb_' + this._amb : null, fade);
    this._syncMusic(live && this._musicOn && this.files.has(MUSIC), fade);
  }
  _syncAmbience(name, fade) {
    if (name && (!this.files.has(name) || this.missing.has(name))) name = null;
    this._wantLoop = name;
    const cur = this._loop;
    if (cur && cur.name === name) return;
    const buf = name && this.buffers.get(name);
    if (name && !buf) {                             // keep the old loop going until the new one is decoded
      this._load(name).then(() => { if (this._wantLoop === name) this._sync(fade); });
      return;
    }
    const c = this.ctx, t = c.currentTime;
    if (cur) {
      this._fade(cur, 0, fade);
      cur.src.stop(t + fade + 0.05);
      cur.src.onended = () => {                     // a season that is over gives its decoded audio back
        cur.g.disconnect();
        if (cur.name !== 'amb_' + this._amb) this.buffers.delete(cur.name);
      };
      this._loop = null;
    }
    if (buf) {
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.loop = true; g.gain.value = 0;
      src.connect(g); g.connect(this.bus.ambience);
      src.start(t, Math.random() * buf.duration);   // a different spot each time, not always the same bird
      this._loop = { name, src, g, from: 0, to: 0, t0: 0, dur: 0 };
      this._fade(this._loop, VOL[name] ?? 1, fade);
    }
  }
  // Music is streamed through an <audio> element (a decoded 75 s track would hold ~25 MB); it pauses when off
  // and picks up where it stopped.
  _syncMusic(want, fade) {
    let m = this._mus;
    if (!!want === !!(m && m.playing)) return;
    const c = this.ctx;
    if (want) {
      if (!m) {
        try {
          const el = new Audio(audioUrl(MUSIC)); el.loop = true; el.preload = 'auto';
          const g = c.createGain(); g.gain.value = 0;
          c.createMediaElementSource(el).connect(g); g.connect(this.bus.music);
          m = this._mus = { el, g, playing: false, timer: 0, from: 0, to: 0, t0: 0, dur: 0 };
        } catch (e) { this.files.delete(MUSIC); return; }
      }
      clearTimeout(m.timer);
      m.playing = true;
      const p = m.el.play(); if (p && p.catch) p.catch(() => { m.playing = false; });
      this._fade(m, VOL[MUSIC] ?? 1, fade);
    } else {
      m.playing = false;
      this._fade(m, 0, fade);
      m.timer = setTimeout(() => { if (!m.playing) m.el.pause(); }, fade * 1000 + 80);
    }
  }

  // ---------------------------------------------------------------- synth fallback (the original blips)
  tone(freq, dur = 0.12, type = 'square', vol = 0.5, when = 0, slide = 0) {
    const c = this._ctx(); if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.synth); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur = 0.1, vol = 0.3, when = 0, hp = 800) {
    const c = this._ctx(); if (!c) return;
    const t = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.synth); s.start(t);
  }
  _synth(name) {
    const T = (f, d, ty, v, w, s) => this.tone(f, d, ty, v, w, s);
    switch (SYNTH_AS[name] || name) {
      case 'click': T(620, 0.05, 'square', 0.25); break;
      case 'tick': T(900, 0.03, 'square', 0.15); break;
      case 'open': T(440, 0.07, 'triangle', 0.4); T(660, 0.09, 'triangle', 0.4, 0.05); break;
      case 'close': T(520, 0.06, 'triangle', 0.3); T(390, 0.08, 'triangle', 0.3, 0.04); break;
      case 'error': T(180, 0.12, 'sawtooth', 0.3); T(140, 0.16, 'sawtooth', 0.3, 0.09); break;
      case 'place': this.noise(0.12, 0.35, 0, 300); T(160, 0.12, 'square', 0.4, 0, 0.6); break;
      case 'chop': this.noise(0.06, 0.4, 0, 1200); T(240, 0.06, 'square', 0.25, 0, 0.6); break;
      case 'clink': T(1400, 0.05, 'square', 0.2); this.noise(0.04, 0.25, 0, 2500); break;
      case 'plant': T(330, 0.06, 'triangle', 0.4); T(440, 0.07, 'triangle', 0.4, 0.05); break;
      case 'harvest': [523, 659, 784].forEach((f, i) => T(f, 0.08, 'square', 0.3, i * 0.05)); break;
      case 'collect': T(784, 0.06, 'square', 0.3); T(1047, 0.1, 'square', 0.3, 0.05); break;
      case 'coin': T(1319, 0.05, 'square', 0.22); T(1760, 0.12, 'square', 0.22, 0.045); break;
      case 'yum': T(392, 0.08, 'triangle', 0.5); T(523, 0.08, 'triangle', 0.5, 0.07); T(659, 0.14, 'triangle', 0.5, 0.14); break;
      case 'arrive': T(659, 0.1, 'triangle', 0.4); T(880, 0.16, 'triangle', 0.4, 0.09); break;
      case 'whoosh': this.noise(0.5, 0.3, 0, 500); T(220, 0.5, 'sine', 0.3, 0, 2.5); break;
      case 'built': [392, 523, 659, 784].forEach((f, i) => T(f, 0.1, 'square', 0.3, i * 0.07)); this.noise(0.15, 0.2, 0, 400); break;
      case 'upgrade': [523, 659, 784, 1047, 1319].forEach((f, i) => T(f, 0.12, 'square', 0.3, i * 0.065)); break;
      case 'fanfare': [523, 523, 659, 784, 1047].forEach((f, i) => T(f, i === 4 ? 0.4 : 0.11, 'square', 0.32, i * 0.11)); [659, 784, 1047].forEach((f) => T(f, 0.4, 'triangle', 0.2, 0.44)); break;
      case 'payout': [784, 988, 1175, 1568, 1976].forEach((f, i) => T(f, 0.14, 'square', 0.28, i * 0.08)); for (let i = 0; i < 8; i++) T(1500 + Math.random() * 900, 0.05, 'square', 0.14, 0.45 + i * 0.06); break;
      case 'success': [523, 659, 784, 1047].forEach((f, i) => T(f, 0.14, 'square', 0.3, i * 0.09)); break;
      case 'fail': [392, 349, 294, 220].forEach((f, i) => T(f, 0.2, 'sawtooth', 0.22, i * 0.14)); break;
      case 'swap': T(660, 0.07, 'square', 0.25); T(495, 0.07, 'square', 0.25, 0.06); T(880, 0.1, 'square', 0.25, 0.12); break;
      case 'levelup': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => T(f, 0.16, 'square', 0.3, i * 0.075)); break;
      default: break;
    }
  }
}
