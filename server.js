// ─────────────────────────────────────────────
//  NexChat — Backend Server
//  Stack: Node.js · Express · Socket.io · Firebase Admin
// ─────────────────────────────────────────────

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const admin      = require('firebase-admin');
const path       = require('path');

// ── 1. FIREBASE ADMIN INIT ──────────────────
// Download your serviceAccountKey.json from:
// Firebase Console → Project Settings → Service Accounts → Generate new private key
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── 2. EXPRESS + SOCKET.IO SETUP ───────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 3. TRACK ONLINE USERS ──────────────────
// { uid: { socketId, displayName, photoURL } }
const onlineUsers = new Map();

// ── 4. AUTH MIDDLEWARE (verifies Firebase token) ─
async function verifyToken(token) {
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

// ── 5. REST ENDPOINT — load chat history ───
// GET /api/messages?user1=uid1&user2=uid2&limit=50
app.get('/api/messages', async (req, res) => {
  const { user1, user2, limit = 50 } = req.query;
  if (!user1 || !user2) return res.status(400).json({ error: 'user1 and user2 required' });

  // Deterministic room ID regardless of who opens the chat
  const roomId = [user1, user2].sort().join('_');

  try {
    const snap = await db
      .collection('messages')
      .where('roomId', '==', roomId)
      .orderBy('timestamp', 'asc')
      .limitToLast(Number(limit))
      .get();

    const messages = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/users — list all registered users
app.get('/api/users', async (req, res) => {
  try {
    const snap = await db.collection('users').get();
    const users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/register-user — save user profile to Firestore on first login
app.post('/api/register-user', async (req, res) => {
  const { token, displayName, photoURL } = req.body;
  const decoded = await verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  try {
    await db.collection('users').doc(decoded.uid).set(
      { uid: decoded.uid, displayName, photoURL, email: decoded.email, createdAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// ── 6. SOCKET.IO — REAL-TIME MESSAGING ────
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // ── Client authenticates after connect ──
  socket.on('authenticate', async ({ token }) => {
    const decoded = await verifyToken(token);
    if (!decoded) {
      socket.emit('auth_error', { message: 'Invalid or expired token' });
      return socket.disconnect();
    }

    socket.uid = decoded.uid;
    socket.displayName = decoded.name || decoded.email;

    // Mark user online
    onlineUsers.set(decoded.uid, {
      socketId: socket.id,
      displayName: socket.displayName,
    });

    // Broadcast updated online list to everyone
    io.emit('online_users', Array.from(onlineUsers.keys()));
    socket.emit('authenticated', { uid: decoded.uid });
    console.log(`User authenticated: ${socket.displayName} (${decoded.uid})`);
  });

  // ── Join a private chat room ──
  socket.on('join_room', ({ peerId }) => {
    if (!socket.uid) return;
    const roomId = [socket.uid, peerId].sort().join('_');
    socket.join(roomId);
    socket.currentRoom = roomId;
  });

  // ── Send a message ──
  socket.on('send_message', async ({ toUid, text }) => {
    if (!socket.uid || !toUid || !text?.trim()) return;

    const roomId   = [socket.uid, toUid].sort().join('_');
    const message  = {
      roomId,
      fromUid:     socket.uid,
      fromName:    socket.displayName,
      toUid,
      text:        text.trim(),
      timestamp:   admin.firestore.FieldValue.serverTimestamp(),
      read:        false,
    };

    // 1. Save to Firestore (persistent storage)
    const docRef = await db.collection('messages').add(message);

    // 2. Emit to both users in the room (real-time delivery)
    const payload = { ...message, id: docRef.id, timestamp: Date.now() };
    io.to(roomId).emit('new_message', payload);

    // 3. If recipient is online but not in this room, send a notification
    const recipientSocket = onlineUsers.get(toUid);
    if (recipientSocket) {
      const recipientSock = io.sockets.sockets.get(recipientSocket.socketId);
      if (recipientSock && recipientSock.currentRoom !== roomId) {
        recipientSock.emit('notification', {
          fromUid:  socket.uid,
          fromName: socket.displayName,
          preview:  text.trim().slice(0, 60),
        });
      }
    }
  });

  // ── Typing indicator ──
  socket.on('typing', ({ toUid, isTyping }) => {
    if (!socket.uid) return;
    const roomId = [socket.uid, toUid].sort().join('_');
    socket.to(roomId).emit('typing', { fromUid: socket.uid, isTyping });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    if (socket.uid) {
      onlineUsers.delete(socket.uid);
      io.emit('online_users', Array.from(onlineUsers.keys()));
      console.log(`User disconnected: ${socket.displayName}`);
    }
  });
});

// ── 7. START SERVER ────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 NexChat server running on http://localhost:${PORT}`);
  console.log(`📦 Firebase project connected`);
  console.log(`🔌 Socket.io ready for connections\n`);
});
