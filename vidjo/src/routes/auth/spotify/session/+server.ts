import type { RequestHandler } from '@sveltejs/kit';
import {
	COOKIE_REFRESH,
	COOKIE_RETURN,
	COOKIE_STATE,
	COOKIE_VERIFIER,
	cookieOpts,
	safeReturnTo,
	unsealToken,
	withQuery
} from '#lib/server/spotify';

/** Completes Spotify OAuth on the origin the user started from. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
	const secure = url.protocol === 'https:';
	const sealed = url.searchParams.get('spotify_session') || '';
	const refreshToken = sealed ? await unsealToken(sealed) : '';

	cookies.delete(COOKIE_STATE, { path: '/' });
	cookies.delete(COOKIE_VERIFIER, { path: '/' });
	cookies.delete(COOKIE_RETURN, { path: '/' });

	if (!refreshToken) {
		return new Response(null, {
			status: 303,
			headers: {
				Location: withQuery(returnTo, 'spotify_error', 'state_mismatch'),
				'Referrer-Policy': 'no-referrer'
			}
		});
	}

	cookies.set(COOKIE_REFRESH, refreshToken, cookieOpts(60 * 60 * 24 * 365, secure));
	return new Response(null, {
		status: 303,
		headers: {
			Location: withQuery(returnTo, 'spotify', 'connected'),
			'Referrer-Policy': 'no-referrer'
		}
	});
};
