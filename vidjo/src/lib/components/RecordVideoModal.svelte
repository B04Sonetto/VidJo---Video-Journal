<script lang="ts">
	import { tick } from 'svelte';
	import { journal } from '#lib/state/journal.svelte';

	let {
		open,
		date,
		onClose,
		onUpload
	}: {
		open: boolean;
		date: string;
		onClose: () => void;
		onUpload?: () => void;
	} = $props();

	type Stage = 'idle' | 'requesting' | 'ready' | 'recording' | 'processing' | 'review' | 'error';

	let stage = $state<Stage>('idle');
	let error = $state('');
	let elapsed = $state(0);
	let saving = $state(false);
	let mirrored = $state(true);
	let facing = $state<'user' | 'environment'>('user');
	let videoEl = $state<HTMLVideoElement | null>(null);
	let reviewEl = $state<HTMLVideoElement | null>(null);
	let closeButton = $state<HTMLButtonElement | null>(null);
	let reviewUrl = $state('');
	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let chunks: BlobPart[] = [];
	let blob: Blob | null = null;
	let mimeType = '';
	let timer: ReturnType<typeof setInterval> | null = null;
	let startedAt = 0;
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;
	let recorderFailed = false;

	const maxSeconds = 180;

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			void begin();
		} else if (!open && wasOpen) {
			wasOpen = false;
			cleanup();
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});

	$effect(() => {
		if (!open) return;

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	async function begin() {
		stage = 'idle';
		error = '';
		saving = false;
		blob = null;
		chunks = [];
		recorderFailed = false;

		if (reviewUrl) {
			URL.revokeObjectURL(reviewUrl);
			reviewUrl = '';
		}

		await tick();
		closeButton?.focus();
		await startStream();
	}

	async function startStream() {
		stopStream();
		stage = 'requesting';
		error = '';

		if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			fail('Camera access is not available in this browser. You can upload a video instead.');
			return;
		}

		try {
			const next = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: facing,
					width: { ideal: 1280 },
					height: { ideal: 720 }
				},
				audio: true
			});

			if (!open) {
				next.getTracks().forEach((track) => track.stop());
				return;
			}

			stream = next;

			if (videoEl) {
				videoEl.srcObject = next;
				await videoEl.play().catch(() => {});
			}

			stage = 'ready';
		} catch (cameraError) {
			fail(cameraMessage(cameraError));
		}
	}

	function cameraMessage(cameraError: unknown) {
		if (cameraError instanceof DOMException) {
			if (cameraError.name === 'NotAllowedError' || cameraError.name === 'SecurityError') {
				return 'Camera and microphone access was blocked. Allow it in your browser, then try again.';
			}
			if (cameraError.name === 'NotFoundError' || cameraError.name === 'DevicesNotFoundError') {
				return 'No camera was found on this device. You can upload a video instead.';
			}
			if (cameraError.name === 'NotReadableError') {
				return 'The camera is busy in another app. Close it, then try again.';
			}
		}

		return 'The camera could not be started. You can upload a video instead.';
	}

	function fail(message: string) {
		clearTimer();
		disposeRecorder();
		stopStream();
		stage = 'error';
		error = message;
	}

	/**
	 * Detach and stop the recorder without letting `onstop` build a review clip.
	 * Used when the modal closes mid-recording or the recorder errors out.
	 */
	function disposeRecorder() {
		const current = recorder;
		recorder = null;
		if (!current) return;

		current.ondataavailable = null;
		current.onerror = null;
		current.onstop = null;

		if (current.state !== 'inactive') {
			try {
				current.stop();
			} catch {
				// The recorder already stopped itself.
			}
		}
	}

	function pickMimeType() {
		if (typeof MediaRecorder === 'undefined') return '';

		const candidates = [
			'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
			'video/webm;codecs=vp9,opus',
			'video/webm;codecs=vp8,opus',
			'video/webm',
			'video/mp4'
		];

		try {
			return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
		} catch {
			return '';
		}
	}

	function startRecording() {
		if (!stream || stage !== 'ready') return;

		if (typeof MediaRecorder === 'undefined') {
			fail('Recording is not supported in this browser. You can upload a video instead.');
			return;
		}

		mimeType = pickMimeType();
		recorderFailed = false;
		chunks = [];
		disposeRecorder();

		try {
			recorder = mimeType
				? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 })
				: new MediaRecorder(stream, { videoBitsPerSecond: 2_500_000 });
		} catch {
			fail('This browser could not start the recorder. You can upload a video instead.');
			return;
		}

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};

		recorder.onerror = () => {
			recorderFailed = true;
			fail('Recording stopped unexpectedly. Try again.');
		};

		recorder.onstop = finishRecording;

		try {
			recorder.start(250);
		} catch {
			fail('This browser could not start the recorder. You can upload a video instead.');
			return;
		}

		startedAt = performance.now();
		elapsed = 0;
		stage = 'recording';
		clearTimer();
		timer = setInterval(updateElapsed, 200);
	}

	function updateElapsed() {
		elapsed = Math.min(maxSeconds, (performance.now() - startedAt) / 1000);
		if (elapsed >= maxSeconds) stopRecording();
	}

	function stopRecording() {
		if (stage !== 'recording') return;

		clearTimer();
		stage = 'processing';

		try {
			recorder?.stop();
		} catch {
			fail('Recording could not be finished. Try again.');
		}
	}

	function finishRecording() {
		clearTimer();

		if (recorderFailed) {
			recorder = null;
			return;
		}

		const type = recorder?.mimeType || mimeType || 'video/webm';
		const recorded = new Blob(chunks, { type });
		chunks = [];
		recorder = null;
		stopStream();

		if (recorded.size === 0) {
			fail('That recording came back empty. Try again.');
			return;
		}

		blob = recorded;

		if (reviewUrl) URL.revokeObjectURL(reviewUrl);
		reviewUrl = URL.createObjectURL(recorded);
		stage = 'review';

		void tick().then(() => {
			reviewEl?.play().catch(() => {});
		});
	}

	async function retake() {
		if (saving) return;

		if (reviewUrl) {
			URL.revokeObjectURL(reviewUrl);
			reviewUrl = '';
		}

		blob = null;
		chunks = [];
		elapsed = 0;
		stage = 'requesting';
		await startStream();
	}

	async function useVideo() {
		if (!blob || saving) return;

		saving = true;
		error = '';

		try {
			const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
			const file = new File([blob], `vidjo-${date}.${extension}`, {
				type: blob.type || 'video/webm'
			});

			await journal.setVideo(file);
			onClose();
		} catch {
			error = 'Could not save that video. Try again.';
			stage = 'error';
		} finally {
			saving = false;
		}
	}

	async function flipCamera() {
		if (stage !== 'ready' || saving) return;

		facing = facing === 'user' ? 'environment' : 'user';
		mirrored = facing === 'user';
		await startStream();
	}

	function close() {
		if (saving) return;
		onClose();
	}

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget && !saving) onClose();
	}

	function uploadInstead() {
		if (saving) return;
		onUpload?.();
	}

	function clearTimer() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function stopStream() {
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
			stream = null;
		}

		if (videoEl) videoEl.srcObject = null;
	}

	function cleanup() {
		clearTimer();
		disposeRecorder();
		stopStream();
		chunks = [];
		blob = null;
		mimeType = '';
		recorderFailed = false;
		elapsed = 0;
		saving = false;
		error = '';
		stage = 'idle';

		if (reviewUrl) {
			URL.revokeObjectURL(reviewUrl);
			reviewUrl = '';
		}
	}

	function formatTime(seconds: number) {
		const total = Math.max(0, Math.floor(seconds));
		const minutes = Math.floor(total / 60);
		const remainder = total % 60;
		return `${minutes}:${String(remainder).padStart(2, '0')}`;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape' && !saving) onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-[rgba(15,8,25,.8)] px-4 py-6"
		data-modal-open
		role="presentation"
		onclick={backdrop}
	>
		<div
			class="w-[min(820px,100%)] rounded-[24px] border border-[#4A3670] bg-desk-2 p-4 text-white shadow-[0_30px_80px_rgba(0,0,0,.65)] sm:p-6"
			role="dialog"
			aria-modal="true"
			aria-labelledby="record-title"
			aria-describedby="record-help"
		>
			<div class="mb-4 flex items-start gap-3">
				<div class="mr-auto">
					<h2 id="record-title" class="m-0 font-display text-[28px] leading-tight font-bold">
						Record a VidJo
					</h2>
					<p id="record-help" class="mt-1 font-hand text-lg text-[#C9B8E8]">
						Up to 3 minutes. Take your time — it is your page.
					</p>
				</div>

				<button
					bind:this={closeButton}
					type="button"
					class="flex size-11 flex-none items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] text-white hover:bg-[#43306A] disabled:opacity-50"
					aria-label="Close video recorder"
					disabled={saving}
					onclick={close}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M6 6l12 12M18 6L6 18"></path>
					</svg>
				</button>
			</div>

			<div
				class="relative aspect-video overflow-hidden rounded-2xl border border-[#4A3670] bg-[#120A20]"
			>
				{#if stage === 'review'}
					<video
						bind:this={reviewEl}
						src={reviewUrl}
						controls
						playsinline
						class="block h-full w-full bg-[#120A20] object-contain"
					>
						<track kind="captions" />
					</video>
				{:else if stage === 'error'}
					<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
						<div
							class="flex size-14 items-center justify-center rounded-full border border-[#6A528F] bg-[#33224D] text-gold"
						>
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<rect x="2.5" y="6" width="13" height="12" rx="2.5"></rect>
								<path d="M15.5 10.5l6-3.5v10l-6-3.5z"></path>
							</svg>
						</div>
						<p class="max-w-[440px] font-hand text-xl leading-snug text-[#EDE6F7]" role="alert">
							{error}
						</p>
						<div class="mt-1 flex flex-wrap justify-center gap-2.5">
							<button
								type="button"
								class="min-h-11 rounded-xl border-[1.5px] border-lav bg-white/[.06] px-4 font-ui text-sm font-medium text-white hover:bg-white/[.16]"
								onclick={() => startStream()}
							>
								Try camera again
							</button>
							{#if onUpload}
								<button
									type="button"
									class="min-h-11 rounded-xl bg-accent px-4 font-ui text-sm font-medium text-white hover:bg-[#624690]"
									onclick={uploadInstead}
								>
									Upload a video instead
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<video
						bind:this={videoEl}
						autoplay
						muted
						playsinline
						class="block h-full w-full bg-[#120A20] object-contain {mirrored ? '-scale-x-100' : ''}"
					></video>

					{#if stage === 'requesting' || stage === 'processing'}
						<div
							class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#120A20]/75 px-5 text-center"
						>
							<svg
								class="size-8 animate-spin text-gold"
								viewBox="0 0 24 24"
								fill="none"
								aria-hidden="true"
							>
								<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".3"
								></circle>
								<path
									d="M21 12a9 9 0 00-9-9"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
								></path>
							</svg>
							<p class="font-ui text-sm text-[#D6CBEC]" role="status">
								{stage === 'requesting' ? 'Starting camera…' : 'Finishing your video…'}
							</p>
						</div>
					{/if}

					{#if stage === 'recording'}
						<div
							class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-[#120A20]/75 px-3 py-1.5 font-ui text-sm font-medium text-white"
							aria-hidden="true"
						>
							<span class="size-2.5 animate-pulse rounded-full bg-[#E05A5A]"></span>
							Recording
						</div>
					{/if}
				{/if}

				{#if saving}
					<div
						class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#120A20]/85 px-5 text-center"
					>
						<svg
							class="size-8 animate-spin text-gold"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".3"
							></circle>
							<path
								d="M21 12a9 9 0 00-9-9"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
							></path>
						</svg>
						<p class="font-ui text-sm text-[#D6CBEC]" role="status">Saving your video…</p>
					</div>
				{/if}
			</div>

			{#if stage !== 'error'}
				<div class="mt-4 flex flex-wrap items-center justify-center gap-3">
					{#if stage === 'review'}
						<span class="mr-auto font-ui text-sm text-[#BBA8E0]">
							Recorded {formatTime(elapsed)}
						</span>
						<button
							type="button"
							class="min-h-11 rounded-xl border-[1.5px] border-[#5A4580] bg-[#33224D] px-4 font-ui text-sm font-medium text-white hover:bg-[#43306A] disabled:opacity-50"
							disabled={saving}
							onclick={retake}
						>
							Retake
						</button>
						<button
							type="button"
							class="min-h-11 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white hover:bg-[#624690] disabled:cursor-wait disabled:opacity-60"
							disabled={saving}
							onclick={useVideo}
						>
							Use this video
						</button>
					{:else if stage === 'recording'}
						<span class="mr-auto font-display text-2xl text-white">{formatTime(elapsed)}</span>
						<button
							type="button"
							class="flex min-h-11 items-center gap-2 rounded-xl bg-[#C94F4F] px-5 font-ui text-sm font-bold text-white hover:bg-[#B54444]"
							onclick={stopRecording}
						>
							<span class="size-3.5 rounded-[3px] bg-white" aria-hidden="true"></span>
							Stop recording
						</button>
					{:else if stage === 'processing'}
						<span class="font-ui text-sm text-[#BBA8E0]">Almost there…</span>
					{:else}
						<span class="mr-auto font-ui text-sm text-[#BBA8E0]">
							{stage === 'requesting' ? 'Waiting for camera…' : 'Camera ready'}
						</span>
						<button
							type="button"
							class="min-h-11 rounded-xl border-[1.5px] border-[#5A4580] bg-[#33224D] px-4 font-ui text-sm font-medium text-white hover:bg-[#43306A] disabled:opacity-40"
							disabled={stage !== 'ready'}
							onclick={flipCamera}
						>
							Flip camera
						</button>
						<button
							type="button"
							class="flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white hover:bg-[#624690] disabled:cursor-wait disabled:opacity-40"
							disabled={stage !== 'ready'}
							onclick={startRecording}
						>
							<span class="size-4 rounded-full bg-[#E05A5A] ring-4 ring-white/20" aria-hidden="true"
							></span>
							Start recording
						</button>
					{/if}
				</div>
			{/if}

			<p class="mt-4 text-center font-hand text-base text-[#9E8CC0]">
				Your video stays private to your journal. It is saved on this device until it syncs.
			</p>
		</div>
	</div>
{/if}
