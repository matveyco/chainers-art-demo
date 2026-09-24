// 60-second score attack: countdown, pop-up targets (golden bonus ones), timer, results + local best.
const $ = (id) => document.getElementById(id);
const ROUND = 60;
const BEST_KEY = 'gaptooth.best';

function loadBest() { try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* storage unavailable */ } }

export class Challenge {
  constructor({ targets, score, juice, sfx, player }) {
    Object.assign(this, { targets, score, juice, sfx, player });
    this.phase = 'idle';          // idle | countdown | run | results
    this.t = 0;
    this.left = ROUND;
    this.spawnT = 0;
    this.best = loadBest();
    this.onPhase = null;
    this.timerEl = $('round-timer');
    this.countEl = $('countdown');
    this.resultsEl = $('results');
    $('res-again').addEventListener('click', () => this.start());
    $('res-free').addEventListener('click', () => this.stop());
  }

  get active() { return this.phase === 'countdown' || this.phase === 'run'; }

  _set(phase) { this.phase = phase; this.onPhase && this.onPhase(phase); }

  start() {
    this.resultsEl.hidden = true;
    this.score.reset();
    this.targets.setMode('round');
    this.player.refill();
    this.t = 0; this.left = ROUND; this.spawnT = 0; this._lastCount = -1; this._lastSec = -1;
    this.timerEl.hidden = false;
    this.timerEl.classList.remove('low');
    this.timerEl.textContent = ROUND.toFixed(1);
    this._set('countdown');
  }

  stop() {
    this.resultsEl.hidden = true;
    this.timerEl.hidden = true;
    this.countEl.hidden = true;
    this.targets.setMode('free');
    this._set('idle');
  }

  _count(text, big) {
    const el = this.countEl;
    el.hidden = false;
    el.textContent = text;
    el.className = 'countdown' + (big ? ' go' : '');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  update(dt) {
    if (this.phase === 'countdown') {
      this.t += dt;
      const n = 3 - Math.floor(this.t);
      if (n !== this._lastCount && n >= 1) { this._lastCount = n; this._count(String(n)); this.sfx.play('beep'); }
      if (this.t >= 3) {
        this._count('GO!', true);
        this.sfx.play('go');
        setTimeout(() => { if (this.phase === 'run') this.countEl.hidden = true; }, 700);
        this._set('run');
        this.t = 0;
      }
      return;
    }
    if (this.phase !== 'run') return;
    this.t += dt;
    this.left = Math.max(0, ROUND - this.t);
    const p = this.t / ROUND;                      // difficulty ramps over the round
    const maxUp = 2 + Math.floor(p * 3.2);
    const upTime = 3.3 - p * 1.5;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.targets.upCount() < maxUp) {
      const gold = Math.random() < 0.12;
      this.targets.popUp(gold ? upTime * 0.6 : upTime, gold);
      this.spawnT = 0.85 - p * 0.45 + Math.random() * 0.3;
    }
    const txt = this.left.toFixed(1);
    if (this.timerEl.textContent !== txt) this.timerEl.textContent = txt;
    const sec = Math.ceil(this.left);
    if (this.left <= 10 && sec !== this._lastSec) {
      this._lastSec = sec;
      this.timerEl.classList.add('low');
      if (sec > 0) this.sfx.play('tickclock');
    }
    if (this.left <= 0) this.finish();
  }

  finish() {
    this._set('results');
    this.sfx.play('buzzer');
    this.juice.callout('TIME!', 'red big');
    this.targets.setMode('round');                 // everything drops
    const s = this.score;
    const isBest = s.points > this.best;
    if (isBest) { this.best = s.points; saveBest(s.points); }
    $('res-score').textContent = s.points.toLocaleString('en-US');
    $('res-best').textContent = isBest && s.points > 0 ? 'New best!' : `Best ${this.best.toLocaleString('en-US')}`;
    $('res-best').classList.toggle('new', isBest && s.points > 0);
    $('res-kos').textContent = s.kos;
    $('res-heads').textContent = s.heads;
    $('res-acc').textContent = s.shots ? Math.round(s.accuracy * 100) + '%' : '–';
    $('res-combo').textContent = '×' + s.bestCombo;
    $('res-boom').textContent = s.booms;
    $('res-gold').textContent = s.golds;
    $('res-rank').textContent = rank(s.points);
    setTimeout(() => {
      if (this.phase !== 'results') return;
      this.timerEl.hidden = true;
      this.resultsEl.hidden = false;
      if (document.pointerLockElement) document.exitPointerLock();
      $('res-again').focus();
    }, 900);
  }
}

function rank(p) {
  if (p >= 6000) return 'Rank S · range legend';
  if (p >= 4000) return 'Rank A · sharpshooter';
  if (p >= 2500) return 'Rank B · marksman';
  if (p >= 1200) return 'Rank C · plinker';
  return 'Rank D · warming up';
}
