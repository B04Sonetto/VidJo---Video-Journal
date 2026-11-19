<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import AttachedSongCard from '#lib/components/AttachedSongCard.svelte';
	import MoodPicker from '#lib/components/MoodPicker.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import RecordVideoModal from '#lib/components/RecordVideoModal.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import { parseDate, todayKey } from '#lib/dates';
	import { journal } from '#lib/state/journal.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import type { Entry } from '#lib/types';

	let {
		entry,
		date,
		pageNumber,
		preview = false,
		enter = false
	}: {
		entry: Entry;
		date: string;
		pageNumber: number;
		preview?: boolean;
		enter?: boolean;
	} = $props();

	const id = $props.id();
	let uploadInput = $state<HTMLInputElement | null>(null);
	let recordOpen = $state(false);
	let removeAsk = $state(false);
	let removeBusy = $state(false);
	let removeDialog = $state<HTMLDivElement | null>(null);
	let removeFocus: HTMLElement | null = null;
	let wasRemoveAsk = false;

	const videoUrl = $derived(journal.videoFor(date));
	const posterUrl = $derived(journal.thumbFor(date));
	const dow = $derived(parseDate(date).toLocaleDateString('en-US', { weekday: 'long' }));
	const dateText = $derived(
		parseDate(date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
	);
	const caption = $derived(entry.title || (date === todayKey() ? "Today's VidJo" : 'My VidJo'));

	$effect(() => {
		if (removeAsk && !wasRemoveAsk) {
			wasRemoveAsk = true;
			removeFocus = document.activeElement as HTMLElement | null;
			void tick().then(() => removeDialog?.querySelector<HTMLElement>('button')?.focus());
		} else if (!removeAsk && wasRemoveAsk) {
			wasRemoveAsk = false;
			const target = removeFocus;
			removeFocus = null;
			if (target?.isConnected) target.focus();
		}
	});

	function pickVideo(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void journal.setVideo(file);
	}

	function askRemove() {
		if (preview) return;
		removeAsk = true;
	}

	function cancelRemove() {
		if (removeBusy) return;
		removeAsk = false;
	}

	async function confirmRemove() {
		if (removeBusy) return;
		removeBusy = true;
		try {
			await journal.removeVideo(date);
			removeAsk = false;
		} finally {
			removeBusy = false;
		}
	}

	function removeBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) cancelRemove();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (!removeAsk || event.key !== 'Escape') return;
		event.preventDefault();
		cancelRemove();
	}}
/>

