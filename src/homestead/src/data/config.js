// Chainers Homestead — all tunable game-design data lives here.

export const TILE = 2;            // metres per ground tile
export const GRID = 22;           // island is GRID x GRID tiles
export const CHAINER_SCALE = 0.85;

// ----------------------------------------------------------------------------------------------
// Resources
// ----------------------------------------------------------------------------------------------
export const RES = {
  wood:    { name: 'Wood',      icon: 'res_wood',    tier: 'raw',     value: 1,   color: '#b9773f', store: 'warehouse' },
  stone:   { name: 'Stone',     icon: 'res_stone',   tier: 'raw',     value: 1,   color: '#9aa0ad', store: 'warehouse' },
  bio:     { name: 'Biopoints', icon: 'res_bio',     tier: 'raw',     value: 0.8, color: '#6dbb3f', store: 'granary' },
  ore:     { name: 'Ore',       icon: 'res_ore',     tier: 'raw',     value: 2.5, color: '#8a6f9e', store: 'warehouse' },
  crystal: { name: 'Crystal',   icon: 'res_crystal', tier: 'rare',    value: 30,  color: '#3fd1c8', store: 'warehouse' },
  planks:  { name: 'Planks',    icon: 'res_planks',  tier: 'refined', value: 5,   color: '#d19a5b', store: 'warehouse' },
  bricks:  { name: 'Bricks',    icon: 'res_bricks',  tier: 'refined', value: 5,   color: '#d8684f', store: 'warehouse' },
  ingot:   { name: 'Ingots',    icon: 'res_ingot',   tier: 'refined', value: 14,  color: '#9fb0c4', store: 'warehouse' },
};
export const RES_ORDER = ['wood', 'stone', 'bio', 'ore', 'planks', 'bricks', 'ingot', 'crystal'];
export const HUD_RES = ['wood', 'stone', 'bio', 'ore', 'planks', 'bricks', 'ingot', 'crystal'];
export const BASE_CAP = { wood: 300, stone: 300, bio: 300, ore: 150, crystal: 20, planks: 80, bricks: 80, ingot: 40 };

// Crates are what you upload into the Reward Pool.
export const CRATES = {
  crate1: { name: 'Relief Crate', icon: 'item_crate_1', points: 10,  time: 45,  cost: { wood: 20, stone: 20, bio: 30 }, workshop: 1, xp: 8 },
  crate2: { name: 'Sturdy Crate', icon: 'item_crate_2', points: 48,  time: 150, cost: { planks: 8, bricks: 8, bio: 60 }, workshop: 2, xp: 30 },
  crate3: { name: 'Grand Crate',  icon: 'item_crate_3', points: 240, time: 420, cost: { planks: 12, bricks: 12, ingot: 6, crystal: 2, bio: 120 }, workshop: 3, xp: 120 },
};

// ----------------------------------------------------------------------------------------------
// Chainer stats: 3 main + 2 additional
// ----------------------------------------------------------------------------------------------
export const STATS = {
  might:   { name: 'Might',   short: 'MGT', icon: 'item_dumbbell', main: true,  color: '#e2574c', desc: 'Raw strength. Chopping, mining and fighting.' },
  agility: { name: 'Agility', short: 'AGI', icon: 'item_feather',  main: true,  color: '#3aa3e3', desc: 'Speed and nimble hands. Chopping, foraging, fighting, exploring.' },
  wits:    { name: 'Wits',    short: 'WIT', icon: 'item_book',     main: true,  color: '#9a6bd8', desc: 'Cleverness. Exploring, foraging, mining and crafting.' },
  stamina: { name: 'Stamina', short: 'STA', icon: 'item_bolt',     main: false, color: '#f4ab1b', desc: 'Recovers faster after expeditions and shrugs off harsh terrain.' },
  luck:    { name: 'Luck',    short: 'LCK', icon: 'item_clover',   main: false, color: '#4fb84a', desc: 'Better odds, bonus loot and jackpot finds.' },
};
export const STAT_KEYS = ['might', 'agility', 'wits', 'stamina', 'luck'];

// Which stats matter for which activity (weights sum to 1).
export const ACTIVITIES = {
  lumber:  { name: 'Lumber',   icon: 'item_axe',     w: { might: 0.6, agility: 0.4 }, tool: 'tool_axe',     verb: 'Chopping' },
  mining:  { name: 'Mining',   icon: 'item_pickaxe', w: { might: 0.7, wits: 0.3 },    tool: 'tool_pickaxe', verb: 'Mining' },
  forage:  { name: 'Foraging', icon: 'item_basket',  w: { agility: 0.5, wits: 0.5 },  tool: 'tool_hoe',     verb: 'Foraging' },
  fight:   { name: 'Fighting', icon: 'item_sword',   w: { might: 0.5, agility: 0.5 }, tool: 'tool_sword',   verb: 'Fighting' },
  explore: { name: 'Exploring', icon: 'item_compass', w: { wits: 0.7, agility: 0.3 }, tool: 'tool_torch',   verb: 'Exploring' },
  craft:   { name: 'Crafting', icon: 'item_hammer',  w: { wits: 0.6, agility: 0.4 },  tool: 'tool_hammer',  verb: 'Crafting' },
};

export const RARITY = {
  common:    { name: 'Common',    color: '#9aa3ad', budget: [13, 16], price: [0.0020, 0.0034], weight: 1, stars: 1 },
  uncommon:  { name: 'Uncommon',  color: '#4fb84a', budget: [17, 20], price: [0.0060, 0.0100], weight: 1, stars: 2 },
  rare:      { name: 'Rare',      color: '#3a8fe3', budget: [21, 25], price: [0.0220, 0.0360], weight: 1, stars: 3 },
  epic:      { name: 'Epic',      color: '#a45be0', budget: [26, 30], price: [0.0650, 0.1000], weight: 1, stars: 4 },
  legendary: { name: 'Legendary', color: '#f4ab1b', budget: [31, 36], price: [0.1800, 0.2800], weight: 1, stars: 5 },
};
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const TRAITS = {
  lumberjack: { name: 'Lumberjack',  desc: '+25% Wood from everything',            icon: 'item_axe' },
  stonehand:  { name: 'Stonehand',   desc: '+25% Stone and Ore from everything',   icon: 'item_pickaxe' },
  greenthumb: { name: 'Green Thumb', desc: '+30% Biopoints when working a farm',   icon: 'item_basket' },
  brawler:    { name: 'Brawler',     desc: '+20% power in fights',                 icon: 'item_sword' },
  pathfinder: { name: 'Pathfinder',  desc: 'Expeditions are 20% faster',           icon: 'item_compass' },
  tinkerer:   { name: 'Tinkerer',    desc: '+25% crafting speed when working',     icon: 'item_hammer' },
  nightowl:   { name: 'Night Owl',   desc: 'Rests 30% faster',                     icon: 'item_bolt' },
  charmer:    { name: 'Lucky Charm', desc: '+3 Luck for the whole team',           icon: 'item_clover' },
  lightfoot:  { name: 'Light Eater', desc: 'Eats half the Biopoints',              icon: 'item_food_bowl' },
};

