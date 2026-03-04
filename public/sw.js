/**
 * DOZ UP - Service Worker
 * Provides offline support and caching for the user-facing app
 */

const CACHE_VERSION = 'v2.9.12';
const CACHE_NAME = `dozup-${CACHE_VERSION}`;
const STATIC_CACHE = `dozup-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `dozup-images-${CACHE_VERSION}`;

// Core assets to cache for offline use
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/mobile.html',
    '/manifest.json',
    '/app/icon-192.png',
    '/app/icon-512.png'
];

// Assets to cache on first use
const RUNTIME_CACHE = [
    '/annotate.html',
    '/collage.html',
    '/gallery.html',
    '/studio.html',
    '/my-account.html',
    '/v2/pricing.html',
    '/v2/dashboard.html'
];

// Install - cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching core assets');
                return cache.addAll(CORE_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch(err => console.error('[SW] Install failed:', err))
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name.startsWith('dozup-') && name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip cross-origin requests except fonts
    if (url.origin !== location.origin && !url.hostname.includes('fonts.googleapis.com')) {
        return;
    }

    // API calls - network first, mirror fallback, then offline response
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/upload')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    // Primary failed - try mirror server
                    const mirrorUrl = 'https://up.doz.com.im' + url.pathname + url.search;
                    return fetch(mirrorUrl, {
                        method: event.request.method,
                        headers: event.request.headers,
                        mode: 'cors'
                    }).catch(() => new Response(JSON.stringify({
                        error: 'offline',
                        message: 'Both servers unreachable. Please check your connection.'
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    }));
                })
        );
        return;
    }

    // Images - cache first, then network
    if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/i/')) {
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        if (response.ok) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    });
                })
        );
        return;
    }

    // HTML pages - network first with cache fallback
    if (event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Static assets - cache first, then network
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
    );
});

// Handle share target (receiving shared images)
self.addEventListener('fetch', event => {
    if (event.request.url.endsWith('/share') && event.request.method === 'POST') {
        event.respondWith(
            (async () => {
                const formData = await event.request.formData();
                const image = formData.get('image');

                // Store image temporarily and redirect to upload page
                const client = await self.clients.get(event.clientId);
                if (client) {
                    client.postMessage({
                        type: 'SHARE_IMAGE',
                        image: image
                    });
                }

                return Response.redirect('/?shared=true', 303);
            })()
        );
    }
});

// Background sync for offline uploads
self.addEventListener('sync', event => {
    if (event.tag === 'upload-queue') {
        event.waitUntil(processUploadQueue());
    }
});

async function processUploadQueue() {
    // Get queued uploads from IndexedDB and retry them
    console.log('[SW] Processing upload queue');
}

// Push notifications
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};

    const options = {
        body: data.body || 'Your image has been uploaded!',
        icon: '/app/icon-192.png',
        badge: '/app/icon-192.png',
        vibrate: [100, 50, 100],
        data: data,
        actions: [
            { action: 'view', title: 'View Image' },
            { action: 'copy', title: 'Copy Link' }
        ],
        tag: 'upload-notification'
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'DOZ UP', options)
    );
});

// Notification click handling
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const data = event.notification.data;

    if (event.action === 'copy' && data?.url) {
        // Copy link to clipboard via client
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clients => {
                if (clients.length > 0) {
                    clients[0].postMessage({
                        type: 'COPY_LINK',
                        url: data.url
                    });
                }
            })
        );
    } else if (event.action === 'view' || !event.action) {
        const url = data?.url || '/';
        event.waitUntil(
            clients.openWindow(url)
        );
    }
});

console.log('[SW] DOZ UP Service Worker loaded');
