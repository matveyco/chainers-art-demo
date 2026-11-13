// Where the game's files live and how their URLs are versioned.
// In the dev server everything sits under assets/. A hosted build may stamp the page with
// data-assets-version (appended as ?v=... so caches never serve a stale file) and point sounds
// at another folder with data-audio-dir.
const el = typeof document !== 'undefined' ? document.documentElement : null;
const V = el && el.dataset.assetsVersion ? '?v=' + el.dataset.assetsVersion : '';
const AUDIO = (el && el.dataset.audioDir) || 'assets/sfx/';

/** URL of a file under assets/, e.g. asset('models/home_1.glb'). */
export const asset = (path) => `assets/${path}${V}`;
/** URL of a sticker icon. */
export const iconUrl = (name) => `assets/icons/${name}.png${V}`;
/** URL of a sound. */
export const audioUrl = (name) => `${AUDIO}${name}.mp3${V}`;