export const NAMES = ['Pell', 'Ilva', 'Bix', 'Momo', 'Tavi', 'Juno', 'Rook', 'Pip', 'Nilo', 'Zuzu', 'Brim', 'Kato', 'Lumi', 'Dax', 'Fenn',
  'Oko', 'Suri', 'Wren', 'Yuki', 'Zed', 'Arlo', 'Bea', 'Cleo', 'Dot', 'Echo', 'Flo', 'Gus', 'Hux', 'Ivo', 'Jax', 'Kiki', 'Lux', 'Mika',
  'Nox', 'Olli', 'Pax', 'Quill', 'Rexo', 'Sol', 'Tess', 'Uma', 'Vex', 'Wim', 'Xan', 'Yara', 'Zola', 'Bobo', 'Chip', 'Dune', 'Elko', 'Fizz',
  'Gala', 'Hobb', 'Inka', 'Jolt', 'Koda', 'Loma', 'Mott', 'Nemi', 'Opal', 'Puck', 'Rumi', 'Sage', 'Tuck', 'Vida', 'Yoko'];

export const USER_ADJ = ['Cozy', 'Sunny', 'Blocky', 'Lucky', 'Mossy', 'Golden', 'Brave', 'Nimble', 'Jolly', 'Mellow', 'Snug', 'Bright', 'Chunky', 'Merry', 'Swift'];
export const USER_NOUN = ['Chainer', 'Farmer', 'Builder', 'Wanderer', 'Tinker', 'Gardener', 'Pioneer', 'Ranger', 'Keeper', 'Baker', 'Mason', 'Scout'];

// Wishes: a "condition" a wandering guest hopes to find at your home.
export const WISHES = {
  campfire: { text: 'a crackling Campfire',   need: { decor_campfire: 1 } },
  well:     { text: 'fresh water from a Well', need: { well: 1 } },
  flowers:  { text: 'three Flower Beds',      need: { decor_flowerbed: 3 } },
  bench:    { text: 'a Bench to sit on',      need: { decor_bench: 1 } },
  lantern:  { text: 'two warm Lanterns',      need: { decor_lantern: 2 } },
  lodge:    { text: 'a Rest Lodge',           need: { rest_lodge: 1 } },
  fountain: { text: 'a splashing Fountain',   need: { decor_fountain: 1 } },
  pond:     { text: 'a quiet Pond',           need: { decor_pond: 1 } },
  arena:    { text: 'a Training Ground',      need: { arena: 1 } },
  statue:   { text: 'a statue of Gleam',      need: { decor_statue: 1 } },
};

// ----------------------------------------------------------------------------------------------
// Cosiness
// ----------------------------------------------------------------------------------------------
export const COSY_TIERS = [
  { min: 0,   name: 'Bare',       odds: [88, 12, 0, 0, 0],    interval: 150 },
  { min: 20,  name: 'Homely',     odds: [70, 26, 4, 0, 0],    interval: 130 },
  { min: 50,  name: 'Snug',       odds: [52, 34, 12, 2, 0],   interval: 110 },
  { min: 100, name: 'Charming',   odds: [36, 36, 21, 6, 1],   interval: 95 },
  { min: 180, name: 'Enchanting', odds: [22, 34, 28, 13, 3],  interval: 80 },
  { min: 300, name: 'Legendary',  odds: [10, 28, 34, 20, 8],  interval: 65 },
];
export const GRUDGE = { kick: 6, leftHungry: 3, decayPerMin: 0.2 };

// ----------------------------------------------------------------------------------------------
// Buildings. cost(level) = base * growth^(level-1); eth from the table (ETH comes only from the pool).
// ----------------------------------------------------------------------------------------------
const lv = (n, fn) => Array.from({ length: n }, (_, i) => fn(i + 1));

export const BUILD_TIME = [0, 8, 45, 180, 480, 1200];       // seconds to build / upgrade TO level n
export const ETH_STEP = [0, 0, 0, 0.0010, 0.0035, 0.0090];  // ETH needed to upgrade TO level n (x building.ethMul)

