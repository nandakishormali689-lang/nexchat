importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBPrMMQ8hJwmyNtA1JaDHvJGtPOHcE9SLs",
  authDomain: "naxchat-abe49.firebaseapp.com",
  projectId: "naxchat-abe49",
  storageBucket: "naxchat-abe49.firebasestorage.app",
  messagingSenderId: "411561104766",
  appId: "1:411561104766:web:825099be07c1093b2ecf2f"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'New Message';
  const body = payload.notification?.body || 'You have a new message';
  self.registration.showNotification(title, {
    body,
    icon: 'https://naxchat-abe49.web.app/icon.png',
    badge: 'https://naxchat-abe49.web.app/icon.png',
    vibrate: [200, 100, 200],
    data: payload.data,
    actions: [{ action: 'open', title: 'Open Chat' }]
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('naxchat-abe49.web.app') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('https://naxchat-abe49.web.app');
    })
  );
});
