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
    loadGroups();
    console.log('Socket authenticated successfully');
  });

  socket.on('auth_error', (err) => {
    toast('Session expired. Please sign in again.');
    doLogout();
  });

  // Incoming real-time message
  socket.on('message', (msg) => {
    const peer = msg.from === currentUser.username ? msg.to : msg.from;

    // Auto join room so future messages arrive
    socket.emit('join_room', peer);

    // Remove optimistic duplicate
    if (messagesCache[peer]) {
      messagesCache[peer] = messagesCache[peer].filter(m => !m.id.startsWith('local_'));
    }

    // Add to cache
    if (!messagesCache[peer]) messagesCache[peer] = [];
    const exists = messagesCache[peer].find(m => m.id === msg.id);
    if (!exists) messagesCache[peer].push(msg);

    // If this conversation is open, render it
    if (activePeer === peer) {
      renderMessages(peer);
    } else if (msg.from !== currentUser.username) {
      unreadCounts[peer] = (unreadCounts[peer] || 0) + 1;
      renderUserList();
      toast(`New message from ${usersCache[peer]?.displayName || peer}`);
    }

    renderUserList();
  });

    // Message deleted
  socket.on('message_deleted', ({ messageId }) => {
    // Remove from all caches
    Object.keys(messagesCache).forEach(peer => {
      messagesCache[peer] = messagesCache[peer].filter(m => m.id !== messageId);
    });

    // Incoming group message
  socket.on('group_message', (msg) => {
    const { groupId } = msg;
    if (!groupMessagesCache[groupId]) groupMessagesCache[groupId] = [];
    const exists = groupMessagesCache[groupId].find(m => m.id === msg.id);
    if (!exists) {
      if (groupMessagesCache[groupId]) {
        groupMessagesCache[groupId] = groupMessagesCache[groupId].filter(m => !m.id.startsWith('local_'));
      }
      groupMessagesCache[groupId].push(msg);
    }
    if (activeGroup === groupId) {
      renderGroupMessages(groupId);
    } else if (msg.from !== currentUser.username) {
      const g = groupsCache[groupId];
      toast(`${g?.name || 'Group'}: ${msg.text.substring(0, 30)}`);
    }
    renderGroupList();
  });

    // Read receipts
  socket.on('messages_read', ({ by, from }) => {
    if (messagesCache[by]) {
      messagesCache[by].forEach(m => {
        if (m.from === currentUser.username && m.to === by) {
          m.read = true;
        }
      });
    }
    if (activePeer === by) renderMessages(by);
  });

    // Re-render if in active chat
    if (activePeer) renderMessages(activePeer);
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
  // Mobile: hide sidebar, show chat area
  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.add('mobile-hidden');
    document.getElementById('active-chat').closest('.chat-area').classList.add('mobile-show');
  }
  const ac = document.getElementById('active-chat');
  ac.style.display = 'flex';

  updatePeerHeader(peer);

  // Join the socket room
  if (socket) {
  socket.emit('join_room', peer);
  console.log('Joined room with', peer);
}

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

    const ticks = isOwn
      ? msg.read
        ? '<span class="ticks read">✓✓</span>'
        : msg.id.startsWith('local_')
          ? '<span class="ticks">✓</span>'
          : '<span class="ticks">✓✓</span>'
      : '';

    html += `
      <div class="msg-group ${isOwn ? 'own' : ''}" id="msg-${msg.id}">
        <div class="msg-avatar">${senderInfo?.avatar || '👤'}</div>
        <div class="bubbles">
          ${!isOwn ? `<div class="bubble-sender">${esc(senderInfo?.displayName || msg.from)}</div>` : ''}
          <div class="bubble" oncontextmenu="showDeleteMenu(event,'${msg.id}','${msg.from}')" ontouchstart="touchHold(event,'${msg.id}','${msg.from}')" ontouchend="cancelTouch()">
            ${esc(msg.text)}
          </div>
          <div class="bubble-time">${timeStr} ${ticks}</div>
        </div>
      </div>`;
  });

  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !socket) return;

  if (activeGroup) {
    socket.emit('group_message', { groupId: activeGroup, text });
    const msg = {
      id: 'local_' + Date.now(),
      from: currentUser.username,
      groupId: activeGroup,
      text,
      time: Date.now(),
    };
    if (!groupMessagesCache[activeGroup]) groupMessagesCache[activeGroup] = [];
    groupMessagesCache[activeGroup].push(msg);
    input.value = '';
    input.style.height = '';
    renderGroupMessages(activeGroup);
    renderGroupList();
    return;
  }

  if (!activePeer) return;
  socket.emit('message', { to: activePeer, text });
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
function goBackMobile() {
  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.remove('mobile-hidden');
    document.getElementById('active-chat').closest('.chat-area').classList.remove('mobile-show');
    activePeer = null;
  }
}

// ── DELETE MESSAGE ─────────────────────────────────────────────────────────
let touchHoldTimer = null;

function touchHold(e, msgId, msgFrom) {
  touchHoldTimer = setTimeout(() => {
    showDeleteMenu(e, msgId, msgFrom);
  }, 600);
}

function cancelTouch() {
  clearTimeout(touchHoldTimer);
}

function showDeleteMenu(e, msgId, msgFrom) {
  e.preventDefault();
  // Only allow deleting own messages
  if (msgFrom !== currentUser.username) return;
  // Remove any existing menu
  removeDeleteMenu();

  const menu = document.createElement('div');
  menu.id = 'delete-menu';
  menu.innerHTML = `
    <button onclick="deleteMessage('${msgId}')">🗑️ Delete</button>
    <button onclick="removeDeleteMenu()">✕ Cancel</button>
  `;
  document.body.appendChild(menu);

  // Position near touch/click
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 100) + 'px';

  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener('click', removeDeleteMenu, { once: true });
  }, 100);
}