export const BUILDINGS = {
  home: {
    name: 'Chainer Home', cat: 'core', size: [3, 3], max: 1, maxLevel: 5, models: ['home_1', 'home_1', 'home_2', 'home_2', 'home_3'],
    desc: 'Where your own Chainers live. Its level unlocks everything else.', icon: 'home_1', cosy: lv(5, l => 4 + l * 4),
    base: { wood: 60, stone: 40 }, growth: 3.0, ethMul: 2.0, add: { 3: { planks: 15, bricks: 10 }, 4: { planks: 40, bricks: 40, ingot: 6 }, 5: { planks: 90, bricks: 90, ingot: 25, crystal: 6 } },
    slots: [2, 3, 4, 6, 8], builders: [2, 2, 3, 3, 4],
  },
  camp: {
    name: 'Wanderer Camp', cat: 'core', size: [3, 3], max: 1, maxLevel: 4, models: ['camp_1', 'camp_1', 'camp_2', 'camp_2'],
    desc: 'Travelling Wanderers rest here. Feed them, make them cosy and they will work for you.', icon: 'camp_1', cosy: lv(4, l => 3 + l * 3),
    base: { wood: 40, stone: 15 }, growth: 3.2, ethMul: 1.2, add: { 3: { planks: 20 }, 4: { planks: 45, bricks: 30 } },
    guests: [1, 2, 3, 4], homeReq: [1, 2, 3, 4],
  },
  farm_plot: {
    name: 'Farm Plot', cat: 'produce', size: [2, 2], max: [2, 3, 4, 6, 8], maxLevel: 5, models: ['farm_plot'],
    desc: 'Grow crops for Biopoints — the food that keeps every Chainer going.', icon: 'farm_plot', cosy: lv(5, () => 1),
    base: { wood: 25, stone: 10 }, growth: 2.4, ethMul: 0.4, add: { 4: { planks: 12 }, 5: { planks: 30, bricks: 10 } },
    yieldMul: [1, 1.25, 1.5, 1.8, 2.2], job: 'forage',
  },
  warehouse: {
    name: 'Warehouse', cat: 'storage', size: [3, 2], max: [1, 1, 2, 2, 3], maxLevel: 5, models: ['warehouse'],
    desc: 'Raises how much Wood, Stone, Ore and crafted goods you can hold.', icon: 'warehouse', cosy: lv(5, () => 1),
    base: { wood: 70, stone: 50 }, growth: 2.6, ethMul: 0.8, add: { 3: { planks: 15 }, 4: { planks: 35, bricks: 25 }, 5: { planks: 70, bricks: 60, ingot: 10 } },
    capMul: [1.0, 2.2, 4.0, 7.0, 12.0],
  },
  granary: {
    name: 'Granary', cat: 'storage', size: [2, 2], max: [1, 1, 2, 2, 2], maxLevel: 5, models: ['granary'],
    desc: 'Stores more Biopoints.', icon: 'granary', cosy: lv(5, () => 1),
    base: { wood: 50, stone: 20 }, growth: 2.5, ethMul: 0.6, add: { 3: { planks: 10 }, 4: { planks: 25, bricks: 15 } },
    bioCap: [400, 900, 1800, 3500, 6500],
  },
  sawmill: {
    name: 'Sawmill', cat: 'produce', size: [3, 2], max: 1, maxLevel: 5, models: ['sawmill'], homeReq: [1, 2, 3, 4, 5],
    desc: 'Saws Wood into Planks.', icon: 'sawmill', cosy: lv(5, () => 1),
    base: { wood: 80, stone: 40 }, growth: 2.6, ethMul: 0.8, add: { 3: { bricks: 12 }, 4: { bricks: 30, ingot: 4 }, 5: { bricks: 60, ingot: 14 } },
    recipe: { in: { wood: 4 }, out: { planks: 1 }, time: 14 }, speed: [1, 1.4, 1.9, 2.6, 3.5], queue: [6, 10, 16, 24, 36], job: 'craft',
  },
  stonecutter: {
    name: 'Stonecutter', cat: 'produce', size: [2, 2], max: 1, maxLevel: 5, models: ['stonecutter'], homeReq: [1, 2, 3, 4, 5],
    desc: 'Cuts Stone into Bricks.', icon: 'stonecutter', cosy: lv(5, () => 1),
    base: { wood: 50, stone: 70 }, growth: 2.6, ethMul: 0.8, add: { 3: { planks: 12 }, 4: { planks: 30, ingot: 4 }, 5: { planks: 60, ingot: 14 } },
    recipe: { in: { stone: 4 }, out: { bricks: 1 }, time: 14 }, speed: [1, 1.4, 1.9, 2.6, 3.5], queue: [6, 10, 16, 24, 36], job: 'craft',
  },
  smelter: {
    name: 'Smelter', cat: 'produce', size: [2, 2], max: 1, maxLevel: 5, models: ['smelter'], homeReq: [2, 3, 3, 4, 5],
    desc: 'Smelts Ore (with a little Wood) into Ingots.', icon: 'smelter', cosy: lv(5, () => 1),
    base: { stone: 120, wood: 60, bricks: 6 }, growth: 2.5, ethMul: 1.0, add: { 3: { planks: 15 }, 4: { planks: 30, bricks: 30 } },
    recipe: { in: { ore: 3, wood: 1 }, out: { ingot: 1 }, time: 26 }, speed: [1, 1.4, 1.9, 2.6, 3.5], queue: [4, 8, 12, 18, 26], job: 'craft',
  },
  workshop: {
    name: 'Crate Workshop', cat: 'pool', size: [3, 3], max: 1, maxLevel: 3, models: ['workshop'], homeReq: [1, 2, 3],
    desc: 'Assemble Crates from your resources. Crates are what you upload into the Reward Pool.', icon: 'workshop', cosy: lv(3, () => 2),
    base: { wood: 50, stone: 50 }, growth: 4.0, ethMul: 1.5, add: { 2: { planks: 10, bricks: 10 }, 3: { planks: 40, bricks: 40, ingot: 8 } },
    speed: [1, 1.35, 1.8], queue: [3, 5, 8], job: 'craft',
  },
  pool_shrine: {
    name: 'Pool Shrine', cat: 'pool', size: [3, 3], max: 1, maxLevel: 3, models: ['pool_shrine'], homeReq: [1, 3, 4], global: 'Reward Pool',
    desc: 'Your link to the world Reward Pool, shared by every player. Upload Crates here; every 30 minutes the pool pays ETH by share.', icon: 'pool_shrine', cosy: lv(3, l => 3 + l * 2),
    base: { wood: 30, stone: 60 }, growth: 5.0, ethMul: 3.0, add: { 2: { bricks: 30, ingot: 5 }, 3: { bricks: 80, ingot: 20, crystal: 5 } },
    bonus: [0, 0.1, 0.2],
  },
  balloon_dock: {       // (the id is historic: it began as a balloon dock)
    name: 'Expedition Lodge', cat: 'core', size: [3, 3], max: 1, maxLevel: 4, models: ['trail_lodge', 'trail_lodge', 'trail_lodge_2', 'trail_lodge_2'], alt: 'balloon_dock', homeReq: [1, 2, 3, 4],
    desc: 'Parties of Chainers set off from here to the frontier. Higher levels open new zones, more parties and better transport.', icon: 'trail_lodge', cosy: lv(4, () => 2),
    base: { wood: 60, stone: 30 }, growth: 3.4, ethMul: 1.5, add: { 2: { planks: 12 }, 3: { planks: 35, bricks: 25, ingot: 4 }, 4: { planks: 80, bricks: 60, ingot: 16, crystal: 3 } },
    parallel: [2, 3, 4, 5], regions: [1, 2, 3, 4],
  },
  exchange: {
    name: 'Trading Post', cat: 'pool', size: [3, 2], max: 1, maxLevel: 3, models: ['exchange'], homeReq: [2, 3, 4], global: 'World Exchange',
    desc: 'Your counter at the World Exchange, one market for all players. Swap one resource for another; prices move with supply.', icon: 'exchange', cosy: lv(3, () => 2),
    base: { wood: 90, stone: 60, planks: 6 }, growth: 3.5, ethMul: 1.2, add: { 3: { bricks: 40, ingot: 8 } },
    fee: [0.05, 0.04, 0.03],
  },
  rest_lodge: {
    name: 'Rest Lodge', cat: 'care', size: [2, 2], max: 1, maxLevel: 3, models: ['rest_lodge'], homeReq: [2, 3, 4],
    desc: 'Tired Chainers recover faster after expeditions.', icon: 'rest_lodge', cosy: lv(3, l => 4 + l * 2),
    base: { wood: 80, stone: 30, planks: 6 }, growth: 3.2, ethMul: 1.0, add: { 3: { bricks: 30, ingot: 6 } },
    rest: [0.2, 0.35, 0.5],
  },
  arena: {
    name: 'Training Ground', cat: 'care', size: [3, 3], max: 1, maxLevel: 3, models: ['arena'], homeReq: [3, 4, 5],
    desc: 'Train your own Chainers to raise their stats.', icon: 'arena', cosy: lv(3, () => 3),
    base: { wood: 120, stone: 120, planks: 15, bricks: 15 }, growth: 3.0, ethMul: 1.5, add: { 3: { ingot: 15, crystal: 3 } },
    trainCap: [3, 6, 10],
  },
  well: {
    name: 'Well', cat: 'care', size: [1, 1], max: [1, 1, 2, 2, 2], maxLevel: 1, models: ['well'],
    desc: 'Fresh water. Wanderers love it.', icon: 'well', cosy: [5], base: { stone: 45, wood: 15 }, growth: 1, ethMul: 0,
  },
  // ---- decorations ------------------------------------------------------------------------
  decor_flowerbed: { name: 'Flower Bed', cat: 'decor', size: [1, 1], max: [3, 5, 8, 12, 16], maxLevel: 1, models: ['decor_flowerbed'], desc: 'A splash of colour.', icon: 'decor_flowerbed', cosy: [2], base: { wood: 8, bio: 15 }, growth: 1, ethMul: 0 },
  decor_bench:     { name: 'Bench', cat: 'decor', size: [1, 1], max: [1, 2, 3, 4, 6], maxLevel: 1, models: ['decor_bench'], desc: 'A place to sit and chat.', icon: 'decor_bench', cosy: [3], base: { wood: 25 }, growth: 1, ethMul: 0 },
  decor_lantern:   { name: 'Lantern', cat: 'decor', size: [1, 1], max: [2, 3, 5, 7, 10], maxLevel: 1, models: ['decor_lantern'], desc: 'A warm glow at dusk.', icon: 'decor_lantern', cosy: [3], base: { wood: 12, stone: 12 }, growth: 1, ethMul: 0 },
  decor_campfire:  { name: 'Campfire', cat: 'decor', size: [1, 1], max: [1, 1, 2, 2, 3], maxLevel: 1, models: ['decor_campfire'], desc: 'Crackling and cosy.', icon: 'decor_campfire', cosy: [4], base: { wood: 30, stone: 15 }, growth: 1, ethMul: 0 },
  decor_hedge:     { name: 'Hedge', cat: 'decor', size: [1, 1], max: [4, 8, 12, 18, 24], maxLevel: 1, models: ['decor_hedge'], desc: 'Neatly trimmed.', icon: 'decor_hedge', cosy: [1], base: { bio: 12 }, growth: 1, ethMul: 0 },
  fence:           { name: 'Fence', cat: 'decor', size: [1, 1], max: [8, 14, 20, 30, 40], maxLevel: 1, models: ['fence'], desc: 'Classic farm fence.', icon: 'fence', cosy: [0.5], base: { wood: 6 }, growth: 1, ethMul: 0 },
  decor_signpost:  { name: 'Signpost', cat: 'decor', size: [1, 1], max: [1, 2, 2, 3, 3], maxLevel: 1, models: ['decor_signpost'], desc: 'This way home.', icon: 'decor_signpost', cosy: [2], base: { wood: 15 }, growth: 1, ethMul: 0 },
  decor_scarecrow: { name: 'Scarecrow', cat: 'decor', size: [1, 1], max: [0, 1, 1, 2, 2], maxLevel: 1, models: ['decor_scarecrow'], desc: 'Keeps the crows guessing.', icon: 'decor_scarecrow', cosy: [4], base: { wood: 30, bio: 40 }, growth: 1, ethMul: 0 },
  decor_arch:      { name: 'Flower Arch', cat: 'decor', size: [2, 1], max: [0, 1, 1, 2, 2], maxLevel: 1, models: ['decor_arch'], desc: 'A grand welcome.', icon: 'decor_arch', cosy: [6], base: { planks: 8, bio: 60 }, growth: 1, ethMul: 0 },
  decor_pond:      { name: 'Pond', cat: 'decor', size: [2, 2], max: [0, 0, 1, 1, 2], maxLevel: 1, models: ['decor_pond'], desc: 'Quiet water and lily pads.', icon: 'decor_pond', cosy: [9], base: { stone: 80, bio: 60 }, growth: 1, ethMul: 0 },
  decor_fountain:  { name: 'Fountain', cat: 'decor', size: [2, 2], max: [0, 0, 1, 1, 1], maxLevel: 1, models: ['decor_fountain'], desc: 'The heart of a charming home.', icon: 'decor_fountain', cosy: [14], base: { bricks: 25, stone: 60 }, growth: 1, ethMul: 0, eth: 0.0015 },
  decor_statue:    { name: 'Statue of Gleam', cat: 'decor', size: [1, 1], max: [0, 0, 0, 1, 1], maxLevel: 1, models: ['decor_statue'], desc: 'The little mechanical bird that broke formation.', icon: 'decor_statue', cosy: [18], base: { bricks: 30, ingot: 12 }, growth: 1, ethMul: 0, eth: 0.0040 },
  decor_windmill:  { name: 'Windmill', cat: 'decor', size: [2, 2], max: [0, 0, 0, 1, 1], maxLevel: 1, models: ['decor_windmill'], desc: 'Turns lazily in the breeze.', icon: 'decor_windmill', cosy: [24], base: { planks: 40, bricks: 30, ingot: 8 }, growth: 1, ethMul: 0, eth: 0.0080 },
};
// The Build menu is ONE list, grouped by what a building is for. `use` says it in a few words.
export const BUILD_GROUPS = [
  { id: 'food', name: 'Food', why: 'Biopoints feed every Chainer and Wanderer', icon: 'res_bio', types: ['farm_plot', 'granary'] },
  { id: 'people', name: 'Chainers and Wanderers', why: 'Visitors, rest and training', icon: 'ui_chainers', types: ['camp', 'well', 'rest_lodge', 'arena'] },
  { id: 'materials', name: 'Materials', why: 'Turn Wood, Stone and Ore into building goods, and hold more', icon: 'res_planks', types: ['sawmill', 'stonecutter', 'smelter', 'warehouse'] },
  { id: 'world', name: 'Frontier and world', why: 'Loot from expeditions, Crates for the Reward Pool, trade', icon: 'item_globe', types: ['balloon_dock', 'workshop', 'pool_shrine', 'exchange'] },
  { id: 'cosy', name: 'Cosy decor', why: 'Raises cosiness, which brings better Wanderers more often', icon: 'ui_cosy',
    types: ['decor_flowerbed', 'decor_bench', 'decor_lantern', 'decor_campfire', 'decor_hedge', 'fence', 'decor_signpost', 'decor_scarecrow', 'decor_arch', 'decor_pond', 'decor_fountain', 'decor_statue', 'decor_windmill'] },
];
export const BUILD_USE = {
  farm_plot: 'Grows Biopoints, the food', granary: 'Holds more Biopoints',
  camp: 'Wanderers come to stay and work', well: 'Wanderers love it: big cosiness', rest_lodge: 'Shorter rest after expeditions', arena: 'Train your Chainers\' stats',
  sawmill: 'Wood into Planks', stonecutter: 'Stone into Bricks', smelter: 'Ore into Ingots', warehouse: 'Holds more of everything else',
  balloon_dock: 'Send parties to the Frontier for loot', workshop: 'Packs resources into Crates', pool_shrine: 'Upload Crates, earn ETH', exchange: 'Swap one resource for another',
};
// what to suggest when the current goal is not a building: the first of these you can build and do not have
export const BUILD_NEXT = ['farm_plot', 'camp', 'balloon_dock', 'sawmill', 'stonecutter', 'workshop', 'pool_shrine', 'warehouse', 'granary', 'well', 'exchange', 'smelter', 'rest_lodge', 'arena'];
export const BUILD_CATS = [
  { id: 'core', name: 'Home' }, { id: 'produce', name: 'Production' }, { id: 'storage', name: 'Storage' },
  { id: 'pool', name: 'Economy' }, { id: 'care', name: 'Care' }, { id: 'decor', name: 'Cosy decor' },
];

