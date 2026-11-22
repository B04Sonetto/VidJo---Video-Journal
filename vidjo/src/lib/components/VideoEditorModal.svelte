<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { journal } from '#lib/state/journal.svelte';

	let {
		open,
		date,
		sourceFile = null,
		sourceUrl = '',
		onClose
	}: {
		open: boolean;
		date: string;
		sourceFile?: File | null;
		sourceUrl?: string;
		onClose: () => void;
	} = $props();

	type CropMode = 'original' | 'landscape' | 'square' | 'portrait';
	type FilterMode = 'none' | 'warm' | 'soft' | 'mono' | 'vivid';

	let video = $state<HTMLVideoElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let sourceObjectUrl = $state('');
	let originalFile = $state<File | null>(null);
	let duration = $state(0);
	let trimStart = $state(0);
	let trimEnd = $state(0);
	let coverAt = $state(0);
	let crop = $state<CropMode>('original');
	let rotation = $state(0);
	let filter = $state<FilterMode>('none');
	let mute = $state(false);
	let loading = $state(false);
	let exporting = $state(false);
	let error = $state('');
	let wasOpen = false;
	let exportFrame = 0;
	let recorder: MediaRecorder | null = null;
	let exportStreams: MediaStream[] = [];

	const filters: Record<FilterMode, string> = {
		none: 'none',
		warm: 'sepia(.25) saturate(1.25) contrast(1.04)',
		soft: 'saturate(.78) brightness(1.06) contrast(.94)',
		mono: 'grayscale(1) contrast(1.08)',
		vivid: 'saturate(1.45) contrast(1.08)'
	};

	const previewRatio = $derived(
		crop === 'square' ? '1 / 1' : crop === 'portrait' ? '9 / 16' : '16 / 9'
	);
	const minSelection = $derived(Math.min(0.5, duration || 0.5));

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			void loadVideo();
		} else if (!open && wasOpen) {
			wasOpen = false;
			cleanup();
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

	async function loadVideo() {
		cleanup();
		error = '';
		loading = true;
		try {
			let blob: Blob;
			if (sourceFile) {
				blob = sourceFile;
			} else if (sourceUrl) {
				const response = await fetch(sourceUrl);
				if (!response.ok) throw new Error('Could not load this video for editing.');
				blob = await response.blob();
			} else {
				throw new Error('Choose a video to start editing.');
			}

			if (!blob.type.startsWith('video/')) {
				throw new Error('This file is not a supported video.');
			}
			originalFile =
				blob instanceof File
					? blob
					: new File([blob], `vidjo-${date}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, {
							type: blob.type
						});
			sourceObjectUrl = URL.createObjectURL(blob);
			await tick();
			if (!video) throw new Error('The video preview could not be opened.');
			video.src = sourceObjectUrl;
			video.load();
		} catch (loadError) {
			error = loadError instanceof Error ? loadError.message : 'Could not open this video.';
			loading = false;
		}
	}

	function onMetadata() {
		if (!video || !Number.isFinite(video.duration)) return;
		duration = video.duration;
		trimStart = 0;
		trimEnd = video.duration;
		coverAt = Math.min(1, video.duration / 2);
		loading = false;
	}

	function setTrimStart(value: number) {
		trimStart = Math.max(0, Math.min(value, trimEnd - minSelection));
		if (video && video.currentTime < trimStart) video.currentTime = trimStart;
	}

	function setTrimEnd(value: number) {
		trimEnd = Math.min(duration, Math.max(value, trimStart + minSelection));
		if (video && video.currentTime > trimEnd) video.currentTime = trimEnd;
	}

	function seekCover(value: number) {
		coverAt = Math.max(trimStart, Math.min(value, trimEnd));
		if (video) {
			video.pause();
			video.currentTime = coverAt;
		}
	}

	function canvasDimensions() {
		if (!video) throw new Error('The video is not ready yet.');
		const width = video.videoWidth || 1280;
		const height = video.videoHeight || 720;
		let aspect =
			crop === 'square'
				? 1
				: crop === 'portrait'
					? 9 / 16
					: crop === 'landscape'
						? 16 / 9
						: width / height;
		if (rotation % 180 !== 0) aspect = 1 / aspect;
		const maxSide = 1280;
		if (aspect >= 1) {
			return { width: maxSide, height: Math.max(1, Math.round(maxSide / aspect)) };
		}
		return { width: Math.max(1, Math.round(maxSide * aspect)), height: maxSide };
	}

	function drawFrame() {
		if (!video || !canvas) throw new Error('The video preview is not ready.');
		const dimensions = canvasDimensions();
		if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
		if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Your browser could not render the video preview.');

		const sourceWidth = video.videoWidth;
		const sourceHeight = video.videoHeight;
		const outputAspect = canvas.width / canvas.height;
		const sourceAspect = sourceWidth / sourceHeight;
		const cropAspect = rotation % 180 === 0 ? outputAspect : 1 / outputAspect;
		let sx = 0;
		let sy = 0;
		let sw = sourceWidth;
		let sh = sourceHeight;
		if (sourceAspect > cropAspect) {
			sw = sourceHeight * cropAspect;
			sx = (sourceWidth - sw) / 2;
		} else {
			sh = sourceWidth / cropAspect;
			sy = (sourceHeight - sh) / 2;
		}

		context.save();
		context.filter = filters[filter];
		context.translate(canvas.width / 2, canvas.height / 2);
		context.rotate((rotation * Math.PI) / 180);
		if (rotation % 180 === 0) {
			context.drawImage(
				video,
				sx,
				sy,
				sw,
				sh,
				-canvas.width / 2,
				-canvas.height / 2,
				canvas.width,
				canvas.height
			);
		} else {
			context.drawImage(
				video,
				sx,
				sy,
				sw,
				sh,
				-canvas.height / 2,
				-canvas.width / 2,
				canvas.height,
				canvas.width
			);
		}
		context.restore();
	}

	async function seekTo(time: number) {
		if (!video) throw new Error('The video preview is not ready.');
		if (Math.abs(video.currentTime - time) < 0.03) return;
		await new Promise<void>((resolve, reject) => {
			const cleanupSeek = () => {
				clearTimeout(timer);
				video?.removeEventListener('seeked', onSeeked);
			};
			const onSeeked = () => {
				cleanupSeek();
				resolve();
			};
			const timer = setTimeout(() => {
				cleanupSeek();
				reject(new Error('Timed out seeking within the video.'));
			}, 5000);
			video!.addEventListener('seeked', onSeeked, { once: true });
			video!.currentTime = time;
		});
	}

	async function coverBlob() {
		if (!video || !canvas) throw new Error('The cover frame is not ready.');
		await seekTo(coverAt);
		drawFrame();
		return new Promise<Blob>((resolve, reject) => {
			canvas!.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error('Could not create the video cover.')),
				'image/jpeg',
				0.82
			);
		});
	}

	function preferredMimeType() {
		if (typeof MediaRecorder === 'undefined') return '';
		return (
			['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) =>
				MediaRecorder.isTypeSupported(type)
			) || ''
		);
	}

	async function exportVideo(): Promise<{ blob: Blob; cover: Blob }> {
		if (!video || !canvas) throw new Error('The video preview is not ready.');
		if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
			throw new Error(
				'Video editing export is not supported in this browser. Try a current version of Chrome or Firefox.'
			);
		}
		const captureVideo = video as HTMLVideoElement & {
			captureStream?: () => MediaStream;
			mozCaptureStream?: () => MediaStream;
		};
		const capture = captureVideo.captureStream || captureVideo.mozCaptureStream;
		if (!capture) {
			throw new Error(
				'This browser cannot export edited video. Try a current version of Chrome or Firefox.'
			);
		}

		const cover = await coverBlob();
		const canvasStream = canvas.captureStream(30);
		const sourceStream = capture.call(video);
		exportStreams = [canvasStream, sourceStream];
		const tracks = [...canvasStream.getVideoTracks()];
		if (!mute) tracks.push(...sourceStream.getAudioTracks());
		if (!tracks.length) throw new Error('This video has no exportable media tracks.');

		const mimeType = preferredMimeType();
		const outputStream = new MediaStream(tracks);
		exportStreams.push(outputStream);
		let renderError: Error | null = null;
		const output = new Promise<Blob>((resolve, reject) => {
			const chunks: BlobPart[] = [];
			try {
				recorder = mimeType
					? new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 2_500_000 })
					: new MediaRecorder(outputStream, { videoBitsPerSecond: 2_500_000 });
			} catch {
				reject(new Error('Your browser could not prepare the edited video for export.'));
				return;
			}
			recorder.ondataavailable = (event) => {
				if (event.data.size) chunks.push(event.data);
			};
			recorder.onerror = () => reject(new Error('The video export stopped unexpectedly.'));
			recorder.onstop = () => {
				if (renderError) {
					reject(renderError);
					return;
				}
				const result = new Blob(chunks, { type: recorder?.mimeType || mimeType || 'video/webm' });
				if (!result.size) {
					reject(new Error('The edited video export was empty. Try again.'));
					return;
				}
				resolve(result);
			};
		});

		await seekTo(trimStart);

		await video.play();
		recorder!.start(250);
		const render = () => {
			if (!video || !recorder || recorder.state !== 'recording') return;
			try {
				drawFrame();
			} catch (drawError) {
				error = 'The video could not be rendered during export.';
				renderError =
					drawError instanceof Error
						? drawError
						: new Error('The video could not be rendered during export.');
				recorder.stop();
				return;
			}
			if (video.currentTime >= trimEnd || video.ended) {
				video.pause();
				recorder.stop();
				return;
			}
			exportFrame = requestAnimationFrame(render);
		};
		render();
		return { blob: await output, cover };
	}

	async function saveEdits() {
		if (!video || exporting || loading) return;
		error = '';
		exporting = true;
		try {
			const result = await exportVideo();
			const extension = result.blob.type.includes('mp4') ? 'mp4' : 'webm';
			const file = new File([result.blob], `vidjo-${date}.${extension}`, {
				type: result.blob.type || 'video/webm'
			});
			journal.current = date;
			await journal.setVideo(file, result.cover);
			onClose();
		} catch (saveError) {
			error =
				saveError instanceof Error ? saveError.message : 'Could not save your edits. Try again.';
		} finally {
			exporting = false;
			stopExport();
		}
	}

	async function saveOriginal() {
		if (!originalFile || exporting || loading) return;
		if (!sourceFile) {
			onClose();
			return;
		}
		error = '';
		exporting = true;
		try {
			journal.current = date;
			await journal.setVideo(originalFile);
			onClose();
		} catch (saveError) {
			error =
				saveError instanceof Error ? saveError.message : 'Could not save your video. Try again.';
		} finally {
			exporting = false;
		}
	}

	function stopExport() {
		if (exportFrame) cancelAnimationFrame(exportFrame);
		exportFrame = 0;
		if (recorder?.state === 'recording') {
			try {
				recorder.stop();
			} catch {
				recorder = null;
			}
		}
		recorder = null;
		for (const stream of exportStreams) {
			stream.getTracks().forEach((track) => track.stop());
		}
		exportStreams = [];
	}

	function cleanup() {
		stopExport();
		if (video) {
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
		if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
		sourceObjectUrl = '';
		originalFile = null;
		duration = 0;
		trimStart = 0;
		trimEnd = 0;
		coverAt = 0;
		crop = 'original';
		rotation = 0;
		filter = 'none';
		mute = false;
		error = '';
		loading = false;
	}

	function close() {
		if (exporting) return;
		onClose();
	}

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) close();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape' && !exporting) close();
	}}
/>

{#if open}
	<div
		use:portal
		class="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[rgba(21,13,22,.78)] px-3 py-5 backdrop-blur-sm min-[720px]:px-5"
		role="presentation"
		onclick={backdrop}
	>
		<div
			class="w-full max-w-[760px] overflow-hidden rounded-[24px] border border-cover-edge bg-book-bg text-book-ink shadow-[0_30px_90px_rgba(0,0,0,.65)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="video-editor-title"
		>
			<header class="flex items-start gap-3 border-b border-line px-4 py-4 min-[640px]:px-6">
				<div class="mr-auto">
					<p class="font-ui text-[10px] font-bold tracking-[.18em] text-book-accent uppercase">
						Your VidJo keepsake
					</p>
					<h2 id="video-editor-title" class="mt-1 font-display text-2xl font-bold">
						Edit your video
					</h2>
					<p class="mt-1 font-ui text-xs text-book-ink/65">
						Trim, crop, choose a cover, and give it your own look.
					</p>
				</div>
				<button
					type="button"
					class="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-book-ink/75 transition-colors hover:bg-paper-deep"
					onclick={close}
					disabled={exporting}
					aria-label="Close video editor"
				>
					<CommunityIcon name="x" size={17} />
				</button>
			</header>

			<div class="max-h-[calc(100dvh-170px)] overflow-y-auto p-4 min-[640px]:p-6">
				<div
					class="mx-auto overflow-hidden rounded-[16px] border border-book-edge/50 bg-desk shadow-[0_8px_24px_rgba(47,30,20,.2)]"
					style={`aspect-ratio: ${previewRatio}; max-height: 48dvh;`}
				>
					<video
						bind:this={video}
						class="h-full w-full object-contain"
						style={`filter: ${filters[filter]}; object-fit: ${crop === 'original' ? 'contain' : 'cover'}; transform: rotate(${rotation}deg);`}
						playsinline
						controls
						preload="metadata"
						onloadedmetadata={onMetadata}
						onerror={() => {
							loading = false;
							error = 'This video could not be decoded by your browser.';
						}}
					>
						<track kind="captions" />
					</video>
				</div>

				{#if loading}
					<p class="mt-3 text-center font-ui text-xs text-book-ink/65" role="status">
						Loading your video…
					</p>
				{/if}

				<div class="mt-5 grid gap-4 min-[640px]:grid-cols-2">
					<section class="rounded-2xl border border-line bg-paper/75 p-3.5">
						<h3 class="font-ui text-xs font-bold text-book-ink">Trim your moment</h3>
						<div class="mt-3 grid grid-cols-2 gap-3">
							<label class="font-ui text-[11px] font-semibold text-book-ink/70">
								Start · {trimStart.toFixed(1)}s
								<input
									type="range"
									min="0"
									max={Math.max(0, trimEnd - minSelection)}
									step="0.1"
									value={trimStart}
									oninput={(event) =>
										setTrimStart(Number((event.currentTarget as HTMLInputElement).value))}
									class="editor-range mt-2 h-2 w-full appearance-none rounded-full"
									disabled={!duration || exporting}
									aria-label="Trim start"
								/>
							</label>
							<label class="font-ui text-[11px] font-semibold text-book-ink/70">
								End · {trimEnd.toFixed(1)}s
								<input
									type="range"
									min={Math.min(duration, trimStart + minSelection)}
									max={duration || 0}
									step="0.1"
									value={trimEnd}
									oninput={(event) =>
										setTrimEnd(Number((event.currentTarget as HTMLInputElement).value))}
									class="editor-range mt-2 h-2 w-full appearance-none rounded-full"
									disabled={!duration || exporting}
									aria-label="Trim end"
								/>
							</label>
						</div>
					</section>

					<section class="rounded-2xl border border-line bg-paper/75 p-3.5">
						<h3 class="font-ui text-xs font-bold text-book-ink">Choose a cover frame</h3>
						<label class="mt-2 block font-ui text-[11px] font-semibold text-book-ink/70">
							Frame · {coverAt.toFixed(1)}s
							<input
								type="range"
								min={trimStart}
								max={Math.max(trimStart, trimEnd)}
								step="0.1"
								value={coverAt}
								oninput={(event) =>
									seekCover(Number((event.currentTarget as HTMLInputElement).value))}
								class="editor-range mt-2 h-2 w-full appearance-none rounded-full"
								disabled={!duration || exporting}
								aria-label="Choose cover frame"
							/>
						</label>
					</section>

					<section class="rounded-2xl border border-line bg-paper/75 p-3.5">
						<label class="block font-ui text-xs font-bold text-book-ink" for="video-crop">
							Frame shape
						</label>
						<div class="mt-2 flex gap-2">
							<select
								id="video-crop"
								bind:value={crop}
								class="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-book-bg px-3 font-ui text-xs text-book-ink focus:border-book-accent focus:outline-none"
								disabled={exporting}
							>
								<option value="original">Original</option>
								<option value="landscape">Landscape · 16:9</option>
								<option value="square">Square · 1:1</option>
								<option value="portrait">Portrait · 9:16</option>
							</select>
							<button
								type="button"
								class="min-h-10 rounded-xl border border-line bg-book-bg px-3 font-ui text-xs font-semibold text-book-ink transition-colors hover:bg-paper-deep"
								onclick={() => (rotation = (rotation + 90) % 360)}
								disabled={exporting}
							>
								Rotate {rotation}°
							</button>
						</div>
					</section>

					<section class="rounded-2xl border border-line bg-paper/75 p-3.5">
						<label class="block font-ui text-xs font-bold text-book-ink" for="video-filter">
							Film mood
						</label>
						<div class="mt-2 flex gap-2">
							<select
								id="video-filter"
								bind:value={filter}
								class="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-book-bg px-3 font-ui text-xs text-book-ink focus:border-book-accent focus:outline-none"
								disabled={exporting}
							>
								<option value="none">Original</option>
								<option value="warm">Warm film</option>
								<option value="soft">Soft light</option>
								<option value="mono">Black &amp; white</option>
								<option value="vivid">Vivid</option>
							</select>
							<label
								class="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-book-bg px-3 font-ui text-xs font-semibold text-book-ink"
							>
								<input type="checkbox" bind:checked={mute} disabled={exporting} />
								Mute
							</label>
						</div>
					</section>
				</div>

				<canvas bind:this={canvas} class="hidden"></canvas>

				{#if error}
					<p
						class="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 font-ui text-xs leading-relaxed text-danger"
						role="alert"
					>
						{error}
					</p>
				{/if}

				<footer class="mt-5 flex flex-col-reverse justify-between gap-2 min-[480px]:flex-row">
					<div class="flex flex-col-reverse gap-2 min-[480px]:flex-row">
						<button
							type="button"
							class="min-h-11 rounded-xl border border-line bg-paper px-4 font-ui text-sm font-semibold text-book-ink transition-colors hover:bg-paper-deep"
							onclick={close}
							disabled={exporting}
						>
							Cancel
						</button>
						<button
							type="button"
							class="min-h-11 rounded-xl border border-line bg-paper px-4 font-ui text-sm font-semibold text-book-ink transition-colors hover:bg-paper-deep disabled:opacity-60"
							onclick={() => void saveOriginal()}
							disabled={!originalFile || loading || exporting}
						>
							{sourceFile ? 'Use original' : 'Keep original'}
						</button>
					</div>
					<button
						type="button"
						class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-book-accent px-5 font-ui text-sm font-bold text-white shadow-[0_8px_18px_rgba(70,45,20,.18)] transition-colors hover:brightness-110 disabled:opacity-60"
						onclick={() => void saveEdits()}
						disabled={loading || !duration || exporting}
					>
						{#if exporting}
							<CommunityIcon name="refresh" size={15} class="animate-spin" />
							Exporting your video…
						{:else}
							<CommunityIcon name="check" size={15} />
							Save edited video
						{/if}
					</button>
				</footer>
			</div>
		</div>
	</div>
{/if}

<style>
	.editor-range {
		background: linear-gradient(
			to right,
			var(--color-book-accent) 0%,
			var(--color-book-accent) 65%,
			color-mix(in srgb, var(--color-book-edge) 45%, white) 65%,
			color-mix(in srgb, var(--color-book-edge) 45%, white) 100%
		);
	}

	.editor-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-book-bg);
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 5px rgb(34 20 12 / 35%);
	}

	.editor-range::-moz-range-thumb {
		width: 11px;
		height: 11px;
		border: 2px solid var(--color-book-bg);
		border-radius: 999px;
		background: var(--color-book-accent);
		box-shadow: 0 1px 5px rgb(34 20 12 / 35%);
	}
</style>
