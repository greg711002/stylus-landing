/* Stylus AI — service worker.
 *
 * Goal: the landing page opens instantly on a repeat visit and still works
 * when the network is gone, on every locale page (English at / plus the
 * fifteen localized folders /pl/, /ru/, /zh/, /es/, /hi/, /pt/, /bn/, /fr/,
 * /de/, /ja/, /ar/, /ko/, /it/, /tr/, /id/).
 *
 * Strategy
 *   navigations  network-first  → always try the live server, fall back to the
 *                                cached copy of the same URL, then to offline.html
 *   static files cache-first    → CSS/JS/fonts/icons/images come from the cache
 *                                and are refreshed in the background
 *
 * Bump VERSION when shipping changed shell files: the new worker re-precaches
 * and the activate handler deletes every older cache.
 */
'use strict';

var VERSION = 'v6';
var CACHE_PREFIX = 'stylus-';
var CACHE_NAME = CACHE_PREFIX + VERSION;
var OFFLINE_URL = './offline.html';

/* App shell: everything needed to render every page without the network. */
var PRECACHE = [
  './',
  './index.html',
  './pl/',
  './pl/index.html',
  './ru/',
  './ru/index.html',
  './zh/',
  './zh/index.html',
  './es/',
  './es/index.html',
  './hi/',
  './hi/index.html',
  './pt/',
  './pt/index.html',
  './bn/',
  './bn/index.html',
  './fr/',
  './fr/index.html',
  './de/',
  './de/index.html',
  './ja/',
  './ja/index.html',
  './ar/',
  './ar/index.html',
  './ko/',
  './ko/index.html',
  './it/',
  './it/index.html',
  './tr/',
  './tr/index.html',
  './id/',
  './id/index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/main.js',
  './assets/fonts/Stolzl-Light.ttf',
  './assets/fonts/Stolzl-Regular.ttf',
  './assets/fonts/Stolzl-Medium.ttf',
  './assets/fonts/Stolzl-Bold.ttf',
  './assets/img/logo.png',
  './assets/img/logo-mark.svg',
  './assets/img/favicon.png',
  './assets/img/apple-touch-icon.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-maskable-192.png',
  './assets/img/icon-maskable-512.png',
  './assets/img/hero-app.webp',
  './assets/img/hero-app-1080.webp',
  './assets/img/feature-1.svg',
  './assets/img/feature-2.svg',
  './assets/img/feature-3.svg',
  './assets/img/wand-1.png',
  './assets/img/wand-2.png',
  './assets/img/wand-3.png',
  './assets/img/wand-4.png',
  './assets/img/avatar-1.png',
  './assets/img/avatar-2.png',
  './assets/img/avatar-3.png',
  './assets/img/avatar-4.png',
  './assets/img/avatar-5.png',
  './assets/img/avatar-6.png',
  './assets/img/avatar-7.png',
  './assets/img/avatar-8.png',
  './assets/img/avatar-9.png',
  './assets/img/avatar-10.png',
  './assets/img/avatar-11.png',
  './assets/img/team-1.png',
  './assets/img/team-2.png',
  './assets/img/team-3.png',
  './assets/img/team-4.png',
  './assets/img/team-5.png',
  './assets/img/uni-1.svg',
  './assets/img/uni-2.svg',
  './assets/img/uni-3.svg',
  './assets/img/uni-4.svg',
  './assets/img/uni-5.svg',
  './assets/img/uni-6.svg',
  './assets/img/pay-1.svg',
  './assets/img/pay-2.svg',
  './assets/img/pay-3.svg',
  './assets/img/pay-4.svg',
  './assets/img/pay-5.svg',
  './assets/img/pay-6.svg',
  './assets/img/rating-1.svg',
  './assets/img/rating-2.svg',
  './assets/img/social-x.svg',
  './assets/img/social-instagram.svg',
  './assets/img/social-facebook.svg',
  './assets/img/social-discord.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* addAll() rejects the whole install when a single file is missing, so
         each request is settled separately: a broken optional asset must not
         leave the site without any service worker at all. */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return null;
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

var isSameOrigin = function (url) {
  return new URL(url, self.location.href).origin === self.location.origin;
};

/* Network-first only makes sense for the documents themselves. */
var handleNavigation = function (event) {
  return fetch(event.request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(event.request, copy);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      return cached || caches.match(OFFLINE_URL);
    });
  });
};

/* Cache-first with a background refresh: fast paint, fresh content next visit. */
var handleAsset = function (event) {
  return caches.match(event.request).then(function (cached) {
    var network = fetch(event.request).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return cached;
    });

    return cached || network;
  });
};

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') return;
  if (!isSameOrigin(request.url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(handleAsset(event));
});
