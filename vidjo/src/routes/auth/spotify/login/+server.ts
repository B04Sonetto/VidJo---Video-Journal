import { isRedirect, redirect, type RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_RETURN,
	COOKIE_STATE,
	COOKIE_VERIFIER,
	authorizeUrl,
	cookieOpts,
	createPkce,
	getRedirectUri,
	safeReturnTo,
	spotifyConfigured,
	trustedAppOrigin,
	withQuery
} from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
	const secure = url.protocol === 'https:';

	try {
		if (!spotifyConfigured()) {
			throw redirect(303, withQuery(returnTo, 'spotify_error', 'not_configured'));
		}

		const redirectUri = getRedirectUri(url.origin);
		// Carry the destination in the signed state as well as a cookie. The
		// callback can land on the configured production origin even when the
		// user started on a preview/custom domain, where that cookie is absent.
		const appOrigin = trustedAppOrigin(url.origin) ? url.origin : '';
		const { verifier, challenge, state } = await createPkce(redirectUri, returnTo, appOrigin);
		const opts = cookieOpts(60 * 10, secure);
		cookies.set(COOKIE_STATE, state, opts);
		cookies.set(COOKIE_VERIFIER, verifier, opts);
		cookies.set(COOKIE_RETURN, returnTo, opts);

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
		throw redirect(303, withQuery(returnTo, 'spotify_error', message));
	}
};
