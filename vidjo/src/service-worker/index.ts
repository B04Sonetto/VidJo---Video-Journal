import { dev, version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

/**
 * VidJo's service worker keeps the app shell and build assets available
 * offline. Supabase requests (API, auth and signed video URLs) are never
 * intercepted here: they are cross-origin, personal, and much too large to
 * cache safely on iOS.
 */

const CACHE_PREFIX = 'vidjo-';
const CACHE_NAME = `${CACHE_PREFIX}${version}`;
const OFFLINE_URL = '/offline.html';
const NAVIGATION_TIMEOUT = 4500;

function withLeadingSlash(path: string) {
	return path.startsWith('/') ? path : `/${path}`;
}

/** Paths precached during install, relative to the deployment base. */
const PRECACHE_PATHS = new Set<string>(
	[
		'/',
		OFFLINE_URL,
		...immutable.map((entry) => entry.path),
		...assets.map((entry) => entry.path),
		...prerendered.map((entry) => entry.path)
	].map(withLeadingSlash)
);

function absolute(path: string) {
	return new URL(path, self.location.origin).href;
}

function isStorable(response: Response) {
	return response.ok && response.type === 'basic' && !response.redirected;
}

async function precache() {
	const cache = await caches.open(CACHE_NAME);

	// One failed file (a removed icon, a flaky request) must not abort the
	// whole install, otherwise the app never becomes installable.
	await Promise.allSettled(
		[...PRECACHE_PATHS].map(async (path) => {
			const request = new Request(absolute(path), { cache: 'reload' });
			const response = await fetch(request);
			if (isStorable(response)) await cache.put(request, response);
		})
	);
}

/** Prefer the network for documents so new deployments are picked up, but fall back to the cached shell. */
async function handleNavigation(request: Request) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT);

	try {
		return await fetch(request, { signal: controller.signal });
	} catch {
		const cache = await caches.open(CACHE_NAME);
		const shell = await cache.match(absolute('/'));
		if (shell) return shell;

		const offline = await cache.match(absolute(OFFLINE_URL));
		if (offline) return offline;

		return new Response('You are offline and this page is not available yet.', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	} finally {
		clearTimeout(timer);
	}
}

async function cacheFirst(request: Request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (isStorable(response)) await cache.put(request, response.clone());
	return response;
}

self.addEventListener('install', (event) => {
	// Development serves unhashed modules straight from Vite. Caching those
	// would pin stale code between edits, so the dev worker stays passive.
	if (dev) return;
	event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			);

			// Take control immediately after the first install and after a
			// user-approved update, so the offline shell is usable right away.
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	if (dev) return;

	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Supabase, Google Fonts, Sentry and every other cross-origin request
	// pass straight through. That includes personal API responses and videos.
	if (url.origin !== self.location.origin) return;

	// Never serve a stale worker or version manifest from the cache.
	if (url.pathname.endsWith('/service-worker.js') || url.pathname.endsWith('/version.json')) return;

	// Range requests are partial video responses; storing them would corrupt playback.
	if (request.headers.has('range')) return;

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigation(request));
		return;
	}

	// Hashed build output and the static app shell are safe to serve from cache.
	if (PRECACHE_PATHS.has(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(cacheFirst(request));
	}
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
	if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
		void self.skipWaiting();
	}
});
