require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// ── FIREBASE INIT ──────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── EXPRESS + SOCKET.IO SETUP ──────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static('../public'));

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const PORT = process.env.PORT || 3000;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function makeToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function roomId(a, b) {
  return [a, b].sort().join('__');
}

const onlineUsers = new Map();

// ── REST ENDPOINTS ────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password, displayName, avatar } = req.body;
  if (!username || !password || !displayName)
    return res.status(400).json({ error: 'Missing fields' });
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3-20 chars: letters, numbers, underscores' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const userRef = db.collection('users').doc(username);
  const existing = await userRef.get();
  if (existing.exists) return res.status(409).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, 10);
  await userRef.set({
    username,
    displayName,
    avatar: avatar || '🧑',
    passwordHash: hash,
    createdAt: FieldValue.serverTimestamp(),
  });

  res.json({ token: makeToken(username), username, displayName, avatar });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const userRef = db.collection('users').doc(username);
  const snap = await userRef.get();
  if (!snap.exists) return res.status(401).json({ error: 'No account with that username' });

  const user = snap.data();
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });

  res.json({ token: makeToken(username), username, displayName: user.displayName, avatar: user.avatar });
});

app.get('/api/users', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const snap = await db.collection('users').get();
  const users = [];
  snap.forEach(doc => {
    if (doc.id !== auth.username) {
      const d = doc.data();
      users.push({
        username: doc.id,
        displayName: d.displayName,
        avatar: d.avatar,
        online: onlineUsers.has(doc.id),
      });
    }
  });
  res.json(users);
});

app.get('/api/messages/:peer', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const room = roomId(auth.username, req.params.peer);
  const snap = await db.collection('messages')
    .where('room', '==', room)
    .orderBy('time', 'asc')
    .limit(200)
    .get();

  const messages = [];
  snap.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
  res.json(messages);
});

socket.on('join_group', (groupId) => {
    if (!currentUser) return;
    socket.join('group_' + groupId);
    console.log(`${currentUser} joined group ${groupId}`);
  });

  socket.on('group_message', async (data) => {
    if (!currentUser) return;
    const { groupId, text } = data;
    if (!text || !groupId || text.length > 2000) return;
    const groupDoc = await db.collection('groups').doc(groupId).get();
    if (!groupDoc.exists) return;
    if (!groupDoc.data().members.includes(currentUser)) return;
    const msg = {
      groupId,
      from: currentUser,
      text: text.trim(),
      time: Date.now(),
    };
    const ref = await db.collection('groupMessages').add(msg);
    const fullMsg = { id: ref.id, ...msg };
    io.to('group_' + groupId).emit('group_message', fullMsg);
    console.log(`👥 [${currentUser} → group ${groupId}]: ${text.substring(0, 50)}`);
  });

app.post('/api/save-token', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });
  await db.collection('users').doc(auth.username).update({ fcmToken: token });
  res.json({ success: true });
});

// Create a group
app.post('/api/groups', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const { name, members } = req.body;
  if (!name || !members || members.length < 1)
    return res.status(400).json({ error: 'Need a name and at least 1 member' });
  const allMembers = [...new Set([auth.username, ...members])];
  const group = {
    name,
    members: allMembers,
    createdBy: auth.username,
    createdAt: FieldValue.serverTimestamp(),
    avatar: '👥'
  };
  const ref = await db.collection('groups').add(group);
  res.json({ id: ref.id, ...group });
});

// Get all groups for current user
app.get('/api/groups', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const snap = await db.collection('groups')
    .where('members', 'array-contains', auth.username)
    .get();
  const groups = [];
  snap.forEach(doc => groups.push({ id: doc.id, ...doc.data() }));
  res.json(groups);
});

// Get group messages
app.get('/api/groups/:groupId/messages', async (req, res) => {
  const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const groupDoc = await db.collection('groups').doc(req.params.groupId).get();
  if (!groupDoc.exists) return res.status(404).json({ error: 'Group not found' });
  if (!groupDoc.data().members.includes(auth.username))
    return res.status(403).json({ error: 'Not a member' });
  const snap = await db.collection('groupMessages')
    .where('groupId', '==', req.params.groupId)
    .orderBy('time', 'asc')
    .limit(200)
    .get();
  const messages = [];
  snap.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
  res.json(messages);
});

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('auth', (token) => {
    const decoded = verifyToken(token);
    if (!decoded) { socket.emit('auth_error', 'Invalid token'); return; }
    currentUser = decoded.username;
    onlineUsers.set(currentUser, socket.id);
    io.emit('presence', { username: currentUser, online: true });
    socket.emit('auth_ok', { username: currentUser });
    console.log(`✓ ${currentUser} connected`);
  });

  socket.on('join_room', (peerUsername) => {
    if (!currentUser) return;
    const room = roomId(currentUser, peerUsername);
    socket.join(room);
    console.log(`${currentUser} joined room ${room}`);
  });

  socket.on('mark_read', async (data) => {
    if (!currentUser) return;
    const { from } = data;
    if (!from) return;
    const room = roomId(currentUser, from);
    const batch = db.batch();
    const snap = await db.collection('messages')
      .where('room', '==', room)
      .where('to', '==', currentUser)
      .where('read', '==', false)
      .get();
    snap.forEach(doc => batch.update(doc.ref, { read: true }));
    await batch.commit();
    const senderSocketId = onlineUsers.get(from);
    if (senderSocketId) {
      io.to(senderSocketId).emit('messages_read', { by: currentUser, from });
    }
    console.log(`✅ ${currentUser} read messages from ${from}`);
  });

  socket.on('message', async (data) => {
    if (!currentUser) return;
    const { to, text } = data;
    if (!text || !to || text.length > 2000) return;

    const room = roomId(currentUser, to);
    const msg = { from: currentUser, to, room, text: text.trim(), time: Date.now(), read: false, delivered: true };

    const ref = await db.collection('messages').add(msg);
    const fullMsg = { id: ref.id, ...msg };

    io.to(room).emit('message', fullMsg);
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) io.to(recipientSocketId).emit('message', fullMsg);

    console.log(`💬 [${currentUser} → ${to}]: ${text.substring(0, 50)}`);

  });

  // Delete message
  socket.on('delete_message', async (data) => {
    if (!currentUser) return;
    const { messageId, to } = data;
    if (!messageId || !to) return;

    try {
      const msgRef = db.collection('messages').doc(messageId);
      const msgSnap = await msgRef.get();

      // Only allow sender to delete
      if (!msgSnap.exists || msgSnap.data().from !== currentUser) {
        socket.emit('delete_error', 'Not allowed');
        return;
      }

      await msgRef.delete();

      // Notify both users
      const room = roomId(currentUser, to);
      io.to(room).emit('message_deleted', { messageId });

      const recipientSocketId = onlineUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('message_deleted', { messageId });
      }

      console.log(`🗑️ Message ${messageId} deleted by ${currentUser}`);
    } catch (e) {
      console.error('Delete error:', e);
    }
  });

  socket.on('typing', ({ to, typing }) => {
    if (!currentUser) return;
    socket.to(roomId(currentUser, to)).emit('typing', { from: currentUser, typing });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(currentUser);
      io.emit('presence', { username: currentUser, online: false });
      console.log(`✗ ${currentUser} disconnected`);
    }
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 NexChat server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);

  // Prevent Render free tier from sleeping
const https = require('https');
setInterval(() => {
  https.get('https://nexchat-server-w0rj.onrender.com', () => {
    console.log('Keepalive ping sent');
  }).on('error', () => {});
}, 840000);
});