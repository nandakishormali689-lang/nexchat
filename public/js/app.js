// ── CONFIG ────────────────────────────────────────────────────────────────────
// Change this to your deployed server URL when hosting
// e.g. 'https://nexchat-server.onrender.com'
const SERVER_URL = 'https://nexchat-server-w0rj.onrender.com';

// ── STATE ──────────────────────────────────────────────────────────────── ─────
let socket = null;
let token = localStorage.getItem('nc_token') || null;
let currentUser = JSON.parse(localStorage.getItem('nc_user') || 'null');
let activePeer = null;
let selectedAvatar = '🧑';
let typingTimer = null;
let usersCache = {};         // username -> { displayName, avatar, online }
let messagesCache = {};      // peerUsername -> [messages]
let unreadCounts = {};       // peerUsername -> number

// ── BOOTSTRAP ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.avatar-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.avatar-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedAvatar = el.dataset.v;
    });
  });

  if (token && currentUser) {
    enterApp();
  }
});

// ── SOCKET SETUP ──────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('auth', token);
  });

  socket.on('auth_ok', () => {
    loadUsers();
  });

  socket.on('auth_error', (err) => {
    toast('Session expired. Please sign in again.');
    doLogout();
  });

  // Incoming real-time message
  socket.on('message', (msg) => {
    const peer = msg.from === currentUser.username ? msg.to : msg.from;

    // Add to cache
    if (!messagesCache[peer]) messagesCache[peer] = [];
    const exists = messagesCache[peer].find(m => m.id === msg.id);
    if (!exists) messagesCache[peer].push(msg);

    // If this conversation is open, render it
    if (activePeer === peer) {
      renderMessages(peer);
    } else if (msg.from !== currentUser.username) {
      // Notification for a different chat
      unreadCounts[peer] = (unreadCounts[peer] || 0) + 1;
      renderUserList();
      toast(`New message from ${usersCache[peer]?.displayName || peer}`);
    }

    // Update preview in sidebar
    renderUserList();
  });

  // Presence updates (online/offline)
  socket.on('presence', ({ username, online }) => {
    if (usersCache[username]) {
      usersCache[username].online = online;
      renderUserList();
      if (activePeer === username) updatePeerHeader(username);
    }
  });

  // Typing indicator
  socket.on('typing', ({ from, typing }) => {
    if (from === activePeer) {
      const bar = document.getElementById('typing-bar');
      const name = document.getElementById('typing-name');
      name.textContent = usersCache[from]?.displayName || from;
      bar.style.display = typing ? 'flex' : 'none';
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', tab === 'login' ? i === 0 : i === 1));
  document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
}

async function doRegister() {
  const displayName = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-user').value.trim().toLowerCase();
  const password = document.getElementById('reg-pass').value;
  const err = document.getElementById('reg-err');

  if (!displayName || !username || !password)
    return showErr(err, 'Please fill in all fields.');

  setBtnLoading('reg-label', true, 'Creating…');
  try {
    const res = await api('/api/register', 'POST', { displayName, username, password, avatar: selectedAvatar });
    saveSession(res);
    enterApp();
  } catch (e) {
    showErr(err, e.message);
  } finally {
    setBtnLoading('reg-label', false, 'Create Account');
  }
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const password = document.getElementById('login-pass').value;
  const err = document.getElementById('login-err');

  if (!username || !password) return showErr(err, 'Please fill in both fields.');

  setBtnLoading('login-label', true, 'Signing in…');
  try {
    const res = await api('/api/login', 'POST', { username, password });
    saveSession(res);
    enterApp();
  } catch (e) {
    showErr(err, e.message);
  } finally {
    setBtnLoading('login-label', false, 'Sign In');
  }
}

function saveSession(data) {
  token = data.token;
  currentUser = { username: data.username, displayName: data.displayName, avatar: data.avatar };
  localStorage.setItem('nc_token', token);
  localStorage.setItem('nc_user', JSON.stringify(currentUser));
}

function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('my-name').textContent = currentUser.displayName;
  document.getElementById('my-avatar').textContent = currentUser.avatar;
  connectSocket();
}

function doLogout() {
  if (socket) socket.disconnect();
  token = null;
  currentUser = null;
  activePeer = null;
  usersCache = {};
  messagesCache = {};
  unreadCounts = {};
  localStorage.removeItem('nc_token');
  localStorage.removeItem('nc_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

// ── USERS ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const users = await api('/api/users', 'GET');
    usersCache = {};
    users.forEach(u => { usersCache[u.username] = u; });
    renderUserList();
  } catch (e) {
    document.getElementById('users-list').innerHTML =
      `<div class="list-hint">Could not load users.<br><small>${e.message}</small></div>`;
  }
}

function renderUserList() {
  const list = document.getElementById('users-list');
  const usernames = Object.keys(usersCache);

  if (usernames.length === 0) {
    list.innerHTML = '<div class="list-hint">No other users yet.<br>Share the link so friends can register!</div>';
    return;
  }

  list.innerHTML = '';
  usernames.forEach(username => {
    const u = usersCache[username];
    const msgs = messagesCache[username] || [];
    const last = msgs[msgs.length - 1];
    const unread = unreadCounts[username] || 0;

    const item = document.createElement('div');
    item.className = 'user-item' + (activePeer === username ? ' active' : '');
    item.innerHTML = `
      <div class="avatar-wrap">
        <div class="avatar-circle">${u.avatar}</div>
        <div class="status-dot ${u.online ? 'online' : ''}"></div>
      </div>
      <div class="user-meta">
        <div class="user-name">${esc(u.displayName)}</div>
        <div class="user-preview">${last
          ? (last.from === currentUser.username ? 'You: ' : '') + esc(last.text)
          : u.online ? 'Online' : 'Tap to chat'}</div>
      </div>
      ${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}
    `;
    item.onclick = () => openChat(username);
    list.appendChild(item);
  });
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
async function openChat(peer) {
  activePeer = peer;
  unreadCounts[peer] = 0;

  const u = usersCache[peer];
  document.getElementById('no-chat').style.display = 'none';
  const ac = document.getElementById('active-chat');
  ac.style.display = 'flex';

  updatePeerHeader(peer);

  // Join the socket room
  if (socket) socket.emit('join_room', peer);

  // Load history if not cached
  if (!messagesCache[peer]) {
    document.getElementById('messages-area').innerHTML = '<div class="list-hint">Loading…</div>';
    try {
      const history = await api(`/api/messages/${peer}`, 'GET');
      messagesCache[peer] = history;
    } catch (e) {
      messagesCache[peer] = [];
    }
  }

  renderMessages(peer);
  renderUserList();
  document.getElementById('msg-input').focus();
}

function updatePeerHeader(peer) {
  const u = usersCache[peer];
  if (!u) return;
  document.getElementById('chat-peer-name').textContent = u.displayName;
  document.getElementById('chat-peer-avatar').textContent = u.avatar;
  const dot = document.getElementById('chat-peer-dot');
  dot.className = 'status-dot' + (u.online ? ' online' : '');
  document.getElementById('chat-peer-sub').textContent = u.online ? '● Online' : '○ Offline';
  document.getElementById('chat-peer-sub').style.color = u.online ? 'var(--success)' : 'var(--text3)';
}

function renderMessages(peer) {
  const area = document.getElementById('messages-area');
  const msgs = messagesCache[peer] || [];

  if (msgs.length === 0) {
    area.innerHTML = `
      <div class="empty-conv">
        <span>👋</span>
        <p>Start the conversation</p>
        <small>Messages are stored in Firebase — real and persistent</small>
      </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  msgs.forEach(msg => {
    const d = new Date(msg.time);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const isOwn = msg.from === currentUser.username;
    const senderInfo = isOwn ? currentUser : usersCache[msg.from];

    if (dateStr !== lastDate) {
      html += `<div class="day-divider">${dateStr}</div>`;
      lastDate = dateStr;
    }

    html += `
      <div class="msg-group ${isOwn ? 'own' : ''}">
        <div class="msg-avatar">${senderInfo?.avatar || '👤'}</div>
        <div class="bubbles">
          ${!isOwn ? `<div class="bubble-sender">${esc(senderInfo?.displayName || msg.from)}</div>` : ''}
          <div class="bubble">${esc(msg.text)}</div>
          <div class="bubble-time">${timeStr}</div>
        </div>
      </div>`;
  });

  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !activePeer || !socket) return;

  socket.emit('message', { to: activePeer, text });

  // Optimistic: add to local cache immediately
  const msg = {
    id: 'local_' + Date.now(),
    from: currentUser.username,
    to: activePeer,
    text,
    time: Date.now(),
  };
  if (!messagesCache[activePeer]) messagesCache[activePeer] = [];
  messagesCache[activePeer].push(msg);

  input.value = '';
  input.style.height = '';
  renderMessages(activePeer);
  renderUserList();

  // Stop typing indicator
  socket.emit('typing', { to: activePeer, typing: false });
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let typingActive = false;
function handleTyping() {
  if (!socket || !activePeer) return;
  if (!typingActive) {
    typingActive = true;
    socket.emit('typing', { to: activePeer, typing: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingActive = false;
    socket.emit('typing', { to: activePeer, typing: false });
  }, 2000);
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(SERVER_URL + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Server error');
  return data;
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showErr(el, msg) { el.textContent = msg; el.style.display = 'block'; }

function setBtnLoading(id, loading, label) {
  const el = document.getElementById(id);
  if (el) el.textContent = label;
  const btn = el?.closest('button');
  if (btn) btn.disabled = loading;
}

function toast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