// Land expansion rings (each ring adds one tile strip on all four sides of the unlocked square).
export const LAND = {
  startHalf: 6,   // unlocked square is (2*half) tiles wide, centred
  rings: [
    { cost: { wood: 150, stone: 100 }, eth: 0 },
    { cost: { wood: 300, stone: 300, planks: 20 }, eth: 0.0015 },
    { cost: { planks: 60, bricks: 60 }, eth: 0.0050 },
    { cost: { planks: 120, bricks: 120, ingot: 20 }, eth: 0.0140 },
    { cost: { planks: 200, bricks: 200, ingot: 50, crystal: 8 }, eth: 0.0300 },
  ],
  ringTiles: 1,
};

// ----------------------------------------------------------------------------------------------
// Farm crops (yield is for one plot at level 1)
// ----------------------------------------------------------------------------------------------
export const CROPS = {
  carrot:      { name: 'Carrots',     model: 'crop_carrot',      time: 45,   bio: 22,   home: 1, xp: 3 },
  tomato:      { name: 'Tomatoes',    model: 'crop_tomato',      time: 150,  bio: 58,   home: 1, xp: 6 },
  corn:        { name: 'Corn',        model: 'crop_corn',        time: 420,  bio: 135,  home: 2, xp: 12 },
  pumpkin:     { name: 'Pumpkins',    model: 'crop_pumpkin',     time: 1080, bio: 300,  home: 3, xp: 24 },
  lavender:    { name: 'Lavender',    model: 'crop_lavender',    time: 2700, bio: 640,  home: 4, xp: 50 },
  protoflower: { name: 'Protoflower', model: 'crop_protoflower', time: 7200, bio: 1500, home: 5, xp: 120, bonus: { crystal: [1, 2] } },
};

