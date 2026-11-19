import { isRedirect, redirect, type RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_STATE,
	COOKIE_VERIFIER,
	authorizeUrl,
	cookieOpts,
	createPkce,
	spotifyConfigured
} from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	try {
		if (!spotifyConfigured()) {
			throw redirect(303, '/?spotify_error=not_configured');
		}

		const { verifier, challenge, state } = await createPkce();
		const opts = cookieOpts(60 * 10);
		cookies.set(COOKIE_STATE, state, opts);
		cookies.set(COOKIE_VERIFIER, verifier, opts);

		// Redirect to Spotify's authorize endpoint. Use a raw Response for the
		// external Location to avoid SvelteKit's redirect_external_not_allowed.
		return new Response(null, {
			status: 303,
			headers: {
				Location: authorizeUrl(url.origin, state, challenge)
			}
		});
	} catch (err) {
		if (isRedirect(err)) throw err;
		const message = err instanceof Error ? err.message : 'Could not start Spotify sign-in.';
		throw redirect(303, `/?spotify_error=${encodeURIComponent(message)}`);
	}
};
