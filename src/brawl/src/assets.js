// Asset access. In the published single-file build the GLBs/JSON are embedded as base64
// (window.__EMBED__); in development they are fetched from ./assets/.
const pc = window.pc;

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// cache-busting token for hosted builds: <html data-assets-version="...">
const VERSION = document.documentElement.dataset.assetsVersion || '';
const url = (name) => 'assets/' + name + (VERSION ? '?v=' + VERSION : '');

export async function loadBuffer(name) {
  const emb = window.__EMBED__ && window.__EMBED__[name];
  if (emb) return b64ToBuffer(emb);
  const r = await fetch(url(name));
  if (!r.ok) throw new Error('Could not load ' + name + ' (' + r.status + ')');
  return r.arrayBuffer();
}

export async function loadJSON(name) {
  const buf = await loadBuffer(name);
  return JSON.parse(new TextDecoder().decode(buf));
}

export function assetURL(name, mime) {
  const emb = window.__EMBED__ && window.__EMBED__[name];
  if (emb) return 'data:' + mime + ';base64,' + emb;
  return url(name);
}

// Create a container asset from bytes already in memory (no network request).
export function containerFromBuffer(app, name, buffer) {
  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(name, 'container', { url: name, filename: name, contents: buffer });
    asset.once('load', () => resolve(asset));
    asset.once('error', (e) => reject(e));
    app.assets.add(asset);
    app.assets.load(asset);
  });
}