<section
	class="page left z-[1] flex flex-col gap-2.5 font-hand {viewport.single
		? 'relative min-h-[680px] w-full rounded-[14px] px-4 pt-6 pb-12 min-[480px]:px-6 min-[640px]:px-8'
		: 'absolute h-[700px] w-[560px] rounded-l-[14px] rounded-r-[3px] px-10 pt-[34px] pb-11'}"
	style:background-color="var(--color-book-bg)"
	style:color="var(--color-book-ink)"
	class:left-5={!preview && !viewport.single}
	class:left-0={preview}
	class:top-5={!preview && !viewport.single}
	class:top-0={preview}
	class:shadow-[-3px_2px_0_-1px_var(--color-book-edge),-6px_4px_0_-2px_var(--color-book-shadow)]={!preview &&
		!viewport.single}
	class:shadow-none={preview || viewport.single}
	class:left-page={!preview && !viewport.single}
	class:enter
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-label="Left page: video and mood"
>
	<div class="flex min-h-[62px] flex-wrap items-start justify-between gap-2">
		<div>
			<div class="font-ui text-sm font-semibold text-ink-muted">
				{dow}
			</div>
			<div
				class="mt-0.5 font-display text-[1.625rem] leading-[1.12] font-bold text-ink min-[900px]:text-[2.125rem] min-[900px]:leading-[1.1]"
			>
				{dateText}
			</div>
		</div>
		{#if entry.sample}
			<div
				class="rounded-md border border-[#C9A25A] bg-[#FFF3D6] px-2.5 py-1 font-ui text-[11px] font-semibold text-[#7A4E0C]"
			>
				Sample page
			</div>
		{/if}
	</div>

	<div
		class="video-frame relative mt-1.5 flex h-[260px] shrink-0 rotate-[-.8deg] flex-col rounded bg-white p-2.5 shadow-[0_3px_10px_rgba(60,40,20,.26)] min-[480px]:h-[300px] min-[900px]:p-3"
	>
		<span
			class="absolute -top-3 left-[-18px] z-[2] h-7 w-[92px] rotate-[-34deg] bg-lav/[.85] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
			aria-hidden="true"
		></span>
		<span
			class="absolute -top-3 right-[-18px] z-[2] h-7 w-[92px] rotate-[34deg] bg-[rgba(240,200,115,.88)] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
			aria-hidden="true"
		></span>
		<div
			class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_30%,var(--color-cover),var(--color-desk)_70%)]"
		>
			{#if videoUrl}
				{#key videoUrl}
					<video
						src={videoUrl}
						poster={posterUrl || undefined}
						controls={!preview}
						muted={preview}
						playsinline
						onerror={() => {
							if (journal.entries[date]?.videoPath) {
								journal.refreshVideo(date);
							}
						}}
						onloadeddata={() => journal.videoPlayed(date)}
						class="block h-full w-full bg-desk object-contain"
					></video>
				{/key}
			{:else if journal.videoProblem(date)}
				<div
					class="flex flex-col items-center gap-2 px-6 text-center font-hand text-lg text-book-bg"
				>
					<div class="font-ui text-[15px] font-semibold">Video unavailable</div>
					<p class="m-0 text-[14px] leading-snug text-lav/90">
						{journal.videoProblem(date)}
					</p>
					{#if !preview}
						<div class="flex flex-wrap justify-center gap-2">
							<Button
								size="sm"
								variant="outline"
								icon="refresh"
								onclick={() => journal.retryVideo(date)}
							>
								Try again
							</Button>
							<Button size="sm" variant="paper" onclick={askRemove}>Remove</Button>
						</div>
					{/if}
				</div>
			{:else if journal.entries[date]?.videoPath}
				<div class="flex flex-col items-center gap-2.5 text-center font-hand text-lg text-book-bg">
					<Spinner size={26} class="text-lav" />
					<span>Loading video…</span>
				</div>
			{:else}
				<div class="flex flex-col items-center gap-4 px-4 text-center text-book-bg">
					<span class="flex size-14 items-center justify-center rounded-full bg-white/10 text-lav">
						<CommunityIcon name="video" size={26} />
					</span>
					<div class="font-ui text-[15px] font-semibold">No video on this page yet</div>
					<div class="flex flex-wrap justify-center gap-2.5">
						<Button size="md" icon="camera" disabled={preview} onclick={() => (recordOpen = true)}>
							Record video
						</Button>
						<Button
							variant="outline"
							size="md"
							icon="upload"
							disabled={preview}
							onclick={() => uploadInput?.click()}
						>
							Upload video
						</Button>
					</div>
				</div>
			{/if}

			{#if journal.uploading}
				<div
					class="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2.5 bg-desk/70 text-center font-ui text-sm text-white"
					role="status"
				>
					<Spinner size={26} class="text-gold" />
					Saving video…
				</div>
			{/if}
		</div>

		<div
			class="relative z-[2] mt-1.5 flex h-9 shrink-0 items-center justify-between gap-2 px-0.5 font-hand text-lg font-bold text-ink min-[900px]:text-xl"
		>
			<span class="min-w-0 truncate pr-1">{caption}</span>
			{#if videoUrl && !preview}
				<button
					type="button"
					class="video-remove flex size-9 flex-none items-center justify-center rounded-lg border border-line bg-light text-accent hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
					aria-label="Remove video"
					title="Remove video"
					onclick={askRemove}
				>
					<CommunityIcon name="trash" size={15} />
				</button>
			{/if}
		</div>
	</div>

	<div class="my-auto">
		<h2 class="m-0 text-center font-display text-[1.25rem] leading-tight font-bold text-ink">
			How are you feeling today?
		</h2>
		<span class="mx-auto mt-1.5 mb-2.5 block h-px w-14 bg-line" aria-hidden="true"></span>

		<MoodPicker
			mood={entry.mood}
			readonly={preview}
			onSelect={(mood) => !preview && journal.toggleMood(mood)}
		/>

		{#if entry.song}
			<div class="mx-auto mt-3 w-full max-w-[420px]">
				<AttachedSongCard
					song={entry.song}
					compact
					label="Song on this page"
					onRemove={!preview
						? async () => {
								journal.current = date;
								await journal.setSongForCurrent(null);
								journal.toast('Song removed from this page');
							}
						: null}
				/>
			</div>
		{/if}
	</div>

	<div
		class="absolute right-0 bottom-3.5 left-0 text-center font-ui text-xs font-semibold text-ink-muted tabular-nums"
	>
		{pageNumber}
	</div>

	<StickerLayer {entry} side="L" {preview} />
</section>

{#if removeAsk}
	<div
		use:portal
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4"
		data-modal-open
		role="presentation"
		onclick={removeBackdrop}
	>
		<div
			bind:this={removeDialog}
			class="relative w-full max-w-[360px] rounded-2xl border border-cover-edge bg-desk-2 p-6 text-center text-white shadow-[0_30px_80px_rgba(0,0,0,.6)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-remove-title`}
			aria-describedby={`${id}-remove-help`}
		>
			<h2 id={`${id}-remove-title`} class="font-display text-xl font-bold text-balance">
				Remove this video?
			</h2>
			<p id={`${id}-remove-help`} class="mt-2.5 font-ui text-sm leading-relaxed text-lav">
				The video will be deleted from this page. The file cannot be recovered.
			</p>
			<div class="mt-6 flex justify-center gap-3">
				<Button variant="outline" onclick={cancelRemove} disabled={removeBusy}>Cancel</Button>
				<Button variant="danger" icon="trash" loading={removeBusy} onclick={confirmRemove}>
					Remove video
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if !preview}
	<input bind:this={uploadInput} type="file" accept="video/*" class="hidden" onchange={pickVideo} />
	<RecordVideoModal
		open={recordOpen}
		{date}
		onClose={() => (recordOpen = false)}
		onUpload={() => {
			recordOpen = false;
			uploadInput?.click();
		}}
	/>
{/if}

<style>
	.left-page::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		background: linear-gradient(to left, rgb(70 45 20 / 0.26), rgb(70 45 20 / 0) 52px);
	}

	/* Keep the Remove action out of the way until the photo is hovered or focused. */
	.video-remove {
		transition:
			opacity 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}

	@media (hover: hover) and (pointer: fine) {
		.video-remove {
			opacity: 0;
		}

		.video-frame:hover .video-remove,
		.video-frame:focus-within .video-remove {
			opacity: 1;
		}
	}

	.enter {
		animation: enter 0.28s ease-out;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateX(24px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
