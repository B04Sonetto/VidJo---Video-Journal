export type LyricLine = {
	time: number;
	text: string;
};

type LrclibResponse = {
	syncedLyrics?: string | null;
	plainLyrics?: string | null;
	duration?: number;
	trackName?: string;
	artistName?: string;
	albumName?: string;
};

type LrclibSearchResult = LrclibResponse & {
	id?: number;
};

type CacheEntry = {
	expires: number;
	value: LyricLine[];
};

const CACHE_TTL = 6 * 60 * 60 * 1000;
const EMPTY_TTL = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 160;
const MAX_LINES = 400;
const cache = new Map<string, CacheEntry>();

function cacheResult(key: string, value: LyricLine[], ttl = CACHE_TTL) {
	cache.delete(key);
	cache.set(key, { expires: Date.now() + ttl, value });
	if (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
}

function parseLrc(lrc: string, extraOffsetMs = 0): LyricLine[] {
	const offsetMatch = lrc.match(/^\[offset:\s*([+-]?\d+)\s*\]$/im);
	const offsetMs = extraOffsetMs + (offsetMatch ? Number(offsetMatch[1]) : 0);
	const seen = new Set<string>();
	const lines: LyricLine[] = [];

	for (const raw of lrc.split(/\r?\n/)) {
		const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
		if (!tags.length) continue;

		const text = raw
			.replace(/\[[^\]]*\]/g, '')
			.trim()
			.slice(0, 240);
		if (!text || /^(ar|ti|al|by|length|re|ve):/i.test(text)) continue;

		for (const tag of tags) {
			const minutes = Number(tag[1]);
			const seconds = Number(tag[2].replace(',', '.'));
			if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) continue;

			const time = Math.max(0, Math.round(minutes * 60000 + seconds * 1000 + offsetMs));
			const key = `${time}|${text.toLowerCase()}`;
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push({ time, text });
		}
	}

	return lines.sort((a, b) => a.time - b.time).slice(0, MAX_LINES);
}

function parsePlainLyrics(plain: string, durationMs: number): LyricLine[] {
	const parts = plain
		.split(/\r?\n/)
		.map((line) => line.trim().slice(0, 240))
		.filter(Boolean)
		.slice(0, MAX_LINES);
	if (!parts.length) return [];

	const span = durationMs > 0 ? durationMs : parts.length * 4000;
	return parts.map((text, index) => ({
		time: Math.round((index * span) / parts.length),
		text
	}));
}

function normalizeName(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lyricsFromResponse(data: LrclibResponse, durationMs?: number): LyricLine[] {
	let lines = data.syncedLyrics ? parseLrc(data.syncedLyrics) : [];
	if (!lines.length && data.plainLyrics) {
		const fallbackDuration = data.duration ? data.duration * 1000 : durationMs || 0;
		lines = parsePlainLyrics(data.plainLyrics, fallbackDuration);
	}
	return lines.slice(0, MAX_LINES);
}

function pickBestSearchResult(
	results: LrclibSearchResult[],
	track: string,
	artist: string,
	album: string | undefined,
	durationMs: number | undefined
) {
	const wantedTrack = normalizeName(track);
	const wantedArtist = normalizeName(artist);
	const wantedAlbum = album ? normalizeName(album) : '';

	let best: LrclibSearchResult | null = null;
	let bestScore = -1;
	for (const result of results) {
		let score = 0;
		if (normalizeName(result.trackName || '') === wantedTrack) score += 50;
		if (normalizeName(result.artistName || '').includes(wantedArtist)) score += 30;
		if (wantedAlbum && normalizeName(result.albumName || '') === wantedAlbum) score += 15;
		if (durationMs && result.duration) {
			score += Math.max(0, 15 - Math.abs(result.duration * 1000 - durationMs) / 10000);
		}
		if (result.syncedLyrics) score += 10;
		if (score > bestScore) {
			best = result;
			bestScore = score;
		}
	}
	return best;
}

export async function fetchLyrics({
	track,
	artist,
	album,
	durationMs
}: {
	track: string;
	artist: string;
	album?: string;
	durationMs?: number;
}): Promise<LyricLine[]> {
	const key = [track, artist, album || '', Math.round((durationMs || 0) / 1000)]
		.join('|')
		.toLowerCase();
	const cached = cache.get(key);
	if (cached) {
		if (cached.expires > Date.now()) return cached.value;
		cache.delete(key);
	}

	const headers = { Accept: 'application/json', 'User-Agent': 'VidJo/1.0 (journal lyrics)' };
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 7000);
	const request = (target: URL) => fetch(target, { headers, signal: controller.signal });

	try {
		const url = new URL('https://lrclib.net/api/get');
		url.searchParams.set('track_name', track);
		url.searchParams.set('artist_name', artist);
		if (album) url.searchParams.set('album_name', album);
		if (durationMs && durationMs > 0) {
			url.searchParams.set('duration', String(Math.round(durationMs / 1000)));
		}

		const response = await request(url);
		let data: LrclibResponse | null = null;
		if (response.ok) {
			data = (await response.json()) as LrclibResponse;
		} else if (response.status === 404) {
			// Album/duration mismatches are common across Spotify editions. A
			// fuzzy search gives us the closest match before we give up.
			const search = new URL('https://lrclib.net/api/search');
			search.searchParams.set('track_name', track);
			search.searchParams.set('artist_name', artist);
			if (album) search.searchParams.set('album_name', album);
			const searchResponse = await request(search);
			if (searchResponse.ok) {
				const results = (await searchResponse.json()) as LrclibSearchResult[];
				if (Array.isArray(results)) {
					data = pickBestSearchResult(results, track, artist, album, durationMs);
				}
			}
		}

		const result = data ? lyricsFromResponse(data, durationMs) : [];
		cacheResult(key, result, result.length ? CACHE_TTL : EMPTY_TTL);
		return result;
	} catch {
		return [];
	} finally {
		clearTimeout(timeout);
	}
}
