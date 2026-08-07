// Custom service worker (injectManifest strategy — see vite.config.ts).
// Mirrors frontend/src/sw.ts exactly — see that file's comment for the full
// rationale. In short: the browser's native "can't reach this page" error
// leaks the raw domain name, and only a service worker can intercept a failed
// navigation to substitute our own branded offline page instead. Scoped to
// just that fallback — no app-shell or API caching, since this is a
// real-time app where a stale cached view would be misleading.
import { precacheAndRoute } from 'workbox-precaching';
import { offlineFallback } from 'workbox-recipes';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

offlineFallback();

self.skipWaiting();
clientsClaim();
