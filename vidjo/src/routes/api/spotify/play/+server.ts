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

export const PUT: RequestHandler = async ({ request, cookies }) => {
	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ error: 'not_connected' }, { status: 401 });

		const body = await request.json().catch(() => ({}));
		const deviceId = typeof body?.device_id === 'string' ? body.device_id : '';
		const uris = Array.isArray(body?.uris)
			? body.uris.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
			: [];
		const contextUri = typeof body?.context_uri === 'string' ? body.context_uri : '';
		if (!deviceId) return json({ error: 'missing_device' }, { status: 400 });
		if (!uris.length && !contextUri) return json({ error: 'missing_track' }, { status: 400 });

		const transfer = await spotifyApi('/me/player', token.access_token, {
			method: 'PUT',
			body: JSON.stringify({ device_ids: [deviceId], play: false })
		});
		if (!transfer.ok && transfer.status !== 204) {
			const rawTransfer = await transfer.text();
			let transferData: unknown = null;
			try {
				transferData = rawTransfer ? (JSON.parse(rawTransfer) as unknown) : null;
			} catch {
				transferData = null;
			}
			if (transfer.status === 401) {
				return json({ error: 'not_connected' }, { status: 401 });
			}
			if (transfer.status === 403) {
				return json(
					{
						error: 'premium_required',
						message: extractSpotifyMessage(transferData) || 'Premium required'
					},
					{ status: 403 }
				);
			}
			if (transfer.status === 404) {
				return json(
					{
						error: 'device_not_found',
						message: 'Spotify could not find the VidJo player. Keep this tab open and try again.'
					},
					{ status: 404 }
				);
			}
			return json(
				{
					error: 'play_failed',
					status: transfer.status,
					message:
						extractSpotifyMessage(transferData) ||
						`Could not activate the VidJo player (${transfer.status})`
				},
				{ status: transfer.status }
			);
		}

		const qs = new URLSearchParams({ device_id: deviceId });
		const payload: Record<string, unknown> = {};
		if (uris.length) payload.uris = uris;
		if (contextUri) payload.context_uri = contextUri;

		const res = await spotifyApi(`/me/player/play?${qs.toString()}`, token.access_token, {
			method: 'PUT',
			body: JSON.stringify(payload)
		});

		const raw = await res.text();
		let data: unknown = null;
		try {
			data = raw ? (JSON.parse(raw) as unknown) : null;
		} catch {
			data = null;
		}

		if (res.status === 204 || res.ok) return json({ ok: true });
		if (res.status === 401) return json({ error: 'not_connected' }, { status: 401 });
		if (res.status === 403) {
			return json(
				{
					error: 'premium_required',
					message: extractSpotifyMessage(data) || 'Premium required'
				},
				{ status: 403 }
			);
		}
		if (res.status === 404) {
			return json(
				{
					error: 'device_not_found',
					message: extractSpotifyMessage(data) || 'Device not found'
				},
				{ status: 404 }
			);
		}
		return json(
			{
				error: 'play_failed',
				status: res.status,
				message: extractSpotifyMessage(data) || `Playback failed (${res.status})`
			},
			{ status: res.status }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Playback failed';
		return json({ error: 'play_failed', message }, { status: 500 });
	}
};
