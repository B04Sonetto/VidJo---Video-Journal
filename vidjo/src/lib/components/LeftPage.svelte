<script lang="ts">
	import MoodPicker from '#lib/components/MoodPicker.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import RecordVideoModal from '#lib/components/RecordVideoModal.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
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
			<div class="font-ui text-[15px] font-bold tracking-[.14em] text-ink-soft uppercase">
				{dow}
			</div>
			<div class="mt-0.5 font-display text-[34px] leading-[1.1] font-bold text-ink">
				{dateText}
			</div>
		</div>
		{#if entry.sample}
			<div
				class="rotate-3 rounded-lg border-2 border-dashed border-[#C9A25A] bg-[#FFF3D6] px-2.5 py-0.5 font-hand text-[15px] font-bold text-[#8A5A12]"
			>
				Sample page
			</div>
		{/if}
	</div>

	<div
		class="relative mt-1.5 h-[300px] shrink-0 rotate-[-.8deg] rounded bg-white p-3 pb-11 shadow-[0_3px_10px_rgba(60,40,20,.28)]"
	>
		<span
			class="absolute -top-3 left-[-18px] z-[2] h-7 w-[92px] rotate-[-34deg] bg-lav/[.85] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
		></span>
		<span
			class="absolute -top-3 right-[-18px] z-[2] h-7 w-[92px] rotate-[34deg] bg-[rgba(240,200,115,.88)] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
		></span>

		<div
			class="relative flex h-full items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_30%,#4A2F78,#251541_70%)]"
		>
			{#if videoUrl}
				{#key videoUrl}
					<video
						src={videoUrl}
						controls={!preview}
						muted={preview}
						playsinline
						onerror={() => {
							if (journal.entries[date]?.videoPath) {
								void journal.resolveSignedUrl(date);
							}
						}}
						class="block h-full w-full bg-[#120A20] object-contain"
					></video>
				{/key}
			{:else if journal.entries[date]?.videoPath}
				<div
					class="flex flex-col items-center gap-2.5 text-center font-hand text-lg text-[#EDE6F7]"
				>
					<div
						class="size-7 animate-spin rounded-full border-2 border-lav border-t-transparent"
					></div>
					<span>Loading video…</span>
				</div>
			{:else}
				<span class="absolute top-[14px] left-[18px] text-base text-gold">
					<CommunityIcon name="spark" size={14} />
				</span>
				<span class="absolute top-[40px] right-[22px] text-base text-gold">
					<CommunityIcon name="spark" size={14} />
				</span>
				<span class="absolute bottom-[18px] left-[30px] text-base text-gold">
					<CommunityIcon name="spark" size={14} />
				</span>

				<div
					class="flex flex-col items-center gap-3 px-4 text-center font-hand text-xl text-[#EDE6F7]"
				>
					<svg
						width="54"
						height="54"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#C9B8E8"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<rect x="2.5" y="6" width="13" height="12" rx="2.5"></rect>
						<path d="M15.5 10.5l6-3.5v10l-6-3.5z"></path>
					</svg>
					<div>Record or upload your video</div>
					<div class="flex flex-wrap justify-center gap-2.5">
						<button
							type="button"
							class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-[18px] font-ui text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,.25)] transition-all hover:bg-[#624690] active:scale-[0.98]"
							disabled={preview}
							onclick={() => (recordOpen = true)}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<circle cx="12" cy="12" r="8"></circle>
								<circle cx="12" cy="12" r="3" fill="#fff"></circle>
							</svg>
							Record Video
						</button>
						<button
							type="button"
							class="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-lav/60 bg-white/[.08] px-[18px] font-ui text-[15px] font-semibold text-white transition-all hover:border-lav hover:bg-white/[.16] active:scale-[0.98]"
							disabled={preview}
							onclick={() => uploadInput?.click()}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path
									d="M7 18a4.5 4.5 0 01-.5-9 6 6 0 0111.5 1.5A3.7 3.7 0 0117.5 18M12 11v8M9 14l3-3 3 3"
								></path>
							</svg>
							Upload Video
						</button>
					</div>
				</div>
			{/if}

			{#if journal.uploading}
				<div
					class="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-[#120A20]/70 text-center font-ui text-sm text-white"
					role="status"
				>
					<svg
						class="size-7 animate-spin text-gold"
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
						onclick={() => journal.removeVideo()}
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

	<p class="mt-auto mb-2 text-center font-hand text-lg text-ink-soft flex items-center justify-center gap-1">
		Open the sticker tray below to make this page yours
		<CommunityIcon name="spark" size={14} />
	</p>

	<div class="absolute right-0 bottom-3.5 left-0 text-center font-hand text-base text-ink-soft">
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
