// ── GAME RENDERER + INPUT ─────────────────────────────────────────────────────

const TILE  = 40;
const COLS  = 20;
const ROWS  = 20;

const PATH_WAYPOINTS = [
  [1, 0], [1, 3], [18, 3], [18, 7],
  [1, 7], [1, 11], [18, 11], [18, 15],
  [1, 15], [1, 20]
];

// Build a Set of path tiles for quick lookup
function buildPathSet() {
  const s = new Set();
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const [c1, r1] = PATH_WAYPOINTS[i];
    const [c2, r2] = PATH_WAYPOINTS[i + 1];
    if (c1 === c2) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) s.add(`${c1},${r}`);
    } else {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) s.add(`${c},${r1}`);
    }
  }
  return s;
}
const PATH_CELLS = buildPathSet();
function isPath(col, row) { return PATH_CELLS.has(`${col},${row}`); }

// Tower definitions (mirrors backend)
const TOWER_DEFS = {
  archer: { name: 'Archer',  cost: 75,  emoji: '🏹', color: '#8B4513', range: 120, desc: 'Fast, single target' },
  canon:  { name: 'Canon',   cost: 150, emoji: '💣', color: '#666',    range: 110, desc: 'Slow, AOE splash' },
  mage:   { name: 'Mage',    cost: 200, emoji: '🔮', color: '#8A2BE2', range: 130, desc: 'Medium, zone AOE' },
  sniper: { name: 'Sniper',  cost: 250, emoji: '🎯', color: '#1a1a2e', range: 200, desc: 'Very slow, huge range' },
  givre:  { name: 'Givre',   cost: 125, emoji: '❄️', color: '#00BFFF', range: 100, desc: 'Slows enemies -50%' }
};

const ENEMY_COLORS = {
  normal: '#2ecc71', rapide: '#f1c40f', tank: '#9b59b6',
  blinde: '#95a5a6', boss: '#e74c3c'
};

// ── STATE ─────────────────────────────────────────────────────────────────────

let gameState = null;
let mySocketId = null;
let myZone = null;
let myGold = 150;
let selectedTower = null;
let hoveredCell = null;
let socket = null;
let particles = [];
let prevEnemyIds = new Set();
let towerFlashes = new Map(); // towerId -> flashUntil timestamp

// ── CANVAS SETUP ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
canvas.width  = COLS * TILE;
canvas.height = ROWS * TILE;

