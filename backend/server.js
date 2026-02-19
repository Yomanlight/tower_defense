const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { GameRoom } = require('./gameRoom');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tower-defense-secret-key-change-in-prod';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ── DATA HELPERS ──────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ── EXPRESS APP ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  const decoded = verifyToken(auth.split(' ')[1]);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  const users = loadUsers();
  if (!users[decoded.id]) return res.status(401).json({ error: 'User not found' });
  req.userId = decoded.id;
  req.user = users[decoded.id];
  next();
}

// ── REST API ──────────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const users = loadUsers();
  const existing = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const id = uuidv4();
  const hash = await bcrypt.hash(password, 10);
  users[id] = { id, username, password: hash, friends: [], pendingRequests: [] };
  saveUsers(users);

  const token = signToken(id);
  res.json({ token, user: { id, username, friends: [] } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const users = loadUsers();
  const user = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user.id);
  const friends = (user.friends || []).map(fid => {
    const f = users[fid];
    return f ? { id: f.id, username: f.username } : null;
  }).filter(Boolean);

  res.json({ token, user: { id: user.id, username: user.username, friends } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users[req.userId];
  const friends = (user.friends || []).map(fid => {
    const f = users[fid];
    return f ? { id: f.id, username: f.username } : null;
  }).filter(Boolean);
  res.json({ id: user.id, username: user.username, friends });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { username } = req.body;
  const users = loadUsers();
  const target = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Cannot add yourself' });

  const me = users[req.userId];
  if ((me.friends || []).includes(target.id)) return res.status(409).json({ error: 'Already friends' });

  if (!target.pendingRequests) target.pendingRequests = [];
  if (target.pendingRequests.includes(req.userId)) return res.status(409).json({ error: 'Request already sent' });

  target.pendingRequests.push(req.userId);
  saveUsers(users);

  // Notify via socket if online
  const targetSocket = onlineUsers.get(target.id);
  if (targetSocket) {
    targetSocket.emit('friendRequest', { from: { id: me.id, username: me.username } });
  }

  res.json({ ok: true });
});

app.post('/api/friends/accept', authMiddleware, (req, res) => {
  const { fromId } = req.body;
  const users = loadUsers();
  const me = users[req.userId];
  const from = users[fromId];
  if (!from) return res.status(404).json({ error: 'User not found' });

  if (!me.pendingRequests) me.pendingRequests = [];
  const idx = me.pendingRequests.indexOf(fromId);
  if (idx === -1) return res.status(400).json({ error: 'No pending request' });

  me.pendingRequests.splice(idx, 1);
  if (!me.friends) me.friends = [];
  if (!from.friends) from.friends = [];
  if (!me.friends.includes(fromId)) me.friends.push(fromId);
  if (!from.friends.includes(req.userId)) from.friends.push(req.userId);
  saveUsers(users);

  const fromSocket = onlineUsers.get(fromId);
  if (fromSocket) {
    fromSocket.emit('notification', {
      type: 'friendAccepted',
      message: `${me.username} accepted your friend request`,
      friend: { id: me.id, username: me.username }
    });
  }

  res.json({ ok: true, friend: { id: from.id, username: from.username } });
});

app.post('/api/friends/reject', authMiddleware, (req, res) => {
  const { fromId } = req.body;
  const users = loadUsers();
  const me = users[req.userId];
  if (!me.pendingRequests) return res.json({ ok: true });
  const idx = me.pendingRequests.indexOf(fromId);
  if (idx !== -1) me.pendingRequests.splice(idx, 1);
  saveUsers(users);
  res.json({ ok: true });
});

app.delete('/api/friends/:id', authMiddleware, (req, res) => {
  const friendId = req.params.id;
  const users = loadUsers();
  const me = users[req.userId];
  const friend = users[friendId];
  if (me.friends) me.friends = me.friends.filter(id => id !== friendId);
  if (friend && friend.friends) friend.friends = friend.friends.filter(id => id !== req.userId);
  saveUsers(users);
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── HTTP SERVER + SOCKET.IO ───────────────────────────────────────────────────

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Maps for online presence
const onlineUsers = new Map();  // userId -> socket
const socketUsers = new Map();  // socketId -> userId
const rooms = new Map();        // roomId -> GameRoom

// Broadcast room list to all in lobby namespace
function broadcastRoomList() {
  const list = [...rooms.values()].map(r => r.getRoomInfo());
  io.emit('roomList', list);
}

// Broadcast game state to room
function broadcastGameState(room) {
  io.to(room.id).emit('gameState', room.getState());
}

// ── SOCKET.IO HANDLERS ────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentUser = null;
  let currentRoomId = null;

  // ── AUTH ────────────────────────────────────────────────────────────────────

  socket.on('auth', ({ token }) => {
    const decoded = verifyToken(token);
    if (!decoded) { socket.emit('authError', { message: 'Invalid token' }); return; }

    const users = loadUsers();
    const user = users[decoded.id];
    if (!user) { socket.emit('authError', { message: 'User not found' }); return; }

    currentUser = { id: user.id, username: user.username };
    onlineUsers.set(user.id, socket);
    socketUsers.set(socket.id, user.id);

    const friends = (user.friends || []).map(fid => {
      const f = users[fid];
      return f ? { id: f.id, username: f.username, online: onlineUsers.has(f.id) } : null;
    }).filter(Boolean);

    const pendingRequests = (user.pendingRequests || []).map(fid => {
      const f = users[fid];
      return f ? { id: f.id, username: f.username } : null;
    }).filter(Boolean);

    socket.emit('authSuccess', { user: currentUser, friends, pendingRequests });

    // Notify friends of online status
    for (const fid of (user.friends || [])) {
      const fs = onlineUsers.get(fid);
      if (fs) fs.emit('friendOnline', { id: user.id, username: user.username });
    }

    // Send current room list
    socket.emit('roomList', [...rooms.values()].map(r => r.getRoomInfo()));
  });

  // ── ROOMS ───────────────────────────────────────────────────────────────────

  socket.on('getRooms', () => {
    socket.emit('roomList', [...rooms.values()].map(r => r.getRoomInfo()));
  });

  socket.on('createRoom', ({ name }) => {
    if (!currentUser) { socket.emit('error', { message: 'Not authenticated' }); return; }
    if (currentRoomId) { socket.emit('error', { message: 'Already in a room' }); return; }

    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const room = new GameRoom(roomId, name || `${currentUser.username}'s room`, socket.id);
    room.addPlayer(socket.id, currentUser.id, currentUser.username);
    rooms.set(roomId, room);
    currentRoomId = roomId;
    socket.join(roomId);
    socket.emit('roomState', room.getRoomInfo());
    broadcastRoomList();
  });

  socket.on('joinRoom', ({ roomId }) => {
    if (!currentUser) { socket.emit('error', { message: 'Not authenticated' }); return; }
    if (currentRoomId) { socket.emit('error', { message: 'Already in a room' }); return; }

    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.isFull()) { socket.emit('error', { message: 'Room is full' }); return; }
    if (room.state !== 'lobby') { socket.emit('error', { message: 'Game already started' }); return; }

    room.addPlayer(socket.id, currentUser.id, currentUser.username);
    currentRoomId = roomId;
    socket.join(roomId);
    io.to(roomId).emit('roomState', room.getRoomInfo());
    broadcastRoomList();
    socket.emit('notification', { type: 'joined', message: `Joined room: ${room.name}` });
  });

  socket.on('leaveRoom', () => {
    _leaveRoom();
  });

  function _leaveRoom() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.removePlayer(socket.id);
      socket.leave(currentRoomId);
      if (room.getPlayerCount() === 0) {
        rooms.delete(currentRoomId);
      } else {
        io.to(currentRoomId).emit('roomState', room.getRoomInfo());
        io.to(currentRoomId).emit('notification', {
          type: 'playerLeft',
          message: `${currentUser ? currentUser.username : 'A player'} left the room`
        });
      }
      broadcastRoomList();
    }
    currentRoomId = null;
  }

  // ── REJOIN (after page navigation) ──────────────────────────────────────────

  socket.on('rejoinRoom', () => {
    if (!currentUser) { socket.emit('error', { message: 'Not authenticated' }); return; }

    // Find a room that contains this userId
    let foundRoom = null;
    for (const room of rooms.values()) {
      if (room.hasUserId(currentUser.id)) { foundRoom = room; break; }
    }

    if (!foundRoom) { socket.emit('rejoinFailed', { message: 'No active game found' }); return; }
    if (currentRoomId) { socket.emit('rejoinFailed', { message: 'Already in a room' }); return; }

    const player = foundRoom.reconnectPlayer(socket.id, currentUser.id);
    if (!player) { socket.emit('rejoinFailed', { message: 'Reconnection failed' }); return; }

    currentRoomId = foundRoom.id;
    socket.join(foundRoom.id);

    // Update hostId if needed
    if (foundRoom.players.size === 1) foundRoom.hostId = socket.id;

    socket.emit('rejoinSuccess', {
      room: foundRoom.getRoomInfo(),
      gameState: foundRoom.getState(),
      myZone: player.zone,
      myGold: player.gold
    });

    // Start broadcasting if game is active
    if (foundRoom.state === 'playing') {
      const stateInterval = setInterval(() => {
        const r = rooms.get(currentRoomId);
        if (!r || r.state === 'gameover' || r.state === 'victory') {
          clearInterval(stateInterval);
          if (r) {
            socket.emit('gameOver', {
              victory: r.state === 'victory',
              message: r.state === 'victory' ? 'Victory! All waves cleared!' : 'Game Over!'
            });
          }
          return;
        }
        socket.emit('gameState', r.getState());
      }, 50);
    }
  });

  // ── GAME ACTIONS ─────────────────────────────────────────────────────────────

  socket.on('startGame', () => {
    if (!currentUser || !currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can start the game' }); return;
    }
    if (room.startGame()) {
      const roomId = currentRoomId;
      io.to(roomId).emit('gameStarted', { wave: 0 });
      broadcastRoomList();
      // Store interval on the room so it's accessible for cleanup
      const stateInterval = setInterval(() => {
        const r = rooms.get(roomId);
        if (!r || r.state === 'gameover' || r.state === 'victory') {
          clearInterval(stateInterval);
          if (r) {
            io.to(roomId).emit('gameOver', {
              victory: r.state === 'victory',
              message: r.state === 'victory' ? 'Victory! All waves cleared!' : 'Game Over!'
            });
          }
          return;
        }
        io.to(roomId).emit('gameState', r.getState());
      }, 50);
      room._broadcastInterval = stateInterval;
    }
  });

  socket.on('startWave', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const result = room.startWave(socket.id);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    io.to(currentRoomId).emit('waveStarted', { wave: result.wave });
  });

  socket.on('placeTower', ({ gridX, gridY, type }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const result = room.placeTower(socket.id, gridX, gridY, type);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    socket.emit('goldUpdate', { gold: result.gold });
    io.to(currentRoomId).emit('towerPlaced', { tower: result.tower });
  });

  socket.on('sellTower', ({ towerId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const result = room.sellTower(socket.id, towerId);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    socket.emit('goldUpdate', { gold: result.gold });
    io.to(currentRoomId).emit('towerSold', { towerId });
  });

  // ── FRIENDS ──────────────────────────────────────────────────────────────────

  socket.on('sendFriendRequest', ({ username }) => {
    if (!currentUser) return;
    const users = loadUsers();
    const target = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!target) { socket.emit('error', { message: 'User not found' }); return; }
    if (target.id === currentUser.id) { socket.emit('error', { message: 'Cannot add yourself' }); return; }

    const me = users[currentUser.id];
    if ((me.friends || []).includes(target.id)) {
      socket.emit('error', { message: 'Already friends' }); return;
    }
    if (!target.pendingRequests) target.pendingRequests = [];
    if (!target.pendingRequests.includes(currentUser.id)) {
      target.pendingRequests.push(currentUser.id);
      saveUsers(users);
    }

    const targetSocket = onlineUsers.get(target.id);
    if (targetSocket) {
      targetSocket.emit('friendRequest', { from: { id: me.id, username: me.username } });
    }
    socket.emit('notification', { type: 'sent', message: `Friend request sent to ${target.username}` });
  });

  socket.on('acceptFriend', ({ fromId }) => {
    if (!currentUser) return;
    const users = loadUsers();
    const me = users[currentUser.id];
    const from = users[fromId];
    if (!from) return;
    if (!me.pendingRequests) me.pendingRequests = [];
    const idx = me.pendingRequests.indexOf(fromId);
    if (idx === -1) return;
    me.pendingRequests.splice(idx, 1);
    if (!me.friends) me.friends = [];
    if (!from.friends) from.friends = [];
    if (!me.friends.includes(fromId)) me.friends.push(fromId);
    if (!from.friends.includes(currentUser.id)) from.friends.push(currentUser.id);
    saveUsers(users);

    const fromSocket = onlineUsers.get(fromId);
    if (fromSocket) {
      fromSocket.emit('notification', {
        type: 'friendAccepted',
        message: `${me.username} accepted your friend request`,
        friend: { id: me.id, username: me.username, online: true }
      });
      fromSocket.emit('friendAdded', { friend: { id: me.id, username: me.username, online: true } });
    }
    socket.emit('friendAdded', {
      friend: { id: from.id, username: from.username, online: onlineUsers.has(fromId) }
    });
  });

  socket.on('rejectFriend', ({ fromId }) => {
    if (!currentUser) return;
    const users = loadUsers();
    const me = users[currentUser.id];
    if (!me.pendingRequests) return;
    const idx = me.pendingRequests.indexOf(fromId);
    if (idx !== -1) me.pendingRequests.splice(idx, 1);
    saveUsers(users);
  });

  socket.on('inviteFriend', ({ friendId }) => {
    if (!currentUser || !currentRoomId) {
      socket.emit('error', { message: 'You must be in a room to invite friends' }); return;
    }
    const targetSocket = onlineUsers.get(friendId);
    if (!targetSocket) { socket.emit('error', { message: 'Friend is offline' }); return; }

    targetSocket.emit('gameInvite', {
      from: { id: currentUser.id, username: currentUser.username },
      roomId: currentRoomId
    });
    socket.emit('notification', { type: 'inviteSent', message: 'Invite sent!' });
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    _leaveRoom();
    if (currentUser) {
      onlineUsers.delete(currentUser.id);
      const users = loadUsers();
      const user = users[currentUser.id];
      if (user) {
        for (const fid of (user.friends || [])) {
          const fs = onlineUsers.get(fid);
          if (fs) fs.emit('friendOffline', { id: currentUser.id });
        }
      }
    }
    socketUsers.delete(socket.id);
  });
});

// ── START ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Tower Defense server running on port ${PORT}`);
});
