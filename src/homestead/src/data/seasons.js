// The four seasons. Autumn is the look of the Chainers Farm reference screenshots and is what the models
// and textures were made for; the other three re-light the world, repaint the ground with their own
// texture set (tools/process_textures3.py), recolour foliage in the shader and add weather.
//
// Art direction: one world, one light family. Every season keeps autumn's low golden sun, its warm earth
// and its dark bark, and moves only part of the palette. Greens are the reference's dark olive
// (#465a17 .. #8a9a3a), never lime: the sun is strong and warm, so foliage colours here are darker and
// greyer than what ends up on screen. Winter is a first snow at golden hour, not a white-out.

export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
export const DEFAULT_SEASON = 'autumn';
export const SKY_STOPS = [0, 0.36, 0.5, 0.6, 0.8, 1];   // gradient positions, zenith -> below the horizon

// Foliage: every leaf card carries a baked autumn colour. The shader sorts it into a family by hue
// (russet, orange, gold, green) and re-paints it on a three-stop ramp: shade -> [mid, light].
// `leaf: null` keeps the baked colours.
export const SEASONS = {
  spring: {
    name: 'Spring', icon: 'ui_season_spring', blurb: 'First green, a few trees in blossom',
    sun: { color: [1.0, 0.90, 0.74], intensity: 1.75, pitch: 52, shadow: 0.74 },
    ambient: [0.47, 0.44, 0.42],
    sky: ['#7aa3c6', '#b3cbd6', '#f2e2c4', '#f6d9b2', '#efc49c', '#dcaa82'],
    cloud: ['#fff5e8', '#ffe8d2', '#ffeadb', '#f6d2b6'],            // [diffuse A, glow A, diffuse B, glow B]
    ground: { dirt: 'dirt_spring', floor: 'floor_spring', grass: 'grass_spring', sand: 'sand_spring', stone: 'rock', soil: 'soil', water: 'floor_spring' },
    lip: '#f4e2c8', water: 'water', grass: 0.55,
    leaf: {
      shade: '#3a3f1c', glow: 0.9,
      russet: ['#bd8c82', '#dcbaa8'],      // the blossom trees, about one in five: dusty rose and peach into cream
      orange: ['#567030', '#7e9850'],      // soft sage-olive: most of the forest
      gold: ['#6c7a30', '#94a04c'],        // young olive-yellow leaves
      green: ['#4a6428', '#6f883c'],
    },
    tuft: ['#7f8636', '#989a48', '#687228'],
    snow: 0, weather: 'petals', wind: 0.8, burst: ['#6c7b25', '#8a9a3a', '#d9a295', '#4a5f18'],
    litter: {
      floor: [['fern', 0.05], ['flowers_a', 0.03], ['flowers_b', 0.025], ['petal_litter_a', 0.03], ['petal_litter_b', 0.03], ['grass_tuft', 0.03]],
      dirt: [['petal_litter_a', 0.03], ['petal_litter_b', 0.03], ['grass_tuft', 0.03], ['flowers_b', 0.012]],
      grass: [['flowers_a', 0.05], ['flowers_b', 0.04], ['grass_tuft', 0.05], ['petal_litter_b', 0.03]],
      sand: [['petal_litter_b', 0.04]],
    },
  },
  summer: {
    name: 'Summer', icon: 'ui_season_summer', blurb: 'Deep olive shade, long golden evenings, fireflies',
    sun: { color: [1.0, 0.87, 0.67], intensity: 1.8, pitch: 49, shadow: 0.8 },
    ambient: [0.46, 0.43, 0.40],
    sky: ['#5f93c2', '#a3c4d6', '#f3e2b6', '#f7d79c', '#f0c283', '#dba868'],
    cloud: ['#fff4e0', '#ffe6c2', '#ffe9cc', '#f6cf9e'],
    ground: { dirt: 'dirt_summer', floor: 'floor_summer', grass: 'grass_summer', sand: 'sand_summer', stone: 'rock', soil: 'soil', water: 'floor_summer' },
    lip: '#f4e2c8', water: 'water', grass: 0.46,
    leaf: {
      shade: '#232c12', glow: 0.6,
      russet: ['#2f4a2a', '#4a693a'],      // forest green, the coolest and darkest crowns
      orange: ['#3f5c2c', '#668544'],      // deep olive: most of the forest
      gold: ['#666c2c', '#94964a'],        // golden-green crowns
      green: ['#3a5426', '#587638'],
    },
    tuft: ['#9a8a3c', '#b39f4e', '#7f7430'],
    snow: 0, weather: 'motes', wind: 0.15, burst: ['#4a5f18', '#62782a', '#8a9a3a', '#a3963a'],
    litter: {
      floor: [['fern', 0.09], ['grass_tuft', 0.05], ['flowers_a', 0.02], ['flowers_b', 0.02], ['mushrooms', 0.025]],
      dirt: [['grass_tuft', 0.05], ['flowers_b', 0.012]],
      grass: [['grass_tuft', 0.08], ['flowers_a', 0.03], ['fern', 0.03]],
      sand: [],
    },
  },
  autumn: {
    name: 'Autumn', icon: 'ui_season_autumn', blurb: 'Golden maples and falling leaves',
    sun: { color: [1.0, 0.88, 0.70], intensity: 1.75, pitch: 54, shadow: 0.78 },
    ambient: [0.50, 0.42, 0.40],
    sky: ['#6f9cc4', '#a9c6da', '#f1dcba', '#f6d3a4', '#eebd8c', '#d9a070'],
    cloud: ['#fff4e4', '#ffe6c8', '#ffe9d2', '#f6cfa6'],
    ground: { dirt: 'dirt', floor: 'floor', grass: 'grass', sand: 'sand', stone: 'rock', soil: 'soil', water: 'floor' },
    lip: '#f4e2c8', water: 'water', grass: 0.6,
    leaf: null,
    tuft: ['#b8742c', '#c98a3c', '#a5621f'],
    snow: 0, weather: 'leaves', wind: 1.2, burst: ['#d5761a', '#dfa126', '#b85c14', '#62782a'],
    litter: {
      floor: [['leaf_litter_a', 0.07], ['leaf_litter_b', 0.07], ['leaf_litter_c', 0.06], ['fern', 0.05], ['grass_tuft', 0.03]],
      dirt: [['leaf_litter_a', 0.045], ['leaf_litter_b', 0.045], ['leaf_litter_c', 0.04], ['grass_tuft', 0.025]],
      grass: [['leaf_litter_b', 0.1], ['grass_tuft', 0.06]],
      sand: [['leaf_litter_b', 0.1]],
    },
  },
  winter: {
    name: 'Winter', icon: 'ui_season_winter', blurb: 'First snow on the last leaves, frozen ponds',
    sun: { color: [1.0, 0.91, 0.75], intensity: 1.6, pitch: 43, shadow: 0.76 },
    ambient: [0.40, 0.43, 0.56],                                     // the cold comes from the sky: blue-violet shade
    sky: ['#8496bc', '#b8bfd4', '#f0dcc8', '#f4cfae', '#e9b89c', '#cfa294'],
    cloud: ['#fbeee2', '#f6dcc8', '#f1e2dc', '#e2c8c4'],
    ground: { dirt: 'snow', floor: 'snow_floor', grass: 'snow_grass', sand: 'snow_path', stone: 'rock_snow', soil: 'soil', water: 'snow_floor' },
    lip: '#f4e2c8', water: 'ice', grass: 0.52,
    leaf: {
      shade: '#2e2428', glow: 0.6, snow: 0.29,                        // snow: how much of a crown's top is covered
      russet: ['#5e3e2e', '#7c5943'],      // the last leaves hang on: muted russet
      orange: ['#6e5540', '#957c58'],      // tan and brown
      gold: ['#7f7352', '#a89c74'],        // straw
      green: ['#2c4230', '#42593c'],       // evergreens stay dark
    },
    tuft: ['#9a8256', '#b39a6a', '#836c44'],
    snow: 0.78, weather: 'snow', wind: 0.55, burst: ['#957c58', '#8f5a3a', '#e6e5e4', '#42593c'],
    litter: {
      floor: [['snow_drift_a', 0.05], ['snow_drift_b', 0.05], ['leaf_litter_a', 0.04], ['leaf_litter_c', 0.04], ['grass_tuft', 0.03]],
      dirt: [['snow_drift_a', 0.03], ['snow_drift_b', 0.03], ['leaf_litter_b', 0.03], ['grass_tuft', 0.03]],
      grass: [['grass_tuft', 0.07], ['snow_drift_b', 0.03]],
      sand: [],
    },
    snowman: true,
  },
};

