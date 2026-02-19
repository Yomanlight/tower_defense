// ── AUTH MODULE ───────────────────────────────────────────────────────────────

const Auth = (() => {
  const TOKEN_KEY = 'td_token';
  const USER_KEY  = 'td_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getUser()  {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch { return null; }
  }
  function isLoggedIn() { return !!getToken(); }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function register(username, password) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  }

  async function login(username, password) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  }

  async function sendFriendRequest(username) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ username })
    });
    return res.json();
  }

  async function acceptFriend(fromId) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/friends/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ fromId })
    });
    return res.json();
  }

  async function rejectFriend(fromId) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/friends/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ fromId })
    });
    return res.json();
  }

  async function removeFriend(friendId) {
    const res = await fetch(`${CONFIG.SERVER_URL}/api/friends/${friendId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    return res.json();
  }

  return { getToken, getUser, isLoggedIn, setSession, clearSession, register, login, sendFriendRequest, acceptFriend, rejectFriend, removeFriend };
})();
