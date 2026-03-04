const CACHE_NAME = 'dozup-admin-v2.9.3';
const urlsToCache = [
    '/app/',
    '/app/index.html',
    '/app/manifest.json',
    '/app/cha-ching.mp3',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

// Install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch
self.addEventListener('fetch', event => {
    // Network first for API calls
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Cache first for static assets
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// Push Notifications
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};

    const options = {
        body: data.body || 'New order received!',
        icon: '/app/icon-192.png',
        badge: '/app/icon-192.png',
        vibrate: [100, 50, 100, 50, 200],
        data: data,
        actions: [
            { action: 'view', title: 'View Order' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        tag: 'order-notification',
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'DOZ UP - New Sale!', options)
    );
});

// Notification click
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.openWindow('/app/')
        );
    }
});