// Responsive scale via CSS
function fitCanvas() {
  const maxW = Math.min(window.innerWidth - 320, window.innerHeight - 120);
  const scale = maxW / canvas.width;
  canvas.style.width  = `${canvas.width  * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ── SOCKET SETUP ─────────────────────────────────────────────────────────────

function initSocket() {
  const token = sessionStorage.getItem('td_socket_token') || Auth.getToken();
  socket = io(CONFIG.SERVER_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('auth', { token });
  });

  socket.on('authSuccess', ({ user }) => {
    mySocketId = socket.id;
    window._mySocketId = socket.id;
    document.getElementById('myUsername').textContent = user.username;
    // Attempt to rejoin the room from the previous session
    socket.emit('rejoinRoom');
  });

  socket.on('rejoinSuccess', ({ gameState: state, myZone: zone, myGold: gold }) => {
    myZone = zone;
    myGold = gold;
    document.getElementById('myGold').textContent = gold;
    if (state) {
      gameState = state;
      document.getElementById('livesDisplay').textContent = state.lives;
      document.getElementById('waveDisplay').textContent = `${state.wave}/${state.maxWaves}`;
    }
    Toast.show('Reconnecté à la partie !', 'success');
  });

  socket.on('rejoinFailed', ({ message }) => {
    // No active game — redirect back to lobby
    Toast.show('Aucune partie active trouvée. Retour au menu...', 'error');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  });

  socket.on('gameState', (state) => {
    // Detect killed enemies for particles
    const newIds = new Set(state.enemies.map(e => e.id));
    for (const id of prevEnemyIds) {
      if (!newIds.has(id)) {
        // Enemy died — find approximate position from old state
        if (gameState) {
          const dead = gameState.enemies.find(e => e.id === id);
          if (dead) spawnParticles(dead.x, dead.y, dead.type);
        }
      }
    }
    prevEnemyIds = newIds;

    gameState = state;

    // Sync my zone & gold
    const me = state.players.find(p => p.socketId === socket.id);
    if (me) {
      myZone = me.zone;
      myGold = me.gold;
      document.getElementById('myGold').textContent = me.gold;
    }

    // Update HUD
    document.getElementById('livesDisplay').textContent = state.lives;
    document.getElementById('waveDisplay').textContent  = `${state.wave}/${state.maxWaves}`;

    const launchBtn = document.getElementById('launchWaveBtn');
    if (launchBtn) {
      launchBtn.disabled = state.waveInProgress || state.state !== 'playing';
      launchBtn.textContent = state.waveInProgress ? 'Vague en cours...' : 'Lancer vague';
    }
  });

  socket.on('goldUpdate', ({ gold }) => {
    myGold = gold;
    document.getElementById('myGold').textContent = gold;
  });

  socket.on('gameOver', ({ victory, message }) => {
    showOverlay(victory ? 'victory' : 'gameover', message);
  });

  socket.on('error', ({ message }) => {
    Toast.show(message, 'error');
  });

  socket.on('notification', ({ message, type }) => {
    Toast.show(message, type || 'info');
  });

  // If coming from lobby page that already joined a room,
  // we just need auth — game loop handles the rest
}

// ── INPUT ─────────────────────────────────────────────────────────────────────

function getGridPos(e) {
  const rect  = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top)  * scaleY;
  return { col: Math.floor(cx / TILE), row: Math.floor(cy / TILE) };
}

canvas.addEventListener('mousemove', (e) => {
  hoveredCell = getGridPos(e);
});

canvas.addEventListener('mouseleave', () => { hoveredCell = null; });

canvas.addEventListener('click', (e) => {
  if (!gameState || gameState.state !== 'playing') return;
  if (!selectedTower) return;
  const { col, row } = getGridPos(e);
  socket.emit('placeTower', { gridX: col, gridY: row, type: selectedTower });
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!gameState || gameState.state !== 'playing') return;
  const { col, row } = getGridPos(e);
  // Find tower at this cell
  const tower = gameState.towers.find(t => t.gridX === col && t.gridY === row);
  if (tower && tower.ownerId === socket.id) {
    socket.emit('sellTower', { towerId: tower.id });
  }
});

// Tower selection buttons
document.querySelectorAll('.tower-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (selectedTower === type) {
      selectedTower = null;
      btn.classList.remove('selected');
    } else {
      document.querySelectorAll('.tower-btn').forEach(b => b.classList.remove('selected'));
      selectedTower = type;
      btn.classList.add('selected');
    }
  });
});

// Wave & quit buttons
document.getElementById('launchWaveBtn').addEventListener('click', () => {
  socket.emit('startWave');
});

document.getElementById('quitBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  window.location.href = 'index.html';
});

// ── PARTICLES ─────────────────────────────────────────────────────────────────

function spawnParticles(x, y, type) {
  const color = ENEMY_COLORS[type] || '#fff';
  const count = type === 'boss' ? 20 : 8;
  for (let i = 0; i < count; i++) {
    const angle  = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed  = 40 + Math.random() * 60;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      color,
      radius: type === 'boss' ? 5 : 3
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx * dt;
    p.y    += p.vy * dt;
    p.life -= dt * 2;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ── DRAW ──────────────────────────────────────────────────────────────────────

function drawBackground() {
  ctx.fillStyle = '#4a7c59';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawZoneOverlays() {
  if (!gameState || gameState.players.length < 2) return;
  // Player 1 zone: rows 0-9 (blue tint)
  ctx.fillStyle = 'rgba(30,100,255,0.06)';
  ctx.fillRect(0, 0, canvas.width, 10 * TILE);
  // Player 2 zone: rows 10-19 (red tint)
  ctx.fillStyle = 'rgba(255,30,30,0.06)';
  ctx.fillRect(0, 10 * TILE, canvas.width, 10 * TILE);

  // Zone labels
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = 'rgba(100,150,255,0.6)';
  ctx.fillText('Zone Joueur 1', 4, 14);
  ctx.fillStyle = 'rgba(255,100,100,0.6)';
  ctx.fillText('Zone Joueur 2', 4, 10 * TILE + 14);
}

function drawPath() {
  ctx.fillStyle = '#c8a96e';
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (isPath(col, row)) {
        ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
      }
    }
  }
  // Path border
  ctx.strokeStyle = '#a08050';
  ctx.lineWidth = 1;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (isPath(col, row)) {
        ctx.strokeRect(col * TILE, row * TILE, TILE, TILE);
      }
    }
  }
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (!isPath(c, r)) ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
    }
  }
}

function drawHoverHighlight() {
  if (!hoveredCell || !selectedTower) return;
  const { col, row } = hoveredCell;
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

  const canPlace = !isPath(col, row) && !gameState?.towers.find(t => t.gridX === col && t.gridY === row);
  const isMine = myZone === null || (gameState?.players.length < 2) ||
    (myZone === 0 ? row <= 9 : row >= 10);

  ctx.fillStyle = (canPlace && isMine) ? 'rgba(255,255,100,0.25)' : 'rgba(255,50,50,0.25)';
  ctx.fillRect(col * TILE, row * TILE, TILE, TILE);

  // Range preview
  if (canPlace && isMine && TOWER_DEFS[selectedTower]) {
    const cx = col * TILE + TILE / 2;
    const cy = row * TILE + TILE / 2;
    const range = TOWER_DEFS[selectedTower].range;
    ctx.beginPath();
    ctx.arc(cx, cy, range, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,100,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,100,0.07)';
    ctx.fill();
  }
}

function drawTowers() {
  if (!gameState) return;
  const now = Date.now();
  for (const tower of gameState.towers) {
    const def  = TOWER_DEFS[tower.type];
    const cx   = tower.gridX * TILE + TILE / 2;
    const cy   = tower.gridY * TILE + TILE / 2;
    const isMe = tower.ownerId === socket?.id;
    const flash = towerFlashes.has(tower.id) && towerFlashes.get(tower.id) > now;

    // Shadow
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 2, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Base circle
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = flash ? '#fff' : (def?.color || '#888');
    ctx.fill();
    ctx.strokeStyle = isMe ? '#4af' : '#888';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Emoji
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.emoji || '?', cx, cy);

    // Sell indicator on right-click hover
    if (hoveredCell && hoveredCell.col === tower.gridX && hoveredCell.row === tower.gridY && isMe) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - 20, cy - 28, 40, 14);
      ctx.fillStyle = '#f90';
      ctx.font = '9px Arial';
      ctx.fillText('Clic droit: vendre', cx, cy - 21);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawEnemies() {
  if (!gameState) return;
  for (const e of gameState.enemies) {
    const isSlow = e.slowUntil > Date.now();
    const r = e.radius || 12;

    // Shadow
    ctx.beginPath();
    ctx.arc(e.x + 2, e.y + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSlow ? '#00BFFF' : (ENEMY_COLORS[e.type] || '#fff');
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Health bar
    const barW  = r * 2 + 4;
    const barH  = 5;
    const barX  = e.x - barW / 2;
    const barY  = e.y - r - 8;
    const ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = '#222';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f1c40f' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * ratio, barH);

    // Name (boss only)
    if (e.type === 'boss') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS', e.x, e.y + r + 12);
      ctx.textAlign = 'left';
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.floor(p.life * 255).toString(16).padStart(2, '0');
    ctx.fill();
  }
}

// ── OVERLAY ───────────────────────────────────────────────────────────────────

function showOverlay(type, message) {
  const overlay = document.getElementById('gameOverlay');
  const title   = document.getElementById('overlayTitle');
  const msg     = document.getElementById('overlayMsg');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.className = `game-overlay ${type}`;
  title.textContent = type === 'victory' ? '🏆 Victoire !' : '💀 Game Over';
  msg.textContent   = message || '';
}

// ── RENDER LOOP ───────────────────────────────────────────────────────────────

let lastFrameTime = 0;

function renderLoop(ts) {
  const dt = Math.min((ts - lastFrameTime) / 1000, 0.1);
  lastFrameTime = ts;

  updateParticles(dt);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawZoneOverlays();
  drawPath();
  drawGrid();
  drawHoverHighlight();
  drawTowers();
  drawEnemies();
  drawParticles();

  requestAnimationFrame(renderLoop);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

initSocket();
requestAnimationFrame(renderLoop);