// Upkeep: every Chainer eats Biopoints.
export const UPKEEP = { perChainerPerMin: 0.6, guestPerMin: 0.4, hungryStatMul: 0.7 };
export const GUEST = { hungryStay: 300, fedStay: 1500, feedCost: { common: 20, uncommon: 35, rare: 60, epic: 100, legendary: 160 }, extendCostMul: 0.6, extendStay: 900, delightedDiscount: 0.15, delightedStat: 1.2 };

// Things lying around the island that an idle Chainer can clear for a few resources.
export const CLEARABLES = {
  tree_a:      { name: 'Tree',        give: { wood: [10, 16] }, time: 6, act: 'lumber', xp: 2 },
  tree_b:      { name: 'Maple',       give: { wood: [12, 18] }, time: 6, act: 'lumber', xp: 2 },
  tree_c:      { name: 'Tall Tree',   give: { wood: [16, 24] }, time: 8, act: 'lumber', xp: 3 },
  tree_pine:   { name: 'Pine',        give: { wood: [12, 20] }, time: 7, act: 'lumber', xp: 2 },
  rock_a:      { name: 'Rock',        give: { stone: [10, 16] }, time: 6, act: 'mining', xp: 2 },
  rock_b:      { name: 'Boulder',     give: { stone: [16, 24] }, time: 8, act: 'mining', xp: 3 },
  rock_ore:    { name: 'Ore Rock',    give: { stone: [6, 10], ore: [4, 8] }, time: 9, act: 'mining', xp: 4 },
  bush_a:      { name: 'Bush',        give: { bio: [8, 14] }, time: 4, act: 'forage', xp: 1 },
  bush_berry:  { name: 'Berry Bush',  give: { bio: [14, 22] }, time: 5, act: 'forage', xp: 2 },
  stump:       { name: 'Stump',       give: { wood: [5, 8] }, time: 4, act: 'lumber', xp: 1 },
  log:         { name: 'Fallen Log',  give: { wood: [8, 12] }, time: 4, act: 'lumber', xp: 1 },
};
// Beyond the fence the land is forest; inside it the yard is mostly open with low things to clear.
export const CLEARABLE_WEIGHTS = [['tree_a', 6], ['tree_b', 4], ['tree_c', 3], ['tree_pine', 3], ['rock_a', 2], ['rock_b', 1], ['rock_ore', 1], ['bush_a', 2], ['bush_berry', 1], ['stump', 1], ['log', 1]];
export const CLEARABLE_WEIGHTS_YARD = [['tree_a', 2], ['tree_b', 2], ['tree_pine', 1], ['rock_a', 4], ['rock_b', 2], ['rock_ore', 1], ['bush_a', 4], ['bush_berry', 3], ['stump', 3], ['log', 3]];

// ----------------------------------------------------------------------------------------------
// Expeditions
// ----------------------------------------------------------------------------------------------
// Zones of the frontier (geometry in data/frontier.js). `dock` = Expedition Lodge level that opens the zone.
export const REGIONS = [
  {
    id: 'woods', name: 'Whispering Woods', dock: 1, tint: '#d5761a', power: 1.0, active: 6,
    desc: 'Gentle forest just beyond your gate. Wood, berries and the odd surprise.',
    ground: { base: 'floor', alt: 'grass', altP: 0.36, shade: [1, 1, 1] },
    scatter: [['tree_a', 5], ['tree_b', 4], ['tree_green', 3], ['tree_c', 3], ['bush_a', 4], ['bush_berry', 4], ['fern', 4], ['flowers_a', 3], ['mushrooms', 3], ['rock_a', 2], ['log', 3], ['stump', 2], ['grass_tuft', 3]],
    pois: ['grove', 'thicket', 'oldquarry', 'den', 'meadow', 'hollow', 'cabin', 'pier', 'trader'],
  },
  {
    id: 'ridge', name: 'Stonebreak Ridge', dock: 2, tint: '#8f8870', power: 2.2, active: 5,
    desc: 'Wind-carved high ground, rich in stone and ore.',
    ground: { base: 'stone', alt: 'dirt', altP: 0.34, shade: [1, 1, 1] },
    scatter: [['rock_a', 8], ['rock_b', 8], ['rock_ore', 5], ['tree_pine', 3], ['bush_a', 2], ['grass_tuft', 6], ['stump', 3], ['fern', 2], ['trail_cairn', 2]],
    pois: ['quarry', 'vein', 'pass', 'nest', 'mine', 'lookout', 'grove'],
  },
  {
    id: 'ruins', name: 'Sunken Ruins', dock: 3, tint: '#57734a', power: 4.2, active: 5,
    desc: 'Old Chainerys stonework swallowed by moss. Crystals glow in the dark.',
    ground: { base: 'grass', alt: 'water', altP: 0.1, shade: [0.92, 1.0, 0.95] },
    scatter: [['ruin_pillar', 7], ['ruin_wall', 4], ['ruin_arch', 2], ['rock_crystal', 4], ['tree_green', 3], ['bush_a', 3], ['reeds', 4], ['mushrooms', 3], ['rock_b', 3], ['fern', 4]],
    pois: ['vault', 'crystalcave', 'guardian', 'garden', 'circle', 'vein', 'hollow'],
  },
  {
    id: 'outpost', name: 'Perfect Outpost', dock: 4, tint: '#4a4c50', power: 7.5, active: 4,
    desc: 'A forward camp of Big Eye\'s Perfects. Dangerous, and loaded with supplies.',
    ground: { base: 'dirt', alt: 'stone', altP: 0.3, shade: [0.72, 0.7, 0.76] },
    scatter: [['tree_dark', 5], ['perfect_crate', 5], ['rock_b', 5], ['rock_ore', 3], ['perfect_tower', 2], ['ruin_wall', 2], ['stump', 4], ['grass_tuft', 3]],
    pois: ['raid', 'sabotage', 'scrapyard', 'rescue', 'bandits', 'crystalcave'],
  },
];

