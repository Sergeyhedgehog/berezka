var CACHE_NAME = 'berezka-v1';
var URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './icon-192.png'
];

// Установка — кешируем основные файлы
self.addEventListener('install', function(event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(URLS_TO_CACHE);
        })
    );
});

// Активация — удаляем старые кеши
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.filter(function(n) { return n !== CACHE_NAME; })
                     .map(function(n) { return caches.delete(n); })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Fetch — сначала сеть, потом кеш (network-first)
self.addEventListener('fetch', function(event) {
    event.respondWith(
        fetch(event.request).then(function(response) {
            // Обновляем кеш свежей версией
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, clone);
            });
            return response;
        }).catch(function() {
            return caches.match(event.request);
        })
    );
});

// ─── Web Push (от push-сервера) ────────────────────────────────────────────────
// Срабатывает когда сервер отправил push через VAPID (iOS Safari PWA, Android Chrome)
self.addEventListener('push', function(event) {
    var data = {};
    try {
        if (event.data) data = event.data.json();
    } catch(e) {
        data = { title: 'Берёзка', body: event.data ? event.data.text() : '' };
    }

    var title   = data.title  || 'Берёзка';
    var options = {
        body:      data.body  || '',
        icon:      'icon-192.png',
        badge:     'icon-192.png',
        tag:       'berezka-push',
        renotify:  true,
        vibrate:   [100, 50, 100],
        data:      { url: data.url || './' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Показ уведомлений от app.js (внутренние) ──────────────────────────────────
self.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(event.data.title, {
            body: event.data.body,
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            tag: 'berezka-msg',
            renotify: true
        });
    }
});

// ─── Клик по уведомлению — открываем или фокусируем приложение ─────────────────
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if ('focus' in clients[i]) {
                    clients[i].focus();
                    return;
                }
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});
