<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { MOODS } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import { parseDate } from '#lib/dates';
	import { journal } from '#lib/state/journal.svelte';
	import type { Entry, Side } from '#lib/types';

	let { entry, side, pageNumber }: { entry: Entry; side: Side; pageNumber: number } = $props();

	const isLeft = $derived(side === 'L');
	const highlightUrl = $derived(journal.highlightFor(entry.id));
	const posterUrl = $derived(journal.thumbFor(entry.id));
	const mediaUrl = $derived(highlightUrl || posterUrl);
	const hasMedia = $derived(Boolean(entry.highlightPath || mediaUrl || entry.videoName));
	const mood = $derived(MOODS.find((item) => item.k === entry.mood) ?? null);
	const stickers = $derived(entry.stickers.filter((sticker) => sticker.page === side));
	const pageDate = $derived(parseDate(entry.date));
	const dateText = $derived(
		pageDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
	);
	const weekday = $derived(pageDate.toLocaleDateString('en-US', { weekday: 'long' }));
	const privacyLabel = $derived(
		entry.privacy === 'private' ? 'Private' : entry.privacy === 'friends' ? 'Friends' : 'Community'
	);
</script>

<!-- Static page used only while a leaf turns. It deliberately avoids players,
     editors, modals, and sticker tools so the flip stays on the compositor. -->
