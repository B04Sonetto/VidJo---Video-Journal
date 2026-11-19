<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { searchGifs, trendingGifs, type GiphyGif } from '#lib/giphy';

	const skeletonSlots = Array.from({ length: 9 }, (_, index) => index);

	let {
		open,
		onClose,
		onPick
	}: {
		open: boolean;
		onClose: () => void;
		onPick: (gif: GiphyGif) => void;
	} = $props();

	let query = $state('');
	let gifs = $state<GiphyGif[]>([]);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state('');
	let hasMore = $state(false);
	let searched = $state(false);
	let searchEl = $state<HTMLInputElement | null>(null);

	let requestId = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let mode: 'trending' | 'search' = 'trending';
	let activeQuery = '';

	$effect(() => {
		if (!open) return;

		query = '';
		gifs = [];
		error = '';
		hasMore = false;
		searched = false;
		mode = 'trending';
		activeQuery = '';
		void load('trending', '', 0, false);

		void tick().then(() => {
			// Opening the keyboard on phones would cover the results.
			if (window.innerWidth >= 980) searchEl?.focus();
		});
	});

	function clearTimer() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	async function load(kind: 'trending' | 'search', value: string, offset: number, append: boolean) {
		const id = ++requestId;

		if (append) {
			loadingMore = true;
		} else {
			loading = true;
			error = '';
		}

		try {
			const page = kind === 'search' ? await searchGifs(value, offset) : await trendingGifs(offset);
			if (id !== requestId) return;

			const merged = append ? [...gifs, ...page.gifs] : page.gifs;
			const seen: Record<string, true> = {};
			gifs = merged.filter((gif) => {
				if (seen[gif.id]) return false;
				seen[gif.id] = true;
				return true;
			});
			hasMore = page.hasMore;
			searched = kind === 'search';
		} catch (err) {
			if (id !== requestId) return;
			error = err instanceof Error ? err.message : 'GIF search is unavailable right now.';
			if (!append) {
				gifs = [];
				hasMore = false;
			}
		} finally {
			if (id === requestId) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function runSearch() {
		clearTimer();
		const value = query.trim();
		if (value.length < 2) return;

		mode = 'search';
		activeQuery = value;
		searched = true;
		void load('search', value, 0, false);
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		runSearch();
	}

	function scheduleSearch() {
		clearTimer();
		const value = query.trim();

		if (value.length === 0) {
			timer = setTimeout(() => {
				mode = 'trending';
				activeQuery = '';
				void load('trending', '', 0, false);
			}, 300);
			return;
		}

		if (value.length < 2) return;

		timer = setTimeout(runSearch, 350);
	}

	function clearSearch() {
		clearTimer();
		query = '';
		mode = 'trending';
		activeQuery = '';
		void load('trending', '', 0, false);
		searchEl?.focus();
	}

	function loadMore() {
		if (loadingMore || !hasMore) return;
		void load(mode, activeQuery, gifs.length, true);
	}

	function retry() {
		void load(mode, activeQuery, 0, false);
	}

	function handleKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}

	onDestroy(clearTimer);
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="gif-picker-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close GIF picker"
		></button>

		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
				<div>
					<h2 id="gif-picker-title" class="font-display text-xl font-bold">Send a GIF</h2>
					<p class="font-ui text-[11px] text-book-ink/70">Search Giphy's collection</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<form class="border-b border-line px-4 py-3" onsubmit={submitSearch}>
				<label class="sr-only" for="gif-search">Search GIFs</label>
				<div class="flex items-center gap-2 rounded-xl border border-line bg-book-bg px-3">
					<CommunityIcon name="search" size={15} class="shrink-0 text-book-ink/50" />
					<input
						id="gif-search"
						bind:this={searchEl}
						bind:value={query}
						oninput={scheduleSearch}
						type="search"
						maxlength="60"
						placeholder="Search GIPHY"
						autocomplete="off"
						class="h-10 min-w-0 flex-1 bg-transparent font-ui text-sm text-book-ink placeholder:text-book-ink/70 focus:outline-none"
					/>
					{#if query}
						<button
							type="button"
							class="flex size-7 shrink-0 items-center justify-center rounded-full text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
							onclick={clearSearch}
							aria-label="Clear search"
						>
							<CommunityIcon name="x" size={13} />
						</button>
					{/if}
				</div>
			</form>

			<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-3">
				{#if loading}
					<div class="grid grid-cols-3 gap-1.5" role="status" aria-label="Loading GIFs">
						{#each skeletonSlots as slot (slot)}
							<div class="aspect-[4/3] animate-pulse rounded-lg bg-line/50"></div>
						{/each}
					</div>
				{:else if error}
					<div class="px-4 py-10 text-center" role="alert">
						<p class="font-hand text-lg leading-snug text-book-ink/70">{error}</p>
						<button
							type="button"
							class="mt-3 min-h-9 rounded-lg border border-line px-3.5 font-ui text-xs font-bold text-book-ink/80 transition-colors hover:bg-paper-deep"
							onclick={retry}
						>
							Try again
						</button>
					</div>
				{:else if gifs.length === 0}
					<div class="px-4 py-10 text-center">
						<p class="font-hand text-lg leading-snug text-book-ink/70">
							{searched ? 'No GIFs found. Try another search.' : 'No GIFs to show right now.'}
						</p>
					</div>
				{:else}
					<div class="grid grid-cols-3 gap-1.5">
						{#each gifs as gif (gif.id)}
							<button
								type="button"
								class="group relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-book-bg"
								onclick={() => onPick(gif)}
								aria-label="Send {gif.title}"
								title={gif.title}
							>
								<img
									src={gif.previewUrl}
									alt={gif.title}
									class="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
									loading="lazy"
									decoding="async"
								/>
							</button>
						{/each}
					</div>

					{#if hasMore}
						<div class="mt-3 text-center">
							<button
								type="button"
								class="min-h-9 rounded-full border border-line bg-book-bg px-3.5 font-ui text-[11px] font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep disabled:opacity-60"
								onclick={loadMore}
								disabled={loadingMore}
							>
								{loadingMore ? 'Loading…' : 'Load more GIFs'}
							</button>
						</div>
					{/if}
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
				<p class="font-ui text-[10px] text-book-ink/70">GIFs are hosted by Giphy.</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a
					href="https://giphy.com/"
					target="_blank"
					rel="noopener noreferrer"
					class="font-ui text-[11px] font-bold text-book-ink/80 underline decoration-line underline-offset-2 hover:text-book-ink"
				>
					Powered by GIPHY
				</a>
			</div>
		</div>
	</div>
{/if}
