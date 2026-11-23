import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchLyrics } from '#lib/server/lyrics';

export const GET: RequestHandler = async ({ url }) => {
	const track = url.searchParams.get('track')?.trim().slice(0, 160);
	const artist = url.searchParams.get('artist')?.trim().slice(0, 160);
	if (!track || !artist) return json({ lines: [] }, { status: 400 });

	const album = url.searchParams.get('album')?.trim().slice(0, 160) || undefined;
	const rawDuration = Number(url.searchParams.get('duration'));
	const durationMs =
		Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration < 24 * 60 * 60 * 1000
			? rawDuration
			: undefined;

	const lines = await fetchLyrics({ track, artist, album, durationMs });
	return json(
		{ lines },
		{
			headers: {
				'Cache-Control': 'private, max-age=3600'
			}
		}
	);
};
