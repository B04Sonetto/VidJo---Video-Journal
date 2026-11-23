<script lang="ts">
	import { onMount } from 'svelte';
	import LeftPage from '#lib/components/LeftPage.svelte';
	import RightPage from '#lib/components/RightPage.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import { dateKey, todayKey } from '#lib/dates';
	import type { Entry } from '#lib/types';

	interface Flip {
		dir: 1 | -1;
		from: Entry;
		to: Entry;
		fromLeft: number;
		fromRight: number;
		toLeft: number;
		toRight: number;
		go: boolean;
	}

	let host = $state<HTMLDivElement | null>(null);
	let hostWidth = $state(0);
	let flip = $state<Flip | null>(null);
	let flipTimer: ReturnType<typeof setTimeout> | undefined;
	let deleteConfirm = $state<string | null>(null);
	let deleting = $state(false);

	const bookWidth = 1160;
	const scale = $derived(
		viewport.single ? 1 : hostWidth > 0 ? Math.min(1, hostWidth / bookWidth) : 1
	);
	const offset = $derived(viewport.single ? 0 : Math.max(0, (hostWidth - bookWidth * scale) / 2));

	const dates = $derived(journal.sortedDates);
	const index = $derived(dates.indexOf(journal.current));
	const total = $derived(dates.length);
	const currentEntry = $derived(journal.entries[journal.current]);
	const todayPages = $derived(
		Object.values(journal.entries).filter(
			(entry) => dateKey(new Date(entry.createdAt)) === todayKey()
		).length
	);
	const streak = $derived(journal.streak);
	const atStart = $derived(index === 0 && (!viewport.single || journal.side === 'L'));
	const atEnd = $derived(index === total - 1 && (!viewport.single || journal.side === 'R'));
	const leftPageNumber = $derived(index * 2 + 1);
	const rightPageNumber = $derived(index * 2 + 2);
	const pageLabel = $derived(
		viewport.single
			? `Page ${index * 2 + (journal.side === 'L' ? 1 : 2)} of ${total * 2}`
			: `Pages ${index * 2 + 1}–${index * 2 + 2} of ${total * 2}`
	);

	function moveTo(target: string, dir: 1 | -1) {
		if (target === journal.current) {
			journal.side = 'L';
			return;
		}

		if (!journal.entries[target]) return;

		const fromEntry = journal.entries[journal.current];
		if (!fromEntry) return;
		const from = $state.snapshot(fromEntry) as Entry;
		const fromLeft = index * 2 + 1;
		const fromRight = index * 2 + 2;

		journal.leaveCurrentIfBlank();
		journal.selected = [];

		const targetIndex = dates.indexOf(target);
		if (targetIndex < 0) return;

		const to = $state.snapshot(journal.entries[target]) as Entry;
		const toLeft = targetIndex * 2 + 1;
		const toRight = targetIndex * 2 + 2;

		if (viewport.single || viewport.reduced) {
			journal.current = target;
			journal.side = dir > 0 ? 'L' : 'R';
			journal.selected = [];
			return;
		}

		journal.busy = true;
		journal.current = target;
		journal.side = 'L';
		flip = { dir, from, to, fromLeft, fromRight, toLeft, toRight, go: false };

		requestAnimationFrame(() => {
			if (flip) flip = { ...flip, go: true };
		});

		if (flipTimer) clearTimeout(flipTimer);
		flipTimer = setTimeout(() => {
			flip = null;
			journal.busy = false;
		}, 1050);
	}

	function setSide(side: 'L' | 'R') {
		if (!journal.ready) return;
		journal.side = side;
		journal.lastPage = side;
		journal.selected = [];
	}

	function go(dir: 1 | -1) {
		if (journal.busy || !journal.ready) return;

		if (viewport.single) {
			if (dir > 0 && journal.side === 'L') {
				journal.side = 'R';
				journal.selected = [];
				return;
			}
			if (dir < 0 && journal.side === 'R') {
				journal.side = 'L';
				journal.selected = [];
				return;
			}
		}

		const target = dates[index + dir];
		if (!target) return;
		moveTo(target, dir);
	}

	async function deletePage() {
		if (!journal.current) return;
		deleteConfirm = journal.current;
	}

	async function confirmDelete() {
		if (!deleteConfirm || deleting) return;
		deleting = true;
		try {
			await journal.deleteEntry(deleteConfirm);
			deleteConfirm = null;
		} finally {
			deleting = false;
		}
	}

	async function cancelDelete() {
		deleteConfirm = null;
	}

	$effect(() => {
		const target = nav.target;
		if (!target || !journal.ready) return;

		const side = nav.targetSide ?? 'L';
		nav.target = null;
		nav.targetSide = null;

		if (target === journal.current) {
			journal.side = side;
			return;
		}

		const resolvedTarget = journal.entries[target] ? target : journal.latestEntryId(target);
		if (!resolvedTarget) {
			const entry = journal.ensureEntry(target);
			if (!entry) return;
			journal.current = entry.id;
			journal.side = side;
			return;
		}
		const dir: 1 | -1 = dates.indexOf(resolvedTarget) > index ? 1 : -1;
		moveTo(resolvedTarget, dir);
		journal.side = side;
	});

	$effect(() => {
		if (!host) return;

		const observer = new ResizeObserver((entries) => {
			hostWidth = entries[0].contentRect.width;
		});

		observer.observe(host);
		hostWidth = host.clientWidth;

		return () => observer.disconnect();
	});

	onMount(() => {
		function onKey(event: KeyboardEvent) {
			if (document.querySelector('[data-modal-open]')) return;

			const target = event.target as HTMLElement | null;
			if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.stk'))) {
				return;
			}

			if (event.key === 'ArrowRight') {
				go(1);
			} else if (event.key === 'ArrowLeft') {
				go(-1);
			} else if (
				(event.key === 'Delete' || event.key === 'Backspace') &&
				journal.selected.length > 0
			) {
				event.preventDefault();
				if (journal.selected.length > 1) {
					journal.deleteSelected();
				} else {
					journal.deleteSticker(journal.selected[0]);
				}
			}
		}

		function onPointer(event: PointerEvent) {
			const target = event.target as Element;

			if (!target.closest('.stk, [data-sticker-tools]')) {
				journal.selectSticker(null);
			}

			const page = target.closest('.page');
			if (page && !target.closest('.face, .under')) {
				journal.lastPage = page.classList.contains('left') ? 'L' : 'R';
			}
		}

		document.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onPointer);

		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onPointer);
			if (flipTimer) clearTimeout(flipTimer);
		};
	});
