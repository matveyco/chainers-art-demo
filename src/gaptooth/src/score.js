// Scoring: points, combo multiplier, multi-knockdowns, chain reactions, accuracy. Emits callouts.
const COMBO_WINDOW = 1.6;     // seconds between hits to keep a combo alive

export class Score {
  constructor(juice, sfx) {
    this.juice = juice;
    this.sfx = sfx;
    this.onChange = null;
    this.reset();
  }

  reset() {
    Object.assign(this, {
      points: 0, shots: 0, hitShots: 0, hits: 0, heads: 0, kos: 0, booms: 0, golds: 0,
      combo: 0, bestCombo: 0, comboT: 0, time: 0, lastKO: -9, multi: 0, lastBoom: -9, chain: 0,
    });
    this.changed();
  }

  get mult() { return 1 + Math.min(4, Math.floor(this.combo / 5)) * 0.5; }
  get accuracy() { return this.shots ? this.hitShots / this.shots : 0; }

  changed() { this.onChange && this.onChange(this); }

  _add(base) {
    const pts = Math.round(base * this.mult);
    this.points += pts;
    return pts;
  }

  shot(hitSomething) {
    this.shots++;
    if (hitSomething) this.hitShots++;
    this.changed();
  }

  // one call per target per shot
  hit(info) {
    if (info.source === 'blast') return;
    this.hits++;
    if (info.head) this.heads++;
    const prevMult = this.mult;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = COMBO_WINDOW;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this._add(info.head ? 25 : 10);
    if (this.mult > prevMult) {
      this.juice.callout(`COMBO ×${this.mult.toFixed(1).replace('.0', '')}`, 'combo');
      this.sfx.play('combo', 1, Math.min(8, this.combo / 5));
    }
    this.changed();
  }

  ko(info) {
    this.kos++;
    let base = 100;
    const tags = [];
    if (info.head) { base += 50; tags.push(['HEADSHOT', 'gold']); }
    if (info.gold) { base += 200; this.golds++; tags.push(['GOLDEN TARGET', 'gold big']); }
    if (info.dist > 22 && info.source !== 'blast') { base += 50; tags.push(['LONG SHOT', '']); }
    if (info.dist < 2.6 && info.source !== 'blast') { base += 25; tags.push(['POINT BLANK', '']); }
    if (this.time - this.lastKO < 1.3) this.multi++; else this.multi = 1;
    this.lastKO = this.time;
    if (this.multi >= 2) {
      base += 100 * (this.multi - 1);
      tags.unshift([this.multi === 2 ? 'DOUBLE KO' : this.multi === 3 ? 'TRIPLE KO' : `${this.multi}× KO`, 'red big']);
    } else if (!tags.length) tags.push(['KNOCKOUT', 'red']);
    const pts = this._add(base);
    for (const [t, k] of tags.slice(0, 2)) this.juice.callout(t, k);
    this.juice.callout('+' + pts, 'pts');
    this.changed();
  }

  boom() {
    this.booms++;
    if (this.time - this.lastBoom < 1.1) this.chain++; else this.chain = 1;
    this.lastBoom = this.time;
    const pts = this._add(150 + 100 * (this.chain - 1));
    if (this.chain >= 2) this.juice.callout(`CHAIN REACTION ×${this.chain}`, 'red big');
    this.juice.callout('+' + pts, 'pts');
    this.changed();
  }

  update(dt) {
    this.time += dt;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.changed(); }
    }
    this.juice.combo(this.combo, this.comboT / COMBO_WINDOW);
  }
}