// Snow as a material colour (models, drifts, the tops of crowns). A soft grey-ivory: the low sun turns it
// warm ivory, the sky turns its shadows blue-violet. Pure white would only burn out.
export const SNOW = { color: '#dcdde2', shade: '#c6c9d8' };

// Weather motes around the camera. fall: m/s downwards; drift: sideways sway; flat: thin like a leaf.
export const WEATHER = {
  petals: { count: 40, colors: ['#e0aca0', '#f0d2c2', '#faefdf'], size: [0.2, 0.32], flat: true, fall: [0.5, 0.95], drift: 0.9, spin: 110, glow: 0.25 },
  motes:  { count: 30, colors: ['#ffe9a0', '#ffd874', '#fff0c0'], size: [0.13, 0.2], flat: false, fall: [-0.12, 0.12], drift: 0.45, spin: 0, glow: 1.8, low: true },
  leaves: { count: 40, colors: ['#d5761a', '#dfa126', '#b85c14', '#c8321c'], size: [0.3, 0.44], flat: true, fall: [0.8, 1.4], drift: 1.3, spin: 240, glow: 0.15 },
  snow:   { count: 110, colors: ['#f6efe2', '#e6e4e6'], size: [0.14, 0.26], flat: false, fall: [1.0, 1.9], drift: 0.5, spin: 0, glow: 0.45 },
};
