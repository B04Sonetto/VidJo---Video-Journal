import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessToken, spotifyApi } from '#lib/server/spotify';

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function extractSpotifyMessage(body: unknown): string | undefined {
	const rec = asRecord(body);
	if (!rec) return undefined;
	const err = rec.error;
	if (typeof err === 'string') return err;
	const errRec = asRecord(err);
	if (errRec && typeof errRec.message === 'string') return errRec.message;
	if (typeof rec.error_description === 'string') return rec.error_description;
	return undefined;
}

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
			limit: '10',
			market: 'from_token'
		});

		const res = await spotifyApi(`/search?${params.toString()}`, token.access_token);
		const raw = await res.text();
		let data: unknown = null;
		try {
			data = raw ? (JSON.parse(raw) as unknown) : null;
		} catch {
			data = raw ? { raw } : null;
		}

		if (res.status === 401) {
			return json(
				{ error: 'not_connected', message: extractSpotifyMessage(data) },
				{ status: 401 }
			);
		}
		if (res.status === 429) {
			return json({ error: 'rate_limited', message: extractSpotifyMessage(data) }, { status: 429 });
		}
		if (!res.ok) {
			return json(
				{
					error: 'spotify_error',
					status: res.status,
					message: extractSpotifyMessage(data) || `Spotify API error (${res.status})`
				},
				{ status: res.status }
			);
		}

		const root = asRecord(data);
		const tracksObj = root ? asRecord(root.tracks) : null;
		const items = Array.isArray(tracksObj?.items) ? (tracksObj.items as unknown[]) : [];

		const tracks = items
			.map((item) => asRecord(item))
			.filter((track): track is Record<string, unknown> => Boolean(track))
			.map((track) => {
				const artists = Array.isArray(track.artists) ? track.artists : [];
				const album = asRecord(track.album);
				const images = album && Array.isArray(album.images) ? album.images : [];
				const ext = asRecord(track.external_urls);
				const img1 = asRecord(images[1]);
				const img0 = asRecord(images[0]);

				return {
					uri: typeof track.uri === 'string' ? track.uri : '',
					id: typeof track.id === 'string' ? track.id : '',
					name: typeof track.name === 'string' ? track.name : '',
					artists: artists
						.map((a) => {
							const rec = asRecord(a);
							return rec && typeof rec.name === 'string' ? rec.name : '';
						})
						.filter(Boolean)
						.join(', '),
					album: album && typeof album.name === 'string' ? album.name : '',
					image:
						(img1 && typeof img1.url === 'string' ? img1.url : '') ||
						(img0 && typeof img0.url === 'string' ? img0.url : ''),
					duration_ms: typeof track.duration_ms === 'number' ? track.duration_ms : 0,
					url: ext && typeof ext.spotify === 'string' ? ext.spotify : ''
				};
			})
			.filter((t) => t.uri && t.name);

		return json({ tracks });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Search failed';
		return json({ error: 'search_failed', message }, { status: 500 });
	}
};
