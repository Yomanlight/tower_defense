const { v4: uuidv4 } = require('uuid');
const {
  TILE_SIZE, GRID_COLS, GRID_ROWS,
  PATH_WAYPOINTS, isPathCell,
  TOWER_TYPES, ENEMY_TYPES,
  buildSpawnQueue
} = require('./gameConfig');

const TICK_RATE = 50; // ms
const MAX_WAVES = 20;
const STARTING_GOLD = 150;
const STARTING_LIVES = 20;
const SPAWN_INTERVAL = 1200; // ms between enemy spawns

// Convert [col, row] waypoints to pixel coords (center of tile)
function wpToPixel([col, row]) {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

const PATH_PIXELS = PATH_WAYPOINTS.map(wpToPixel);

// Precompute cumulative distances along the path
const PATH_SEGMENTS = [];
let totalPathLength = 0;
for (let i = 0; i < PATH_PIXELS.length - 1; i++) {
  const dx = PATH_PIXELS[i + 1].x - PATH_PIXELS[i].x;
  const dy = PATH_PIXELS[i + 1].y - PATH_PIXELS[i].y;
  const len = Math.sqrt(dx * dx + dy * dy);
  PATH_SEGMENTS.push({ from: PATH_PIXELS[i], to: PATH_PIXELS[i + 1], len, start: totalPathLength });
  totalPathLength += len;
}

function getPositionOnPath(progress) {
  // progress: 0..1 along total path
  const dist = progress * totalPathLength;
  for (const seg of PATH_SEGMENTS) {
    if (dist <= seg.start + seg.len) {
      const t = (dist - seg.start) / seg.len;
      return {
        x: seg.from.x + (seg.to.x - seg.from.x) * t,
        y: seg.from.y + (seg.to.y - seg.from.y) * t
      };
    }
  }
  // Past end
  return PATH_PIXELS[PATH_PIXELS.length - 1];
}

class GameRoom {
  constructor(id, name, hostId) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.players = new Map(); // socketId -> { id, username, gold, zone }
    this.state = 'lobby'; // lobby | playing | paused | gameover | victory

    // Game state
    this.lives = STARTING_LIVES;
    this.wave = 0;
    this.towers = new Map(); // towerId -> tower
    this.enemies = new Map(); // enemyId -> enemy
    this.waveInProgress = false;

    this._tickInterval = null;
    this._spawnInterval = null;
    this._spawnQueue = [];
    this._enemyCounter = 0;
    this._towerCounter = 0;
    this._lastTick = Date.now();
  }

  // ── PLAYER MANAGEMENT ────────────────────────────────────────────────────────

  addPlayer(socketId, userId, username) {
    const playerCount = this.players.size;
    // First player is host (zone 0 = rows 0-9), second is zone 1 (rows 10-19)
    const zone = playerCount === 0 ? 0 : 1;
    this.players.set(socketId, {
      socketId,
      id: userId,
      username,
      gold: STARTING_GOLD,
      zone,
      ready: false
    });
  }

  // Reconnect a player who already has a slot by userId — updates their socketId
  reconnectPlayer(newSocketId, userId) {
    for (const [oldSocketId, player] of this.players) {
      if (player.id === userId) {
        const updated = { ...player, socketId: newSocketId };
        this.players.delete(oldSocketId);
        this.players.set(newSocketId, updated);
        return updated;
      }
    }
    return null;
  }

  hasUserId(userId) {
    for (const p of this.players.values()) {
      if (p.id === userId) return true;
    }
    return false;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (this.players.size === 0) this.stopGame();
  }

  getPlayerCount() {
    return this.players.size;
  }

  isFull() {
    return this.players.size >= 2;
  }

  // ── TOWER PLACEMENT ──────────────────────────────────────────────────────────

  placeTower(socketId, gridX, gridY, type) {
    const player = this.players.get(socketId);
    if (!player) return { error: 'Not in room' };
    if (this.state !== 'playing') return { error: 'Game not active' };

    const towerDef = TOWER_TYPES[type];
    if (!towerDef) return { error: 'Invalid tower type' };

    // Zone check (solo allowed anywhere, co-op restricted)
    const isSolo = this.players.size === 1;
    if (!isSolo) {
      const zoneMinRow = player.zone === 0 ? 0 : 10;
      const zoneMaxRow = player.zone === 0 ? 9 : 19;
      if (gridY < zoneMinRow || gridY > zoneMaxRow) return { error: 'Outside your zone' };
    }

    // Bounds
    if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS)
      return { error: 'Out of bounds' };

    // Path check
    if (isPathCell(gridX, gridY)) return { error: 'Cannot place on path' };

    // Occupied?
    for (const tower of this.towers.values()) {
      if (tower.gridX === gridX && tower.gridY === gridY) return { error: 'Cell occupied' };
    }

    // Gold check
    if (player.gold < towerDef.cost) return { error: 'Not enough gold' };

    player.gold -= towerDef.cost;
    const towerId = `t${++this._towerCounter}`;
    const tower = {
      id: towerId,
      gridX,
      gridY,
      x: gridX * TILE_SIZE + TILE_SIZE / 2,
      y: gridY * TILE_SIZE + TILE_SIZE / 2,
      type,
      ownerId: socketId,
      cooldown: 0,
      ...towerDef
    };
    this.towers.set(towerId, tower);
    return { ok: true, tower, gold: player.gold };
  }

  sellTower(socketId, towerId) {
    const player = this.players.get(socketId);
    if (!player) return { error: 'Not in room' };
    if (this.state !== 'playing') return { error: 'Game not active' };

    const tower = this.towers.get(towerId);
    if (!tower) return { error: 'Tower not found' };
    if (tower.ownerId !== socketId) return { error: 'Not your tower' };

    const refund = Math.floor(tower.cost * tower.sellRatio);
    player.gold += refund;
    this.towers.delete(towerId);
    return { ok: true, refund, gold: player.gold };
  }

  // ── WAVE MANAGEMENT ──────────────────────────────────────────────────────────

  startGame() {
    if (this.state !== 'lobby') return false;
    this.state = 'playing';
    this.lives = STARTING_LIVES;
    this.wave = 0;
    this.towers.clear();
    this.enemies.clear();
    // Give each player starting gold
    for (const p of this.players.values()) {
      p.gold = STARTING_GOLD;
    }
    this._startTick();
    return true;
  }

  startWave(socketId) {
    if (this.state !== 'playing') return { error: 'Game not active' };
    if (socketId !== this.hostId && !this._isHost(socketId)) return { error: 'Host only' };
    if (this.waveInProgress) return { error: 'Wave already active' };

    const nextWave = this.wave + 1;
    if (nextWave > MAX_WAVES) return { error: 'All waves done' };

    this.wave = nextWave;
    this.waveInProgress = true;
    this._spawnQueue = buildSpawnQueue(this.wave - 1);
    this._startSpawning();
    return { ok: true, wave: this.wave };
  }

  _isHost(socketId) {
    const players = [...this.players.values()];
    return players.length > 0 && players[0].socketId === socketId;
  }

  _startSpawning() {
    if (this._spawnInterval) clearInterval(this._spawnInterval);
    this._spawnInterval = setInterval(() => {
      if (this._spawnQueue.length === 0) {
        clearInterval(this._spawnInterval);
        this._spawnInterval = null;
        return;
      }
      const type = this._spawnQueue.shift();
      this._spawnEnemy(type);
    }, SPAWN_INTERVAL);
  }

  _spawnEnemy(type) {
    const def = ENEMY_TYPES[type];
    if (!def) return;
    const id = `e${++this._enemyCounter}`;
    const enemy = {
      id,
      type,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      armor: def.armor,
      reward: def.reward,
      radius: def.radius,
      progress: 0,        // 0..1 along path
      slowUntil: 0,
      slowFactor: 1.0,
      ...getPositionOnPath(0)
    };
    this.enemies.set(id, enemy);
  }

  // ── GAME TICK ─────────────────────────────────────────────────────────────────

  _startTick() {
    this._lastTick = Date.now();
    if (this._tickInterval) clearInterval(this._tickInterval);
    this._tickInterval = setInterval(() => this._tick(), TICK_RATE);
  }

  stopGame() {
    if (this._tickInterval)    { clearInterval(this._tickInterval);    this._tickInterval    = null; }
    if (this._spawnInterval)   { clearInterval(this._spawnInterval);   this._spawnInterval   = null; }
    if (this._broadcastInterval) { clearInterval(this._broadcastInterval); this._broadcastInterval = null; }
  }

  _tick() {
    const now = Date.now();
    const dt = (now - this._lastTick) / 1000; // seconds
    this._lastTick = now;

    if (this.state !== 'playing') return;

    this._moveEnemies(dt, now);
    this._towerAttack(now);
    this._checkWaveComplete();
  }

  _moveEnemies(dt, now) {
    for (const [id, enemy] of this.enemies) {
      const slow = now < enemy.slowUntil ? enemy.slowFactor : 1.0;
      const distPerSecond = enemy.speed * slow;
      enemy.progress += (distPerSecond * dt) / totalPathLength;

      if (enemy.progress >= 1) {
        // Reached end — lose a life
        this.lives--;
        this.enemies.delete(id);
        if (this.lives <= 0) {
          this.lives = 0;
          this._endGame(false);
          return;
        }
        continue;
      }

      const pos = getPositionOnPath(enemy.progress);
      enemy.x = pos.x;
      enemy.y = pos.y;
    }
  }

  _towerAttack(now) {
    for (const tower of this.towers.values()) {
      if (tower.cooldown > now) continue;

      const def = TOWER_TYPES[tower.type];
      const rangeSquared = def.range * def.range;

      if (def.splash && def.splashRadius === def.range) {
        // Mage: AOE all enemies in range
        let hit = false;
        for (const enemy of this.enemies.values()) {
          const dx = enemy.x - tower.x;
          const dy = enemy.y - tower.y;
          if (dx * dx + dy * dy <= rangeSquared) {
            this._damageEnemy(enemy, def.damage, def, now);
            hit = true;
          }
        }
        if (hit) tower.cooldown = now + def.attackSpeed * 1000;
      } else {
        // Single target (with optional splash on hit)
        let target = null;
        let bestProgress = -1;
        for (const enemy of this.enemies.values()) {
          const dx = enemy.x - tower.x;
          const dy = enemy.y - tower.y;
          if (dx * dx + dy * dy <= rangeSquared) {
            if (enemy.progress > bestProgress) {
              bestProgress = enemy.progress;
              target = enemy;
            }
          }
        }
        if (target) {
          if (def.splash) {
            // Canon: AOE splash around target
            const splashSq = def.splashRadius * def.splashRadius;
            for (const enemy of this.enemies.values()) {
              const dx = enemy.x - target.x;
              const dy = enemy.y - target.y;
              if (dx * dx + dy * dy <= splashSq) {
                this._damageEnemy(enemy, def.damage, def, now);
              }
            }
          } else {
            this._damageEnemy(target, def.damage, def, now);
          }
          tower.cooldown = now + def.attackSpeed * 1000;
        }
      }
    }
  }

  _damageEnemy(enemy, damage, towerDef, now) {
    const effective = Math.max(0, damage - enemy.armor);
    enemy.hp -= effective;

    if (towerDef.slow) {
      enemy.slowUntil = now + towerDef.slowDuration;
      enemy.slowFactor = towerDef.slowFactor;
    }

    if (enemy.hp <= 0) {
      // Award gold to all players proportionally
      this._awardGold(enemy.reward);
      this.enemies.delete(enemy.id);
    }
  }

  _awardGold(amount) {
    const players = [...this.players.values()];
    if (players.length === 0) return;
    // Give each player their share (in solo full amount, co-op each gets full)
    for (const p of players) {
      p.gold += amount;
    }
  }

  _checkWaveComplete() {
    if (!this.waveInProgress) return;
    if (this._spawnQueue.length > 0 || this._spawnInterval) return;
    if (this.enemies.size > 0) return;

    this.waveInProgress = false;

    if (this.wave >= MAX_WAVES) {
      this._endGame(true);
    }
  }

  _endGame(victory) {
    this.state = victory ? 'victory' : 'gameover';
    this.stopGame();
  }

  // ── STATE SNAPSHOT ───────────────────────────────────────────────────────────

  getState() {
    const playersArr = [];
    for (const p of this.players.values()) {
      playersArr.push({
        socketId: p.socketId,
        id: p.id,
        username: p.username,
        gold: p.gold,
        zone: p.zone
      });
    }

    const towersArr = [];
    for (const t of this.towers.values()) {
      towersArr.push({
        id: t.id,
        gridX: t.gridX,
        gridY: t.gridY,
        type: t.type,
        ownerId: t.ownerId
      });
    }

    const enemiesArr = [];
    for (const e of this.enemies.values()) {
      enemiesArr.push({
        id: e.id,
        type: e.type,
        x: Math.round(e.x),
        y: Math.round(e.y),
        hp: e.hp,
        maxHp: e.maxHp,
        radius: e.radius,
        slowUntil: e.slowUntil
      });
    }

    return {
      roomId: this.id,
      state: this.state,
      lives: this.lives,
      wave: this.wave,
      maxWaves: MAX_WAVES,
      waveInProgress: this.waveInProgress,
      players: playersArr,
      towers: towersArr,
      enemies: enemiesArr
    };
  }

  getRoomInfo() {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      playerCount: this.players.size,
      maxPlayers: 2,
      state: this.state
    };
  }
}

module.exports = { GameRoom };
