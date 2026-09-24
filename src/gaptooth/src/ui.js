// DOM HUD & panels.
import { WEAPONS, ORDER } from './player.js';

const $ = (id) => document.getElementById(id);

export const DISPLAY = { Pistol: 'Pocket Pew', SMG: 'Buzzsaw', Shotgun: 'Boomer', Launcher: 'Thumper' };

const GROUPS = [
  { title: 'Locomotion', names: ['Idle', 'Walk_F', 'Walk_B', 'Walk_L', 'Walk_R', 'Run_F'] },
  { title: 'Actions', names: ['Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Hit_React', 'Death', 'Wave', 'Dance'] },
  { title: 'Pistol · Pocket Pew', names: ['Pistol_Idle', 'Pistol_Shoot', 'Pistol_Reload'] },
  { title: 'SMG · Buzzsaw', names: ['SMG_Idle', 'SMG_Shoot', 'SMG_Reload'] },
  { title: 'Shotgun · Boomer', names: ['Shotgun_Idle', 'Shotgun_Shoot', 'Shotgun_Reload'] },
  { title: 'Rocket launcher · Thumper', names: ['Launcher_Idle', 'Launcher_Shoot', 'Launcher_Reload'] },
];

export class UI {
  constructor(meta, sizes) {
    this.meta = meta;
    this.sizes = sizes;
    this.clipMeta = Object.fromEntries(meta.clips.map((c) => [c.name, c]));
    this.onMode = null; this.onWeapon = null; this.onClip = null; this.onTransport = null;
    this._toastT = null;
    this.mode = 'play';
    this._buildSlots();
    this._buildClips();
    this._buildInfo();
    this._bindTop();
  }

  loaded(p, text) {
    $('loader-fill').style.width = Math.round(p * 100) + '%';
    if (text) $('loader-text').textContent = text;
  }

  ready() { $('loader').classList.add('done'); }

  error(msg) { $('loader-text').textContent = msg; }

