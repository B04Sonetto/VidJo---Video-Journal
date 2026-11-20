import type { RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_REFRESH,
	COOKIE_RETURN,
	COOKIE_STATE,
	COOKIE_VERIFIER,
	cookieOpts,
	exchangeCode,
	getRedirectUri,
	readState,
	sealToken,
	safeReturnTo,
	spotifyConfigured,
	withQuery
} from '#lib/server/spotify';

function out(location: string) {
	return new Response(null, {
		status: 303,
		headers: {
			Location: location,
			'Referrer-Policy': 'no-referrer'
		}
	});
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const secure = url.protocol === 'https:';
	const cookieReturn = safeReturnTo(cookies.get(COOKIE_RETURN));
	let returnTo = cookieReturn;

	try {
		if (!spotifyConfigured()) {
			return out(withQuery(returnTo, 'spotify_error', 'not_configured'));
		}

		const error = url.searchParams.get('error');
		if (error) return out(withQuery(returnTo, 'spotify_error', error));

		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		// The signed state carries the verifier, exact redirect_uri and the page
		// the user started from. Cookies are only a fallback for authorizations
		// started by an older deployment.
		const signed = state ? await readState(state) : null;
		returnTo = signed?.returnTo || cookieReturn;
		const storedState = cookies.get(COOKIE_STATE);
		const verifier = signed?.verifier || cookies.get(COOKIE_VERIFIER);
		const stateMatches = Boolean(signed) || Boolean(state && state === storedState);

		if (!code || !state || !verifier || !stateMatches) {
			return out(withQuery(returnTo, 'spotify_error', 'invalid_state'));
		}

		cookies.delete(COOKIE_STATE, { path: '/' });
		cookies.delete(COOKIE_VERIFIER, { path: '/' });
		cookies.delete(COOKIE_RETURN, { path: '/' });

		const tokens = await exchangeCode(
			signed?.redirectUri || getRedirectUri(url.origin),
			code,
			verifier
		);

		// When Spotify used a configured production callback but the user is on
		// another trusted origin, hand the refresh token back to that origin so
		// the player is connected in the tab the user actually came from.
		const appOrigin = signed?.origin;
		if (appOrigin && appOrigin !== url.origin) {
			const handoff = new URL('/auth/spotify/session', appOrigin);
			handoff.searchParams.set('returnTo', returnTo);
			if (tokens.refresh_token) {
				handoff.searchParams.set('spotify_session', await sealToken(tokens.refresh_token));
			}
			return out(handoff.toString());
		}

		if (tokens.refresh_token) {
			cookies.set(COOKIE_REFRESH, tokens.refresh_token, cookieOpts(60 * 60 * 24 * 365, secure));
		}
		return out(withQuery(returnTo, 'spotify', 'connected'));
	} catch (err) {
		const message = err instanceof Error ? err.message : 'connect_failed';
		return out(withQuery(returnTo, 'spotify_error', message));
	}
};
