// Builds site/demos/gaptooth/ from src/gaptooth/:
//   index.html (full document, social tags, back link to the hub)
//   app.<hash>.js  (esbuild bundle of src/gaptooth/src/main.js)
//   style.<hash>.css
// Binary assets live in site/demos/gaptooth/assets/ and are cache-busted with ?v=<hash>.
// PlayCanvas is served from /vendor/playcanvas/<version>/ so every demo shares one cached engine.
//
// usage: cd tools && npm install && node build.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'gaptooth');
const OUT = path.join(ROOT, 'site', 'demos', 'gaptooth');
const ENGINE = '/vendor/playcanvas/2.22.4/playcanvas.min.js';
const SITE_URL = 'https://chainers.art';

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

// clean previous hashed outputs
for (const f of fs.readdirSync(OUT)) if (/^(app|style)\.[0-9a-f]{10}\.(js|css)$/.test(f)) fs.rmSync(path.join(OUT, f));

// ---- CSS
const css = esbuild.transformSync(
  fs.readFileSync(path.join(SRC, 'src', 'fonts.css'), 'utf8') + '\n' + fs.readFileSync(path.join(SRC, 'src', 'style.css'), 'utf8'),
  { loader: 'css', minify: true },
).code;
const cssName = `style.${hash(css)}.css`;
fs.writeFileSync(path.join(OUT, cssName), css);

// ---- JS
const js = esbuild.buildSync({
  entryPoints: [path.join(SRC, 'src', 'main.js')], bundle: true, minify: true, format: 'iife',
  target: ['es2020'], write: false, legalComments: 'none',
}).outputFiles[0].text;
const jsName = `app.${hash(js)}.js`;
fs.writeFileSync(path.join(OUT, jsName), js);

// ---- assets version (all binary assets + cover)
const assetFiles = fs.readdirSync(path.join(OUT, 'assets')).sort();
const assetsVersion = hash(Buffer.concat(assetFiles.map((f) => fs.readFileSync(path.join(OUT, 'assets', f)))));
const coverV = hash(fs.readFileSync(path.join(OUT, 'social.jpg')));

// ---- HTML
let body = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const cut = body.indexOf('<div id="app">');
body = body.slice(cut)
  .replace('<!--__SCRIPTS__-->\n', '')
  .replace('<script src="engine/playcanvas.js"></script>\n<script type="module" src="src/main.js"></script>',
    `<script src="${ENGINE}"></script>\n<script src="${jsName}"></script>`);
// brand block becomes the way back to the hub
body = body.replace(/<div class="brand">\s*<span class="brand-mark">GAPTOOTH<\/span>\s*<span class="brand-sub">[^<]*<\/span>\s*<\/div>/,
  `<a class="brand" href="/" title="All Chainers demos">
      <span class="back" aria-hidden="true">&lsaquo;</span>
      <span class="brand-mark">GAPTOOTH</span>
      <span class="brand-sub">Chainers demos</span>
    </a>`);
if (!body.includes('class="back"')) throw new Error('brand block not found');

const title = 'Gaptooth Test Range · Chainers Demos';
const desc = 'An articulated voxel character with 26 animations and four weapons, playable in the browser in PBR or comic style: shooting range, 60-second score attack, animation studio.';
const html = `<!doctype html>
<html lang="en" data-assets-version="${assetsVersion}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#1a1814">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${SITE_URL}/demos/gaptooth/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Chainers Demos">
<meta property="og:title" content="Gaptooth Test Range">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE_URL}/demos/gaptooth/">
<meta property="og:image" content="${SITE_URL}/demos/gaptooth/social.jpg?v=${coverV}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="${ENGINE}" as="script">
<link rel="preload" href="assets/character.glb?v=${assetsVersion}" as="fetch" crossorigin>
<link rel="stylesheet" href="${cssName}">
</head>
<body>
${body.trim()}
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// ---- hub: point the tile and the share card at the current images (Cloudflare caches images for a day)
const HUB = path.join(ROOT, 'site', 'index.html');
const tileV = hash(fs.readFileSync(path.join(OUT, 'cover.jpg')));
const hub = fs.readFileSync(HUB, 'utf8')
  .replace(/\/demos\/gaptooth\/cover\.jpg(\?v=[0-9a-f]+)?/g, `/demos/gaptooth/cover.jpg?v=${tileV}`)
  .replace(/\/demos\/gaptooth\/social\.jpg(\?v=[0-9a-f]+)?/g, `/demos/gaptooth/social.jpg?v=${coverV}`);
fs.writeFileSync(HUB, hub);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`built ${path.relative(ROOT, OUT)}: ${jsName} ${kb(js.length)}, ${cssName} ${kb(css.length)}, assets v=${assetsVersion}`);
