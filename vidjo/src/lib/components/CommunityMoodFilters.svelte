<script lang="ts">
	import { MOODS, MOOD_BY_KEY } from '#lib/data/moods';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { MoodKey } from '#lib/types';

	type FeedMode = 'hot' | 'top' | 'week' | 'month' | 'newest';

	let {
		activeMood,
		moodCounts,
		totalCount,
		feedMode,
		onSelect
	}: {
		activeMood: MoodKey | 'all';
		moodCounts: Partial<Record<MoodKey, number>>;
		totalCount: number;
		feedMode: FeedMode;
		onSelect: (mood: MoodKey | 'all') => void;
	} = $props();

	const modeDescription = $derived(
		feedMode === 'hot'
			? 'hot first'
			: feedMode === 'top'
				? 'top cheered first'
				: feedMode === 'week'
					? 'most popular this week'
					: feedMode === 'month'
						? 'most popular this month'
						: 'newest first'
	);
</script>

<div class="flex flex-wrap items-end justify-between gap-2">
	<div>
		<h2
			id="community-mood-title"
			class="font-display text-2xl leading-tight font-bold text-book-bg min-[720px]:text-[28px]"
		>
			Browse by mood
		</h2>
		<p class="mt-0.5 font-ui text-sm text-book-bg/65">
			Showing {activeMood === 'all' ? 'every mood' : MOOD_BY_KEY[activeMood].l} · {modeDescription}
		</p>
	</div>
	{#if activeMood !== 'all'}
		<button
			type="button"
			class="font-ui text-xs font-semibold text-book-accent hover:underline"
			onclick={() => onSelect('all')}
		>
			Clear mood
		</button>
	{/if}
</div>

<div class="mt-4 flex flex-wrap gap-2.5" role="group" aria-labelledby="community-mood-title">
	<button
		type="button"
		class="flex min-h-11 items-center gap-2 rounded-full border-2 px-3.5 font-hand text-[18px] leading-none font-bold transition-colors {activeMood ===
		'all'
			? 'border-book-accent bg-book-bg text-book-ink'
			: 'border-cover text-book-bg/75 hover:border-book-accent hover:text-book-bg'}"
		onclick={() => onSelect('all')}
		aria-pressed={activeMood === 'all'}
	>
		<CommunityIcon name="sparkles" size={17} class="text-book-accent" />
		All moods
		<span class="font-ui text-[10px] tabular-nums opacity-60">{totalCount}</span>
	</button>

	{#each MOODS as mood (mood.k)}
		<button
			type="button"
			class="flex min-h-11 items-center gap-1.5 rounded-full border-2 py-1 pr-3 pl-2 font-hand text-[18px] leading-none font-bold transition-colors {activeMood ===
			mood.k
				? 'border-book-accent bg-book-bg text-book-ink'
				: 'border-cover text-book-bg/75 hover:border-book-accent hover:text-book-bg'}"
			onclick={() => onSelect(activeMood === mood.k ? 'all' : mood.k)}
			aria-pressed={activeMood === mood.k}
		>
			<span class="size-[26px] shrink-0 [&>svg]:size-full" aria-hidden="true">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
				{@html mood.svg}
			</span>
			{mood.l}
			<span class="font-ui text-[10px] tabular-nums opacity-60">{moodCounts[mood.k] ?? 0}</span>
		</button>
	{/each}
</div>
