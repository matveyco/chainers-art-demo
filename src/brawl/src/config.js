// Chainers Brawl: roster, arena layout and match rules. Distances in metres (1 tile = 1 m),
// times in seconds, damage and health in points.

export const TILE = 1;
export const CHAR_SCALE = 1.45;          // brawlers are drawn a bit larger than the range figure
export const UNIT_RADIUS = 0.42;

// Top-left quadrant of the arena; the map is mirrored left-right and top-bottom around the
// centre column/row (the gem mine). '.' ground, '#' crate wall, 'S' stone wall, 'B' bush,
// 'W' water, 'M' gem mine, '2' red spawn (the bottom half turns them into '1', blue spawns).
export const MAP_QUADRANT = [
  'BB.......',
  'BB....2.2',
  '.........',
  '..SSS....',
  '.......BB',
  '.........',
  'BBB..#...',
  'BBB..#...',
  'B........',
  '....BB...',
  'SS..BB...',
  '.........',
  '...#...#.',
  'WW.#.....',
  'WW......M',
];

// Solo Showdown: 29 x 29, mirrored both ways. 'P' power box (breaks into a power cube),
// '1' spawn (six: the four corners and the middle of the top and bottom edges).
export const MAP_SHOWDOWN = [
  'BBB.....BB.....',
  'B.............1',
  '..1....SS......',
  '......SS..P....',
  '...P........BB.',
  '.......BB...BB.',
  'WWW....BB......',
  'WW..S..........',
  '....S..P.......',
  '..........SS...',
  'BB..P..........',
  'BB.....BBB.....',
  '......BB...P...',
  '.SS..........BB',
  '.S....P.....BBP',
];

export const SHOWDOWN = {
  players: 6,
  boxHp: 1500,
  cubeHp: 0.1,            // each power cube: +10% health and damage
  cubeDmg: 0.1,
  gasStart: 22,           // seconds after the start
  gasDuration: 85,        // time for the safe square to close to its final size
  gasFinal: 2.5,          // half-size of the last safe square (m)
  gasDps: 700,            // damage per second in the gas, doubles toward the end
};

export const TEAM = {
  blue: { id: 0, name: 'Blue', color: [0.2, 0.55, 1.0], css: '#3d8bff' },
  red: { id: 1, name: 'Red', color: [1.0, 0.25, 0.22], css: '#ff4a3d' },
};

// Attack kinds:
//  burst  - a line of bullets fired one after another
//  spread - pellets fanned over an arc, all at once
//  rocket - one slow rocket that explodes on contact or at the end of its range
//  barrage (super) - rockets that fall on a target area
//  rally (super) - heals and hastes the brawler and nearby teammates, refills ammo
export const BRAWLERS = {
  gaptooth: {
    name: 'Gaptooth', role: 'Sharpshooter', weapon: 'SMG', skin: null, hat: null,
    blurb: 'Long bursts from the Buzzsaw SMG. His super rattles out a storm that chews through walls.',
    hp: 3000, speed: 3.45, reload: 1.35, cooldown: 0.42, ammo: 3,
    attack: { kind: 'burst', count: 6, interval: 0.055, damage: 230, speed: 18, range: 9.5, spread: 2.2, radius: 0.2, width: 0.5 },
    super: { name: 'Rattle Storm', kind: 'burst', count: 14, interval: 0.035, damage: 280, speed: 21, range: 11, spread: 3.2, radius: 0.24, width: 0.9, breakWalls: true, pierce: true },
    charge: 2600,
    accent: '#e6c13f',
  },
  brick: {
    name: 'Brick', role: 'Tank', weapon: 'Shotgun', skin: 'brick', hat: 'hardhat',
    blurb: 'A wall of a Chainer with the Boomer Pump. Close up, one blast empties a health bar. Super: Big Bang knocks everyone back and flattens cover.',
    hp: 4800, speed: 3.25, reload: 1.6, cooldown: 0.55, ammo: 3,
    attack: { kind: 'spread', count: 5, arc: 34, damage: 330, speed: 16, range: 6.6, radius: 0.22 },
    super: { name: 'Big Bang', kind: 'spread', count: 9, arc: 44, damage: 380, speed: 17, range: 8.2, radius: 0.28, knock: 3.2, breakWalls: true },
    charge: 3000,
    accent: '#ff8a1f',
  },
  rosa: {
    name: 'Rosa', role: 'Artillery', weapon: 'Launcher', skin: 'rosa', hat: 'aviator',
    blurb: 'Rockets from the Thumper RL splash everyone near the hit. Her super calls a barrage down on any spot in range.',
    hp: 2700, speed: 3.35, reload: 2.0, cooldown: 0.6, ammo: 3,
    attack: { kind: 'rocket', damage: 1050, splash: 1.45, speed: 12.5, range: 10, radius: 0.26 },
    super: { name: 'Barrage', kind: 'barrage', count: 6, damage: 820, splash: 1.3, area: 2.2, range: 9.5, delay: 0.55, gap: 0.14 },
    charge: 2600,
    accent: '#f28fa5',
  },
  pip: {
    name: 'Pip', role: 'Speedster', weapon: 'Pistol', skin: 'pip', hat: 'cap',
    blurb: 'The fastest Chainer on the field, snapping double shots from the Pocket Pew. Super: Pep Rally heals the squad, refills ammo and speeds everyone up.',
    hp: 2900, speed: 3.85, reload: 1.05, cooldown: 0.38, ammo: 3,
    attack: { kind: 'burst', count: 2, interval: 0.12, damage: 470, speed: 22, range: 8.6, spread: 1.2, radius: 0.2, width: 0.4 },
    super: { name: 'Pep Rally', kind: 'rally', heal: 1600, radius: 4.6, haste: 1.35, duration: 3.5 },
    charge: 2300,
    accent: '#7bd6a6',
  },
};
export const ROSTER = ['gaptooth', 'brick', 'rosa', 'pip'];

export const BOT_NAMES = ['Bolt', 'Nyx', 'Mango', 'Tofu', 'Rex', 'Kiwi', 'Juno', 'Zap', 'Momo', 'Taco', 'Pixel', 'Nova', 'Dex', 'Luna'];

export const RULES = {
  matchTime: 150,           // seconds
  gemsToWin: 10,
  countdown: 15,            // hold the lead with 10+ gems this long
  mineFirst: 4,             // first gem after the start
  mineEvery: 7,
  respawn: 4,
  spawnShield: 2,
  regenDelay: 3,            // no damage taken and no attack for this long...
  regenRate: 0.13,          // ...then heal this fraction of max health per second
  revealNear: 2.6,          // enemies closer than this see into a bush
  revealAfterAttack: 1.1,
  pickupRadius: 0.95,
};

export const DIFFICULTY = {
  easy: { react: 0.55, aimError: 11, lead: 0.4, dodge: 0.15, aggression: 0.7 },
  normal: { react: 0.34, aimError: 6.5, lead: 0.75, dodge: 0.45, aggression: 1 },
  hard: { react: 0.2, aimError: 3.5, lead: 0.95, dodge: 0.8, aggression: 1.2 },
};
