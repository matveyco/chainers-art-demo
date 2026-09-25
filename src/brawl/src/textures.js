// Texture set: pixel-art arena textures painted with an image model and cleaned to fixed
// palettes (nearest magnification, sRGB mip-maps), the brawler outfit atlases, and the effect
// atlases. Sources are kept as bitmaps where the ground is baked on a canvas.
import { loadBuffer } from './assets.js';

const pc = window.pc;

const LIST = {
  grass: ['arena-grass.png', 'ground', true],
  dirt: ['arena-dirt.png', 'ground', true],
  crate: ['arena-crate.png', 'pixel'],
  stone: ['arena-stone.png', 'pixel'],
  leaves: ['arena-leaves.png', 'pixel'],
  skin_brick: ['skin-brick.png', 'pixelClamp'],
  skin_brick_mr: ['skin-brick-mr.png', 'dataNearest'],
  skin_rosa: ['skin-rosa.png', 'pixelClamp'],
  skin_rosa_mr: ['skin-rosa-mr.png', 'dataNearest'],
  skin_pip: ['skin-pip.png', 'pixelClamp'],
  skin_pip_mr: ['skin-pip-mr.png', 'dataNearest'],
  vfx: ['vfx-sprites.webp', 'sprite'],
  vfxField: ['vfx-field.webp', 'data'],
};

const KINDS = {
  pixel: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'REPEAT', aniso: 1 },
  ground: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'REPEAT', aniso: 8 },
  pixelClamp: { srgb: true, min: 'NEAREST_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'CLAMP_TO_EDGE', aniso: 1 },
  dataNearest: { srgb: false, min: 'NEAREST_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'CLAMP_TO_EDGE', aniso: 1 },
  sprite: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'LINEAR', wrap: 'CLAMP_TO_EDGE', aniso: 4 },
  data: { srgb: false, min: 'LINEAR_MIPMAP_LINEAR', mag: 'LINEAR', wrap: 'CLAMP_TO_EDGE', aniso: 4 },
};

export async function decodeImage(name) {
  const buf = await loadBuffer(name);
  const type = name.endsWith('.webp') ? 'image/webp' : 'image/png';
  const blob = new Blob([buf], { type });
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function makeTexture(device, src, kind, name = '') {
  const k = KINDS[kind];
  const tex = new pc.Texture(device, {
    name, width: src.width, height: src.height,
    format: k.srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc['FILTER_' + k.min], magFilter: pc['FILTER_' + k.mag],
    addressU: pc['ADDRESS_' + k.wrap], addressV: pc['ADDRESS_' + k.wrap],
    anisotropy: k.aniso,
  });
  tex.setSource(src);
  return tex;
}

export async function loadTextures(app, onEach) {
  const device = app.graphicsDevice;
  const T = { src: {} };
  await Promise.all(Object.entries(LIST).map(async ([key, [file, kind, keep]]) => {
    const src = await decodeImage(file);
    T[key] = makeTexture(device, src, kind, key);
    if (keep) T.src[key] = src;
    if (onEach) onEach(key);
  }));
  return T;
}

export const TEXTURE_COUNT = Object.keys(LIST).length;
