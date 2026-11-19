import { redirect, type RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_STATE,
	COOKIE_VERIFIER,
	authorizeUrl,
	cookieOpts,
	createPkce,
	spotifyConfigured
} from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!spotifyConfigured()) {
		throw redirect(303, '/?spotify_error=not_configured');
	}

	const { verifier, challenge, state } = createPkce();
	const opts = cookieOpts(60 * 10);
	cookies.set(COOKIE_STATE, state, opts);
	cookies.set(COOKIE_VERIFIER, verifier, opts);

	throw redirect(303, authorizeUrl(url.origin, state, challenge));
};
