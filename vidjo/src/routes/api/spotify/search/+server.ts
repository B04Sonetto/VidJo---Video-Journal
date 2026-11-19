import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessToken, spotifyApi } from '#lib/server/spotify';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const q = (url.searchParams.get('q') || '').trim();
	if (!q) return json({ tracks: [] });
	if (q.length > 120) return json({ error: 'query_too_long' }, { status: 400 });

	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ error: 'not_connected' }, { status: 401 });

		const params = new URLSearchParams({
			q,
			type: 'track',
			limit: '12',
			market: 'from_token'
		});
		const res = await spotifyApi(`/search?${params.toString()}`, token.access_token);
		if (res.status === 401) return json({ error: 'not_connected' }, { status: 401 });
		if (res.status === 429) return json({ error: 'rate_limited' }, { status: 429 });
		if (!res.ok) return json({ error: 'spotify_error' }, { status: res.status });

		const data = (await res.json()) as {
			tracks?: {
				items?: Array<{
					uri: string;
					id: string;
					name: string;
					artists?: Array<{ name?: string }>;
					album?: { name?: string; images?: Array<{ url?: string }> };
					duration_ms?: number;
					external_urls?: { spotify?: string };
				}>;
			};
		};

		const tracks = (data.tracks?.items || []).map((track) => ({
			uri: track.uri,
			id: track.id,
			name: track.name,
			artists: (track.artists || []).map((a) => a.name || '').filter(Boolean).join(', '),
			album: track.album?.name || '',
			image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || '',
			duration_ms: track.duration_ms || 0,
			url: track.external_urls?.spotify || ''
		}));

		return json({ tracks });
	} catch {
		return json({ error: 'search_failed' }, { status: 500 });
	}
};