function removeDeleteMenu() {
  const menu = document.getElementById('delete-menu');
  if (menu) menu.remove();
}

function deleteMessage(msgId) {
  removeDeleteMenu();
  if (!socket || !activePeer) return;
  socket.emit('delete_message', { messageId: msgId, to: activePeer });
  // Optimistic remove
  if (messagesCache[activePeer]) {
    messagesCache[activePeer] = messagesCache[activePeer].filter(m => m.id !== msgId);
  }
  renderMessages(activePeer);
  renderUserList();
}

// Swipe left to go back on mobile
(function() {
  let touchStartX = 0;
  let touchEndX = 0;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    // Swipe right (diff > 80) = go back to contacts
    if (diff > 80 && window.innerWidth <= 600 && activePeer) {
      goBackMobile();
    }
  }, { passive: true });
})();

// ── GROUP CHAT ─────────────────────────────────────────────────────────────
let groupsCache = {};
let activeGroup = null;
let groupMessagesCache = {};

async function loadGroups() {
  try {
    const groups = await api('/api/groups', 'GET');
    groupsCache = {};
    groups.forEach(g => { groupsCache[g.id] = g; });
    renderGroupList();
    groups.forEach(g => {
      if (socket) socket.emit('join_group', g.id);
    });
  } catch (e) {
    console.log('Could not load groups:', e.message);
  }
}

function renderGroupList() {
  const list = document.getElementById('groups-list');
  const label = document.getElementById('groups-label');
  const ids = Object.keys(groupsCache);
  if (ids.length === 0) {
    list.style.display = 'none';
    label.style.display = 'none';
    return;
  }
  list.style.display = 'block';
  label.style.display = 'flex';
  list.innerHTML = '';
  ids.forEach(id => {
    const g = groupsCache[id];
    const msgs = groupMessagesCache[id] || [];
    const last = msgs[msgs.length - 1];
    const item = document.createElement('div');
    item.className = 'user-item' + (activeGroup === id ? ' active' : '');
    item.innerHTML = `
      <div class="avatar-wrap">
        <div class="avatar-circle">${g.avatar || '👥'}</div>
      </div>
      <div class="user-meta">
        <div class="user-name">${esc(g.name)}</div>
        <div class="user-preview">${last ? esc(last.text) : g.members.length + ' members'}</div>
      </div>
    `;
    item.onclick = () => openGroupChat(id);
    list.appendChild(item);
  });
}

async function openGroupChat(groupId) {
  activeGroup = groupId;
  activePeer = null;
  const g = groupsCache[groupId];

  document.getElementById('no-chat').style.display = 'none';
  const ac = document.getElementById('active-chat');
  ac.style.display = 'flex';

  document.getElementById('chat-peer-name').textContent = g.name;
  document.getElementById('chat-peer-avatar').textContent = g.avatar || '👥';
  document.getElementById('chat-peer-dot').className = 'status-dot online';
  document.getElementById('chat-peer-sub').textContent = g.members.length + ' members';
  document.getElementById('chat-peer-sub').style.color = 'var(--text2)';

  if (socket) socket.emit('join_group', groupId);

  if (!groupMessagesCache[groupId]) {
    document.getElementById('messages-area').innerHTML = '<div class="list-hint">Loading…</div>';
    try {
      const history = await api(`/api/groups/${groupId}/messages`, 'GET');
      groupMessagesCache[groupId] = history;
    } catch (e) {
      groupMessagesCache[groupId] = [];
    }
  }

  renderGroupMessages(groupId);
  renderGroupList();

  if (window.innerWidth <= 600) {
    document.getElementById('sidebar').classList.add('mobile-hidden');
    document.getElementById('active-chat').closest('.chat-area').classList.add('mobile-show');
  }
  document.getElementById('msg-input').focus();
}

function renderGroupMessages(groupId) {
  const area = document.getElementById('messages-area');
  const msgs = groupMessagesCache[groupId] || [];
  if (msgs.length === 0) {
    area.innerHTML = `<div class="empty-conv"><span>👥</span><p>Start the group conversation</p></div>`;
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
      <div class="msg-group ${isOwn ? 'own' : ''}" id="msg-${msg.id}">
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

function showNewGroup() {
  const modal = document.getElementById('group-modal');
  modal.style.display = 'flex';
  const checkboxes = document.getElementById('member-checkboxes');
  checkboxes.innerHTML = '';
  Object.entries(usersCache).forEach(([username, info]) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;';
    div.innerHTML = `
      <input type="checkbox" id="member-${username}" value="${username}" style="width:16px;height:16px;cursor:pointer">
      <label for="member-${username}" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px">
        <span style="font-size:18px">${info.avatar}</span>
        <span>${esc(info.displayName)}</span>
      </label>`;
    checkboxes.appendChild(div);
  });
}

function closeNewGroup() {
  document.getElementById('group-modal').style.display = 'none';
  document.getElementById('group-name').value = '';
}

async function createGroup() {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { toast('Please enter a group name'); return; }
  const checked = [...document.querySelectorAll('#member-checkboxes input:checked')];
  if (checked.length === 0) { toast('Please select at least 1 member'); return; }
  const members = checked.map(c => c.value);
  try {
    const group = await api('/api/groups', 'POST', { name, members });
    groupsCache[group.id] = group;
    groupMessagesCache[group.id] = [];
    closeNewGroup();
    renderGroupList();
    openGroupChat(group.id);
    toast('Group created!');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}