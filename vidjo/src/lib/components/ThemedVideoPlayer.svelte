<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let {
		src,
		poster = '',
		class: className = '',
		preload = 'metadata',
		onLoadedData,
		onError
	}: {
		src: string;
		poster?: string;
		class?: string;
		preload?: 'none' | 'metadata' | 'auto';
		onLoadedData?: () => void;
		onError?: () => void;
	} = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let playing = $state(false);
	let muted = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);

	const progress = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);

	function formatTime(value: number) {
		const total = Math.max(0, Math.floor(value));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	}

	async function togglePlayback() {
		if (!video) return;
		if (video.paused) {
			try {
				await video.play();
			} catch {
				playing = false;
			}
		} else {
			video.pause();
		}
	}

	function seek(event: Event) {
		if (!video) return;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		video.currentTime = value;
		currentTime = value;
	}

	function toggleMute() {
		if (!video) return;
		muted = !muted;
		video.muted = muted;
		if (!muted && video.volume === 0) setVolume(0.65);
	}

	function setVolume(value: number) {
		if (!video) return;
		volume = value;
		video.volume = value;
		video.muted = value === 0;
		muted = video.muted;
	}

	async function toggleFullscreen() {
		if (!video) return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await video.parentElement?.requestFullscreen();
			}
		} catch {
			// Fullscreen is optional and may be blocked by the browser.
		}
	}
</script>

<div
	class="themed-video group relative flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit] border border-book-edge/55 bg-desk text-book-bg shadow-[0_8px_24px_rgba(47,30,20,.25)] {className}"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		{src}
		{preload}
		playsinline
		poster={poster || undefined}
		class="min-h-0 w-full flex-1 bg-desk object-contain"
		onplay={() => (playing = true)}
		onpause={() => (playing = false)}
		onended={() => (playing = false)}
		onloadedmetadata={() => (duration = video?.duration || 0)}
		ontimeupdate={() => {
			currentTime = video?.currentTime || 0;
			duration = video?.duration || 0;
		}}
		onloadeddata={onLoadedData}
		onerror={onError}
	></video>

	<div
		class="video-controls shrink-0 border-t border-book-edge/40 bg-book-bg/95 px-2.5 py-2 text-book-ink backdrop-blur-md min-[480px]:px-3"
	>
		<input
			type="range"
			min="0"
			max={Math.max(duration, 0.1)}
			step="0.1"
			value={Math.min(currentTime, duration || currentTime)}
			style="--video-progress: {progress}%"
			class="video-seek mb-1.5 block h-1.5 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-book-accent"
			oninput={seek}
			aria-label="Video position"
			disabled={!duration}
		/>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="flex size-8 shrink-0 items-center justify-center rounded-full bg-book-accent/15 text-book-accent transition-colors hover:bg-book-accent/25 focus-visible:outline-2 focus-visible:outline-book-accent"
				onclick={() => void togglePlayback()}
				aria-label={playing ? 'Pause video' : 'Play video'}
			>
				<CommunityIcon name={playing ? 'pause' : 'play'} size={15} />
			</button>
			<span class="min-w-[66px] font-ui text-[10px] font-semibold text-book-ink/70 tabular-nums">
				{formatTime(currentTime)} / {formatTime(duration)}
			</span>
			<button
				type="button"
				class="flex size-8 shrink-0 items-center justify-center rounded-full text-book-ink/70 transition-colors hover:bg-book-accent/10 hover:text-book-accent focus-visible:outline-2 focus-visible:outline-book-accent"
				onclick={toggleMute}
				aria-label={muted ? 'Unmute video' : 'Mute video'}
			>
				<CommunityIcon name={muted || volume === 0 ? 'volume-x' : 'volume-2'} size={15} />
			</button>
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={muted ? 0 : volume}
				style="--video-progress: {(muted ? 0 : volume) * 100}%"
				class="video-volume h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-book-accent"
				oninput={(event) => setVolume(Number((event.currentTarget as HTMLInputElement).value))}
				aria-label="Video volume"
			/>
			<button
				type="button"
				class="flex size-8 shrink-0 items-center justify-center rounded-full text-book-ink/70 transition-colors hover:bg-book-accent/10 hover:text-book-accent focus-visible:outline-2 focus-visible:outline-book-accent"
				onclick={() => void toggleFullscreen()}
				aria-label="Toggle fullscreen"
			>
				<CommunityIcon name="expand" size={15} />
			</button>
		</div>
	</div>
</div>

<style>
	.video-seek,
	.video-volume {
		background: linear-gradient(
			to right,
			var(--color-book-accent) 0%,
			var(--color-book-accent) var(--video-progress),
			color-mix(in srgb, var(--color-book-edge) 55%, white) var(--video-progress),
			color-mix(in srgb, var(--color-book-edge) 55%, white) 100%
		);
	}

	.video-seek::-webkit-slider-thumb,
	.video-volume::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-book-bg);
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 5px rgb(34 20 12 / 35%);
	}

	.video-seek::-moz-range-thumb,
	.video-volume::-moz-range-thumb {
		width: 9px;
		height: 9px;
		border: 2px solid var(--color-book-bg);
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 5px rgb(34 20 12 / 35%);
	}
</style>
