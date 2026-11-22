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

function dedupeTracks(items: unknown[], seedId: string, seedUri: string, limit: number) {
	const seen = new Set<string>();
	if (seedId) seen.add(seedId);
	if (seedUri) seen.add(seedUri);
	const tracks: ReturnType<typeof mapTrack>[] = [];
	for (const item of items) {
		const rec = asRecord(item);
		if (!rec) continue;
		const mapped = mapTrack(rec);
		if (!mapped.uri || !mapped.name) continue;
		const id =
			mapped.id ||
			(mapped.uri.startsWith('spotify:track:') ? mapped.uri.split(':').pop() || '' : '');
		if ((id && seen.has(id)) || seen.has(mapped.uri)) continue;
		if (id) seen.add(id);
		seen.add(mapped.uri);
		tracks.push(mapped);
		if (tracks.length >= limit) break;
	}
	return tracks;
}

async function parseBody(res: Response): Promise<unknown> {
	const raw = await res.text();
	if (!raw) return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return { raw };
	}
}

async function searchTracks(
	token: string,
	q: string,
	seedId: string,
	seedUri: string,
	limit: number
) {
	const target = Math.max(1, Math.min(Math.trunc(limit) || 5, 10));
	const limitsToTry = [20, 10, 5, 1];

	let lastFailure: { ok: false; status: number; message: string } | null = null;

	for (const searchLimit of limitsToTry) {
		const searchParams = new URLSearchParams({
			q,
			type: 'track',
			limit: String(searchLimit),
			market: 'from_token'
		});
		const res = await spotifyApi(`/search?${searchParams.toString()}`, token);
		const data = await parseBody(res);
		if (!res.ok) {
			const message = extractSpotifyMessage(data) || `Spotify search failed (${res.status})`;
			lastFailure = { ok: false, status: res.status, message };
			// Some Spotify responses reject specific limit values in edge cases; retry with safer values.
			if (res.status === 400 && /invalid limit/i.test(message)) {
				continue;
			}
			return lastFailure;
		}

		const root = asRecord(data);
		const tracksObj = asRecord(root?.tracks);
		const items = Array.isArray(tracksObj?.items) ? (tracksObj.items as unknown[]) : [];
		return { ok: true as const, tracks: dedupeTracks(items, seedId, seedUri, target) };
	}

	// If Spotify keeps rejecting search limits, return no tracks so callers can try other fallbacks.
	if (lastFailure && lastFailure.status === 400 && /invalid limit/i.test(lastFailure.message)) {
		return { ok: true as const, tracks: [] as ReturnType<typeof mapTrack>[] };
	}

	return (
		lastFailure || {
			ok: false as const,
			status: 400,
			message: 'Spotify search failed'
		}
	);
}

