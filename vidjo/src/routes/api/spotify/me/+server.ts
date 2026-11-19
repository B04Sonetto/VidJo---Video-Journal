import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessToken, spotifyApi } from '#lib/server/spotify';

export const GET: RequestHandler = async ({ cookies }) => {
	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ connected: false }, { status: 401 });

		const res = await spotifyApi('/me', token.access_token);
		if (res.status === 401) return json({ connected: false }, { status: 401 });
		if (!res.ok) return json({ error: 'spotify_error' }, { status: res.status });

		const data = await res.json();
		return json({
			connected: true,
			id: data.id,
			name: data.display_name || data.id,
			product: data.product || '',
			image: data.images?.[0]?.url || ''
		});
	} catch {
		return json({ connected: false }, { status: 401 });
	}
};
