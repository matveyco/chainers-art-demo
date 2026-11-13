// Builds every demo in site/demos/<slug>/ from src/<slug>/:
//   index.html (full document, social tags, back link to the hub)
//   app.<hash>.js  (esbuild bundle of src/<slug>/src/main.js)
//   style.<hash>.css
// Binary assets live in site/demos/<slug>/assets/ and are cache-busted with ?v=<hash>.
// PlayCanvas is served from /vendor/playcanvas/<version>/ so every demo shares one cached engine.
//
// usage: cd tools && npm install && node build.mjs [slug ...]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = '/vendor/playcanvas/2.22.4/playcanvas.min.js';
const SITE_URL = 'https://chainers.art';

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const DEMOS = {
  gaptooth: {
    title: 'Gaptooth Test Range · Chainers Demos',
    ogTitle: 'Gaptooth Test Range',
    desc: 'An articulated voxel character with 26 animations and four weapons, playable in the browser in PBR or comic style: shooting range, 60-second score attack, animation studio.',
    theme: '#1a1814',
    preload: 'character.glb',
    // the brand block becomes the way back to the hub
    brand: [/<div class="brand">\s*<span class="brand-mark">GAPTOOTH<\/span>\s*<span class="brand-sub">[^<]*<\/span>\s*<\/div>/,
      `<a class="brand" href="/" title="All Chainers demos">
      <span class="back" aria-hidden="true">&lsaquo;</span>
      <span class="brand-mark">GAPTOOTH</span>
      <span class="brand-sub">Chainers demos</span>
    </a>`],
  },
  brawl: {
    title: 'Chainers Brawl · Chainers Demos',
    ogTitle: 'Chainers Brawl',
    desc: 'A top-down brawler against bots, in the browser: Gem Grab 3 vs 3 or Solo Showdown for six, four Chainers with their own weapons and supers, bushes to hide in, breakable walls, toon, PBR and pixel-art graphics.',
    theme: '#17122c',
    preload: 'character.glb',
    brand: [/<div class="brand">\s*<span class="brand-mark">CHAINERS<\/span>\s*<span class="brand-sub">[^<]*<\/span>\s*<\/div>/,
      `<a class="brand" href="/" title="All Chainers demos">
      <span class="back" aria-hidden="true">&lsaquo;</span>
      <span class="brand-mark">CHAINERS</span>
      <span class="brand-sub">All demos</span>
    </a>`],
  },
};

