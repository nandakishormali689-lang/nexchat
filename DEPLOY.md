# NexChat — Full Deployment Guide

This app uses **Node.js + Socket.io** (backend) + **Firebase Firestore** (database) + **Render** (free hosting).
Once deployed, anyone on the internet can register and chat in real time.

---

## STEP 1 — Set Up Firebase (Database)

1. Go to https://console.firebase.google.com
2. Click **"Add project"** → name it `nexchat` → click through setup
3. In the left sidebar: **Build → Firestore Database**
4. Click **"Create database"** → choose **"Start in production mode"** → pick a region → Done

### Get your Firebase credentials:
5. Click the ⚙️ gear icon → **"Project settings"**
6. Go to **"Service accounts"** tab
7. Click **"Generate new private key"** → download the JSON file
8. Open that JSON file — you'll paste it into `.env` in Step 3

### Set Firestore rules (allow authenticated server access):
The server uses the Admin SDK so no extra rules needed. Keep defaults.

---

## STEP 2 — Prepare Your Code

```bash
# Clone or download this project, then:
cd nexchat/server
cp .env.example .env
```

Open `.env` and fill in:

```env
JWT_SECRET=paste_a_long_random_string_here
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}
```

For `FIREBASE_SERVICE_ACCOUNT`: open the JSON file from Step 1,
**paste the entire contents on one line** as the value.

For `JWT_SECRET`: run this in your terminal to generate one:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## STEP 3 — Deploy to Render (Free Hosting)

Render gives you a free Node.js server that stays online.

1. Push your project to GitHub (create a repo, push the `nexchat/` folder)
2. Go to https://render.com → Sign up (free)
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repo
5. Configure:
   - **Name**: nexchat-server
   - **Root Directory**: `server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
6. Click **"Advanced"** → **"Add Environment Variables"**
   Add: `JWT_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `NODE_ENV=production`
7. Click **"Create Web Service"**

Render will build and deploy. You'll get a URL like:
`https://nexchat-server-xxxx.onrender.com`

---

## STEP 4 — Connect the Frontend

Open `public/js/app.js` and update line 4:

```javascript
// Change this:
const SERVER_URL = window.location.origin;

// To your Render URL:
const SERVER_URL = 'https://nexchat-server-xxxx.onrender.com';
```

---

## STEP 5 — Host the Frontend (Firebase Hosting — Free)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Select your project
# Public directory: nexchat/public
# Single page app: No

firebase deploy
```

Firebase will give you a URL like: `https://nexchat-xxxxx.web.app`

**That's your live chat app!** Share the URL with anyone — they can register
and chat with each other from anywhere in the world.

---

## Architecture Overview

```
User A (Browser)                    User B (Browser)
     │                                    │
     │  WebSocket (Socket.io)             │  WebSocket (Socket.io)
     ▼                                    ▼
┌─────────────────────────────────────────────────┐
│          Node.js Server (Render)                │
│  ┌─────────────┐    ┌──────────────────────┐   │
│  │  REST API   │    │    Socket.io          │   │
│  │  /register  │    │  - auth               │   │
│  │  /login     │    │  - message (emit)     │   │
│  │  /users     │    │  - presence           │   │
│  │  /messages  │    │  - typing indicator   │   │
│  └─────────────┘    └──────────────────────┘   │
└─────────────────────────────┬───────────────────┘
                              │  Firebase Admin SDK
                              ▼
              ┌───────────────────────────┐
              │    Firebase Firestore     │
              │  collections:             │
              │  - users/{username}       │
              │  - messages/{auto-id}     │
              └───────────────────────────┘
```

## Message Flow (real-time)

1. User A types and presses Enter
2. Browser emits `socket.emit('message', { to: 'userB', text: '...' })`
3. Server receives it, saves to Firestore, gets back an ID
4. Server does `io.to(room).emit('message', fullMsg)` — pushes to both users
5. User B's browser receives the event and renders it instantly

## Notes

- Messages are **permanently stored** in Firestore — they persist across sessions
- Free Render servers sleep after 15 min inactivity (first message may take ~30s to wake)
  → Upgrade to Render Starter ($7/mo) for always-on
- Firebase Firestore free tier: 50,000 reads/day, 20,000 writes/day — plenty for personal use
- For more users, add message pagination (the server already limits to 200 per conversation)