</script>

{#if journal.ready && streak.current > 0}
	<div
		class="mx-auto mb-2 flex w-full max-w-[720px] items-center justify-center gap-1.5 font-ui text-[11px] text-book-bg/45"
		aria-label="Journal streak"
	>
		<CommunityIcon name="flame" size={12} />
		<span class="tabular-nums">{streak.current} day{streak.current === 1 ? '' : 's'}</span>
		{#if streak.longest > streak.current}
			<span class="text-book-bg/30">· best {streak.longest}</span>
		{/if}
	</div>
{/if}

{#if journal.ready}
	<div
		class="mx-auto mb-2 flex w-full max-w-[720px] justify-end"
		title={todayPages >= 3 ? 'Daily page limit reached' : 'Create another page for today'}
	>
		<Button size="sm" icon="plus" disabled={todayPages >= 3} onclick={() => journal.createEntry()}>
			Add Page · {todayPages}/3
		</Button>
	</div>
{/if}

{#if viewport.single}
	<div
		class="mx-auto mb-2.5 flex w-full max-w-[720px] items-center gap-1.5 rounded-2xl border border-cover-edge/60 bg-desk-2/95 p-1.5 shadow-[0_6px_18px_rgba(0,0,0,.3)]"
		aria-label="Journal page"
	>
		<button
			type="button"
			class="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 font-ui text-[13px] font-bold transition-colors {journal.side ===
			'L'
				? 'bg-paper text-ink shadow-sm'
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
			aria-pressed={journal.side === 'L'}
			onclick={() => setSide('L')}
		>
			<CommunityIcon name="video" size={15} />
			Video
		</button>
		<button
			type="button"
			class="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 font-ui text-[13px] font-bold transition-colors {journal.side ===
			'R'
				? 'bg-paper text-ink shadow-sm'
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
			aria-pressed={journal.side === 'R'}
			onclick={() => setSide('R')}
		>
			<CommunityIcon name="pen" size={15} />
			Write
		</button>
		<Button size="sm" class="min-h-10" icon="check" onclick={() => journal.markSaved()}>
			Save
		</Button>
	</div>
{/if}

<div
	bind:this={host}
	class="relative mx-auto w-full overflow-x-clip {viewport.single
		? 'max-w-[720px]'
		: 'max-w-[1240px]'}"
	style:height={viewport.single ? null : `${740 * scale}px`}
>
	<div
		class="relative {viewport.single ? 'w-full' : 'origin-top-left'}"
		style:width={viewport.single ? null : `${bookWidth}px`}
		style:transform={viewport.single ? null : `scale(${scale})`}
		style:margin-left={viewport.single ? null : `${offset}px`}
	>
		<div
			class="book relative [perspective:2600px] {viewport.single
				? 'w-full p-2 min-[480px]:p-3 min-[640px]:p-4'
				: 'h-[740px] w-[1160px]'}"
		>
			<div
				class="cover absolute inset-0 rounded-[24px] bg-[linear-gradient(135deg,var(--color-cover),var(--color-cover-edge)_55%,var(--color-desk))] shadow-[0_32px_75px_rgba(0,0,0,.65),0_12px_28px_rgba(0,0,0,.45)] ring-1 ring-white/[.07] ring-inset"
			></div>

			{#if currentEntry}
				{#if viewport.single}
					{#key `${journal.current}-${journal.side}`}
						{#if journal.side === 'L'}
							<LeftPage
								entry={currentEntry}
								date={journal.current}
								pageNumber={leftPageNumber}
								enter
							/>
						{:else}
							<RightPage entry={currentEntry} pageNumber={rightPageNumber} enter />
						{/if}
					{/key}
				{:else}
					<LeftPage entry={currentEntry} date={journal.current} pageNumber={leftPageNumber} />
					<RightPage entry={currentEntry} pageNumber={rightPageNumber} />
				{/if}
			{/if}

			{#if !viewport.single}
				<div
					class="absolute top-5 left-[579px] z-[3] h-[700px] w-0.5 bg-[rgba(40,22,10,.55)] shadow-[0_0_14px_6px_rgba(40,22,10,.18)]"
					aria-hidden="true"
				></div>

				<button
					type="button"
					class="corner prev"
					disabled={atStart}
					aria-label="Turn to previous page"
					onclick={() => go(-1)}
				></button>
				<button
					type="button"
					class="corner next"
					disabled={atEnd}
					aria-label="Turn to next page"
					onclick={() => go(1)}
				></button>
			{/if}

			{#if flip}
				<div
					class="under pointer-events-none absolute top-5 z-[2] h-[700px] w-[560px]"
					class:left-5={flip.dir > 0}
					class:left-[580px]={flip.dir < 0}
				>
					{#if flip.dir > 0}
						<LeftPage entry={flip.from} date={flip.from.date} pageNumber={flip.fromLeft} preview />
					{:else}
						<RightPage entry={flip.from} pageNumber={flip.fromRight} preview />
					{/if}
				</div>

				<div
					class="leaf absolute top-5 z-20 h-[700px] w-[560px]"
					class:next={flip.dir > 0}
					class:prev={flip.dir < 0}
					class:go={flip.go}
				>
					<div class="face front absolute inset-0">
						{#if flip.dir > 0}
							<RightPage entry={flip.from} pageNumber={flip.fromRight} preview />
						{:else}
							<LeftPage
								entry={flip.from}
								date={flip.from.date}
								pageNumber={flip.fromLeft}
								preview
							/>
						{/if}
					</div>

					<div class="face back absolute inset-0">
						{#if flip.dir > 0}
							<LeftPage entry={flip.to} date={flip.to.date} pageNumber={flip.toLeft} preview />
						{:else}
							<RightPage entry={flip.to} pageNumber={flip.toRight} preview />
						{/if}
						<div class="shade absolute inset-0 z-30 rounded-[inherit]"></div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<div
	class="mx-auto mt-[18px] flex max-w-[1160px] items-center justify-center gap-2 min-[480px]:gap-4"
>
	<button
		type="button"
		class="flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-cover-edge bg-desk-2 text-white shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-colors hover:bg-cover disabled:cursor-default disabled:opacity-35 disabled:hover:bg-desk-2 min-[480px]:size-12"
		disabled={atStart}
		aria-label="Previous page"
		onclick={() => go(-1)}
	>
		<CommunityIcon name="arrow-left" size={22} />
	</button>

	<div
		class="min-w-0 flex-1 text-center font-ui text-[13px] font-medium text-lav tabular-nums min-[480px]:min-w-[160px] min-[480px]:flex-none min-[480px]:text-[15px]"
		aria-live="polite"
	>
		{pageLabel}
	</div>

	<button
		type="button"
		class="flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-cover-edge bg-desk-2 text-white shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-colors hover:bg-cover disabled:cursor-default disabled:opacity-35 disabled:hover:bg-desk-2 min-[480px]:size-12"
		disabled={atEnd}
		aria-label="Next page"
		onclick={() => go(1)}
	>
		<CommunityIcon name="arrow-right" size={22} />
	</button>

	<button
		type="button"
		class="flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-danger/60 bg-desk-2 text-white shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-colors hover:bg-danger/20 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-desk-2 min-[480px]:size-12"
		aria-label="Delete this page"
		onclick={deletePage}
	>
		<CommunityIcon name="trash" size={22} />
	</button>
</div>

{#if deleteConfirm}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center"
		aria-modal="true"
		role="dialog"
		aria-label="Delete page"
	>
		<button
			type="button"
			class="absolute inset-0 bg-black/75"
			onclick={cancelDelete}
			onkeydown={(event) => {
				if (event.key === 'Escape') cancelDelete();
			}}
			aria-hidden="true"
		></button>
		<div
			class="relative mx-4 max-w-[340px] rounded-2xl border border-cover-edge bg-desk-2 p-7 text-center text-white shadow-[0_30px_80px_rgba(0,0,0,.6)]"
		>
			<h2 class="font-display text-xl font-bold text-balance">Delete this page?</h2>
			<p class="mt-2.5 font-ui text-sm leading-relaxed text-lav">
				This permanently removes this journal entry and its video. It cannot be undone.
			</p>
			<div class="mt-6 flex justify-center gap-3">
				<Button variant="outline" onclick={cancelDelete} disabled={deleting}>Cancel</Button>
				<Button variant="danger" icon="trash" loading={deleting} onclick={confirmDelete}>
					Delete page
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.leaf {
		transform-style: preserve-3d;
		transition: transform 950ms cubic-bezier(0.55, 0.04, 0.25, 1);
		pointer-events: none;
	}

	.leaf.next {
		left: 580px;
		transform-origin: left center;
	}

	.leaf.prev {
		left: 20px;
		transform-origin: right center;
	}

	.leaf.next.go {
		transform: rotateY(-180deg);
	}

	.leaf.prev.go {
		transform: rotateY(180deg);
	}

	.face {
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
	}

	.face.back {
		transform: rotateY(180deg);
	}

	.shade {
		background: linear-gradient(90deg, rgb(30 15 5 / 0), rgb(30 15 5 / 0.4));
		opacity: 0;
		pointer-events: none;
	}

	.leaf.go .shade {
		animation: shade 950ms ease-in-out;
	}

	@keyframes shade {
		0% {
			opacity: 0;
		}
		50% {
			opacity: 0.9;
		}
		100% {
			opacity: 0;
		}
	}

	.corner {
		position: absolute;
		bottom: 20px;
		width: 64px;
		height: 64px;
		border: 0;
		background: none;
		z-index: 6;
		padding: 0;
	}

	.corner.next {
		right: 20px;
		border-radius: 0 0 14px 0;
	}

	.corner.prev {
		left: 20px;
		border-radius: 0 0 0 14px;
	}

	.corner::before {
		content: '';
		position: absolute;
		bottom: 0;
		width: 0;
		height: 0;
		border-style: solid;
		transition: all 0.2s;
	}

	.corner.next::before {
		right: 0;
		border-width: 0;
		border-color: transparent transparent var(--color-book-edge) transparent;
	}

	.corner.prev::before {
		left: 0;
		border-width: 0;
		border-color: transparent transparent var(--color-book-edge) transparent;
	}

	.corner.next:hover::before,
	.corner.next:focus-visible::before {
		border-width: 0 0 46px 46px;
		border-color: transparent transparent
			color-mix(in srgb, var(--color-book-edge) 72%, var(--color-book-ink)) transparent;
		filter: drop-shadow(-2px -2px 3px rgb(0 0 0 / 0.25));
	}

	.corner.prev:hover::before,
	.corner.prev:focus-visible::before {
		border-width: 0 46px 46px 0;
		border-color: transparent transparent
			color-mix(in srgb, var(--color-book-edge) 72%, var(--color-book-ink)) transparent;
		filter: drop-shadow(2px -2px 3px rgb(0 0 0 / 0.25));
	}

	.corner[disabled] {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.leaf {
			transition: none;
		}

		.leaf.go .shade {
			animation: none;
		}

		.corner::before {
			transition: none;
		}
	}
</style>
