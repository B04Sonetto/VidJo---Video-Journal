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

function mapTrack(track: Record<string, unknown>) {
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
}

function dedupeTracks(items: unknown[], seedId: string, limit: number) {
	const seen = new Set<string>(seedId ? [seedId] : []);
	const tracks: ReturnType<typeof mapTrack>[] = [];
	for (const item of items) {
		const rec = asRecord(item);
		if (!rec) continue;
		const mapped = mapTrack(rec);
		if (!mapped.uri || !mapped.name) continue;
		const id =
			mapped.id ||
			(mapped.uri.startsWith('spotify:track:') ? mapped.uri.split(':').pop() || '' : '');
		if (id && seen.has(id)) continue;
		if (id) seen.add(id);
		tracks.push(mapped);
		if (tracks.length >= limit) break;
	}
	return tracks;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const seedTrack = (
		url.searchParams.get('seed_track') ||
		url.searchParams.get('seed_tracks') ||
		''
	).trim();
	const seedUri = (url.searchParams.get('seed_uri') || '').trim();
	let seedId = seedTrack;
	if (!seedId && seedUri.startsWith('spotify:track:')) {
		seedId = seedUri.split(':').pop() || '';
	}

	const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 5, 10));
	if (!seedId) return json({ tracks: [], error: 'missing_seed' }, { status: 400 });

	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ tracks: [], error: 'not_connected' }, { status: 401 });

		// 1) Try Spotify recommendations (may be unavailable for some apps/endpoints).
		try {
			const params = new URLSearchParams({
				limit: String(limit),
				seed_tracks: seedId,
				market: 'from_token'
			});
			const res = await spotifyApi(`/recommendations?${params.toString()}`, token.access_token);
			const raw = await res.text();
			let data: unknown = null;
			try {
				data = raw ? (JSON.parse(raw) as unknown) : null;
			} catch {
				data = raw ? { raw } : null;
			}
			if (res.ok) {
				const root = asRecord(data);
				const items = Array.isArray(root?.tracks) ? (root.tracks as unknown[]) : [];
				const tracks = dedupeTracks(items, seedId, limit);
				if (tracks.length) return json({ tracks });
			}
		} catch {
			// fall through to search fallback
		}

		// 2) Fallback: find similar tracks via search using the seed track's artist/name.
		let seedName = (url.searchParams.get('seed_name') || '').trim();
		let seedArtist = (url.searchParams.get('seed_artist') || '').trim();
		if (!seedName || !seedArtist) {
			try {
				const trackRes = await spotifyApi(
					`/tracks/${encodeURIComponent(seedId)}?market=from_token`,
					token.access_token
				);
				if (trackRes.ok) {
					const t = asRecord(await trackRes.json().catch(() => null));
					if (t) {
						if (!seedName && typeof t.name === 'string') seedName = t.name;
						const artists = Array.isArray(t.artists) ? t.artists : [];
						const a0 = asRecord(artists[0]);
						if (!seedArtist && a0 && typeof a0.name === 'string') seedArtist = a0.name;
					}
				}
			} catch {
				// ignore
			}
		}

		const queries = [
			seedArtist ? `artist:${seedArtist}` : '',
			seedName ? `track:${seedName}` : ''
		].filter(Boolean);
		const q = queries.join(' ').trim() || seedArtist || seedName || 'top hits';
		const searchParams = new URLSearchParams({
			q,
			type: 'track',
			limit: String(Math.min(limit + 5, 20)),
			market: 'from_token'
		});
		const searchRes = await spotifyApi(`/search?${searchParams.toString()}`, token.access_token);
		const searchData = asRecord(await searchRes.json().catch(() => null));
		if (!searchRes.ok) {
			return json(
				{
					tracks: [],
					error: 'spotify_error',
					status: searchRes.status,
					message: extractSpotifyMessage(searchData) || 'Could not load a recommended next track'
				},
				{ status: searchRes.status }
			);
		}

		const tracksObj = asRecord(searchData?.tracks);
		const items = Array.isArray(tracksObj?.items) ? (tracksObj.items as unknown[]) : [];
		const tracks = dedupeTracks(items, seedId, limit);
		return json({ tracks });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Recommendations failed';
		return json({ tracks: [], error: 'recommendations_failed', message }, { status: 500 });
	}
};