<section
	class="page {isLeft
		? 'left left-page'
		: 'right right-page'} relative h-full w-full overflow-hidden font-hand"
	style:background-color="var(--color-book-bg)"
	style:color="var(--color-book-ink)"
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-hidden="true"
>
	<div class="flex h-full flex-col gap-2.5 px-10 pt-[34px] pb-4">
		{#if isLeft}
			<div class="flex min-h-[62px] flex-wrap items-start justify-between gap-2">
				<div>
					<div class="font-ui text-sm font-semibold text-ink-muted">{weekday}</div>
					<div
						class="mt-0.5 font-display text-[1.625rem] leading-[1.12] font-bold text-ink min-[900px]:text-[2.125rem]"
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
				class="video-frame relative mt-1.5 flex h-[220px] shrink-0 rotate-[-.8deg] flex-col rounded bg-white p-2.5 shadow-[0_3px_10px_rgba(60,40,20,.26)] min-[900px]:h-[300px]"
			>
				<span
					class="absolute -top-3 -left-[18px] z-[2] h-7 w-[92px] rotate-[-34deg] bg-lav/85 [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)]"
				></span>
				<span
					class="absolute -top-3 -right-[18px] z-[2] h-7 w-[92px] rotate-[34deg] bg-[rgba(240,200,115,.88)] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)]"
				></span>
				<div
					class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_30%,var(--color-cover),var(--color-desk)_70%)]"
				>
					{#if mediaUrl}
						<img src={mediaUrl} alt="" class="h-full w-full object-cover" />
					{:else}
						<div class="flex flex-col items-center gap-2 text-book-bg/70">
							<CommunityIcon name={hasMedia ? 'disc' : 'camera'} size={26} />
							<span class="font-ui text-xs font-semibold">
								{hasMedia ? 'Loading moment…' : 'A moment lives here'}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<div
				class="relative z-[2] mt-1.5 flex h-9 shrink-0 items-center px-0.5 font-hand text-lg font-bold text-ink min-[900px]:text-xl"
			>
				<span class="truncate">{entry.title || "Today's VidJo"}</span>
			</div>

			<div class="my-auto text-center">
				<h2 class="m-0 font-display text-[1.25rem] leading-tight font-bold text-ink">
					How are you feeling today?
				</h2>
				{#if mood}
					<div
						class="mx-auto mt-2 flex w-fit items-center gap-2 rounded-full border border-line/70 bg-paper/60 px-3 py-1 font-ui text-xs font-semibold text-ink"
					>
						<span class="block size-5 [&>svg]:size-full">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
							{@html mood.svg}
						</span>
						{mood.l}
					</div>
				{/if}

				{#if entry.song}
					<div
						class="mx-auto mt-3 flex w-full max-w-[420px] items-center gap-2 rounded-xl border border-line/70 bg-paper/60 p-2 text-left"
					>
						{#if entry.song.image}
							<img src={entry.song.image} alt="" class="size-9 shrink-0 rounded-lg object-cover" />
						{:else}
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-book-accent/20 text-book-accent"
							>
								<CommunityIcon name="music" size={16} />
							</span>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-ui text-xs font-bold text-ink">
								{entry.song.name}
							</span>
							<span class="block truncate font-ui text-[11px] text-ink-soft">
								{entry.song.artists}
							</span>
						</span>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="h-12 w-full shrink-0 truncate border-b-2 border-line px-1 pb-1 font-hand text-[1.625rem] font-bold text-ink min-[900px]:h-[54px] min-[900px]:text-[2rem]"
			>
				{entry.title || 'Title (optional): just a random day…'}
			</div>

			<div
				class="mt-1.5 shrink-0 font-display text-[1.1875rem] font-bold text-ink min-[900px]:text-[1.375rem]"
			>
				What's on your mind?
			</div>
			<div
				class="mt-3 min-h-[64px] flex-1 overflow-hidden px-1 font-hand text-[1.375rem] leading-[2rem] whitespace-pre-wrap text-ink"
				class:paper-lined={journal.paper === 'lined'}
			>
				{entry.mind || 'A page waiting to be written…'}
			</div>

			<div
				class="shrink-0 font-display text-[1.1875rem] font-bold text-ink min-[900px]:text-[1.375rem]"
			>
				Reflection <small class="font-hand text-base font-normal text-ink-soft">(optional)</small>
			</div>
			<div
				class="mt-0.5 h-[92px] shrink-0 overflow-hidden px-1 font-hand text-[1.375rem] leading-[2rem] whitespace-pre-wrap text-ink"
				class:paper-lined={journal.paper === 'lined'}
			>
				{entry.refl}
			</div>

			<div class="mt-1 shrink-0">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-paper/60 px-2.5 py-1 font-ui text-[11px] font-semibold text-ink-soft"
				>
					<CommunityIcon
						name={entry.privacy === 'private'
							? 'lock'
							: entry.privacy === 'friends'
								? 'users'
								: 'globe'}
						size={12}
					/>
					{privacyLabel}
				</span>
			</div>
		{/if}
	</div>

	<div
		class="absolute right-0 bottom-3.5 left-0 text-center font-ui text-xs font-semibold text-ink-muted tabular-nums"
	>
		{pageNumber}
	</div>

	<div class="pointer-events-none absolute inset-0 z-[5]">
		{#each stickers as sticker (sticker.id)}
			{@const definition = STICKER_BY_KEY[sticker.type]}
			<div
				class="stk absolute {definition?.flat
					? 'sticker-flat'
					: 'sticker-shadow'} [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
				style:left={`${sticker.x}%`}
				style:top={`${sticker.y}%`}
				style:width={`${sticker.size}px`}
				style:transform={`translate(-50%, -50%) rotate(${sticker.rot}deg)`}
			>
				{#if sticker.type === 'img' && sticker.src}
					<img src={sticker.src} alt="" class="block h-auto w-full" draggable="false" />
				{:else}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/stickers.ts -->
					{@html definition?.svg ?? ''}
				{/if}
			</div>
		{/each}
	</div>
</section>

<style>
	.left-page::after,
	.right-page::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
	}

	.left-page::after {
		background: linear-gradient(to right, rgb(70 45 20 / 0.2), rgb(70 45 20 / 0) 44px);
	}

	.right-page::after {
		background: linear-gradient(to left, rgb(70 45 20 / 0.26), rgb(70 45 20 / 0) 52px);
	}
</style>
