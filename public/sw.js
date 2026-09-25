const CACHE_NAME = 'avento-core-v1';
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Pre-caching offline shell');
            return cache.addAll(PRECACHE_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[ServiceWorker] Clearing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass caching for realtime stream, websockets, and device control endpoints
    if (
        url.pathname.startsWith('/stream') ||
        url.pathname.startsWith('/capture') ||
        url.pathname.startsWith('/metrics') ||
        url.pathname.startsWith('/bot_action') ||
        url.pathname.startsWith('/servo') ||
        url.pathname.startsWith('/track') ||
        url.pathname.startsWith('/mic_audio') ||
        url.pathname.startsWith('/ws')
    ) {
        return; // Normal network request
    }

    // Cache-first for CDN libraries, fonts, and static assets
    if (
        url.hostname.includes('cdn') ||
        url.hostname.includes('cloudflare') ||
        url.hostname.includes('fonts') ||
        url.pathname.endsWith('.svg') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.js')
    ) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    // Update cache in background
                    fetch(event.request).then((networkResponse) => {
                        if (networkResponse.status === 200) {
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                        }
                    }).catch(() => {});
                    return cachedResponse;
                }
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Stale-While-Revalidate for HTML
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