// difficulty and loot are multiplied by region.power; `time` is the work on the spot in seconds (the walk is extra).
// prop: the set piece on the map (alt: used until / unless that model exists).
export const POI_TYPES = {
  grove:       { name: 'Lumber Grove',     act: 'lumber',  prop: 'tree_c',          diff: 26, time: [30, 60],   team: 3, loot: { wood: [45, 80] }, extra: { bio: [0, 12] } },
  thicket:     { name: 'Berry Thicket',    act: 'forage',  prop: 'bush_berry',      diff: 22, time: [25, 50],   team: 2, loot: { bio: [50, 90] } },
  oldquarry:   { name: 'Old Quarry',       act: 'mining',  prop: 'rock_b',          diff: 28, time: [32, 65],   team: 3, loot: { stone: [45, 80] }, extra: { ore: [0, 6] } },
  den:         { name: 'Thornback Den',    act: 'fight',   prop: 'beast_den',       diff: 36, time: [35, 65],   team: 3, loot: { bio: [30, 60], wood: [20, 40], stone: [20, 40] }, risky: true },
  meadow:      { name: 'Sunny Meadow',     act: 'explore', prop: 'flowers_b',       diff: 20, time: [22, 42],   team: 2, loot: { bio: [30, 50], wood: [10, 25] }, find: 0.25 },
  hollow:      { name: 'Hollow Giant',     act: 'explore', prop: 'ancient_tree', alt: 'tree_big', diff: 27, time: [30, 60], team: 3, loot: { wood: [30, 55], bio: [20, 40] }, find: 0.45 },
  cabin:       { name: 'Abandoned Cabin',  act: 'explore', prop: 'abandoned_cabin', alt: 'camp_tent', diff: 24, time: [28, 55], team: 2, loot: { wood: [25, 45], stone: [15, 30] }, extra: { planks: [1, 4] }, find: 0.35 },
  pier:        { name: 'Old Fishing Pier', act: 'forage',  prop: 'fishing_pier', alt: 'reeds', diff: 25, time: [30, 55], team: 3, loot: { bio: [70, 120] }, water: true },
  trader:      { name: 'Trader\'s Pitch',  act: 'explore', prop: 'trader_camp', alt: 'camp_tent', diff: 22, time: [20, 40], team: 2, loot: { planks: [3, 7], bricks: [3, 7] }, find: 0.3 },
  quarry:      { name: 'Cliff Quarry',     act: 'mining',  prop: 'rock_b',          diff: 30, time: [40, 80],   team: 3, loot: { stone: [50, 90] }, extra: { ore: [4, 12] } },
  vein:        { name: 'Ore Vein',         act: 'mining',  prop: 'rock_ore',        diff: 34, time: [45, 90],   team: 3, loot: { ore: [16, 30] }, extra: { stone: [10, 25] } },
  pass:        { name: 'Windy Pass',       act: 'explore', prop: 'poi_flag',        diff: 30, time: [35, 70],   team: 2, loot: { stone: [20, 40], ore: [6, 14] }, find: 0.3 },
  nest:        { name: 'Rockbiter Nest',   act: 'fight',   prop: 'beast_den',       diff: 40, time: [45, 85],   team: 4, loot: { ore: [12, 24], stone: [30, 60], bio: [20, 40] }, risky: true },
  mine:        { name: 'Forgotten Mine',   act: 'mining',  prop: 'mine_entrance', alt: 'cave_entrance', diff: 36, time: [50, 95], team: 4, loot: { ore: [20, 36], ingot: [1, 2] }, extra: { stone: [15, 30] } },
  lookout:     { name: 'Old Lookout',      act: 'explore', prop: 'watchtower', alt: 'perfect_tower', diff: 32, time: [35, 70], team: 2, loot: { planks: [3, 6], ore: [6, 12] }, find: 0.4 },
  vault:       { name: 'Forgotten Vault',  act: 'explore', prop: 'ruin_arch',       diff: 34, time: [50, 105],  team: 3, loot: { bricks: [4, 9], crystal: [1, 2] }, find: 0.4 },
  crystalcave: { name: 'Crystal Cave',     act: 'mining',  prop: 'cave_entrance',   diff: 38, time: [60, 125],  team: 3, loot: { crystal: [1, 3], ore: [10, 20] } },
  guardian:    { name: 'Stone Guardian',   act: 'fight',   prop: 'ruin_pillar',     diff: 44, time: [55, 115],  team: 4, loot: { bricks: [6, 12], ingot: [1, 3], crystal: [0, 2] }, risky: true },
  garden:      { name: 'Flooded Garden',   act: 'forage',  prop: 'reeds',           diff: 30, time: [40, 80],   team: 3, loot: { bio: [90, 160] }, extra: { planks: [0, 3] }, water: true },
  circle:      { name: 'Singing Stones',   act: 'explore', prop: 'stone_circle', alt: 'ruin_pillar', diff: 36, time: [45, 95], team: 3, loot: { crystal: [1, 2], bricks: [3, 7] }, find: 0.5 },
  raid:        { name: 'Supply Raid',      act: 'fight',   prop: 'perfect_crate',   diff: 44, time: [70, 145],  team: 4, loot: { planks: [8, 16], bricks: [8, 16], ingot: [2, 5] }, risky: true },
  sabotage:    { name: 'Watchtower',       act: 'explore', prop: 'perfect_tower',   diff: 42, time: [75, 155],  team: 3, loot: { ingot: [3, 6], crystal: [1, 3] }, find: 0.5, risky: true },
  scrapyard:   { name: 'Scrap Yard',       act: 'mining',  prop: 'perfect_crate',   diff: 38, time: [65, 135],  team: 4, loot: { ore: [20, 40], ingot: [2, 4] } },
  rescue:      { name: 'Captive Convoy',   act: 'fight',   prop: 'camp_tent',       diff: 50, time: [85, 165],  team: 4, loot: { bio: [80, 140], planks: [6, 12], crystal: [1, 2] }, risky: true },
  bandits:     { name: 'Bandit Camp',      act: 'fight',   prop: 'bandit_camp', alt: 'camp_tent', diff: 46, time: [70, 140], team: 4, loot: { planks: [6, 12], ingot: [2, 5], bio: [40, 80] }, risky: true },
};

