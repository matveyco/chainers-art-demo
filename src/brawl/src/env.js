// Image-based lighting built at startup: two procedural HDR environments (outdoor range sky,
// photo studio) rendered on the CPU into small equirect float textures, then prefiltered by the
// engine into env atlases (diffuse irradiance + glossy reflection mips). No image downloads.
const pc = window.pc;

// float -> IEEE half (enough precision for lighting data)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function half(v) {
  _f[0] = v;
  const x = _u[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 112;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7bff;
  return sign | (exp << 10) | ((x >>> 13) & 0x3ff);
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Direction convention matches the engine's env sampling (row 0 = straight up, x mirrored).
function equirect(device, name, W, H, fn) {
  const tex = new pc.Texture(device, {
    name, width: W, height: H, format: pc.PIXELFORMAT_RGBA16F, mipmaps: false,
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
  });
  const data = tex.lock();
  const d = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const el = (0.5 - (j + 0.5) / H) * Math.PI;
    const ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i < W; i++) {
      const ph = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      d[0] = -ce * Math.sin(ph); d[1] = se; d[2] = ce * Math.cos(ph);   // engine samples env maps x-mirrored
      const c = fn(d);
      const k = (j * W + i) * 4;
      data[k] = half(c[0]); data[k + 1] = half(c[1]); data[k + 2] = half(c[2]); data[k + 3] = half(1);
    }
  }
  tex.unlock();
  return tex;
}

// unit vector pointing TOWARDS a light placed at azimuth/elevation (degrees), same convention as aimLight
export function dirFrom(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Outdoor: deep blue zenith, pale hazy horizon, warm glow around the sun, warm concrete bounce below.
export function rangeSky(sun) {
  const zen = [0.16, 0.34, 0.78], hor = [0.72, 0.82, 0.93], glow = [1.0, 0.78, 0.5];
  const grd = [0.30, 0.27, 0.23], grdHor = [0.52, 0.52, 0.52];
  return (d) => {
    const y = d[1];
    let c;
    if (y >= 0) {
      c = mix(hor, zen, Math.pow(smooth(0, 1, y), 0.55));
      const s = Math.max(0, dot(d, sun));
      const g = Math.pow(s, 12) * 0.45 + Math.pow(s, 90) * 1.4;      // broad warm halo, no hard disc
      c = [c[0] + glow[0] * g, c[1] + glow[1] * g, c[2] + glow[2] * g];
      const haze = 1 - smooth(0, 0.12, y);                             // bright band at the horizon
      c = [c[0] + 0.12 * haze, c[1] + 0.12 * haze, c[2] + 0.1 * haze];
    } else {
      c = mix(grdHor, grd, smooth(0, 0.25, -y));
    }
    return c;
  };
}

// Studio: dark grey room with a continuous soft light band around it (a light tent) and an
// overhead scrim. It has no preferred azimuth, so it stays consistent while the camera orbits;
// the directional key and rim lights ride with the camera and carry the modelling.
export function studioRoom() {
  return (d) => {
    const y = d[1];
    let c = y >= 0 ? mix([0.1, 0.103, 0.11], [0.16, 0.163, 0.17], smooth(0, 1, y)) : mix([0.09, 0.09, 0.095], [0.045, 0.045, 0.05], smooth(0, 0.4, -y));
    const band = smooth(0.26, 0.36, y) * (1 - smooth(0.62, 0.74, y)) * 0.55;   // ~15-45 degrees up
    const top = Math.pow(Math.max(0, y), 10) * 0.6;                            // overhead scrim
    const k = band + top;
    return [c[0] + k, c[1] + k * 0.99, c[2] + k * 0.97];
  };
}

// Softer, less saturated version of the range sky, used for lighting only: the visible sky can be
// a strong blue without turning every shadow blue.
export function rangeLight(sun) {
  const sky = rangeSky(sun);
  return (d) => {
    const c = sky(d);
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const s = d[1] >= 0 ? 0.55 : 1.0;                                     // keep 55% of the sky's saturation
    return [(l + (c[0] - l) * s) * 0.85, (l + (c[1] - l) * s) * 0.85, (l + (c[2] - l) * s) * 0.85];
  };
}

// Build { envAtlas, skybox } from a direction->colour function.
export function buildEnvironment(app, name, fn, opts = {}) {
  const device = app.graphicsDevice;
  const src = equirect(device, name + '-src', opts.width || 256, opts.height || 128, fn);
  const lighting = pc.EnvLighting.generateLightingSource(src, { size: 128 });
  const envAtlas = pc.EnvLighting.generateAtlas(lighting, { size: 512 });
  let skybox = null;
  if (opts.skybox) {
    const skySrc = typeof opts.skybox === 'function' ? equirect(device, name + '-sky', 512, 256, opts.skybox) : src;
    skybox = pc.EnvLighting.generateSkyboxCubemap(skySrc, opts.skyboxSize || 256);
    if (skySrc !== src) skySrc.destroy();
  }
  lighting.destroy();
  src.destroy();
  return { envAtlas, skybox };
}
