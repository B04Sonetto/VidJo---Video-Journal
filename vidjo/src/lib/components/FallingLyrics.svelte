<script lang="ts">
	import { fade } from 'svelte/transition';
	import { lyrics } from '#lib/state/lyrics.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { spotify } from '#lib/state/spotify.svelte';

	type VisualLine = {
		index: number;
		time: number;
		text: string;
		yPx: number;
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
	const FRAME_MS = 32;
	const MAX_VISIBLE = 14;

	let host = $state<HTMLDivElement | null>(null);
	let hostHeight = $state(0);
	let basePosition = $state(0);
	let tick = $state(0);
	let baseAt = 0;

	$effect(() => {
		void lyrics.load(spotify.track, profile.fallingLyrics, spotify.duration);
	});

	// Measure once so falling lines can move with transforms instead of changing
	// `top` every frame, which is much cheaper inside the scaled book spread.
	$effect(() => {
		if (!host || !browser) return;
		const observer = new ResizeObserver(([entry]) => {
			hostHeight = entry.contentRect.height;
		});
		observer.observe(host);
		hostHeight = host.clientHeight;
		return () => observer.disconnect();
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
		let lastFrame = 0;
		const loop = (now: number) => {
			if (now - lastFrame >= FRAME_MS) {
				lastFrame = now;
				tick = now;
			}
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
		if (!profile.fallingLyrics || spotify.panelOpen || !lyrics.lines.length || !hostHeight) {
			return [];
		}
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
				yPx: y * hostHeight,
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

		return result.slice(-MAX_VISIBLE);
	});
</script>

<div
	bind:this={host}
	class="pointer-events-none absolute z-[25] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_86%,transparent)] [contain:layout_paint] {className}"
	aria-hidden="true"
>
	{#if profile.fallingLyrics && !spotify.panelOpen && spotify.track && visuals.length}
		{#each visuals as line (line.index)}
			<div
				class="lyric-position absolute top-0 max-w-[78%]"
				style="left: {line.left}%; transform: translate3d(0, {line.yPx}px, 0); opacity: {line.opacity};"
			>
				<span
					class="lyric-line block font-hand text-[clamp(1rem,2.2vw,1.5rem)] leading-tight {line.active
						? 'lyric-line-active rounded-full bg-paper/55 px-2.5 py-0.5 font-bold text-book-ink ring-1 ring-white/30'
						: 'text-book-ink/80'}"
					style="--drift-a: {line.driftA}px; --drift-b: {line.driftB}px; --tilt: {line.tilt}deg; --tilt-alt: {line.tiltAlt}deg; --sway: {line.sway}s; --delay: {line.delay}s;"
					in:fade={{ duration: 700 }}
					out:fade={{ duration: 450 }}
				>
					{line.text}
				</span>
			</div>
		{/each}
	{/if}
</div>

<style>
	.lyric-position {
		will-change: transform, opacity;
	}

	.lyric-line {
		animation: lyric-sway var(--sway) ease-in-out var(--delay) infinite;
		text-shadow:
			0 0 6px rgb(255 255 255 / 0.9),
			0 1px 0 rgb(255 255 255 / 0.75),
			0 8px 18px rgb(42 27 61 / 0.2);
		will-change: transform;
	}

	.lyric-line-active {
		text-shadow:
			0 0 8px rgb(255 253 238 / 1),
			0 0 20px rgb(255 225 150 / 0.72),
			0 1px 0 rgb(255 255 255 / 0.9),
			0 8px 20px rgb(42 27 61 / 0.22);
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
