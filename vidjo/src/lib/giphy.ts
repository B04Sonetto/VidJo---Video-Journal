import { PUBLIC_GIPHY_API_KEY } from '$app/env/public';

const API_KEY = (PUBLIC_GIPHY_API_KEY ?? '').trim();
const API_ROOT = 'https://api.giphy.com/v1/gifs';
const PAGE_SIZE = 24;
const MAX_URL_LENGTH = 500;

/** Giphy is only offered when a public API key is configured. */
export const giphyEnabled = API_KEY.length > 0;

export interface GiphyGif {
	id: string;
	title: string;
	/** Small animated image used in the picker grid. */
	previewUrl: string;
	/** Full-size GIF stored in the message. */
	fullUrl: string;
}

export interface GiphyPage {
	gifs: GiphyGif[];
	total: number;
	offset: number;
	hasMore: boolean;
}

type GiphyImage = {
	url?: string;
};

type GiphyResult = {
	id?: string;
	title?: string;
	images?: {
		fixed_height?: GiphyImage;
		fixed_height_small?: GiphyImage;
		downsized_medium?: GiphyImage;
	};
};

type GiphyResponse = {
	data?: GiphyResult[];
	pagination?: {
		total_count?: number;
	};
};

/**
 * Only allow GIFs served over HTTPS from Giphy. The database repeats this check
 * so a tampered client cannot store an arbitrary URL in a message.
 */
export function isGiphyMediaUrl(value: string) {
	if (!value || value.length > MAX_URL_LENGTH) return false;

	try {
		const url = new URL(value);
		return url.protocol === 'https:' && /^(?:media\d*|i)\.giphy\.com$/i.test(url.hostname);
	} catch {
		return false;
	}
}

function mediaUrl(image: GiphyImage | undefined) {
	const url = typeof image?.url === 'string' ? image.url.trim() : '';
	return isGiphyMediaUrl(url) ? url : '';
}

function mapGif(row: GiphyResult): GiphyGif | null {
	const fullUrl = mediaUrl(row.images?.fixed_height) || mediaUrl(row.images?.downsized_medium);
	const previewUrl = mediaUrl(row.images?.fixed_height_small) || fullUrl;

	if (!fullUrl || !previewUrl) return null;

	return {
		id: typeof row.id === 'string' ? row.id : fullUrl,
		title: (row.title ?? '').trim() || 'GIF',
		previewUrl,
		fullUrl
	};
}

async function request(
	kind: 'trending' | 'search',
	query: string,
	offset: number
): Promise<GiphyPage> {
	if (!giphyEnabled) {
		return { gifs: [], total: 0, offset, hasMore: false };
	}

	const params = new URLSearchParams({
		api_key: API_KEY,
		limit: String(PAGE_SIZE),
		offset: String(Math.max(0, offset)),
		rating: 'pg',
		lang: 'en'
	});
	if (kind === 'search') params.set('q', query);

	const response = await fetch(`${API_ROOT}/${kind}?${params}`, {
		headers: { Accept: 'application/json' }
	});

	if (!response.ok) {
		throw new Error(
			response.status === 429
				? 'GIF search is busy. Try again in a moment.'
				: 'GIF search is unavailable right now.'
		);
	}

	const payload = (await response.json()) as GiphyResponse;
	const gifs = (payload.data ?? []).map(mapGif).filter((gif): gif is GiphyGif => gif !== null);
	const total = Math.max(0, Number(payload.pagination?.total_count) || 0);

	return {
		gifs,
		total,
		offset,
		hasMore:
			gifs.length > 0 && (total > 0 ? offset + gifs.length < total : gifs.length >= PAGE_SIZE)
	};
}

export function trendingGifs(offset = 0) {
	return request('trending', '', offset);
}

export function searchGifs(query: string, offset = 0) {
	return request('search', query, offset);
}
