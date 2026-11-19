import type { Cookies } from '@sveltejs/kit';
import { createHash, randomBytes } from 'node:crypto';

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

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

function base64url(buffer: Buffer) {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function spotifyConfigured() {
	return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export function getRedirectUri(origin: string) {
	const configured = (env.SPOTIFY_REDIRECT_URI || '').trim();
	const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);

	// Local development must use the registered local callback even if a
	// production redirect URI is configured in env.
	if (isLocal) return `${origin}/auth/spotify/callback`;
	if (configured) return configured;
	if (origin === 'https://vidjo.vercel.app')
		return 'https://vidjo.vercel.app/auth/spotify/callback';
	return `${origin}/auth/spotify/callback`;
}

export function createPkce() {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash('sha256').update(verifier).digest());
	const state = base64url(randomBytes(16));
	return { verifier, challenge, state };
}

export function cookieOpts(maxAge?: number) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: !dev,
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
	return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
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

export async function exchangeCode(origin: string, code: string, verifier: string) {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: getRedirectUri(origin),
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
