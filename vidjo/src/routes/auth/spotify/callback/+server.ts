import { isRedirect, redirect, type RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_REFRESH,
	COOKIE_RETURN,
	COOKIE_STATE,
	COOKIE_VERIFIER,
	cookieOpts,
	exchangeCode,
	getRedirectUri,
	readState,
	safeReturnTo,
	spotifyConfigured,
	withQuery
} from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const returnTo = safeReturnTo(cookies.get(COOKIE_RETURN));
	const secure = url.protocol === 'https:';

	try {
		if (!spotifyConfigured()) {
			throw redirect(303, withQuery(returnTo, 'spotify_error', 'not_configured'));
		}

		const error = url.searchParams.get('error');
		if (error) {
			throw redirect(303, withQuery(returnTo, 'spotify_error', error));
		}

		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		// The signed state carries the PKCE verifier and the exact redirect_uri
		// used at login, so verification survives cross-origin callbacks,
		// blocked cookies and extra tabs. Cookies remain as a fallback for
		// authorizations started by an older deployment.
		const signed = state ? await readState(state) : null;
		const storedState = cookies.get(COOKIE_STATE);
		const verifier = signed?.verifier || cookies.get(COOKIE_VERIFIER);
		const stateMatches = Boolean(signed) || Boolean(state && state === storedState);

		if (!code || !state || !verifier || !stateMatches) {
			throw redirect(303, withQuery(returnTo, 'spotify_error', 'invalid_state'));
		}

		cookies.delete(COOKIE_STATE, { path: '/' });
		cookies.delete(COOKIE_VERIFIER, { path: '/' });
		cookies.delete(COOKIE_RETURN, { path: '/' });

		const tokens = await exchangeCode(
			signed?.redirectUri || getRedirectUri(url.origin),
			code,
			verifier
		);
		if (tokens.refresh_token) {
			cookies.set(COOKIE_REFRESH, tokens.refresh_token, cookieOpts(60 * 60 * 24 * 365, secure));
		}
		throw redirect(303, withQuery(returnTo, 'spotify', 'connected'));
	} catch (err) {
		if (isRedirect(err)) throw err;
		const message = err instanceof Error ? err.message : 'connect_failed';
		throw redirect(303, withQuery(returnTo, 'spotify_error', message));
	}
};
