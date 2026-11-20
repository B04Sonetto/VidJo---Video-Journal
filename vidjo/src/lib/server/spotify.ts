import type { Cookies } from '@sveltejs/kit';

const env = process.env as Record<string, string | undefined>;
const dev = process.env.NODE_ENV !== 'production';

export const SPOTIFY_SCOPES = [
	'streaming',
	'user-read-email',
	'user-read-private',
	'user-read-playback-state',
	'user-modify-playback-state'
].join(' ');

export const COOKIE_STATE = 'vidjo_spotify_state';
export const COOKIE_VERIFIER = 'vidjo_spotify_verifier';
export const COOKIE_REFRESH = 'vidjo_spotify_refresh';
export const COOKIE_RETURN = 'vidjo_spotify_return';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const STATE_TTL_SECONDS = 10 * 60;

function base64url(bytes: Uint8Array) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value: string) {
	const padded =
		value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function randomBytes(size: number) {
	const bytes = new Uint8Array(size);
	crypto.getRandomValues(bytes);
	return bytes;
}

export function spotifyConfigured() {
	return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

function originOf(value: string) {
	try {
		return new URL(value).origin;
	} catch {
		return '';
	}
}

export function getRedirectUri(origin: string) {
	const configured = (env.SPOTIFY_REDIRECT_URI || '').trim();
	const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);

	// Local development must use the registered local callback even if a
	// production redirect URI is configured in env.
	if (isLocal) return `${origin}/auth/spotify/callback`;
	// The OAuth state cookie and the Supabase session both live on the origin the
	// person started from, so the callback has to land on that same origin. A
	// configured URI for a different host would drop them on a site where they are
	// signed out, which looked like being bounced back to the sign-in screen.
	if (configured && originOf(configured) === origin) return configured;
	if (origin === 'https://vidjo.vercel.app')
		return 'https://vidjo.vercel.app/auth/spotify/callback';
	return `${origin}/auth/spotify/callback`;
}

/** Only allow same-origin paths as a post-login destination. */
export function safeReturnTo(value: string | null | undefined) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	try {
		const parsed = new URL(value, 'http://vidjo.local');
		if (parsed.origin !== 'http://vidjo.local') return '/';
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '/';
	}
}

/**
 * Only hand a refresh token back to origins we know are ours. Host headers can
 * be spoofed, so `url.origin` alone is not enough to trust a cross-origin
 * handoff. Add extra preview/custom domains to SPOTIFY_APP_ORIGINS.
 */
export function trustedAppOrigin(origin: string) {
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		const value = parsed.origin;

		if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) return true;

		const configured = (env.SPOTIFY_REDIRECT_URI || '').trim();
		if (configured) {
			try {
				if (new URL(configured).origin === value) return true;
			} catch {
				// ignore a bad configured URI
			}
		}

		const vercelUrl = (env.VERCEL_URL || '').trim();
		if (vercelUrl && value === `https://${vercelUrl}`) return true;

		const productionUrl = (env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
		if (productionUrl && value === `https://${productionUrl}`) return true;

		return (env.SPOTIFY_APP_ORIGINS || '')
			.split(',')
			.map((item) => item.trim().replace(/\/$/, ''))
			.filter(Boolean)
			.includes(value);
	} catch {
		return false;
	}
}

