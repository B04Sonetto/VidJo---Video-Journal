<script lang="ts">
	import { portal } from '#lib/actions/portal';
	import Button from '#lib/components/ui/Button.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	/** Lets the user drag and zoom an image before it is uploaded. */
	let {
		file,
		kind,
		onCancel,
		onConfirm
	}: {
		file: File;
		kind: 'avatar' | 'banner';
		onCancel: () => void;
		onConfirm: (result: File, previewUrl: string) => void;
	} = $props();

	const id = $props.id();
	const isBanner = $derived(kind === 'banner');
	const outputWidth = $derived(isBanner ? 1600 : 512);
	const outputHeight = $derived(isBanner ? 480 : 512);

	let frameW = $state(0);
	let frameH = $state(0);
	let zoom = $state(1);
	let offsetX = $state(0);
	let offsetY = $state(0);
	let image = $state<HTMLImageElement | null>(null);
	let sourceUrl = $state('');
	let loading = $state(true);
	let exporting = $state(false);
	let error = $state('');
	let dragging = $state(false);
	let dragStart = { x: 0, y: 0, ox: 0, oy: 0 };

	const baseScale = $derived.by(() => {
		if (!image || !frameW || !frameH) return 0;
		return Math.max(frameW / image.naturalWidth, frameH / image.naturalHeight);
	});
	const displayW = $derived(image && baseScale ? image.naturalWidth * baseScale * zoom : 0);
	const displayH = $derived(image && baseScale ? image.naturalHeight * baseScale * zoom : 0);
	const maxX = $derived(Math.max(0, (displayW - frameW) / 2));
	const maxY = $derived(Math.max(0, (displayH - frameH) / 2));

	$effect(() => {
		// Keep the image covering the frame at every zoom level.
		offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
		offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
	});

	$effect(() => {
		const selected = file;
		let cancelled = false;
		const url = URL.createObjectURL(selected);
		sourceUrl = url;
		loading = true;
		error = '';
		image = null;
		zoom = 1;
		offsetX = 0;
		offsetY = 0;

		const loaded = new Image();
		loaded.onload = () => {
			if (cancelled) return;
			image = loaded;
			loading = false;
		};
		loaded.onerror = () => {
			if (cancelled) return;
			error = 'This image could not be opened. Try another file.';
			loading = false;
		};
		loaded.src = url;

		return () => {
			cancelled = true;
			URL.revokeObjectURL(url);
			if (sourceUrl === url) sourceUrl = '';
		};
	});

	function onPointerDown(event: PointerEvent) {
		if (!image) return;
		dragging = true;
		dragStart = { x: event.clientX, y: event.clientY, ox: offsetX, oy: offsetY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		offsetX = dragStart.ox + (event.clientX - dragStart.x);
		offsetY = dragStart.oy + (event.clientY - dragStart.y);
	}

	function onPointerUp(event: PointerEvent) {
		dragging = false;
		const element = event.currentTarget as HTMLElement;
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
	}

	function reset() {
		zoom = 1;
		offsetX = 0;
		offsetY = 0;
	}

	async function confirm() {
		if (!image || !baseScale || exporting) return;
		exporting = true;
		error = '';
		try {
			const canvas = document.createElement('canvas');
			canvas.width = outputWidth;
			canvas.height = outputHeight;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Image editing is not available in this browser.');

			// The visible frame maps straight onto the exported image.
			const imageLeft = frameW / 2 + offsetX - displayW / 2;
			const imageTop = frameH / 2 + offsetY - displayH / 2;
			const xToSource = image.naturalWidth / displayW;
			const yToSource = image.naturalHeight / displayH;
			const sourceX = Math.min(image.naturalWidth, Math.max(0, -imageLeft * xToSource));
			const sourceY = Math.min(image.naturalHeight, Math.max(0, -imageTop * yToSource));
			const sourceW = Math.min(image.naturalWidth - sourceX, frameW * xToSource);
			const sourceH = Math.min(image.naturalHeight - sourceY, frameH * yToSource);

			context.imageSmoothingQuality = 'high';
			context.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, outputWidth, outputHeight);

			const type =
				file.type === 'image/png'
					? 'image/png'
					: file.type === 'image/webp'
						? 'image/webp'
						: 'image/jpeg';
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(result) =>
						result ? resolve(result) : reject(new Error('Could not export this image.')),
					type,
					0.9
				);
			});
			const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
			const name = `${file.name.replace(/\.[^.]+$/, '')}-cropped.${extension}`;
			onConfirm(new File([blob], name, { type }), URL.createObjectURL(blob));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not crop this image.';
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') onCancel();
	}}