async function getPersonalizedTracks(
	token: string,
	excludedTrackId: string,
	excludedTrackUri: string,
	limit: number
) {
	const topTracksRes = await spotifyApi(
		'/me/top/tracks?time_range=medium_term&limit=50',
		token
	);
	const topTracksData = await parseBody(topTracksRes);
	if (!topTracksRes.ok) {
		const missingScope = topTracksRes.status === 403;
		return {
			tracks: [],
			error: missingScope ? 'top_tracks_scope_required' : 'spotify_error',
			status: topTracksRes.status,
			message: missingScope
				? 'Disconnect VidJo and reconnect Spotify to let it use your top tracks for personalized recommendations.'
				: extractSpotifyMessage(topTracksData) || 'Could not load your Spotify listening history.'
		};
	}

	const topTracksRoot = asRecord(topTracksData);
	const topItems = Array.isArray(topTracksRoot?.items) ? (topTracksRoot.items as unknown[]) : [];
	const topTracks = dedupeTracks(topItems, excludedTrackId, excludedTrackUri, 50);
	const seedCandidates = topTracks.filter((track) => track.id);

	if (!seedCandidates.length) return { tracks: [] };

	const seedCount = Math.min(5, seedCandidates.length);
	const seeds = Array.from({ length: seedCount }, (_, index) => {
		const candidateIndex = Math.floor((index * seedCandidates.length) / seedCount);
		return seedCandidates[candidateIndex];
	});
	const seedIds = new Set(seeds.map((track) => track.id));

	try {
		const params = new URLSearchParams({
			limit: String(Math.max(20, limit)),
			seed_tracks: seeds.map((track) => track.id).join(','),
			market: 'from_token'
		});
		const recommendationsRes = await spotifyApi(
			`/recommendations?${params.toString()}`,
			token
		);
		if (recommendationsRes.ok) {
			const recommendationsData = asRecord(await parseBody(recommendationsRes));
			const items = Array.isArray(recommendationsData?.tracks)
				? (recommendationsData.tracks as unknown[])
				: [];
			const recommended = dedupeTracks(items, excludedTrackId, excludedTrackUri, 50)
				.filter((track) => !track.id || !seedIds.has(track.id))
				.slice(0, limit);
			if (recommended.length) return { tracks: recommended };
		}
	} catch {
		// Fall back to the listener's own top tracks if Spotify recommendations fail.
	}

	return { tracks: topTracks.slice(0, limit) };
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const personalized = url.searchParams.get('personalized') === 'true';
	const excludedTrackId = (url.searchParams.get('exclude_track') || '').trim();
	const excludedTrackUri = (url.searchParams.get('exclude_uri') || '').trim();
	const seedTrack = (
		url.searchParams.get('seed_track') ||
		url.searchParams.get('seed_tracks') ||
		''
	).trim();
	const seedUriParam = (url.searchParams.get('seed_uri') || '').trim();
	let seedId = seedTrack;
	if (!seedId && seedUriParam.startsWith('spotify:track:')) {
		seedId = seedUriParam.split(':').pop() || '';
	}
	const seedUri = seedUriParam || (seedId ? `spotify:track:${seedId}` : '');
	let seedName = (url.searchParams.get('seed_name') || '').trim();
	let seedArtist = (url.searchParams.get('seed_artist') || '').trim();
	let seedArtistId = '';

	const rawLimit = Number.parseInt(url.searchParams.get('limit') || '5', 10);
	const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 5, 10));
	if (!personalized && !seedId && !seedName && !seedArtist) {
		return json({ tracks: [], error: 'missing_seed' }, { status: 400 });
	}

	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ tracks: [], error: 'not_connected' }, { status: 401 });
		if (personalized) {
			const result = await getPersonalizedTracks(
				token.access_token,
				excludedTrackId,
				excludedTrackUri,
				limit
			);
			return json(result, 'status' in result ? { status: result.status } : undefined);
		}

		// Resolve seed metadata early (helps all fallbacks).
		if (seedId) {
			try {
				const trackRes = await spotifyApi(
					`/tracks/${encodeURIComponent(seedId)}?market=from_token`,
					token.access_token
				);
				if (trackRes.ok) {
					const t = asRecord(await parseBody(trackRes));
					if (t) {
						if (!seedName && typeof t.name === 'string') seedName = t.name;
						const artists = Array.isArray(t.artists) ? t.artists : [];
						const a0 = asRecord(artists[0]);
						if (!seedArtist && a0 && typeof a0.name === 'string') seedArtist = a0.name;
						if (!seedArtistId && a0 && typeof a0.id === 'string') seedArtistId = a0.id;
					}
				} else if (trackRes.status === 401) {
					return json(
						{
							tracks: [],
							error: 'not_connected',
							message: extractSpotifyMessage(await parseBody(trackRes))
						},
						{ status: 401 }
					);
				}
			} catch {
				// ignore and continue with provided hints
			}
		}

		// 1) Try Spotify recommendations when we have a seed track id.
		if (seedId) {
			try {
				const recLimits = [5, 10, 1];
				for (const recLimit of recLimits) {
					const params = new URLSearchParams({
						limit: String(recLimit),
						seed_tracks: seedId,
						market: 'from_token'
					});
					const res = await spotifyApi(`/recommendations?${params.toString()}`, token.access_token);
					if (res.ok) {
						const data = await parseBody(res);
						const root = asRecord(data);
						const items = Array.isArray(root?.tracks) ? (root.tracks as unknown[]) : [];
						const tracks = dedupeTracks(items, seedId, seedUri, limit);
						if (tracks.length) return json({ tracks });
						break;
					}
					const data = await parseBody(res);
					const message = extractSpotifyMessage(data) || '';
					// Retry only on invalid-limit edge cases; other statuses should fall through to fallbacks.
					if (!(res.status === 400 && /invalid limit/i.test(message))) {
						break;
					}
				}
			} catch {
				// fall through
			}
		}

		// 2) Artist top tracks fallback (good "keep listening" behavior).
		if (seedArtistId) {
			try {
				const topRes = await spotifyApi(
					`/artists/${encodeURIComponent(seedArtistId)}/top-tracks?market=from_token`,
					token.access_token
				);
				if (topRes.ok) {
					const topData = asRecord(await parseBody(topRes));
					const items = Array.isArray(topData?.tracks) ? (topData.tracks as unknown[]) : [];
					const tracks = dedupeTracks(items, seedId, seedUri, limit);
					if (tracks.length) return json({ tracks });
				}
			} catch {
				// ignore
			}
		}

		// 3) Search-based fallbacks.
		const primaryArtist = seedArtist.split(',')[0]?.trim() || seedArtist;
		const cleanName = seedName
			.replace(/[()[\]"'’]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		const cleanArtist = primaryArtist
			.replace(/[()[\]"'’]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		const candidates = Array.from(
			new Set(
				[
					cleanArtist && cleanName ? `artist:"${cleanArtist}" ${cleanName}` : '',
					cleanArtist && cleanName ? `${cleanArtist} ${cleanName}` : '',
					cleanArtist ? `artist:"${cleanArtist}"` : '',
					cleanArtist || primaryArtist,
					cleanName || seedName,
					seedArtist && seedArtist !== primaryArtist ? seedArtist : '',
					"today's top hits",
					'top hits',
					'popular',
					'viral hits',
					'chill hits'
				]
					.map((q) => q.trim())
					.filter(Boolean)
			)
		);

		let lastError: { status: number; message: string } | null = null;
		for (const q of candidates) {
			try {
				const result = await searchTracks(token.access_token, q, seedId, seedUri, limit);
				if (!result.ok) {
					lastError = { status: result.status, message: result.message };
					if (result.status === 401) {
						return json(
							{ tracks: [], error: 'not_connected', message: result.message },
							{ status: 401 }
						);
					}
					continue;
				}
				if (result.tracks.length) return json({ tracks: result.tracks });
			} catch {
				// try next query
			}
		}

		// 4) Final broad searches so "next" can keep playing even without a good seed match.
		for (const q of ['global top 50', 'pop', 'new music', 'lofi', 'indie']) {
			try {
				const result = await searchTracks(token.access_token, q, seedId, seedUri, limit);
				if (!result.ok) {
					if (!lastError) lastError = { status: result.status, message: result.message };
					if (result.status === 401) {
						return json(
							{ tracks: [], error: 'not_connected', message: result.message },
							{ status: 401 }
						);
					}
					continue;
				}
				if (result.tracks.length) return json({ tracks: result.tracks });
			} catch {
				// ignore
			}
		}

		// If every query succeeded but all results were filtered out, return empty list (client can show generic).
		// If we saw an upstream error and never found tracks, surface it.
		if (lastError) {
			// If Spotify rejects limits in some environments, degrade gracefully so client fallback can continue.
			if (lastError.status === 400 && /invalid limit/i.test(lastError.message)) {
				return json({ tracks: [] });
			}
			return json(
				{
					tracks: [],
					error: 'spotify_error',
					status: lastError.status,
					message: lastError.message
				},
				{ status: lastError.status }
			);
		}

		return json({ tracks: [] });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Recommendations failed';
		return json({ tracks: [], error: 'recommendations_failed', message }, { status: 500 });
	}
};
