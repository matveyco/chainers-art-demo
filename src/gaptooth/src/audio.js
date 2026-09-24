// Procedural WebAudio sound effects (no audio files). Starts on first user gesture.
// Gunshots and blasts also feed a short "range echo" (filtered feedback delay).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = {};
  }

  ensure() {
    if (!this.enabled) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        const c = this.ctx = new AC();
        this.master = c.createGain();
        this.master.gain.value = 0.55;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.master.connect(comp); comp.connect(c.destination);
        // echo send: delay -> lowpass -> feedback, back into master
        this.echo = c.createGain(); this.echo.gain.value = 0.32;
        const dl = c.createDelay(1); dl.delayTime.value = 0.13;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
        const fb = c.createGain(); fb.gain.value = 0.34;
        this.echo.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
        const len = c.sampleRate;
        this.noise = c.createBuffer(1, len, c.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (e) { return false; }
  }

  _env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  _out(g, wet) {
    g.connect(this.master);
    if (wet) g.connect(this.echo);
  }

  _noise(t, dur, peak, type, f0, f1, q = 0.8, wet = false) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, 0.004, peak, dur);
    src.connect(f); f.connect(g); this._out(g, wet);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  _tone(t, dur, peak, f0, f1, type = 'sine', wet = false, attack = 0.003) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g); this._out(g, wet);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, vol = 1, param = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + 0.005;
    // light rate limiting to avoid stacking identical sounds in one frame
    if (this.last[name] && t - this.last[name] < 0.02) return;
    this.last[name] = t;
    const v = vol;
    switch (name) {
      // ---- weapons
      case 'pistol':
        this._noise(t, 0.16, 0.9 * v, 'bandpass', 2600, 500, 0.7, true);
        this._tone(t, 0.12, 0.8 * v, 170, 55, 'sine', true);
        this._tone(t, 0.03, 0.35 * v, 3200, 1400, 'square');          // mechanical snap
        break;
      case 'smg':
        this._noise(t, 0.08, 0.6 * v, 'bandpass', 3200, 900, 0.9, true);
        this._tone(t, 0.06, 0.5 * v, 210, 80, 'triangle', true);
        break;
      case 'shotgun':
        this._noise(t, 0.42, 1.0 * v, 'lowpass', 5200, 220, 0.5, true);
        this._tone(t, 0.3, 1.0 * v, 110, 34, 'sine', true);
        this._tone(t, 0.05, 0.4 * v, 1500, 600, 'square');
        break;
      case 'launcher':
        this._noise(t, 0.6, 0.75 * v, 'bandpass', 900, 3400, 0.6, true);
        this._tone(t, 0.2, 0.7 * v, 90, 42, 'sine', true);
        break;
      case 'explosion':
        this._noise(t, 1.3, 1.0 * v, 'lowpass', 2600, 60, 0.4, true);
        this._tone(t, 0.8, 1.0 * v, 72, 22, 'sine', true);
        this._noise(t + 0.02, 0.25, 0.6 * v, 'highpass', 3000, 900, 0.5);   // crack
        break;
      // ---- feedback
      case 'tick':                                                          // body hit
        this._tone(t, 0.05, 0.3 * v, 1500, 1050, 'triangle');
        this._noise(t, 0.04, 0.18 * v, 'highpass', 4000, 2500, 0.8);
        break;
      case 'headshot':                                                      // bright ding
        this._tone(t, 0.32, 0.26 * v, 1760, 1740);
        this._tone(t, 0.24, 0.14 * v, 2640, 2620);
        this._tone(t, 0.05, 0.25 * v, 1400, 1000, 'triangle');
        break;
      case 'ko':
        this._tone(t, 0.3, 0.7 * v, 150, 42, 'sine');
        this._noise(t, 0.25, 0.45 * v, 'lowpass', 1400, 120, 0.7);
        this._tone(t + 0.05, 0.22, 0.2 * v, 660, 990, 'triangle');          // rising tag
        break;
      case 'combo': {                                                       // pitch climbs with the combo level
        const f = 520 * Math.pow(2, Math.min(12, param * 2) / 12);
        this._tone(t, 0.08, 0.22 * v, f, f, 'square');
        this._tone(t + 0.07, 0.12, 0.2 * v, f * 1.5, f * 1.5, 'square');
        break;
      }
      case 'popup': this._noise(t, 0.12, 0.2 * v, 'bandpass', 700, 1600, 1.2); this._tone(t, 0.06, 0.12 * v, 300, 520, 'triangle'); break;
      case 'popgold':
        this._noise(t, 0.12, 0.2 * v, 'bandpass', 700, 1600, 1.2);
        [1318, 1661, 1975].forEach((f, i) => this._tone(t + i * 0.05, 0.12, 0.14 * v, f, f, 'triangle'));
        break;
      case 'whoosh': this._noise(t, 0.22, 0.2 * v, 'bandpass', 1400, 500, 0.9); break;
      case 'fuse': this._noise(t, 0.9, 0.18 * v, 'highpass', 5200, 3000, 0.5); break;
      case 'beep': this._tone(t, 0.12, 0.3 * v, 880, 880, 'square'); break;
      case 'go': this._tone(t, 0.4, 0.34 * v, 1320, 1320, 'square'); this._tone(t, 0.4, 0.2 * v, 660, 660, 'square'); break;
      case 'tickclock': this._tone(t, 0.04, 0.16 * v, 2000, 2000, 'square'); break;
      case 'buzzer': this._tone(t, 0.7, 0.3 * v, 220, 200, 'sawtooth'); this._tone(t, 0.7, 0.2 * v, 110, 100, 'sawtooth'); break;
      // ---- impacts
      case 'metal': this._tone(t, 0.09, 0.12 * v, 2400 + Math.random() * 600, 1800, 'triangle'); this._noise(t, 0.05, 0.1 * v, 'highpass', 5000, 3000, 0.7); break;
      case 'wood': this._noise(t, 0.07, 0.2 * v, 'bandpass', 900, 500, 1.6); this._tone(t, 0.05, 0.1 * v, 320, 160, 'sine'); break;
      case 'dirt': this._noise(t, 0.08, 0.14 * v, 'lowpass', 1200, 300, 0.6); break;
      // ---- handling & movement
      case 'click': this._tone(t, 0.035, 0.35 * v, 2400, 1800, 'square'); break;
      case 'clack':
        this._tone(t, 0.05, 0.3 * v, 900, 500, 'square');
        this._noise(t, 0.05, 0.25 * v, 'highpass', 3000, 2000, 0.7);
        break;
      case 'pump':
        this._noise(t, 0.09, 0.35 * v, 'bandpass', 1400, 700, 1.5);
        this._tone(t + 0.1, 0.05, 0.3 * v, 700, 400, 'square');
        this._noise(t + 0.1, 0.07, 0.3 * v, 'bandpass', 1800, 900, 1.5);
        break;
      case 'shell': this._tone(t, 0.06, 0.12 * v, 3800 + Math.random() * 800, 2600, 'triangle'); break;
      case 'hit': this._tone(t, 0.06, 0.25 * v, 1300, 900, 'triangle'); break;
      case 'thud': this._noise(t, 0.2, 0.5 * v, 'lowpass', 500, 80, 0.6); break;
      case 'jump': this._noise(t, 0.12, 0.18 * v, 'lowpass', 900, 300, 0.5); break;
      case 'land': this._noise(t, 0.14, 0.3 * v, 'lowpass', 600, 90, 0.6); break;
      case 'step': this._noise(t, 0.07, 0.07 * v, 'lowpass', 700, 150, 0.4); break;
      case 'swap': this._tone(t, 0.07, 0.2 * v, 500, 900, 'square'); break;
      case 'empty': this._tone(t, 0.04, 0.25 * v, 1800, 1500, 'square'); break;
      default: break;
    }
  }
}