function buildDemo(slug) {
  const cfg = DEMOS[slug];
  const SRC = path.join(ROOT, 'src', slug);
  const OUT = path.join(ROOT, 'site', 'demos', slug);

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
  const end = body.indexOf('</body>');
  body = body.slice(cut, end >= 0 ? end : undefined)
    .replace('<!--__SCRIPTS__-->\n', '')
    .replace('<script src="engine/playcanvas.js"></script>\n<script type="module" src="src/main.js"></script>',
      `<script src="${ENGINE}"></script>\n<script src="${jsName}"></script>`);
  if (!body.includes(jsName)) throw new Error(slug + ': script tags not found');
  body = body.replace(cfg.brand[0], cfg.brand[1]);
  if (!body.includes('class="back"')) throw new Error(slug + ': brand block not found');

  const html = `<!doctype html>
<html lang="en" data-assets-version="${assetsVersion}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${cfg.title}</title>
<meta name="description" content="${cfg.desc}">
<meta name="theme-color" content="${cfg.theme}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${SITE_URL}/demos/${slug}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Chainers Demos">
<meta property="og:title" content="${cfg.ogTitle}">
<meta property="og:description" content="${cfg.desc}">
<meta property="og:url" content="${SITE_URL}/demos/${slug}/">
<meta property="og:image" content="${SITE_URL}/demos/${slug}/social.jpg?v=${coverV}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="${ENGINE}" as="script">
<link rel="preload" href="assets/${cfg.preload}?v=${assetsVersion}" as="fetch" crossorigin>
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
    .replace(new RegExp(`/demos/${slug}/cover\\.jpg(\\?v=[0-9a-f]+)?`, 'g'), `/demos/${slug}/cover.jpg?v=${tileV}`)
    .replace(new RegExp(`/demos/${slug}/social\\.jpg(\\?v=[0-9a-f]+)?`, 'g'), `/demos/${slug}/social.jpg?v=${coverV}`);
  fs.writeFileSync(HUB, hub);
  console.log(`built ${path.relative(ROOT, OUT)}: ${jsName} ${kb(js.length)}, ${cssName} ${kb(css.length)}, assets v=${assetsVersion}`);
}

// ---- Chainers Homestead: a bigger game with its own engine build, nested asset folders and sounds.
// Sources and assets are copied in from the game's own project; this step only bundles and stamps them.
//   app.<hash>.js   src/homestead/src/main.js with PlayCanvas bundled in (ES module)
//   style.<hash>.css  src/homestead/fonts.css (page fonts, back link) + the game's stylesheet
//   assets/**       models, textures, icons, manifest: requested with ?v=<hash of them all>
//   audio/*.mp3     outside assets/, so nginx sends them as audio
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.startsWith('.') ? [] : [path.join(dir, e.name)]));
}
function buildHomestead() {
  const slug = 'homestead';
  const SRC = path.join(ROOT, 'src', slug);
  const OUT = path.join(ROOT, 'site', 'demos', slug);
  const title = 'Chainers Homestead · Chainers Demos';
  const ogTitle = 'Chainers Homestead';
  const desc = 'Build a cosy homestead in a forest clearing: clear land, farm, give your Chainers orders, send parties to the frontier for loot, automate the work and pack crates for the reward pool. Four seasons, made for phones first.';
  for (const f of fs.readdirSync(OUT)) if (/^(app|style)\.[0-9a-f]{10}\.(js|css)$/.test(f)) fs.rmSync(path.join(OUT, f));

  const out = esbuild.buildSync({
    entryPoints: [path.join(SRC, 'src', 'main.js')], bundle: true, minify: true, format: 'esm',
    target: ['es2020'], write: false, legalComments: 'none', outdir: OUT, entryNames: 'app',
    nodePaths: [path.join(ROOT, 'tools', 'node_modules')],
  }).outputFiles;
  const js = out.find((f) => f.path.endsWith('.js')).text;
  const gameCss = out.find((f) => f.path.endsWith('.css')).text;
  const css = esbuild.transformSync(fs.readFileSync(path.join(SRC, 'fonts.css'), 'utf8') + '\n' + gameCss, { loader: 'css', minify: true }).code;
  const jsName = `app.${hash(js)}.js`, cssName = `style.${hash(css)}.css`;
  fs.writeFileSync(path.join(OUT, jsName), js);
  fs.writeFileSync(path.join(OUT, cssName), css);

  const files = [...walk(path.join(OUT, 'assets')), ...walk(path.join(OUT, 'audio'))];
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.relative(OUT, f)); h.update(fs.readFileSync(f)); }
  const assetsVersion = h.digest('hex').slice(0, 10);
  const coverV = hash(fs.readFileSync(path.join(OUT, 'social.jpg')));

  const body = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace('<!--__SCRIPTS__-->', `<script type="module" src="${jsName}"></script>`);
  if (!body.includes(jsName)) throw new Error(slug + ': script slot not found');
  const html = `<!doctype html>
<html lang="en" data-assets-version="${assetsVersion}" data-audio-dir="audio/">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#7a4a1f">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${SITE_URL}/demos/${slug}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Chainers Demos">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE_URL}/demos/${slug}/">
<meta property="og:image" content="${SITE_URL}/demos/${slug}/social.jpg?v=${coverV}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/assets/fonts/geologica-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="modulepreload" href="${jsName}">
<link rel="stylesheet" href="${cssName}">
</head>
<body>
${body.trim()}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  const HUB = path.join(ROOT, 'site', 'index.html');
  const tileV = hash(fs.readFileSync(path.join(OUT, 'cover.jpg')));
  fs.writeFileSync(HUB, fs.readFileSync(HUB, 'utf8')
    .replace(new RegExp(`/demos/${slug}/cover\\.jpg(\\?v=[0-9a-f]+)?`, 'g'), `/demos/${slug}/cover.jpg?v=${tileV}`)
    .replace(new RegExp(`/demos/${slug}/social\\.jpg(\\?v=[0-9a-f]+)?`, 'g'), `/demos/${slug}/social.jpg?v=${coverV}`));
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`built ${path.relative(ROOT, OUT)}: ${jsName} ${kb(js.length)}, ${cssName} ${kb(css.length)}, ${files.length} asset files ${(bytes / 1048576).toFixed(1)} MB, v=${assetsVersion}`);
}

const BUILDERS = { ...Object.fromEntries(Object.keys(DEMOS).map((slug) => [slug, () => buildDemo(slug)])), homestead: buildHomestead };
const pick = process.argv.slice(2);
for (const slug of (pick.length ? pick : Object.keys(BUILDERS))) {
  if (!BUILDERS[slug]) throw new Error('unknown demo: ' + slug);
  BUILDERS[slug]();
}
