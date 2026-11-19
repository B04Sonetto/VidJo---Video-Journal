import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessToken, spotifyConfigured } from '#lib/server/spotify';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!spotifyConfigured()) {
		return json({ connected: false, configured: false, access_token: null, expires_in: 0 });
	}

	try {
		const token = await getAccessToken(cookies);
		if (!token) {
			return json({ connected: false, configured: true, access_token: null, expires_in: 0 });
		}
		return json({
			connected: true,
			configured: true,
			access_token: token.access_token,
			expires_in: token.expires_in
		});
	} catch {
		return json(
			{
				connected: false,
				configured: true,
				access_token: null,
				expires_in: 0,
				error: 'refresh_failed'
			},
			{ status: 401 }
		);
	}
};