// Environmental conditions that can sit on a point of interest.
export const CONDITIONS = {
  fog:      { name: 'Thick Fog',      icon: 'item_compass',   desc: 'Hard to find the way: Wits count 50% more.',            stat: { wits: 1.5 } },
  cliffs:   { name: 'Steep Climb',    icon: 'item_bolt',      desc: 'Exhausting: the team needs average Stamina 5 or loses 25% power.', staminaReq: 5, powerMul: 0.75 },
  sun:      { name: 'Scorching Sun',  icon: 'item_hourglass', desc: 'They come back drained: rest takes 50% longer.',     restMul: 1.5 },
  tailwind: { name: 'Fair Weather',   icon: 'item_feather',   desc: 'Easy walking: the journey is 30% shorter.',            timeMul: 0.7 },
  bounty:   { name: 'Bountiful',      icon: 'item_star',      desc: 'Rich pickings: +40% loot.',                               lootMul: 1.4 },
  patrol:   { name: 'Hostile Patrol', icon: 'item_sword',     desc: 'Perfect scouts nearby: Might counts 40% more, failure hurts more.', stat: { might: 1.4 }, restMul: 1.3 },
  wards:    { name: 'Ancient Wards',  icon: 'item_clover',    desc: 'Old magic favours the fortunate: Luck counts double.',   luckMul: 2 },
  mud:      { name: 'Deep Mud',       icon: 'item_backpack',  desc: 'Slow going: Agility counts 40% more, the walk is 20% longer.',  stat: { agility: 1.4 }, timeMul: 1.2 },
};
export const CONDITION_KEYS = Object.keys(CONDITIONS);

export const EXPEDITION = {
  poiLife: [600, 1200], walk: 1.25, rationPerChainerPerMin: 4, restBase: 0.5, restMin: 20,
  restMul: { great: 0.8, success: 1.0, partial: 1.6, fail: 2.6 }, lootMul: { great: 1.6, success: 1.0, partial: 0.45, fail: 0.1 },
  xp: { great: 40, success: 28, partial: 14, fail: 6 }, staminaRest: 0.045, luckChance: 0.01, critPerLuck: 0.018,
};

// How the party goes about it: a risk dial.
export const APPROACH = {
  careful:  { name: 'Careful',  icon: 'item_shield', chance: 0.12,  loot: 0.8, crit: 0.5, rest: 0.8,  desc: 'Take it slow.', pros: 'Safer, shorter rest', cons: '-20% loot' },
  balanced: { name: 'Balanced', icon: 'item_scales', chance: 0,     loot: 1.0, crit: 1.0, rest: 1.0,  desc: 'The sensible way.', pros: 'No surprises', cons: '' },
  bold:     { name: 'Bold',     icon: 'item_dice',   chance: -0.12, loot: 1.4, crit: 1.6, rest: 1.25, desc: 'Push hard.', pros: '+40% loot, more jackpots', cons: 'Riskier, longer rest' },
};
// Rented at the Expedition Lodge for one trip. speed multiplies walking speed; carry multiplies the haul.
export const TRANSPORT = {
  foot:  { name: 'On foot',   icon: 'item_boots', speed: 1,    carry: 1,    cost: null,                    lodge: 1, model: null,        note: 'Free' },
  mule:  { name: 'Pack mule', icon: 'item_mule',  speed: 1.35, carry: 1.1,  cost: { bio: 25 },             lodge: 1, model: 'pack_mule', note: '26% faster, +10% haul' },
  wagon: { name: 'Wagon',     icon: 'item_wagon', speed: 1.8,  carry: 1.25, cost: { bio: 40, planks: 4 },  lodge: 2, model: 'wagon',     note: '45% faster, +25% haul' },
};
// The lucky draw after every trip: three face-down cards, one pick. w = weight, luck adds to the good ones.
export const LUCKY = {
  haul:    { w: 30, name: 'Bigger haul',    icon: 'item_backpack', text: '+30% of everything they carried' },
  bio:     { w: 22, name: 'Field rations',  icon: 'res_bio',       text: 'A sack of Biopoints' },
  xp:      { w: 18, name: 'Campfire tales', icon: 'item_book',     text: 'Double experience for the team' },
  goods:   { w: 14, name: 'Lost shipment',  icon: 'res_planks',    text: 'Planks and Bricks' },
  crate:   { w: 8,  name: 'Sealed crate',   icon: 'item_crate_1',  text: 'A Relief Crate, ready for the pool' },
  crystal: { w: 4,  name: 'Glint in the dirt', icon: 'res_crystal', text: 'A Crystal', lucky: 0.5 },
  jackpot: { w: 1.5, name: 'Jackpot',       icon: 'item_trophy',   text: 'The whole haul again', lucky: 0.6 },
};

// ----------------------------------------------------------------------------------------------
// Supply lines: upgrades that make the homestead run itself. Bought once with resources.
// `level` = Homestead level needed; `needs` = a building you must have.
// ----------------------------------------------------------------------------------------------
export const UPGRADES = {
  kitchen:   { name: 'Camp Kitchen',    icon: 'upg_kitchen',    alt: 'item_food_bowl', level: 2, needs: 'camp',        cost: { wood: 60, stone: 40, bio: 40 },
    desc: 'Wanderers are fed on arrival from the camp larder. You decide how much food the larder holds.' },
  seeddrill: { name: 'Seed Drill',      icon: 'upg_seed_drill', alt: 'crop_sprout',    level: 2, needs: 'farm_plot',   cost: { wood: 80, stone: 30 },
    desc: 'Every plot replants the same crop after a harvest.' },
  baskets:   { name: 'Harvest Baskets', icon: 'upg_baskets',    alt: 'item_basket',    level: 3, needs: 'farm_plot',   cost: { wood: 120, planks: 10 },
    desc: 'Ripe crops are harvested into storage on their own, even while you are away.' },
  bell:      { name: 'Foreman\'s Bell', icon: 'upg_bell',       alt: 'item_hammer',    level: 4, needs: null,          cost: { planks: 30, bricks: 30 },
    desc: 'Sawmill, Stonecutter and Smelter keep working while you hold more than the reserve you set, and store what they make.' },
  crateline: { name: 'Crate Line',      icon: 'upg_crate_line', alt: 'item_crate_1',   level: 5, needs: 'workshop',    cost: { planks: 50, bricks: 50, ingot: 6 },
    desc: 'The Workshop keeps assembling the crate you choose while resources last, and shelves them for you.' },
  courier:   { name: 'Courier',         icon: 'upg_courier',    alt: 'item_eth',       level: 6, needs: 'pool_shrine', cost: { planks: 40, ingot: 10 },
    desc: 'Finished Crates are carried to the Reward Pool and uploaded automatically.' },
};
export const UPGRADE_ORDER = ['kitchen', 'seeddrill', 'baskets', 'bell', 'crateline', 'courier'];
export const AUTO_DEFAULT = {
  kitchen: { on: true, stock: 80, floor: 40 },
  seeddrill: { on: true }, baskets: { on: true },
  bell: { on: true, keep: { wood: 60, stone: 60, ore: 10 } },
  crateline: { on: false, key: 'crate1', keepBio: 80, keep: { wood: 60, stone: 60 } },
  courier: { on: true },
};
export const LARDER_CAP = [120, 200, 320, 480];      // by Wanderer Camp level

