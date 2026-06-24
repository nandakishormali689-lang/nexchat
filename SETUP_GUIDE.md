# NexChat — Complete Setup Guide
### Node.js + Socket.io + Firebase · Real-time chat across the internet

---

## How it works

```
User A (Browser)                 Your Server                  User B (Browser)
      |                         (Node.js + Socket.io)               |
      |── send_message ────────►|                                    |
      |                         |── saves to Firestore (DB)          |
      |                         |── new_message event ──────────────►|
      |                         |                                    |
      |◄── new_message ─────────|  (if A is also in the room)        |
```

Firebase handles:  **Auth** (login/register) + **Firestore** (message storage)
Your server handles: **Socket.io** (real-time delivery between users)

---

## STEP 1 — Create a Firebase Project (free)

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it "nexchat" → click through
3. In the left menu, click **Authentication** → **Get started**
   - Enable **Email/Password**
   - Enable **Google** (optional but recommended)
4. In the left menu, click **Firestore Database** → **Create database**
   - Choose **Start in test mode** (allows read/write for 30 days)
   - Pick any region near your users
5. Click the **gear icon** → **Project settings** → **Service accounts** tab
   - Click **Generate new private key** → it downloads `serviceAccountKey.json`
   - **Place this file in your project root** (same folder as `server.js`)
   - ⚠️ Never commit this file to GitHub — it's your master key!

---

## STEP 2 — Get your Firebase Web Config

1. In Firebase Console → Project Settings → scroll down to **Your apps**
2. Click **Add app** → Web (</>) → register it
3. Copy the `firebaseConfig` object shown
4. Open `public/index.html` and **replace** the placeholder config at the top:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",      // ← paste yours here
  authDomain:        "nexchat-abc.firebaseapp.com",
  projectId:         "nexchat-abc",
  storageBucket:     "nexchat-abc.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc",
};
```

---

## STEP 3 — Install and run the server locally

```bash
# Make sure Node.js 18+ is installed: https://nodejs.org

cd nexchat
npm install          # installs express, socket.io, firebase-admin

node server.js       # starts the server on http://localhost:3000
```

Open `http://localhost:3000` in your browser — the app should load.
Open it in a second browser window, register a second account, and chat!

For development with auto-restart on changes:
```bash
npm run dev          # uses nodemon
```

---

## STEP 4 — Add Firestore indexes (required for message queries)

The message query uses `roomId` + `timestamp` together. Firestore needs a
composite index for this. When you first send a message, check the server
console — it will print a direct link to create the index. Click it and wait
~1 minute for it to build.

Or create it manually:
- Firestore → Indexes → Composite → Add index
  - Collection: `messages`
  - Field 1: `roomId` (Ascending)
  - Field 2: `timestamp` (Ascending)

---

## STEP 5 — Deploy the server to Railway (free tier, 5 minutes)

Railway is the fastest way to put your Node server online for free.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init          # choose "Empty project", name it "nexchat"
railway up            # uploads your code and deploys it
```

Then in the Railway dashboard:
1. Go to your project → **Variables** tab
2. No extra env vars needed (Firebase config is from `serviceAccountKey.json`)
3. Copy your deployment URL, e.g. `https://nexchat-production.up.railway.app`

**IMPORTANT:** Open `public/index.html` and update `SERVER_URL`:
```js
const SERVER_URL = "https://nexchat-production.up.railway.app";
```

Then redeploy: `railway up`

---

## STEP 6 — Set Firestore security rules (before going public)

Replace the default test-mode rules with these in Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only read user profiles, not write directly
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid;
    }

    // Messages: only sender or recipient can read/write
    match /messages/{msgId} {
      allow read: if request.auth != null &&
        (request.auth.uid == resource.data.fromUid ||
         request.auth.uid == resource.data.toUid);
      allow create: if request.auth != null &&
        request.auth.uid == request.resource.data.fromUid;
    }
  }
}
```

---

## Project structure

```
nexchat/
├── server.js              ← Node.js + Socket.io backend
├── package.json           ← dependencies
├── serviceAccountKey.json ← Firebase Admin key (DO NOT COMMIT)
├── .gitignore             ← should include serviceAccountKey.json
├── SETUP_GUIDE.md         ← this file
└── public/
    └── index.html         ← full frontend (HTML + CSS + JS)
```

---

## Add a .gitignore before pushing to GitHub

```
node_modules/
serviceAccountKey.json
.env
```

---

## What's included in this app

| Feature | How it works |
|---|---|
| Email/password registration | Firebase Authentication |
| Google sign-in | Firebase Authentication |
| Real-time message delivery | Socket.io over WebSockets |
| Message history | Stored in Firestore, loaded on chat open |
| Online/offline status | Socket.io presence tracking |
| Typing indicator | Socket.io `typing` event |
| New message notification | Socket.io `notification` event |
| Works from any device | Server deployed on Railway |

---

## Troubleshooting

**"Could not load users"** — server isn't running. Run `node server.js`.

**Messages not appearing** — check Firestore composite index (Step 4).

**Google sign-in blocked** — add your domain to Firebase → Authentication → Settings → Authorized domains.

**Socket not connecting on Railway** — Railway supports WebSockets natively. Make sure `SERVER_URL` in `index.html` uses `https://` not `http://`.
