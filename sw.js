'use strict';

const CACHE_NAME = 'tomato-time-static-v8';
const APP_SHELL = [
  '/',
  '/index.html',
  '/25-5/',
  '/50-10/',
  '/52-17/',
  '/90-20/',
  '/404.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/fonts/figtree-latin.woff2',
  '/icons/favicon.svg',
  '/icons/favicon-focus.svg',
  '/icons/favicon-break.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/og-image.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('tomato-time-static-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      return cached || caches.match('/index.html');
    }));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    });
  }));
});
