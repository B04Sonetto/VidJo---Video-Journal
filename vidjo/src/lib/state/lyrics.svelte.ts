import { SvelteURLSearchParams } from 'svelte/reactivity';
import type { SpotifyTrack } from '#lib/state/spotify.svelte';

export type LyricLine = { time: number; text: string };

function isLyricLine(value: unknown): value is LyricLine {
	const line = value as LyricLine;
	return (
		Boolean(line) &&
		typeof line.time === 'number' &&
		Number.isFinite(line.time) &&
		typeof line.text === 'string' &&
		Boolean(line.text.trim())
	);
}

class LyricsState {
	lines = $state<LyricLine[]>([]);
	loading = $state(false);

	private key = '';
	private controller: AbortController | null = null;

	async load(track: SpotifyTrack | null, enabled: boolean, fallbackDurationMs = 0) {
		if (!enabled || !track?.name || !track.artists) {
			this.stop();
			return;
		}

		const duration = track.duration_ms || fallbackDurationMs || 0;
		const key = [
			track.uri || '',
			track.name,
			track.artists,
			track.album || '',
			Math.round(duration / 1000)
		].join('|');
		if (key === this.key) return;

		this.key = key;
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.lines = [];
		this.loading = true;

		try {
			const params = new SvelteURLSearchParams({ track: track.name, artist: track.artists });
			if (track.album) params.set('album', track.album);
			if (duration > 0) params.set('duration', String(Math.round(duration)));

			const response = await fetch(`/api/lyrics?${params}`, { signal: controller.signal });
			if (!response.ok || controller.signal.aborted) return;
			const data = (await response.json()) as { lines?: unknown };
			if (controller.signal.aborted || !Array.isArray(data.lines)) return;
			this.lines = data.lines.filter(isLyricLine).slice(0, 400);
		} catch {
			// Offline, aborted, or no lyrics: the pages simply stay clean.
		} finally {
			if (this.controller === controller) {
				this.loading = false;
				this.controller = null;
			}
		}
	}

	stop() {
		this.key = '';
		this.controller?.abort();
		this.controller = null;
		this.lines = [];
		this.loading = false;
	}

	activeIndexAt(time: number) {
		let index = -1;
		for (let i = 0; i < this.lines.length; i++) {
			if (this.lines[i].time > time) break;
			index = i;
		}
		return index;
	}
}

export const lyrics = new LyricsState();
