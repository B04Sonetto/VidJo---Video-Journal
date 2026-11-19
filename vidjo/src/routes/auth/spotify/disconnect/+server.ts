import { json, type RequestHandler } from '@sveltejs/kit';
import { COOKIE_REFRESH } from '#lib/server/spotify';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(COOKIE_REFRESH, { path: '/' });
	return json({ ok: true });
};
