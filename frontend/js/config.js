// ── SERVER CONFIGURATION ──────────────────────────────────────────────────────
// Change SERVER_URL to your Railway deployment URL before deploying to Netlify
const CONFIG = {
  SERVER_URL: 'http://localhost:3000'
};

// Auto-detect: if running on localhost use local backend, else use production
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  // Replace this with your Railway URL after deployment
  CONFIG.SERVER_URL = 'towerdefense-production.up.railway.app';
}
