<script lang="ts">
	import MoodPicker from '#lib/components/MoodPicker.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import RecordVideoModal from '#lib/components/RecordVideoModal.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import { parseDate, TODAY } from '#lib/dates';
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

	let uploadInput = $state<HTMLInputElement | null>(null);
	let recordOpen = $state(false);

	const videoUrl = $derived(journal.videoFor(date));
	const posterUrl = $derived(journal.thumbFor(date));
	const dow = $derived(parseDate(date).toLocaleDateString('en-US', { weekday: 'long' }));
	const dateText = $derived(
		parseDate(date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
	);
	const caption = $derived(entry.title || (date === TODAY ? "Today's VidJo" : 'My VidJo'));

	function pickVideo(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void journal.setVideo(file);
	}
</script>

<section
	class="page left absolute top-5 z-[1] flex h-[700px] w-[560px] flex-col gap-2.5 px-10 pt-[34px] pb-11 font-hand"
	style:background-color="var(--color-book-bg)"
	style:color="var(--color-book-ink)"
	class:left-5={!preview}
	class:left-0={preview}
	class:top-0={preview}
	class:rounded-[14px]={viewport.single}
	class:rounded-l-[14px]={!viewport.single}
	class:rounded-r-[3px]={!viewport.single}
	class:shadow-[-3px_2px_0_-1px_var(--color-book-edge),-6px_4px_0_-2px_var(--color-book-shadow)]={!preview}
	class:shadow-none={preview}
	class:left-page={!preview && !viewport.single}
	class:enter
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-label="Left page: video and mood"
>
	<div class="flex h-[62px] items-start justify-between gap-3">
		<div>
			<div class="font-ui text-sm font-semibold text-ink-muted">
				{dow}
			</div>
			<div class="mt-0.5 font-display text-[34px] leading-[1.1] font-bold text-ink">
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
		class="relative mt-1.5 h-[300px] shrink-0 rounded bg-white p-3 pb-11 shadow-[0_3px_10px_rgba(60,40,20,.22)]"
	>
		<div
			class="relative flex h-full items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_30%,#4A2F78,#251541_70%)]"
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
						class="block h-full w-full bg-[#120A20] object-contain"
					></video>
				{/key}
			{:else if journal.videoProblem(date)}
				<div
					class="flex flex-col items-center gap-2 px-6 text-center font-hand text-lg text-[#EDE6F7]"
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
							<Button size="sm" variant="paper" onclick={() => journal.removeVideo(date)}>
								Remove
							</Button>
						</div>
					{/if}
				</div>
			{:else if journal.entries[date]?.videoPath}
				<div
					class="flex flex-col items-center gap-2.5 text-center font-hand text-lg text-[#EDE6F7]"
				>
					<Spinner size={26} class="text-lav" />
					<span>Loading video…</span>
				</div>
			{:else}
				<div class="flex flex-col items-center gap-4 px-4 text-center text-[#EDE6F7]">
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
					class="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2.5 bg-[#120A20]/70 text-center font-ui text-sm text-white"
					role="status"
				>
					<Spinner size={26} class="text-gold" />
					Saving video…
				</div>
			{/if}
		</div>

		<div
			class="absolute right-3.5 bottom-1.5 left-3.5 flex h-[34px] items-center justify-between gap-2 font-hand text-xl font-bold text-ink"
		>
			<span class="min-w-0 truncate pr-1">{caption}</span>
			{#if videoUrl && !preview}
				<span class="flex flex-none gap-1.5">
					<button
						type="button"
						class="min-h-[30px] rounded-lg border border-[#CDBBE9] bg-light px-2 font-ui text-[13px] font-medium text-accent"
						onclick={() => (recordOpen = true)}
					>
						Record
					</button>
					<button
						type="button"
						class="min-h-[30px] rounded-lg border border-[#CDBBE9] bg-light px-2 font-ui text-[13px] font-medium text-accent"
						onclick={() => uploadInput?.click()}
					>
						Upload
					</button>
					<button
						type="button"
						class="min-h-[30px] rounded-lg border border-[#CDBBE9] bg-light px-2 font-ui text-[13px] font-medium text-accent"
						onclick={() => journal.removeVideo(date)}
					>
						Remove
					</button>
				</span>
			{/if}
		</div>
	</div>

	<h2 class="m-0 flex items-center gap-2 font-display text-[22px] font-bold text-ink">
		How are you feeling today?
	</h2>

	<MoodPicker
		mood={entry.mood}
		readonly={preview}
		onSelect={(mood) => !preview && journal.toggleMood(mood)}
	/>

	<p class="mt-auto mb-2 text-center font-hand text-lg text-ink-soft">
		Open the sticker tray below to make this page yours
	</p>

	<div
		class="absolute right-0 bottom-3.5 left-0 text-center font-ui text-xs font-semibold text-ink-muted tabular-nums"
	>
		{pageNumber}
	</div>

	<StickerLayer {entry} side="L" {preview} />
</section>

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
