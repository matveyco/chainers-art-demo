// Performance HUD: a compact chip in the top bar (fps, triangles, draw calls) that opens a panel
// with a frame-time graph and the renderer numbers. Triangles are counted from the mesh
// instances the camera actually drew last frame (instanced FX included), not from scene totals.
const pc = window.pc;
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n.toLocaleString('en-US'));

export class DebugHud {
  constructor(app, camera, info) {
    this.app = app;
    this.camera = camera;
    this.info = info;                 // { charTris, weaponTris, clips }
    this.times = new Float32Array(150);
    this.head = 0;
    this.last = performance.now();
    this.acc = 0; this.frames = 0;
    this.open = false;
    this.canvas = $('dbg-graph');
    this.g = this.canvas.getContext('2d');
    $('stats').addEventListener('click', () => this.toggle());
    $('dbg-close').addEventListener('click', () => this.toggle(false));
    this.look = null;
  }

  toggle(on = !this.open) {
    this.open = on;
    $('dbg').hidden = !on;
    $('stats').setAttribute('aria-expanded', String(on));
  }

  countTris() {
    let vis = 0, total = 0, casters = 0;
    const seen = new Set();
    for (const layer of this.app.scene.layers.layerList) {
      if (!layer.enabled) continue;
      for (const mi of layer.meshInstances) {
        if (seen.has(mi)) continue;
        seen.add(mi);
        const prim = mi.mesh && mi.mesh.primitive && mi.mesh.primitive[0];
        if (!prim || prim.type !== pc.PRIMITIVE_TRIANGLES) continue;
        const inst = mi.instancingData ? (mi.instancingCount || 0) : 1;
        const t = (prim.count / 3) * inst;
        total += t;
        if (mi.visibleThisFrame) vis += t;
        if (mi.castShadow && mi.visibleThisFrame) casters += t;
      }
    }
    return { vis: Math.round(vis), total: Math.round(total), casters: Math.round(casters) };
  }

  update() {
    const now = performance.now();
    const ms = now - this.last;
    this.last = now;
    this.times[this.head] = ms;
    this.head = (this.head + 1) % this.times.length;
    this.acc += ms; this.frames++;
    if (this.acc < 400) return;
    const fps = Math.round(1000 * this.frames / this.acc);
    const avg = this.acc / this.frames;
    this.acc = 0; this.frames = 0;
    const s = this.app.stats;
    const tris = this.countTris();
    $('st-fps').textContent = fps;
    $('st-tri').textContent = fmt(tris.vis);
    $('st-dc').textContent = s.drawCalls.total;
    if (!this.open) return;
    const d = this.app.graphicsDevice;
    let worst = 0;
    for (const t of this.times) worst = Math.max(worst, t);
    const L = this.look;
    const sun = L && L.sun.light;
    const rows = [
      ['Frame', `${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} ms worst`],
      ['Triangles', `${fmt(tris.vis)} drawn · ${fmt(tris.total)} in scene`],
      ['Shadow casters', `${fmt(tris.casters)} tris`],
      ['Draw calls', `${s.drawCalls.total}`],
      ['Shadows', sun && sun.castShadows && L.sun.enabled ? `${sun.numCascades} × ${sun.shadowResolution}px · ${sun.shadowType === pc.SHADOW_PCF5_32F ? 'PCF 5×5' : 'PCF 3×3'}` : 'off'],
      ['Post', L ? (L.cf && L.cf.enabled ? [L.cf.rendering.samples > 1 ? `MSAA ${L.cf.rendering.samples}×` : 'no MSAA', L.cf.ssao.type !== pc.SSAOTYPE_NONE ? 'SSAO' : '', L.style !== 'pbr' ? 'ink' : '', L.cf.bloom.intensity > 0 ? 'bloom' : ''].filter(Boolean).join(' · ') : 'off') : ''],
      ['Resolution', `${d.width}×${d.height} (${(d.maxPixelRatio || 1).toFixed(2)}× DPR cap)`],
      ['VRAM', `${(s.vram.totalUsed / 1048576).toFixed(1)} MB`],
      ['Brawlers', `${this.game ? this.game.units.length : 0} × ${fmt(this.info.charTris)} tris · ${this.info.clips} clips`],
      ['Effects', `${this.game ? this.game.fx.sprites.count : 0} sprites · ${this.game ? this.game.combat.shots.length : 0} shots`],
    ];
    $('dbg-fps').textContent = fps;
    $('dbg-rows').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    this.draw();
  }

  draw() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const max = 50;                         // ms at the top of the graph
    const y = (ms) => H - Math.min(1, ms / max) * H;
    g.fillStyle = 'rgba(243,237,225,.06)';
    g.fillRect(0, y(33.3), W, y(16.7) - y(33.3));
    g.strokeStyle = 'rgba(243,237,225,.22)';
    g.lineWidth = 1;
    for (const ms of [16.7, 33.3]) { g.beginPath(); g.moveTo(0, Math.round(y(ms)) + 0.5); g.lineTo(W, Math.round(y(ms)) + 0.5); g.stroke(); }
    const n = this.times.length, bw = W / n;
    for (let i = 0; i < n; i++) {
      const ms = this.times[(this.head + i) % n];
      if (!ms) continue;
      g.fillStyle = ms > 33.4 ? '#e25d45' : ms > 17.5 ? '#e7a33e' : '#37c4b4';
      const top = y(ms);
      g.fillRect(i * bw, top, Math.max(1, bw - 0.5), H - top);
    }
    g.fillStyle = 'rgba(243,237,225,.55)';
    g.font = '10px "JetBrains Mono", monospace';
    g.fillText('60', 3, y(16.7) - 3);
    g.fillText('30', 3, y(33.3) - 3);
  }
}
