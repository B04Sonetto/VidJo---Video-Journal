<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
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

	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

	let video = $state<HTMLVideoElement | null>(null);
	let wrapper = $state<HTMLDivElement | null>(null);
	let playing = $state(false);
	let muted = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let buffered = $state(0);
	let speed = $state(1);
	let waiting = $state(false);
	let isFullscreen = $state(false);
	let pipAvailable = $state(false);
	let pipActive = $state(false);
	let controlsVisible = $state(true);
	let scrubbing = $state(false);
	let hoverTime = $state<number | null>(null);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	const progress = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);
	const bufferedPercent = $derived(Math.max(progress, buffered));
	const volumePercent = $derived(muted ? 0 : volume * 100);
	const volumeIcon = $derived(
		muted || volume === 0 ? 'volume-x' : volume < 0.5 ? 'volume-1' : 'volume-2'
	);
	const hoverPercent = $derived(
		hoverTime !== null && duration > 0
			? Math.min(100, Math.max(0, (hoverTime / duration) * 100))
			: 0
	);

	function formatTime(value: number) {
		if (!Number.isFinite(value)) return '0:00';
		const total = Math.max(0, Math.floor(value));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	}

	function showControls() {
		controlsVisible = true;
		if (hideTimer) clearTimeout(hideTimer);
		if (playing && !scrubbing) {
			hideTimer = setTimeout(() => (controlsVisible = false), 2200);
		}
	}

	function scheduleHide() {
		if (hideTimer) clearTimeout(hideTimer);
		if (playing && !scrubbing) {
			hideTimer = setTimeout(() => (controlsVisible = false), 1200);
		}
	}

	async function togglePlayback() {
		if (!video) return;
		showControls();
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

	function seekTo(value: number) {
		if (!video || !duration) return;
		const next = Math.min(Math.max(value, 0), duration);
		video.currentTime = next;
		currentTime = next;
	}

	function seek(event: Event) {
		seekTo(Number((event.currentTarget as HTMLInputElement).value));
	}

	function seekBy(seconds: number) {
		seekTo((video?.currentTime || 0) + seconds);
		showControls();
	}

	function updateBuffered() {
		const el = video;
		if (!el || !Number.isFinite(el.duration) || el.duration <= 0 || !el.buffered.length) {
			buffered = 0;
			return;
		}
		let end = 0;
		for (let i = 0; i < el.buffered.length; i += 1) {
			if (el.buffered.start(i) <= el.currentTime && el.currentTime <= el.buffered.end(i)) {
				end = el.buffered.end(i);
				break;
			}
			end = Math.max(end, el.buffered.end(i));
		}
		buffered = Math.min(100, (end / el.duration) * 100);
	}

	function toggleMute() {
		if (!video) return;
		muted = !muted;
		video.muted = muted;
		if (!muted && video.volume === 0) setVolume(0.65);
		showControls();
	}

	function setVolume(value: number) {
		if (!video) return;
		volume = Math.min(1, Math.max(0, value));
		video.volume = volume;
		video.muted = volume === 0;
		muted = video.muted;
		showControls();
	}

	function cycleSpeed() {
		if (!video) return;
		speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
		video.playbackRate = speed;
		showControls();
	}

	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await wrapper?.requestFullscreen();
			}
		} catch {
			// Fullscreen is optional and may be blocked by the browser.
		}
	}

	async function togglePictureInPicture() {
		if (!video || !pipAvailable) return;
		try {
			if (document.pictureInPictureElement === video) {
				await document.exitPictureInPicture();
			} else {
				await video.requestPictureInPicture();
			}
		} catch {
			// Picture-in-picture is optional and may be blocked by the browser.
		}
	}

	function trackHoverTime(event: PointerEvent) {
		if (!duration) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		if (!rect.width) return;
		hoverTime = ((event.clientX - rect.left) / rect.width) * duration;
		showControls();
	}

	function playerIsActive() {
		if (!wrapper) return false;
		const active = document.activeElement;
		if (active && wrapper.contains(active)) return true;
		// Let a focused player win over one that is merely hovered.
		if (active?.closest('.themed-video')) return false;
		return wrapper.matches(':hover');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!playerIsActive() || !video) return;
		const target = event.target as HTMLElement | null;
		if (
			target?.isContentEditable ||
			(target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
		) {
			return;
		}

		switch (event.key) {
			case ' ':
			case 'k':
			case 'K':
				event.preventDefault();
				void togglePlayback();
				break;
			case 'ArrowLeft':
				event.preventDefault();
				seekBy(-5);
				break;
			case 'ArrowRight':
				event.preventDefault();
				seekBy(5);
				break;
			case 'ArrowUp':
				event.preventDefault();
				setVolume(volume + 0.05);
				break;
			case 'ArrowDown':
				event.preventDefault();
				setVolume(volume - 0.05);
				break;
			case 'm':
			case 'M':
				event.preventDefault();
				toggleMute();
				break;
			case 'f':
			case 'F':
				event.preventDefault();
				void toggleFullscreen();
				break;
		}
	}

	$effect(() => {
		// A new source is a new video: clear the previous playback state.
		src;
		currentTime = 0;
		duration = 0;
		buffered = 0;
		waiting = false;
		playing = false;
		speed = 1;
		if (video) video.playbackRate = 1;
	});

	onMount(() => {
		const el = video;
		pipAvailable =
			document.pictureInPictureEnabled && typeof el?.requestPictureInPicture === 'function';
		const onEnterPip = () => (pipActive = true);
		const onLeavePip = () => (pipActive = false);
		el?.addEventListener('enterpictureinpicture', onEnterPip);
		el?.addEventListener('leavepictureinpicture', onLeavePip);
		return () => {
			el?.removeEventListener('enterpictureinpicture', onEnterPip);
			el?.removeEventListener('leavepictureinpicture', onLeavePip);
		};
	});

	onDestroy(() => {
		if (hideTimer) clearTimeout(hideTimer);
	});