/>

<div
	use:portal
	class="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(15,8,25,.82)] p-3 min-[720px]:p-5"
	data-modal-open
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onCancel();
	}}
>
	<div
		class="relative z-10 flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-[22px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.65)]"
		role="dialog"
		aria-modal="true"
		aria-labelledby={`${id}-title`}
	>
		<header class="flex items-center gap-3 border-b border-cover-edge/70 px-4 py-3">
			<span
				class="flex size-9 items-center justify-center rounded-full bg-cover/30 text-book-accent"
			>
				<CommunityIcon name="camera" size={17} />
			</span>
			<h2 id={`${id}-title`} class="min-w-0 flex-1 font-display text-lg font-bold">
				{isBanner ? 'Adjust your banner' : 'Adjust your profile picture'}
			</h2>
			<button
				type="button"
				class="flex size-9 items-center justify-center rounded-full bg-cover/30 text-book-bg/80 hover:bg-cover/50"
				onclick={onCancel}
				aria-label="Cancel"
			>
				<CommunityIcon name="x" size={16} />
			</button>
		</header>

		<div class="min-h-0 flex-1 modal-scroll overflow-y-auto px-4 py-4">
			<p class="font-ui text-xs leading-relaxed text-book-bg/70">
				{isBanner
					? 'Drag the image and zoom to choose which part appears in your banner. Keep important details near the middle.'
					: 'Drag the image and zoom to choose what shows inside the circle. The circle is exactly what others will see.'}
			</p>

			<div
				bind:clientWidth={frameW}
				bind:clientHeight={frameH}
				class="relative mx-auto mt-4 w-full overflow-hidden border border-cover-edge bg-desk select-none {isBanner
					? 'aspect-[10/3] rounded-xl'
					: 'aspect-square max-w-[320px] rounded-full'}"
				style:cursor={dragging ? 'grabbing' : 'grab'}
				role="presentation"
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
			>
				{#if image && sourceUrl}
					<img
						src={sourceUrl}
						alt="Crop preview"
						class="pointer-events-none absolute max-w-none"
						draggable="false"
						style="width: {displayW}px; height: {displayH}px; left: {frameW / 2 +
							offsetX}px; top: {frameH / 2 + offsetY}px; transform: translate(-50%, -50%);"
					/>
				{/if}
				{#if loading}
					<div
						class="absolute inset-0 flex items-center justify-center font-ui text-xs text-book-bg/70"
					>
						Loading image…
					</div>
				{/if}
			</div>

			<div class="mt-4">
				<div class="flex items-center justify-between font-ui text-xs">
					<label for={`${id}-zoom`} class="font-semibold text-book-bg/80">Zoom</label>
					<span class="text-book-bg/65 tabular-nums">{Math.round(zoom * 100)}%</span>
				</div>
				<input
					id={`${id}-zoom`}
					type="range"
					min="1"
					max="3"
					step="0.01"
					bind:value={zoom}
					disabled={!image}
					class="mt-1.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-cover-edge/70 disabled:opacity-50"
				/>
				<button
					type="button"
					class="mt-2 font-ui text-xs font-semibold text-book-accent hover:underline"
					onclick={reset}
					disabled={!image}
				>
					Reset position
				</button>
			</div>

			{#if error}
				<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{error}</p>
			{/if}
		</div>

		<footer class="flex flex-wrap gap-2 border-t border-cover-edge/70 px-4 py-3">
			<Button
				loading={exporting}
				icon="check"
				onclick={() => void confirm()}
				disabled={!image || loading}
			>
				Use this {isBanner ? 'banner' : 'photo'}
			</Button>
			<Button variant="outline" onclick={onCancel}>Cancel</Button>
		</footer>
	</div>
</div>
