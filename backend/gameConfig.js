// ─── GAME CONFIGURATION ───────────────────────────────────────────────────────

const TILE_SIZE = 40;
const GRID_COLS = 20;
const GRID_ROWS = 20;

// Path waypoints [col, row] — the S-shaped path through the map
const PATH_WAYPOINTS = [
  [1, 0],
  [1, 3],
  [18, 3],
  [18, 7],
  [1, 7],
  [1, 11],
  [18, 11],
  [18, 15],
  [1, 15],
  [1, 20] // exit (off-map)
];

// Pre-compute which grid cells are path tiles
function computePathCells() {
  const cells = new Set();
  for (let wi = 0; wi < PATH_WAYPOINTS.length - 1; wi++) {
    const [c1, r1] = PATH_WAYPOINTS[wi];
    const [c2, r2] = PATH_WAYPOINTS[wi + 1];
    if (c1 === c2) {
      const minR = Math.min(r1, r2);
      const maxR = Math.max(r1, r2);
      for (let r = minR; r <= maxR; r++) cells.add(`${c1},${r}`);
    } else {
      const minC = Math.min(c1, c2);
      const maxC = Math.max(c1, c2);
      for (let c = minC; c <= maxC; c++) cells.add(`${c},${r1}`);
    }
  }
  return cells;
}

const PATH_CELLS = computePathCells();

function isPathCell(col, row) {
  return PATH_CELLS.has(`${col},${row}`);
}

// ─── TOWER TYPES ──────────────────────────────────────────────────────────────
const TOWER_TYPES = {
  archer: {
    name: 'Archer',
    cost: 75,
    damage: 1,
    attackSpeed: 0.8,   // seconds between attacks
    range: 120,
    color: '#8B4513',
    emoji: '🏹',
    splash: false,
    slow: false,
    sellRatio: 0.6
  },
  canon: {
    name: 'Canon',
    cost: 150,
    damage: 5,
    attackSpeed: 2.5,
    range: 110,
    color: '#555',
    emoji: '💣',
    splash: true,
    splashRadius: 50,
    slow: false,
    sellRatio: 0.6
  },
  mage: {
    name: 'Mage',
    cost: 200,
    damage: 3,
    attackSpeed: 1.5,
    range: 130,
    color: '#8A2BE2',
    emoji: '🔮',
    splash: true,
    splashRadius: 130,
    slow: false,
    sellRatio: 0.6
  },
  sniper: {
    name: 'Sniper',
    cost: 250,
    damage: 8,
    attackSpeed: 3.0,
    range: 200,
    color: '#1a1a2e',
    emoji: '🎯',
    splash: false,
    slow: false,
    sellRatio: 0.6
  },
  givre: {
    name: 'Givre',
    cost: 125,
    damage: 1,
    attackSpeed: 1.2,
    range: 100,
    color: '#00BFFF',
    emoji: '❄️',
    splash: false,
    slow: true,
    slowFactor: 0.5,
    slowDuration: 2000,
    sellRatio: 0.6
  }
};

// ─── ENEMY TYPES ──────────────────────────────────────────────────────────────
const ENEMY_TYPES = {
  normal: {
    name: 'Normal',
    hp: 3,
    speed: 80,    // px/s
    armor: 0,
    reward: 10,
    color: '#2ecc71',
    radius: 12
  },
  rapide: {
    name: 'Rapide',
    hp: 2,
    speed: 160,
    armor: 0,
    reward: 8,
    color: '#f1c40f',
    radius: 9
  },
  tank: {
    name: 'Tank',
    hp: 15,
    speed: 55,
    armor: 0,
    reward: 20,
    color: '#9b59b6',
    radius: 18
  },
  blinde: {
    name: 'Blindé',
    hp: 8,
    speed: 70,
    armor: 2,
    reward: 15,
    color: '#95a5a6',
    radius: 14
  },
  boss: {
    name: 'Boss',
    hp: 100,
    speed: 40,
    armor: 3,
    reward: 100,
    color: '#e74c3c',
    radius: 24
  }
};