  _bindTop() {
    document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode, true)));
    document.querySelectorAll('[data-collapse]').forEach((b) => b.addEventListener('click', () => {
      const p = $(b.dataset.collapse);
      const c = p.classList.toggle('collapsed');
      b.textContent = c ? '+' : '–';
      b.setAttribute('aria-expanded', String(!c));
    }));
    $('btn-info').addEventListener('click', () => this.toggleInfo());
    $('info-close').addEventListener('click', () => this.toggleInfo(false));
  }

  toggleInfo(force) {
    const p = $('panel-info');
    const show = force === undefined ? p.hidden : force;
    p.hidden = !show;
    $('btn-info').setAttribute('aria-expanded', String(show));
  }

  setMode(mode, user) {
    this.mode = mode;
    document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    for (const id of ['panel-play', 'panel-studio', 'panel-ref']) $(id).hidden = $(id).dataset.mode !== mode;
    $('weaponbar').hidden = mode !== 'play';
    $('scorebar').hidden = mode !== 'play';
    if (mode !== 'play') $('crosshair').classList.remove('on');
    if (user && this.onMode) this.onMode(mode);
  }

  // ---------------------------------------------------------------- weapon bar
  _buildSlots() {
    const el = $('slots');
    const mk = (key, name, label) => {
      const b = document.createElement('button');
      b.className = 'slot';
      b.dataset.weapon = name || '';
      b.setAttribute('aria-pressed', 'false');
      const icon = window.__ICONS__ && window.__ICONS__[name || 'Unarmed'];
      b.innerHTML = (icon ? `<img class="ico" src="${icon}" alt="">` : '<i class="ico"></i>') +
        `<span class="lab"><span class="n">${key}</span><span class="w">${label}</span></span>`;
      b.title = `${label} (${key})`;
      b.addEventListener('click', () => this.onWeapon && this.onWeapon(name || null));
      el.appendChild(b);
    };
    mk('Q', null, 'Hands');
    ORDER.forEach((w, i) => mk(String(i + 1), w, DISPLAY[w]));
  }

  weaponState(weapon, ammo, reloading) {
    document.querySelectorAll('.slot').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.weapon || null) === (weapon || null))));
    const cur = $('ammo-cur'), max = $('ammo-max'), st = $('ammo-state');
    if (!weapon) { cur.textContent = '–'; max.textContent = ''; st.textContent = 'unarmed'; st.className = ''; return; }
    cur.textContent = String(ammo);
    max.textContent = '/ ' + WEAPONS[weapon].mag;
    if (reloading) { st.textContent = 'reloading'; st.className = 'warn'; }
    else if (ammo === 0) { st.textContent = 'empty · R'; st.className = 'warn'; }
    else { st.textContent = DISPLAY[weapon]; st.className = ''; }
  }

  score(sc) {
    const acc = sc.shots ? Math.round(sc.accuracy * 100) + '%' : '–';
    for (const [id, v] of [['sc-score', sc.points.toLocaleString('en-US')], ['sc-kos', String(sc.kos)], ['sc-acc', acc]]) {
      const el = $(id);
      if (el.textContent !== v) {
        const bump = id !== 'sc-acc';
        el.textContent = v;
        if (bump) {
          el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
          clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('bump'), 260);
        }
      }
    }
  }

  toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  stats(fps, dc, vram) {
    $('st-fps').textContent = fps; $('st-dc').textContent = dc; $('st-tri').textContent = vram;
  }

  // ---------------------------------------------------------------- studio
  _buildClips() {
    const root = $('clip-groups');
    let n = 0;
    for (const g of GROUPS) {
      const sec = document.createElement('section');
      sec.className = 'clip-group';
      sec.innerHTML = `<h3>${g.title}</h3>`;
      const list = document.createElement('div');
      list.className = 'clip-list';
      for (const name of g.names) {
        const m = this.clipMeta[name];
        if (!m) continue;
        n++;
        const b = document.createElement('button');
        b.className = 'clip';
        b.dataset.clip = name;
        b.setAttribute('aria-pressed', 'false');
        const tag = m.loop ? '<span class="pill loop">loop</span>' : (m.weapon ? '<span class="pill wpn">once</span>' : '<span class="pill">once</span>');
        b.innerHTML = `<span class="nm">${name.replace('_', ' ')}</span>${tag}<span class="d">${m.duration.toFixed(2)}s</span>`;
        b.addEventListener('click', () => this.onClip && this.onClip(name));
        list.appendChild(b);
      }
      sec.appendChild(list);
      root.appendChild(sec);
    }
    $('clip-count').textContent = n + ' clips';
    $('btn-play').addEventListener('click', () => this.onTransport && this.onTransport({ toggle: true }));
    const scrub = $('scrub');
    scrub.addEventListener('input', () => this.onTransport && this.onTransport({ scrub: scrub.value / 1000 }));
    $('speed').addEventListener('change', (e) => this.onTransport && this.onTransport({ speed: parseFloat(e.target.value) }));
    for (const id of ['opt-turn', 'opt-bones', 'opt-sockets', 'opt-wire']) {
      $(id).addEventListener('change', (e) => this.onTransport && this.onTransport({ [id.slice(4)]: e.target.checked }));
    }
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.onTransport && this.onTransport({ view: b.dataset.view })));
  }

  activeClip(name) {
    document.querySelectorAll('.clip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.clip === name)));
    const m = this.clipMeta[name];
    $('now-name').textContent = name.replace('_', ' ');
    let meta = `${m.frames} frames · 30 fps · ${m.loop ? 'loop' : 'one-shot'}`;
    if (m.speed) meta += ` · ${m.speed.toFixed(2)} m/s`;
    if (m.weapon) meta += ` · ${DISPLAY[m.weapon]}`;
    $('now-meta').textContent = meta;
  }

  transportState(t, dur, playing) {
    const s = $('scrub');
    if (document.activeElement !== s) s.value = String(Math.round((dur ? t / dur : 0) * 1000));
    $('time').textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
    $('btn-play').textContent = playing ? '❚❚' : '▶';
    $('btn-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  // ---------------------------------------------------------------- info
  _buildInfo() {
    const m = this.meta, sz = this.sizes;
    const kb = (n) => (n / 1024).toFixed(1) + ' KB';
    const ch = m.character;
    const wrows = m.weapons.map((w) => `<tr><td>${w.file}</td><td>${sz[w.file] ? kb(sz[w.file]) : ''}</td></tr>`).join('');
    const clipsN = m.clips.length;
    const totalFrames = m.clips.reduce((a, c) => a + c.frames, 0);
    $('info-body').innerHTML = `
      <section class="info-sec">
        <h3>Character</h3>
        <dl class="specs">
          <div><dt>Mesh</dt><dd>${ch.verts} verts · ${ch.quads * 2} tris · 1 draw call</dd></div>
          <div><dt>Material</dt><dd>1 PBR, ${ch.atlas[0]}×${ch.atlas[1]} pixel atlas, nearest filter</dd></div>
          <div><dt>Skeleton</dt><dd>19 joints (16 deform + root + 2 grip sockets)</dd></div>
          <div><dt>Skinning</dt><dd>rigid boxes, 1 u blend loops at neck, spine, elbows, wrists, knees, ankles</dd></div>
          <div><dt>Animation</dt><dd>${clipsN} clips · ${totalFrames} frames · int16 rotations</dd></div>
          <div><dt>Scale</dt><dd>1 voxel = 4 cm · height ${ch.height_m} m · +Z forward</dd></div>
        </dl>
      </section>
      <section class="info-sec">
        <h3>Files (GLB, embedded textures)</h3>
        <table class="files"><tbody>
          <tr><td>character.glb</td><td>${sz['character.glb'] ? kb(sz['character.glb']) : ''}</td></tr>
          ${wrows}
          <tr><td>clips.json</td><td>${sz['clips.json'] ? kb(sz['clips.json']) : ''}</td></tr>
        </tbody></table>
      </section>
      <section class="info-sec">
        <h3>PlayCanvas: load, animate, arm</h3>
        <pre class="code" id="code-snippet">${CODE}</pre>
        <button class="copy" id="btn-copy">Copy snippet</button>
      </section>
      <section class="info-sec">
        <h3>Game feel (demo code)</h3>
        <dl class="specs">
          <div><dt>Time</dt><dd>hit-stop on heavy hits, short slow motion on knockdowns and blasts</dd></div>
          <div><dt>Camera</dt><dd>recoil climb, FOV punch, push-back, trauma shake with roll</dd></div>
          <div><dt>Body</dt><dd>spring recoil on spine + chest over the animation</dd></div>
          <div><dt>Aim</dt><dd>crosshair drawn from the real spread cone, turns red on targets</dd></div>
          <div><dt>Feedback</dt><dd>damage numbers, headshots ×2, combos, callouts, local best score</dd></div>
          <div><dt>Rendering</dt><dd>FX on GPU instancing (1 draw per material), bullet holes in one dynamic mesh</dd></div>
        </dl>
      </section>
      <section class="info-sec">
        <h3>Conventions</h3>
        <dl class="specs">
          <div><dt>Grip_R / Grip_L</dt><dd>attach weapons with identity transform</dd></div>
          <div><dt>Weapon nodes</dt><dd>Muzzle, Eject, Support; parts Slide, Mag, Bolt, Pump, Shell, Rocket</dd></div>
          <div><dt>Layering</dt><dd>Upper layer masked at Spine (children)</dd></div>
          <div><dt>Root motion</dt><dd>in place; speeds &amp; roll travel in clips.json</dd></div>
          <div><dt>Events</dt><dd>fire, eject, mag_out, mag_in, pump, bolt, shell_in, rocket_in…</dd></div>
        </dl>
      </section>`;
    $('btn-copy').addEventListener('click', async () => {
      const txt = $('code-snippet').textContent;
      try { await navigator.clipboard.writeText(txt); this.toast('Snippet copied'); }
      catch (e) {
        const r = document.createRange(); r.selectNodeContents($('code-snippet'));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        this.toast('Selected — press Ctrl/Cmd+C');
      }
    });
    // reference palette
    const pal = ['#DBBC3E', '#C39632', '#723D12', '#E1DDDD', '#603F41', '#512C27', '#7C768A', '#200C08', '#44221E', '#5D322C'];
    $('ref-palette').innerHTML = '<span class="swatches">' + pal.map((c) => `<i style="background:${c}" title="${c}"></i>`).join('') + '</span>';
  }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CODE = esc(`// character.glb + weapon GLBs, loaded as 'container' assets
const hero = charAsset.resource.instantiateRenderEntity();
app.root.addChild(hero);

hero.addComponent('anim', { activate: true });
hero.anim.loadStateGraph(graph);             // layers: Base, Upper
for (const a of charAsset.resource.animations) {
  hero.anim.assignAnimation(a.resource.name, a.resource, 'Base');
}
// weapon clips on a second layer, masked to the upper body
const upper = hero.anim.findAnimationLayer('Upper');
upper.mask = { 'Rig/Root/Hips/Spine': { children: true } };
hero.anim.assignAnimation('SMG_Shoot', clip('SMG_Shoot'), 'Upper');
hero.anim.assignAnimation('None', pc.AnimTrack.EMPTY, 'Upper');

// arm: identity transform on the grip socket
const gun = smgAsset.resource.instantiateRenderEntity();
hero.findByName('Grip_R').addChild(gun);

hero.anim.baseLayer.transition('Walk_F', 0.2);
upper.weight = 1;
upper.transition('SMG_Shoot', 0.05);         // fire while walking
const muzzle = gun.findByName('SMG_Muzzle');   // FX spawn point`);
