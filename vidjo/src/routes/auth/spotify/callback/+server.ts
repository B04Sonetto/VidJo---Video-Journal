import { redirect, type RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_REFRESH,
	COOKIE_STATE,
	COOKIE_VERIFIER,
	cookieOpts,
	exchangeCode,
	spotifyConfigured
} from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!spotifyConfigured()) {
		throw redirect(303, '/?spotify_error=not_configured');
	}

	const error = url.searchParams.get('error');
	if (error) {
		throw redirect(303, `/?spotify_error=${encodeURIComponent(error)}`);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get(COOKIE_STATE);
	const verifier = cookies.get(COOKIE_VERIFIER);

	cookies.delete(COOKIE_STATE, { path: '/' });
	cookies.delete(COOKIE_VERIFIER, { path: '/' });

	if (!code || !state || !verifier || state !== storedState) {
		throw redirect(303, '/?spotify_error=invalid_state');
	}

	try {
		const tokens = await exchangeCode(url.origin, code, verifier);
		if (tokens.refresh_token) {
			cookies.set(COOKIE_REFRESH, tokens.refresh_token, cookieOpts(60 * 60 * 24 * 365));
		}
		throw redirect(303, '/?spotify=connected');
	} catch (err) {
		if (
			err &&
			typeof err === 'object' &&
			'status' in err &&
			(err as { status: number }).status === 303
		) {
			throw err;
		}
		const message = err instanceof Error ? err.message : 'connect_failed';
		throw redirect(303, `/?spotify_error=${encodeURIComponent(message)}`);
	}
};
