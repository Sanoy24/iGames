// Custom service worker (injectManifest strategy  see vite.config.ts).
//
// This exists for exactly one reason: when the network is unreachable (no
// internet, DNS failure, server down  see DECISIONS.md), the BROWSER's own
// native error page renders instead of anything we control, and that native
// page prints the raw backend/frontend domain to the user. A service worker
// is the only mechanism that can intercept a failed navigation and substitute
// our own branded "check your connection" page (public/offline.html) instead.
//
// Deliberately narrow scope: this does NOT cache the live app shell or any
// API responses. iGames is a real-money, real-time app (live balances,
// sockets)  silently serving a stale cached version while offline would be
// actively misleading, not helpful. The offline fallback only ever says
// "you're offline, retry"  it never pretends to be a working app.
//
// Also note the fundamental limit this can't get around: a service worker
// only exists after it has successfully installed once, which requires an
// initial successful page load. A user's very first-ever visit with zero
// connectivity will still show the browser's native error  nothing running
// on the page yet can intercept that.
import { precacheAndRoute } from 'workbox-precaching';
import { offlineFallback } from 'workbox-recipes';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Injected at build time by vite-plugin-pwa (injectManifest strategy)  just
// the offline page itself, not the app bundle (see scope note above).
precacheAndRoute(self.__WB_MANIFEST);

offlineFallback();

// Take over immediately on activation instead of waiting for every open tab
// to close  the only thing this service worker does is the offline
// fallback, so there's no risk in an in-flight session picking it up right away.
self.skipWaiting();
clientsClaim();
