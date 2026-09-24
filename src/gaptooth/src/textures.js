// Texture set for the range and the effects. The range textures are pixel art drawn with an
// image model and cleaned to a strict palette (magnified with nearest filtering, mip-mapped in
// sRGB so distant floors don't shimmer); the effect atlases are smooth toon sprites.
import { loadBuffer } from './assets.js';

const pc = window.pc;

const LIST = {
  floor: ['range-floor.png', 'ground'],
  wall: ['range-wall.png', 'pixel'],
  steel: ['range-steel.png', 'pixel'],
  crate: ['range-crate.png', 'pixel'],
  grass: ['range-grass.png', 'ground'],
  barrel: ['range-barrel.png', 'pixelClamp'],
  target: ['range-target.png', 'pixelClamp'],
  wood: ['range-wood.png', 'pixel'],
  hazard: ['range-hazard.png', 'pixel'],
  foliage: ['range-foliage.png', 'pixel'],
  decals: ['range-decals.png', 'pixelClamp'],
  vfx: ['vfx-sprites.webp', 'sprite'],
  vfxField: ['vfx-field.webp', 'data'],
};

// Anisotropic filtering also turns magnification linear on most back ends (D3D via ANGLE), so it
// is kept for the ground only (seen at grazing angles); props keep crisp nearest-filtered pixels.
const KINDS = {
  pixel: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'REPEAT', aniso: 1 },
  ground: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'REPEAT', aniso: 8 },
  pixelClamp: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'NEAREST', wrap: 'CLAMP_TO_EDGE', aniso: 1 },
  sprite: { srgb: true, min: 'LINEAR_MIPMAP_LINEAR', mag: 'LINEAR', wrap: 'CLAMP_TO_EDGE', aniso: 4 },
  data: { srgb: false, min: 'LINEAR_MIPMAP_LINEAR', mag: 'LINEAR', wrap: 'CLAMP_TO_EDGE', aniso: 4 },
};

async function decode(name) {
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

export async function loadTextures(app) {
  const device = app.graphicsDevice;
  const T = {};
  await Promise.all(Object.entries(LIST).map(async ([key, [file, kind]]) => {
    const k = KINDS[kind];
    const src = await decode(file);
    const tex = new pc.Texture(device, {
      name: key, width: src.width, height: src.height,
      format: k.srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc['FILTER_' + k.min], magFilter: pc['FILTER_' + k.mag],
      addressU: pc['ADDRESS_' + k.wrap], addressV: pc['ADDRESS_' + k.wrap],
      anisotropy: k.aniso,
    });
    tex.setSource(src);
    T[key] = tex;
  }));
  return T;
}