/** Append/overwrite one query parameter on a validated local path. */
export function withQuery(target: string, key: string, value: string) {
	const parsed = new URL(safeReturnTo(target), 'http://vidjo.local');
	parsed.searchParams.set(key, value);
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function hmac(value: string) {
	const secret = env.SPOTIFY_CLIENT_SECRET || env.SPOTIFY_CLIENT_ID || 'vidjo-spotify-state';
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

/**
 * The PKCE verifier and the exact redirect_uri travel inside a short-lived,
 * signed `state` value. Relying on cookies for these made the flow break when
 * the browser came back on a different origin (preview vs production, www vs
 * apex), when cookies were blocked, or when a second tab overwrote the single
 * cookie slot. Spotify echoes `state` back verbatim, so this is enough to bind
 * the callback to the original request without any browser storage.
 */
export async function createPkce(redirectUri: string, returnTo = '/', origin = '') {
	const verifier = base64url(randomBytes(32));
	const data = new TextEncoder().encode(verifier);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const challenge = base64url(new Uint8Array(hash));
	const nonce = base64url(randomBytes(16));
	const payload = base64url(
		new TextEncoder().encode(
			JSON.stringify({
				v: verifier,
				r: redirectUri,
				b: safeReturnTo(returnTo),
				o: origin,
				t: Math.floor(Date.now() / 1000),
				n: nonce
			})
		)
	);
	const signature = base64url(await hmac(payload));
	return { verifier, challenge, state: `${payload}.${signature}` };
}

/** Verify and unpack a state value created by `createPkce`. */
export async function readState(state: string) {
	const dot = state.lastIndexOf('.');
	if (dot <= 0) return null;

	const payload = state.slice(0, dot);
	const signature = state.slice(dot + 1);
	const expected = base64url(await hmac(payload));
	if (signature.length !== expected.length) return null;

	// Constant-time-ish comparison.
	let difference = 0;
	for (let i = 0; i < signature.length; i++)
		difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
	if (difference !== 0) return null;

	try {
		const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
			v?: unknown;
			r?: unknown;
			b?: unknown;
			o?: unknown;
			t?: unknown;
		};
		if (
			typeof parsed?.v !== 'string' ||
			typeof parsed?.r !== 'string' ||
			typeof parsed?.t !== 'number'
		) {
			return null;
		}
		let origin = '';
		if (typeof parsed.o === 'string' && parsed.o) {
			const parsedOrigin = new URL(parsed.o);
			if (
				(parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') ||
				parsedOrigin.origin !== parsed.o
			) {
				return null;
			}
			// The origin was allowlisted when this signed state was created.
			// Rechecking against this deployment's env would reject Vercel previews.
			origin = parsedOrigin.origin;
		}
		const age = Math.abs(Date.now() / 1000 - parsed.t);
		if (!Number.isFinite(age) || age > STATE_TTL_SECONDS) return null;
		return {
			verifier: parsed.v,
			redirectUri: parsed.r,
			returnTo: typeof parsed.b === 'string' ? safeReturnTo(parsed.b) : '/',
			origin
		};
	} catch {
		return null;
	}
}

async function tokenKey() {
	const secret = env.SPOTIFY_CLIENT_SECRET || env.SPOTIFY_CLIENT_ID || 'vidjo-spotify-state';
	const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt the refresh token for a one-hop handoff back to the origin the user
 * started from. Signing would not be enough: the token itself must not appear
 * in a URL in readable form.
 */
export async function sealToken(value: string) {
	const iv = randomBytes(12);
	const key = await tokenKey();
	const encrypted = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
	);
	const packed = new Uint8Array(iv.length + encrypted.length);
	packed.set(iv, 0);
	packed.set(encrypted, iv.length);
	return base64url(packed);
}

export async function unsealToken(value: string) {
	try {
		const packed = fromBase64url(value);
		if (packed.length <= 12) return '';
		const key = await tokenKey();
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: packed.slice(0, 12) },
			key,
			packed.slice(12)
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		return '';
	}
}

export function cookieOpts(maxAge?: number, secure = !dev) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		...(maxAge ? { maxAge } : {})
	};
}

export function authorizeUrl(origin: string, state: string, challenge: string) {
	const params = new URLSearchParams({
		client_id: env.SPOTIFY_CLIENT_ID || '',
		response_type: 'code',
		redirect_uri: getRedirectUri(origin),
		scope: SPOTIFY_SCOPES,
		state,
		code_challenge_method: 'S256',
		code_challenge: challenge,
		show_dialog: 'false'
	});
	return `${ACCOUNTS}/authorize?${params.toString()}`;
}

function basicAuth() {
	const id = env.SPOTIFY_CLIENT_ID || '';
	const secret = env.SPOTIFY_CLIENT_SECRET || '';
	const bytes = new TextEncoder().encode(`${id}:${secret}`);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return `Basic ${btoa(binary)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function errorMessage(data: unknown, fallback: string) {
	const rec = asRecord(data);
	if (!rec) return fallback;
	if (typeof rec.error_description === 'string') return rec.error_description;
	if (typeof rec.error === 'string') return rec.error;
	const err = asRecord(rec.error);
	if (err && typeof err.message === 'string') return err.message;
	return fallback;
}

export async function exchangeCode(redirectUri: string, code: string, verifier: string) {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier
	});

	const res = await fetch(`${ACCOUNTS}/api/token`, {
		method: 'POST',
		headers: {
			Authorization: basicAuth(),
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(errorMessage(data, 'Could not connect Spotify.'));
	}

	return data as {
		access_token: string;
		token_type: string;
		scope: string;
		expires_in: number;
		refresh_token?: string;
	};
}

export async function refreshAccessToken(refreshToken: string) {
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: refreshToken
	});

	const res = await fetch(`${ACCOUNTS}/api/token`, {
		method: 'POST',
		headers: {
			Authorization: basicAuth(),
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(errorMessage(data, 'Could not refresh Spotify session.'));
	}

	return data as {
		access_token: string;
		token_type: string;
		scope?: string;
		expires_in: number;
		refresh_token?: string;
	};
}

export function getRefreshToken(cookies: Cookies) {
	return cookies.get(COOKIE_REFRESH) || '';
}

export async function getAccessToken(cookies: Cookies) {
	const refreshToken = getRefreshToken(cookies);
	if (!refreshToken) return null;

	const data = await refreshAccessToken(refreshToken);
	if (data.refresh_token) {
		cookies.set(COOKIE_REFRESH, data.refresh_token, cookieOpts(60 * 60 * 24 * 365));
	}
	return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function spotifyApi(path: string, accessToken: string, init: RequestInit = {}) {
	return fetch(`${API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...(init.headers || {})
		}
	});
}
