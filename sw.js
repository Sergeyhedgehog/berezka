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

// Показ уведомлений от app.js
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

// Клик по уведомлению — открываем приложение
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(function(clients) {
            for (var i = 0; i < clients.length; i++) {
                if ('focus' in clients[i]) return clients[i].focus();
            }
            return self.clients.openWindow('./');
        })
    );
});