// ─── WAVE CONFIGURATIONS ──────────────────────────────────────────────────────
// Each wave is an array of { type, count } spawn groups
const WAVE_CONFIGS = [
  // Wave 1
  [{ type: 'normal', count: 8 }],
  // Wave 2
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 4 }],
  // Wave 3
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 6 }],
  // Wave 4
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 6 }, { type: 'tank', count: 2 }],
  // Wave 5
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 8 }, { type: 'tank', count: 4 }],
  // Wave 6
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 6 }, { type: 'tank', count: 5 }, { type: 'blinde', count: 3 }],
  // Wave 7
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 8 }, { type: 'tank', count: 5 }, { type: 'blinde', count: 5 }],
  // Wave 8
  [{ type: 'rapide', count: 10 }, { type: 'tank', count: 6 }, { type: 'blinde', count: 6 }],
  // Wave 9
  [{ type: 'normal', count: 6 }, { type: 'rapide', count: 8 }, { type: 'tank', count: 6 }, { type: 'blinde', count: 6 }],
  // Wave 10 — Boss
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 6 }, { type: 'tank', count: 4 }, { type: 'blinde', count: 4 }, { type: 'boss', count: 1 }],
  // Wave 11
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 8 }, { type: 'tank', count: 6 }, { type: 'blinde', count: 6 }],
  // Wave 12
  [{ type: 'rapide', count: 12 }, { type: 'tank', count: 7 }, { type: 'blinde', count: 7 }],
  // Wave 13
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 10 }, { type: 'tank', count: 7 }, { type: 'blinde', count: 7 }],
  // Wave 14
  [{ type: 'rapide', count: 10 }, { type: 'tank', count: 8 }, { type: 'blinde', count: 8 }, { type: 'boss', count: 1 }],
  // Wave 15 — 2 Bosses
  [{ type: 'normal', count: 8 }, { type: 'rapide', count: 8 }, { type: 'tank', count: 6 }, { type: 'blinde', count: 6 }, { type: 'boss', count: 2 }],
  // Wave 16
  [{ type: 'rapide', count: 12 }, { type: 'tank', count: 8 }, { type: 'blinde', count: 8 }, { type: 'boss', count: 1 }],
  // Wave 17
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 10 }, { type: 'tank', count: 8 }, { type: 'blinde', count: 8 }, { type: 'boss', count: 2 }],
  // Wave 18
  [{ type: 'rapide', count: 14 }, { type: 'tank', count: 10 }, { type: 'blinde', count: 10 }, { type: 'boss', count: 2 }],
  // Wave 19
  [{ type: 'normal', count: 10 }, { type: 'rapide', count: 12 }, { type: 'tank', count: 10 }, { type: 'blinde', count: 10 }, { type: 'boss', count: 2 }],
  // Wave 20 — 3 Bosses
  [{ type: 'normal', count: 12 }, { type: 'rapide', count: 12 }, { type: 'tank', count: 10 }, { type: 'blinde', count: 10 }, { type: 'boss', count: 3 }]
];

// Build flat spawn queue for a wave (interleaved for variety)
function buildSpawnQueue(waveIndex) {
  const groups = WAVE_CONFIGS[waveIndex];
  if (!groups) return [];

  // Interleave: spread each group evenly across the total
  const queue = [];
  const totalPerGroup = groups.map(g => ({ ...g, remaining: g.count }));
  const total = totalPerGroup.reduce((s, g) => s + g.count, 0);

  for (let i = 0; i < total; i++) {
    // Pick group proportionally (round-robin by weight)
    let best = null;
    let bestRatio = -1;
    for (const g of totalPerGroup) {
      if (g.remaining <= 0) continue;
      const ratio = g.remaining / g.count;
      if (ratio > bestRatio) { bestRatio = ratio; best = g; }
    }
    if (best) {
      queue.push(best.type);
      best.remaining--;
    }
  }
  return queue;
}

module.exports = {
  TILE_SIZE,
  GRID_COLS,
  GRID_ROWS,
  PATH_WAYPOINTS,
  PATH_CELLS,
  isPathCell,
  TOWER_TYPES,
  ENEMY_TYPES,
  WAVE_CONFIGS,
  buildSpawnQueue
};
