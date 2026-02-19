// ── LOBBY MODULE ──────────────────────────────────────────────────────────────

const Lobby = (() => {
  let socket = null;
  let rooms = [];
  let currentRoom = null;

  function init(sock) {
    socket = sock;
    bindEvents();
    socket.emit('getRooms');
  }

  function bindEvents() {
    // Create room
    const createBtn = document.getElementById('createRoomBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        const name = prompt('Room name (optional):') || '';
        socket.emit('createRoom', { name });
      });
    }

    // Join by code
    const joinBtn = document.getElementById('joinByCodeBtn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        const code = prompt('Enter room code:');
        if (code) socket.emit('joinRoom', { roomId: code.trim().toUpperCase() });
      });
    }

    // Start game button
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        socket.emit('startGame');
      });
    }

    // Leave room
    const leaveBtn = document.getElementById('leaveRoomBtn');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        socket.emit('leaveRoom');
        currentRoom = null;
        showLobbyView();
      });
    }
  }

  function updateRoomList(list) {
    rooms = list;
    renderRoomList();
  }

  function renderRoomList() {
    const container = document.getElementById('roomListContainer');
    if (!container) return;

    if (rooms.length === 0) {
      container.innerHTML = '<p class="empty-msg">No rooms available. Create one!</p>';
      return;
    }

    container.innerHTML = '';
    for (const room of rooms) {
      const div = document.createElement('div');
      div.className = `room-card ${room.state !== 'lobby' ? 'in-progress' : ''}`;
      div.innerHTML = `
        <div class="room-info">
          <span class="room-name">${escapeHtml(room.name)}</span>
          <span class="room-code">Code: <strong>${room.id}</strong></span>
          <span class="room-players">${room.playerCount}/${room.maxPlayers} players</span>
        </div>
        <div class="room-status">${room.state === 'lobby' ? '🟢 Open' : '🔴 ' + room.state}</div>
        ${room.state === 'lobby' && room.playerCount < room.maxPlayers
          ? `<button class="btn-join" data-id="${room.id}">Join</button>`
          : ''}
      `;
      container.appendChild(div);
    }

    container.querySelectorAll('.btn-join').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.emit('joinRoom', { roomId: btn.dataset.id });
      });
    });
  }

  function handleRoomState(room) {
    currentRoom = room;
    showRoomView(room);
  }

  function showLobbyView() {
    document.getElementById('lobbyView').style.display = 'block';
    document.getElementById('roomView').style.display = 'none';
  }

  function showRoomView(room) {
    document.getElementById('lobbyView').style.display = 'none';
    const roomView = document.getElementById('roomView');
    roomView.style.display = 'block';

    document.getElementById('roomTitle').textContent = room.name;
    document.getElementById('roomCode').textContent = room.id;
    const playerCount = document.getElementById('roomPlayerCount');
    if (playerCount) playerCount.textContent = `${room.playerCount}/${room.maxPlayers}`;

    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
      const me = Auth.getUser();
      startBtn.style.display = (room.hostId === socket.id || room.playerCount >= 1) ? 'inline-block' : 'none';
    }
  }

  function handleGameStarted() {
    if (!currentRoom) return;
    // Save room info & navigate to game page
    sessionStorage.setItem('td_room', JSON.stringify(currentRoom));
    sessionStorage.setItem('td_socket_token', Auth.getToken());
    window.location.href = 'game.html';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  return { init, updateRoomList, handleRoomState, showLobbyView, handleGameStarted };
})();