// What a Homestead level opens (shown on the level card). Your level also gates Home upgrades: Home level n needs level (n-1)*2.
export const LEVEL_PERKS = {
  2: ['Home level 2', 'Camp Kitchen', 'Seed Drill'],
  3: ['Harvest Baskets'],
  4: ['Home level 3', 'Foreman\'s Bell'],
  5: ['Crate Line'],
  6: ['Home level 4', 'Courier'],
  8: ['Home level 5'],
};
export const XP_SOURCES = [['item_hammer', 'Build and upgrade'], ['res_bio', 'Harvest crops'], ['item_compass', 'Expeditions'], ['item_crate_1', 'Crates and the pool'], ['item_trophy', 'Goals'], ['item_axe', 'Clear land']];

// ----------------------------------------------------------------------------------------------
// Reward pool + exchange
// ----------------------------------------------------------------------------------------------
export const POOL = { epochSec: 1800, ethPerDay: 1.0, bots: 26 };
export const POOL_ETH_PER_EPOCH = POOL.ethPerDay / (86400 / POOL.epochSec);
export const BOT_NAMES = ['MossyRanger_12', 'PixelPell', 'GoldenAcre', 'ChaviersHand', 'LumoraScout', 'BlockyBea', 'TomatoKing', 'IlvaTeal', 'FernAndFig',
  'CropperJoe', 'GleamWatcher', 'SnugHollow', 'Protoflora', 'CarrotCartel', 'NimbleNox', 'WillowBend', 'StoneSoup', 'BalloonBoy', 'QuietPond',
  'HoneyHux', 'TinkerTess', 'AmberFields', 'JollyJax', 'PineAndPlank', 'LanternLux', 'BraveBrim', 'OldQuarry', 'SunnyZola'];
export const EXCHANGE = { depth: 16000, tickSec: 25, revert: 0.06, historyLen: 60, assets: ['wood', 'stone', 'bio', 'ore', 'planks', 'bricks', 'ingot', 'crystal'] };

// ----------------------------------------------------------------------------------------------
// Player levels + guide quests
// ----------------------------------------------------------------------------------------------
export const xpForLevel = (l) => Math.round(40 * Math.pow(l, 1.7));

export const QUESTS = [
  { id: 'q_clear',   text: 'Tap a tree or rock so your Chainer clears it', goal: { cleared: 2 }, reward: { wood: 30, stone: 30 }, hint: 'clear' },
  { id: 'q_farm',    text: 'Build a Farm Plot', goal: { build: 'farm_plot' }, reward: { bio: 40 }, hint: 'build:farm_plot' },
  { id: 'q_plant',   text: 'Plant and harvest Carrots', goal: { harvest: 1 }, reward: { bio: 40, wood: 30 }, hint: 'farm' },
  { id: 'q_fire',    text: 'Light a Campfire for your Wanderer Camp', goal: { build: 'decor_campfire' }, reward: { stone: 40, bio: 30 }, hint: 'build:decor_campfire' },
  { id: 'q_feed',    text: 'Welcome a Wanderer with a meal', goal: { fed: 1 }, reward: { wood: 40, stone: 40 }, hint: 'camp' },
  { id: 'q_dock',    text: 'Build the Expedition Lodge', goal: { build: 'balloon_dock' }, reward: { bio: 60 }, hint: 'build:balloon_dock' },
  { id: 'q_exp',     text: 'Send a team on an expedition', goal: { expeditions: 1 }, reward: { wood: 50, stone: 50, bio: 50 }, hint: 'expedition' },
  { id: 'q_work',    text: 'Build the Crate Workshop', goal: { build: 'workshop' }, reward: { wood: 40, stone: 40 }, hint: 'build:workshop' },
  { id: 'q_crate',   text: 'Assemble a Relief Crate', goal: { crates: 1 }, reward: { bio: 60 }, hint: 'workshop' },
  { id: 'q_pool',    text: 'Build the Pool Shrine and upload a Crate', goal: { deposits: 1 }, reward: { wood: 60, stone: 60 }, hint: 'build:pool_shrine' },
  { id: 'q_cosy',    text: 'Reach 20 Cosiness with decorations', goal: { cosy: 20 }, reward: { bio: 80, wood: 40 }, hint: 'build:decor_flowerbed' },
  { id: 'q_saw',     text: 'Build a Sawmill and a Stonecutter', goal: { buildAll: ['sawmill', 'stonecutter'] }, reward: { wood: 80, stone: 80 }, hint: 'build:sawmill' },
  { id: 'q_home2',   text: 'Upgrade the Chainer Home to level 2', goal: { level: ['home', 2] }, reward: { planks: 10, bricks: 10 }, hint: 'home' },
  { id: 'q_supply',  text: 'Get the Camp Kitchen so Wanderers are fed for you', goal: { upg: 'kitchen' }, reward: { bio: 120 }, hint: 'supply' },
  { id: 'q_xchg',    text: 'Build the Trading Post and make a swap', goal: { swaps: 1 }, reward: { ore: 20, bio: 80 }, hint: 'build:exchange' },
  { id: 'q_eth',     text: 'Earn your first ETH from the Reward Pool', goal: { ethEarned: 0.0000001 }, reward: { planks: 15, bricks: 15 }, hint: 'pool' },
  { id: 'q_recruit', text: 'Buy a Wanderer you like with ETH', goal: { recruited: 1 }, reward: { bio: 200, planks: 20, bricks: 20 }, hint: 'camp' },
  { id: 'q_land',    text: 'Expand your land', goal: { land: 1 }, reward: { wood: 150, stone: 150 }, hint: 'land' },
  { id: 'q_crate2',  text: 'Assemble a Sturdy Crate', goal: { crate2: 1 }, reward: { ingot: 5, bio: 150 }, hint: 'workshop' },
  { id: 'q_home3',   text: 'Upgrade the Chainer Home to level 3', goal: { level: ['home', 3] }, reward: { ingot: 8, crystal: 1 }, hint: 'home' },
  { id: 'q_cosy2',   text: 'Reach 100 Cosiness — become Charming', goal: { cosy: 100 }, reward: { crystal: 3, bio: 300 }, hint: 'build:decor_fountain' },
];

// The basic set: one Chainer, the Chainer Home and the Wanderer Camp (tile offset from the island centre).
export const START = {
  res: { wood: 90, stone: 70, bio: 80, ore: 0, crystal: 0, planks: 0, bricks: 0, ingot: 0 },
  eth: 0,
  camp: [2, -1],
  firstGuestSec: 75,
};
