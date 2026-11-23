<script lang="ts">
	import { fade } from 'svelte/transition';
	import { lyrics } from '#lib/state/lyrics.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { spotify } from '#lib/state/spotify.svelte';

	type VisualLine = {
		index: number;
		time: number;
		text: string;
		y: number;
		opacity: number;
		left: number;
		tilt: number;
		tiltAlt: number;
		driftA: number;
		driftB: number;
		sway: number;
		delay: number;
		active: boolean;
	};

	let { class: className = 'inset-0' }: { class?: string } = $props();

	const browser = typeof window !== 'undefined';
	const LEAD_MS = 24000;

	let basePosition = $state(0);
	let tick = $state(0);
	let baseAt = 0;

	$effect(() => {
		void lyrics.load(spotify.track, profile.fallingLyrics, spotify.duration);
	});

	const shouldAnimate = $derived(
		browser &&
			profile.fallingLyrics &&
			!spotify.panelOpen &&
			spotify.playing &&
			Boolean(spotify.track) &&
			lyrics.lines.length > 0
	);

	// Rebase on Spotify's once-per-second position reports, and also when the
	// player panel opens/closes so the page effect never resumes from a stale clock.
	$effect(() => {
		const position = spotify.position;
		const playing = spotify.playing;
		const panelOpen = spotify.panelOpen;
		const duration = spotify.duration;
		void playing;
		void panelOpen;
		void duration;
		basePosition = position;
		baseAt = browser ? performance.now() : 0;
		tick = baseAt;
	});

	$effect(() => {
		if (!browser || !shouldAnimate) return;
		let frame = 0;
		const loop = (now: number) => {
			tick = now;
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	const elapsed = $derived(spotify.playing && baseAt ? Math.max(0, tick - baseAt) : 0);
	const currentTime = $derived(
		Math.max(0, Math.min(spotify.duration || Number.MAX_SAFE_INTEGER, basePosition + elapsed))
	);

	const visuals = $derived.by<VisualLine[]>(() => {
		if (!profile.fallingLyrics || spotify.panelOpen || !lyrics.lines.length) return [];
		const time = currentTime;
		const result: VisualLine[] = [];

		for (let index = 0; index < lyrics.lines.length; index++) {
			const line = lyrics.lines[index];
			// Future words wait above the current line and drift down as the song
			// advances; already-sung words continue below and fade away.
			const y = 0.44 - (line.time - time) / LEAD_MS;
			if (y < -0.14 || y > 1.14) continue;

			const next = lyrics.lines[index + 1];
			const active = line.time <= time && (!next || next.time > time);
			const distance = Math.abs(line.time - time) / LEAD_MS;
			const tilt = -4 + ((index * 7) % 9);
			const drift = 7 + ((index * 11) % 16);

			result.push({
				...line,
				index,
				y,
				active,
				opacity: active ? 1 : Math.max(0.07, 0.54 - distance * 0.95),
				left: 8 + (((index * 37) % 100) / 100) * 68,
				tilt,
				tiltAlt: -tilt,
				driftA: -drift,
				driftB: drift,
				sway: 7 + ((index * 3) % 5),
				delay: -((index * 0.8) % 6)
			});
		}

		return result.slice(-18);
	});
</script>

<div
	class="pointer-events-none absolute z-[25] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_86%,transparent)] {className}"
	aria-hidden="true"
>
	{#if profile.fallingLyrics && !spotify.panelOpen && spotify.track && visuals.length}
		{#each visuals as line (line.index)}
			<span
				class="lyric-line absolute max-w-[78%] font-hand text-[clamp(1rem,2.2vw,1.5rem)] leading-tight {line.active
					? 'rounded-full bg-paper/40 px-2.5 py-0.5 font-bold text-book-ink shadow-[0_2px_14px_rgba(255,255,255,.22)] backdrop-blur-[1px]'
					: 'text-book-ink/70'}"
				style="top: {line.y *
					100}%; left: {line.left}%; opacity: {line.opacity}; --drift-a: {line.driftA}px; --drift-b: {line.driftB}px; --tilt: {line.tilt}deg; --tilt-alt: {line.tiltAlt}deg; --sway: {line.sway}s; --delay: {line.delay}s;"
				in:fade={{ duration: 700 }}
				out:fade={{ duration: 450 }}
			>
				{line.text}
			</span>
		{/each}
	{/if}
</div>

<style>
	.lyric-line {
		animation: lyric-sway var(--sway) ease-in-out var(--delay) infinite;
		text-shadow:
			0 1px 0 rgb(255 255 255 / 0.5),
			0 8px 20px rgb(42 27 61 / 0.22);
		will-change: transform;
	}

	@keyframes lyric-sway {
		0%,
		100% {
			transform: translate3d(var(--drift-a), -4px, 0) rotate(var(--tilt));
		}
		50% {
			transform: translate3d(var(--drift-b), 6px, 0) rotate(var(--tilt-alt));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lyric-line {
			animation: none;
			transform: rotate(var(--tilt));
		}
	}
</style>