</script>

<svelte:window
	onkeydown={handleKeydown}
	onfullscreenchange={() => {
		isFullscreen = document.fullscreenElement === wrapper;
		showControls();
	}}
/>

<div
	bind:this={wrapper}
	role="group"
	aria-label="Video player"
	class="themed-video group relative isolate flex min-h-0 w-full flex-col overflow-hidden rounded-[inherit] border border-book-edge/55 bg-desk text-book-bg shadow-[0_10px_30px_rgba(20,10,30,.35)] {className}"
	class:controls-hidden={!controlsVisible}
	onpointermove={showControls}
	onpointerleave={scheduleHide}
	onfocusin={showControls}
	onfocusout={scheduleHide}
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		{src}
		{preload}
		playsinline
		poster={poster || undefined}
		class="absolute inset-0 size-full bg-desk object-contain"
		onclick={() => void togglePlayback()}
		onplay={() => {
			playing = true;
			waiting = false;
			showControls();
		}}
		onpause={() => {
			playing = false;
			controlsVisible = true;
		}}
		onended={() => {
			playing = false;
			controlsVisible = true;
		}}
		onwaiting={() => (waiting = true)}
		onplaying={() => (waiting = false)}
		oncanplay={() => (waiting = false)}
		onloadedmetadata={() => {
			duration = Number.isFinite(video?.duration) ? video!.duration : 0;
			updateBuffered();
		}}
		ondurationchange={() => {
			duration = Number.isFinite(video?.duration) ? video!.duration : 0;
		}}
		ontimeupdate={() => {
			currentTime = video?.currentTime || 0;
			updateBuffered();
		}}
		onprogress={updateBuffered}
		onvolumechange={() => {
			if (video) {
				volume = video.volume;
				muted = video.muted;
			}
		}}
		onratechange={() => {
			if (video) speed = video.playbackRate;
		}}
		onloadeddata={onLoadedData}
		onerror={() => {
			waiting = false;
			playing = false;
			onError?.();
		}}
	></video>

	<div class="top-scrim pointer-events-none absolute inset-x-0 top-0 z-10 h-24"></div>

	{#if !playing && !waiting}
		<button
			type="button"
			class="center-play absolute top-1/2 left-1/2 z-20 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-book-bg transition-all duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-book-accent min-[520px]:size-16"
			onclick={() => void togglePlayback()}
			aria-label="Play video"
			title="Play (space)"
		>
			<svg viewBox="0 0 24 24" fill="currentColor" class="ml-0.5 size-7" aria-hidden="true">
				<path
					d="M8 5.3v13.4a.8.8 0 0 0 1.22.68l10.2-6.7a.8.8 0 0 0 0-1.36L9.22 4.62A.8.8 0 0 0 8 5.3Z"
				></path>
			</svg>
		</button>
	{/if}

	{#if waiting}
		<div class="pointer-events-none absolute inset-0 z-20 grid place-items-center">
			<span class="video-spinner" aria-label="Loading video"></span>
		</div>
	{/if}

	<div class="bottom-scrim pointer-events-none absolute inset-x-0 bottom-0 z-20 h-40"></div>

	<div
		class="control-dock absolute inset-x-0 bottom-0 z-30 px-2 pt-8 pb-2 min-[520px]:px-3 min-[520px]:pb-3"
	>
		<div
			class="dock-surface mx-auto flex w-full max-w-[760px] flex-col gap-1.5 rounded-2xl border border-white/12 px-2.5 py-2 text-white shadow-[0_12px_32px_rgba(0,0,0,.5)] min-[520px]:px-3"
		>
			<div
				class="seek-area"
				role="presentation"
				onpointermove={trackHoverTime}
				onpointerleave={() => (hoverTime = null)}
			>
				<div class="seek-rail">
					<div class="seek-buffered" style="width: {bufferedPercent}%"></div>
					<div class="seek-played" style="width: {progress}%"></div>
					{#if hoverTime !== null && duration > 0}
						<div class="seek-hover" style="left: {hoverPercent}%"></div>
					{/if}
				</div>
				{#if hoverTime !== null && duration > 0}
					<span
						class="seek-tip font-ui tabular-nums"
						style="left: {Math.min(94, Math.max(6, hoverPercent))}%">{formatTime(hoverTime)}</span
					>
				{/if}
				<input
					type="range"
					min="0"
					max={Math.max(duration, 0.1)}
					step="0.1"
					value={Math.min(currentTime, duration || currentTime)}
					class="seek-input"
					oninput={seek}
					onpointerdown={() => {
						scrubbing = true;
						showControls();
					}}
					onpointerup={() => {
						scrubbing = false;
						scheduleHide();
					}}
					onpointercancel={() => (scrubbing = false)}
					aria-label="Video position"
					disabled={!duration}
				/>
			</div>

			<div class="flex items-center gap-1.5 min-[520px]:gap-2">
				<button
					type="button"
					class="control-btn primary-btn"
					onclick={() => void togglePlayback()}
					aria-label={playing ? 'Pause video' : 'Play video'}
					title={playing ? 'Pause (space)' : 'Play (space)'}
				>
					<CommunityIcon name={playing ? 'pause' : 'play'} size={16} />
				</button>

				<span class="time-readout font-ui tabular-nums">
					{formatTime(currentTime)}<span class="time-divider"> / </span><span class="time-total"
						>{formatTime(duration)}</span
					>
				</span>

				<div class="ml-auto flex items-center gap-1 min-[520px]:gap-1.5">
					<div class="volume-group flex items-center gap-1">
						<button
							type="button"
							class="control-btn"
							onclick={toggleMute}
							aria-label={muted ? 'Unmute video' : 'Mute video'}
							title={muted ? 'Unmute (M)' : 'Mute (M)'}
						>
							<CommunityIcon name={volumeIcon} size={16} />
						</button>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={muted ? 0 : volume}
							style="--volume-progress: {volumePercent}%"
							class="volume-input"
							oninput={(event) =>
								setVolume(Number((event.currentTarget as HTMLInputElement).value))}
							aria-label="Video volume"
						/>
					</div>

					<button
						type="button"
						class="control-btn speed-btn font-ui tabular-nums"
						onclick={cycleSpeed}
						aria-label="Playback speed: {speed}x. Click to change."
						title="Playback speed"
					>
						{speed}×
					</button>

					{#if pipAvailable}
						<button
							type="button"
							class="control-btn pip-btn"
							class:active={pipActive}
							onclick={() => void togglePictureInPicture()}
							aria-label={pipActive ? 'Exit picture-in-picture' : 'Enter picture-in-picture'}
							title="Picture-in-picture"
						>
							<CommunityIcon name="picture-in-picture" size={16} />
						</button>
					{/if}

					<button
						type="button"
						class="control-btn"
						onclick={() => void toggleFullscreen()}
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
						title="Fullscreen (F)"
					>
						<CommunityIcon name={isFullscreen ? 'minimize' : 'expand'} size={16} />
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.themed-video {
		container-type: inline-size;
		container-name: player;
	}

	.themed-video:fullscreen {
		width: 100vw;
		height: 100vh;
		border: 0;
		border-radius: 0;
		background: #000;
	}

	.themed-video:fullscreen video {
		object-fit: contain;
	}

	.top-scrim {
		background: linear-gradient(to bottom, rgb(6 4 12 / 55%), transparent);
		transition: opacity 250ms ease;
	}

	.bottom-scrim {
		background: linear-gradient(to top, rgb(6 4 12 / 88%) 0%, rgb(6 4 12 / 45%) 45%, transparent);
		transition: opacity 250ms ease;
	}

	.control-dock {
		transition:
			opacity 220ms ease,
			transform 220ms ease;
	}

	.controls-hidden .control-dock,
	.controls-hidden .bottom-scrim,
	.controls-hidden .top-scrim {
		opacity: 0;
		pointer-events: none;
		transform: translateY(6px);
	}

	.control-dock:focus-within {
		opacity: 1;
		pointer-events: auto;
		transform: none;
	}

	.center-play {
		background: color-mix(in srgb, var(--color-book-accent) 18%, rgb(10 6 20 / 72%));
		border: 1px solid color-mix(in srgb, var(--color-book-accent) 55%, white 12%);
		box-shadow:
			0 10px 30px rgb(0 0 0 / 45%),
			inset 0 1px 0 rgb(255 255 255 / 18%);
		backdrop-filter: blur(10px);
	}

	.center-play:hover {
		background: color-mix(in srgb, var(--color-book-accent) 32%, rgb(10 6 20 / 72%));
	}

	.video-spinner {
		width: 34px;
		height: 34px;
		border: 3px solid rgb(255 255 255 / 22%);
		border-top-color: var(--color-book-accent);
		border-radius: 999px;
		animation: video-spin 750ms linear infinite;
	}

	@keyframes video-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.video-spinner {
			animation-duration: 1.6s;
		}
	}

	.dock-surface {
		background: rgb(12 8 22 / 72%);
		backdrop-filter: blur(18px) saturate(140%);
	}

	.seek-area {
		position: relative;
		display: flex;
		height: 16px;
		align-items: center;
	}

	.seek-rail,
	.seek-buffered,
	.seek-played {
		position: absolute;
		left: 0;
		border-radius: 999px;
	}

	.seek-rail {
		right: 0;
		height: 4px;
		background: rgb(255 255 255 / 22%);
		overflow: visible;
	}

	.seek-buffered {
		top: 0;
		bottom: 0;
		background: rgb(255 255 255 / 32%);
	}

	.seek-played {
		top: 0;
		bottom: 0;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--color-book-accent) 78%, white),
			var(--color-book-accent)
		);
		box-shadow: 0 0 10px color-mix(in srgb, var(--color-book-accent) 45%, transparent);
	}

	.seek-hover {
		position: absolute;
		top: -3px;
		width: 2px;
		height: 10px;
		border-radius: 2px;
		background: rgb(255 255 255 / 75%);
	}

	.seek-tip {
		position: absolute;
		bottom: 18px;
		transform: translateX(-50%);
		padding: 2px 6px;
		border-radius: 6px;
		background: rgb(8 5 16 / 92%);
		border: 1px solid rgb(255 255 255 / 14%);
		font-size: 10px;
		font-weight: 600;
		line-height: 1.3;
		pointer-events: none;
	}

	.seek-input,
	.volume-input {
		margin: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	.seek-input {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 16px;
	}

	.seek-input:disabled {
		cursor: default;
	}

	.seek-input::-webkit-slider-thumb,
	.volume-input::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border: 2px solid white;
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 6px rgb(0 0 0 / 55%);
		transition: transform 150ms ease;
	}

	.seek-area:hover .seek-input::-webkit-slider-thumb,
	.volume-group:hover .volume-input::-webkit-slider-thumb {
		transform: scale(1.15);
	}

	.seek-input::-moz-range-thumb,
	.volume-input::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border: 2px solid white;
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 6px rgb(0 0 0 / 55%);
	}

	.seek-input:focus-visible,
	.volume-input:focus-visible,
	.control-btn:focus-visible {
		outline: 2px solid var(--color-book-accent);
		outline-offset: 2px;
	}

	.control-btn {
		display: flex;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		align-items: center;
		justify-content: center;
		border-radius: 9px;
		background: rgb(255 255 255 / 9%);
		color: rgb(255 255 255 / 82%);
		transition:
			background 160ms ease,
			color 160ms ease,
			transform 160ms ease;
	}

	.control-btn:hover {
		background: rgb(255 255 255 / 18%);
		color: white;
		transform: translateY(-1px);
	}

	.control-btn.active {
		background: color-mix(in srgb, var(--color-book-accent) 30%, transparent);
		color: color-mix(in srgb, var(--color-book-accent) 70%, white);
	}

	.primary-btn {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--color-book-accent);
		color: color-mix(in srgb, var(--color-book-ink) 90%, black);
		box-shadow: 0 4px 14px color-mix(in srgb, var(--color-book-accent) 32%, transparent);
	}

	.primary-btn:hover {
		background: color-mix(in srgb, var(--color-book-accent) 82%, white);
		color: color-mix(in srgb, var(--color-book-ink) 90%, black);
	}

	.time-readout {
		flex-shrink: 0;
		padding-inline: 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: white;
	}

	.time-divider,
	.time-total {
		color: rgb(255 255 255 / 52%);
	}

	.speed-btn {
		width: auto;
		min-width: 34px;
		padding-inline: 6px;
		font-size: 10px;
		font-weight: 700;
	}

	.volume-input {
		width: 62px;
		height: 14px;
		transition: width 180ms ease;
	}

	.volume-input:hover,
	.volume-input:focus-visible {
		width: 78px;
	}

	.volume-input {
		background: linear-gradient(
			to right,
			var(--color-book-accent) 0%,
			var(--color-book-accent) var(--volume-progress),
			rgb(255 255 255 / 24%) var(--volume-progress),
			rgb(255 255 255 / 24%) 100%
		);
		background-size: 100% 4px;
		background-position: center;
		background-repeat: no-repeat;
	}

	@container player (max-width: 470px) {
		.volume-input,
		.speed-btn,
		.pip-btn {
			display: none;
		}
	}

	@container player (max-width: 320px) {
		.time-total,
		.time-divider {
			display: none;
		}
	}
</style>
