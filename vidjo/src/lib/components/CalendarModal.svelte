<script lang="ts">
	import { tick } from 'svelte';
	import { MOOD_BY_KEY, type MoodDef } from '#lib/data/moods';
	import { pad, parseDate, TODAY } from '#lib/dates';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import type { Entry } from '#lib/types';

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();

	interface DayCell {
		key: string;
		day: number;
		empty: boolean;
		entry?: Entry;
		has: boolean;
		mood?: MoodDef;
		isToday: boolean;
		isCurrent: boolean;
		hasVideo: boolean;
	}

	const pencil =
		'<svg viewBox="0 0 24 24" fill="none" stroke="#8E7FAA" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 19l3-1L19 7l-2-2L6 16z"/></svg>';

	let year = $state(0);
	let month = $state(0);
	let closeButton = $state<HTMLButtonElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	const monthTitle = $derived(
		new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
	);
	const monthName = $derived(
		new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' })
	);

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;

			const date = parseDate(journal.current);
			year = date.getFullYear();
			month = date.getMonth();

			void tick().then(() => closeButton?.focus());
		} else if (!open && wasOpen) {
			wasOpen = false;
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});

	const cells = $derived.by(() => {
		const first = new Date(year, month, 1).getDay();
		const days = new Date(year, month + 1, 0).getDate();
		const result: DayCell[] = [];

		for (let i = 0; i < first; i += 1) {
			result.push({
				key: `empty-${i}`,
				day: 0,
				empty: true,
				has: false,
				isToday: false,
				isCurrent: false,
				hasVideo: false
			});
		}

		for (let day = 1; day <= days; day += 1) {
			const key = `${year}-${pad(month + 1)}-${pad(day)}`;
			const entry = journal.entries[key];
			const has = Boolean(entry && !journal.isBlank(entry));
			result.push({
				key,
				day,
				empty: false,
				entry,
				has,
				mood: entry?.mood ? MOOD_BY_KEY[entry.mood] : undefined,
				isToday: key === TODAY,
				isCurrent: key === journal.current,
				hasVideo: Boolean(journal.videoFor(key))
			});
		}

		return result;
	});

	const monthEntries = $derived.by(() =>
		Object.values(journal.entries)
			.filter((entry) => {
				const date = parseDate(entry.date);
				return date.getFullYear() === year && date.getMonth() === month && !journal.isBlank(entry);
			})
			.sort((a, b) => a.date.localeCompare(b.date))
	);

	$effect(() => {
		if (!open) return;

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	function shiftMonth(delta: number) {
		const date = new Date(year, month + delta, 1);
		year = date.getFullYear();
		month = date.getMonth();
	}

	function pick(date: string) {
		journal.ensureEntry(date);
		nav.jump(date);
		onClose();
	}

	function dayAria(cell: DayCell) {
		const base = `${cell.day} ${monthName}`;
		if (!cell.has) return `${base}, empty page`;
		const title = cell.entry?.title || 'untitled VidJo';
		const mood = cell.mood ? `, feeling ${cell.mood.l.toLowerCase()}` : '';
		return `${base}, ${title}${mood}`;
	}

	function shortDate(date: string) {
		return parseDate(date).toLocaleDateString('en-US', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-[rgba(15,8,25,.72)] px-4 pt-[max(20px,env(safe-area-inset-top,0px))] pb-5"
		data-modal-open
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			class="grid w-[min(920px,100%)] grid-cols-1 gap-7 rounded-[20px] bg-paper p-[20px_18px_24px] font-hand text-ink shadow-[0_30px_70px_rgba(0,0,0,.6)] min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] min-[900px]:p-[28px_32px_32px]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="calTitle"
		>
			<div class="col-span-full flex items-center gap-3">
				<button
					type="button"
					class="flex size-11 items-center justify-center rounded-xl border border-[#CDBBE9] bg-light text-accent hover:bg-[#E4D8F6]"
					aria-label="Previous month"
					onclick={() => shiftMonth(-1)}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M15 5l-7 7 7 7"></path>
					</svg>
				</button>

				<h2 id="calTitle" class="mr-auto ml-2 font-display text-[32px] font-bold">
					{monthTitle}
				</h2>

				<button
					type="button"
					class="flex size-11 items-center justify-center rounded-xl border border-[#CDBBE9] bg-light text-accent hover:bg-[#E4D8F6]"
					aria-label="Next month"
					onclick={() => shiftMonth(1)}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M9 5l7 7-7 7"></path>
					</svg>
				</button>

				<button
					bind:this={closeButton}
					type="button"
					class="flex size-11 items-center justify-center rounded-xl border border-[#CDBBE9] bg-light text-accent hover:bg-[#E4D8F6]"
					aria-label="Close calendar"
					onclick={onClose}
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

			<div>
				<div class="grid grid-cols-7 gap-1.5" aria-hidden="true">
					{#each ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as day (day)}
						<span
							class="pb-1.5 text-center font-ui text-[13px] font-bold tracking-[.1em] text-ink-soft"
						>
							{day}
						</span>
					{/each}
				</div>

				<div class="mt-1.5 grid grid-cols-7 gap-1.5">
					{#each cells as cell (cell.key)}
						{#if cell.empty}
							<span class="invisible aspect-[1/1.05]" aria-hidden="true"></span>
						{:else}
							<button
								type="button"
								class="relative flex aspect-[1/1.05] min-w-0 flex-col items-start rounded-xl border-[1.5px] p-1 font-hand text-base font-bold text-ink hover:border-accent hover:bg-light {cell.isCurrent
									? 'border-accent bg-[#E4D8F6]'
									: 'border-line bg-[#FFFDF6]'}"
								class:ring-2={cell.isToday}
								class:ring-gold={cell.isToday}
								style:background-color={cell.mood ? `${cell.mood.c}55` : undefined}
								aria-label={dayAria(cell)}
								onclick={() => pick(cell.key)}
							>
								{cell.day}
								{#if cell.hasVideo}
									<i
										class="absolute top-[5px] right-[5px] size-[9px] rounded-full bg-accent"
										title="Has a video"
									></i>
								{/if}
								{#if cell.mood}
									<span class="m-auto w-[70%] max-w-[34px] [&>svg]:size-full">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
										{@html cell.mood.svg}
									</span>
								{:else if cell.has}
									<span class="m-auto w-[70%] max-w-[34px] [&>svg]:size-full">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG constant -->
										{@html pencil}
									</span>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			</div>

			<div>
				<h3 class="mb-2.5 font-display text-[22px] font-bold">VidJos this month</h3>
				<ul class="m-0 flex list-none flex-col gap-2 p-0">
					{#if monthEntries.length === 0}
						<li class="font-hand text-[19px] text-ink-soft">
							No VidJos this month yet. Pick a day to start a page.
						</li>
					{:else}
						{#each monthEntries as entry (entry.date)}
							{@const mood = entry.mood ? MOOD_BY_KEY[entry.mood] : null}
							<li>
								<button
									type="button"
									class="flex min-h-14 w-full items-center gap-3 rounded-xl border-[1.5px] border-line bg-[#FFFDF6] px-3 py-1.5 text-left font-hand text-lg text-ink hover:border-accent hover:bg-light"
									onclick={() => pick(entry.date)}
								>
									<span class="size-[38px] flex-none [&>svg]:size-full">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
										{@html mood?.svg ?? pencil}
									</span>
									<span class="min-w-0">
										<b class="block truncate font-hand text-[19px] font-bold">
											{entry.title || 'Untitled'}
										</b>
										<small class="font-hand text-[15px] text-ink-soft">
											{shortDate(entry.date)}{mood ? ` · ${mood.l}` : ''}{journal.videoFor(
												entry.date
											)
												? ' · video'
												: ''}
										</small>
									</span>
								</button>
							</li>
						{/each}
					{/if}
				</ul>
			</div>
		</div>
	</div>
{/if}
