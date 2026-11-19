import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessToken, spotifyApi } from '#lib/server/spotify';

export const PUT: RequestHandler = async ({ request, cookies }) => {
	try {
		const token = await getAccessToken(cookies);
		if (!token) return json({ error: 'not_connected' }, { status: 401 });

		const body = await request.json().catch(() => ({}));
		const deviceId = typeof body?.device_id === 'string' ? body.device_id : '';
		const uris = Array.isArray(body?.uris)
			? body.uris.filter((u: unknown) => typeof u === 'string')
			: [];
		const contextUri = typeof body?.context_uri === 'string' ? body.context_uri : '';
		if (!deviceId) return json({ error: 'missing_device' }, { status: 400 });
		if (!uris.length && !contextUri) return json({ error: 'missing_track' }, { status: 400 });

		const qs = new URLSearchParams({ device_id: deviceId });
		const payload: Record<string, unknown> = {};
		if (uris.length) payload.uris = uris;
		if (contextUri) payload.context_uri = contextUri;

		const res = await spotifyApi(`/me/player/play?${qs.toString()}`, token.access_token, {
			method: 'PUT',
			body: JSON.stringify(payload)
		});

		if (res.status === 204 || res.ok) return json({ ok: true });
		if (res.status === 401) return json({ error: 'not_connected' }, { status: 401 });
		if (res.status === 403) return json({ error: 'premium_required' }, { status: 403 });
		if (res.status === 404) return json({ error: 'device_not_found' }, { status: 404 });
		return json({ error: 'play_failed' }, { status: res.status });
	} catch {
		return json({ error: 'play_failed' }, { status: 500 });
	}
};
