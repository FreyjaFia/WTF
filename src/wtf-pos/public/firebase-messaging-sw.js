/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBYe7fUeZHYX6efJE__4ST10D8z4Z-KXKw',
  authDomain: 'wtf-pos.firebaseapp.com',
  projectId: 'wtf-pos',
  storageBucket: 'wtf-pos.firebasestorage.app',
  messagingSenderId: '994532070723',
  appId: '1:994532070723:web:9e3c5a47de12df17d14bf6',
  measurementId: 'G-R02NBHHJQD',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  if (notification.title || notification.body) {
    // Let Firebase handle notification payloads to avoid double notifications.
    return;
  }

  const title = notification.title || 'WTF POS';
  const options = {
    body: notification.body,
    icon: notification.icon || 'assets/images/icon-192.png',
    data: payload.data || {},
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const path = data.path || (data.orderId ? `/orders/editor/${data.orderId}` : '/orders/list');
  const targetUrl = new URL(path, self.location.origin).toString();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    }),
  );
});
