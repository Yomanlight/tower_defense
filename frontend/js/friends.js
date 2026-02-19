// ── FRIENDS MODULE ────────────────────────────────────────────────────────────

const Friends = (() => {
  let friends = [];
  let pendingRequests = [];
  let socket = null;

  function init(sock, initialFriends, initialPending) {
    socket = sock;
    friends = initialFriends || [];
    pendingRequests = initialPending || [];
    render();
  }

  function setFriends(list) {
    friends = list || [];
    render();
  }

  function addFriend(friend) {
    if (!friends.find(f => f.id === friend.id)) {
      friends.push(friend);
    } else {
      const f = friends.find(f => f.id === friend.id);
      if (f) { f.online = friend.online; f.username = friend.username; }
    }
    // Remove from pending if present
    pendingRequests = pendingRequests.filter(r => r.id !== friend.id);
    render();
  }

  function setOnline(id, online) {
    const f = friends.find(f => f.id === id);
    if (f) { f.online = online; render(); }
  }

  function addPendingRequest(from) {
    if (!pendingRequests.find(r => r.id === from.id)) {
      pendingRequests.push(from);
      render();
      Toast.show(`Friend request from ${from.username}`, 'info');
    }
  }

  function removePendingRequest(id) {
    pendingRequests = pendingRequests.filter(r => r.id !== id);
    render();
  }

  function render() {
    const list = document.getElementById('friendsList');
    const pending = document.getElementById('pendingList');
    if (!list || !pending) return;

    list.innerHTML = '';
    if (friends.length === 0) {
      list.innerHTML = '<li class="empty">No friends yet</li>';
    } else {
      for (const f of friends) {
        const li = document.createElement('li');
        li.className = 'friend-item';
        li.innerHTML = `
          <span class="status-dot ${f.online ? 'online' : 'offline'}"></span>
          <span class="friend-name">${escapeHtml(f.username)}</span>
          <div class="friend-actions">
            ${f.online ? `<button class="btn-sm btn-invite" data-id="${f.id}" title="Invite to game">Invite</button>` : ''}
            <button class="btn-sm btn-remove" data-id="${f.id}" title="Remove friend">✕</button>
          </div>
        `;
        list.appendChild(li);
      }
    }

    // Bind invite buttons
    list.querySelectorAll('.btn-invite').forEach(btn => {
      btn.addEventListener('click', () => {
        const friendId = btn.dataset.id;
        if (socket) socket.emit('inviteFriend', { friendId });
      });
    });

    // Bind remove buttons
    list.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const friendId = btn.dataset.id;
        await Auth.removeFriend(friendId);
        friends = friends.filter(f => f.id !== friendId);
        render();
      });
    });

    // Pending requests
    pending.innerHTML = '';
    if (pendingRequests.length === 0) {
      pending.innerHTML = '<li class="empty">No pending requests</li>';
    } else {
      for (const req of pendingRequests) {
        const li = document.createElement('li');
        li.className = 'pending-item';
        li.innerHTML = `
          <span class="friend-name">${escapeHtml(req.username)}</span>
          <div class="friend-actions">
            <button class="btn-sm btn-accept" data-id="${req.id}">Accept</button>
            <button class="btn-sm btn-reject" data-id="${req.id}">Reject</button>
          </div>
        `;
        pending.appendChild(li);
      }
    }

    pending.querySelectorAll('.btn-accept').forEach(btn => {
      btn.addEventListener('click', () => {
        if (socket) socket.emit('acceptFriend', { fromId: btn.dataset.id });
        removePendingRequest(btn.dataset.id);
      });
    });

    pending.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', () => {
        if (socket) socket.emit('rejectFriend', { fromId: btn.dataset.id });
        removePendingRequest(btn.dataset.id);
      });
    });

    // Update badge
    const badge = document.getElementById('pendingBadge');
    if (badge) {
      badge.textContent = pendingRequests.length;
      badge.style.display = pendingRequests.length > 0 ? 'inline-block' : 'none';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  return { init, setFriends, addFriend, setOnline, addPendingRequest, removePendingRequest };
})();
