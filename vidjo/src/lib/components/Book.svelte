<script lang="ts">
	import { onMount } from 'svelte';
	import LeftPage from '#lib/components/LeftPage.svelte';
	import RightPage from '#lib/components/RightPage.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
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

	const bookWidth = $derived(viewport.single ? 600 : 1160);
	const scale = $derived(hostWidth > 0 ? Math.min(1, hostWidth / bookWidth) : 1);
	const offset = $derived(Math.max(0, (hostWidth - bookWidth * scale) / 2));

	const dates = $derived(journal.sortedDates);
	const index = $derived(dates.indexOf(journal.current));
	const total = $derived(dates.length);
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

		const from = $state.snapshot(journal.currentEntry) as Entry;
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
		if (!deleteConfirm) return;
		await journal.deleteEntry(deleteConfirm);
		deleteConfirm = null;
	}

	async function cancelDelete() {
		deleteConfirm = null;
	}

	$effect(() => {
		const target = nav.target;
		if (!target || !journal.ready) return;

		nav.target = null;

		if (target === journal.current) {
			journal.side = 'L';
			return;
		}

		const dir: 1 | -1 = target > journal.current ? 1 : -1;
		moveTo(target, dir);
		journal.side = 'L';
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
			} else if ((event.key === 'Delete' || event.key === 'Backspace') && journal.selected.length > 0) {
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

<div
	bind:this={host}
	class="relative mx-auto w-full max-w-[1240px]"
	style:height={`${740 * scale}px`}
>
	<!-- Ambient desk glow beneath book -->
	<div
		class="pointer-events-none absolute inset-x-8 bottom-[-10px] -z-10 h-40 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(110,65,160,0.38)_0%,rgba(67,41,107,0.18)_50%,transparent_72%)] blur-2xl"
		aria-hidden="true"
	></div>

	<div
		class="relative origin-top-left"
		style:width={`${bookWidth}px`}
		style:transform={`scale(${scale})`}
		style:margin-left={`${offset}px`}
	>
		<div
			class="book relative h-[740px] [perspective:2600px]"
			class:w-[600px]={viewport.single}
			class:w-[1160px]={!viewport.single}
		>
			<div
				class="cover absolute inset-0 rounded-[24px] bg-[linear-gradient(135deg,#523479,#3A2360_55%,#2E1A4E)] shadow-[0_32px_75px_rgba(0,0,0,.65),0_12px_28px_rgba(0,0,0,.45),inset_0_0_0_2px_rgba(255,255,255,.07)] after:absolute after:inset-2 after:rounded-[17px] after:border-2 after:border-dashed after:border-gold/50 after:content-['']"
			></div>

			{#if viewport.single}
				{#key `${journal.current}-${journal.side}`}
					{#if journal.side === 'L'}
						<LeftPage
							entry={journal.currentEntry}
							date={journal.current}
							pageNumber={leftPageNumber}
							enter
						/>
					{:else}
						<RightPage entry={journal.currentEntry} pageNumber={rightPageNumber} enter />
					{/if}
				{/key}
			{:else}
				<LeftPage entry={journal.currentEntry} date={journal.current} pageNumber={leftPageNumber} />
				<RightPage entry={journal.currentEntry} pageNumber={rightPageNumber} />
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

<div class="mx-auto mt-[18px] flex max-w-[1160px] items-center justify-center gap-4">
	<button
		type="button"
		class="flex size-12 items-center justify-center rounded-full border-[1.5px] border-[#5A4580] bg-desk-2 shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-all hover:scale-105 hover:bg-[#3A2A55] active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100 disabled:hover:bg-desk-2"
		disabled={atStart}
		aria-label="Previous page"
		onclick={() => go(-1)}
	>
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#fff"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M15 5l-7 7 7 7"></path>
		</svg>
	</button>

	<div
		class="min-w-[160px] text-center font-ui text-[15px] font-medium tracking-wide text-[#D6CBEC]"
		aria-live="polite"
	>
		{pageLabel}
	</div>

	<button
		type="button"
		class="flex size-12 items-center justify-center rounded-full border-[1.5px] border-[#5A4580] bg-desk-2 shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-all hover:scale-105 hover:bg-[#3A2A55] active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100 disabled:hover:bg-desk-2"
		disabled={atEnd}
		aria-label="Next page"
		onclick={() => go(1)}
	>
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#fff"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M9 5l7 7-7 7"></path>
		</svg>
	</button>

	<button
		type="button"
		class="flex size-12 items-center justify-center rounded-full border-[1.5px] border-[#D19A9A] bg-desk-2 shadow-[0_4px_14px_rgba(0,0,0,.35)] transition-all hover:scale-105 hover:bg-[#3A222B] active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100 disabled:hover:bg-desk-2"
		aria-label="Delete this page"
		onclick={deletePage}
	>
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#fff"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<polyline points="3 6 5 6 21 6"></polyline>
			<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
		</svg>
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
		class="absolute inset-0 bg-black/60 backdrop-blur-sm"
		onclick={cancelDelete}
		onkeydown={(event) => {
			if (event.key === 'Escape') cancelDelete();
		}}
		aria-hidden="true"
	></button>
		<div
			class="relative rounded-[24px] border border-[#5A4580] bg-desk-2 p-8 shadow-[0_30px_80px_rgba(0,0,0,.6)] text-center text-white max-w-[320px] mx-4"
		>
			<h2 class="font-display text-xl font-bold">Delete this page?</h2>
			<p class="mt-3 font-ui text-sm text-[#D6CBEC] leading-relaxed">
				This will permanently remove this journal entry. It cannot be undone.
			</p>
			<div class="mt-6 flex gap-3 justify-center">
				<button
					type="button"
					class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] px-4 font-ui text-sm text-[#D6CBEC] hover:bg-[#43306A]"
					onclick={cancelDelete}
				>
					Cancel
				</button>
				<button
					type="button"
					class="flex size-11 items-center justify-center rounded-xl border border-[#D19A9A] bg-[#3A222B] px-4 font-ui text-sm text-white hover:bg-[#4A2A32]"
					onclick={confirmDelete}
				>
					Delete
				</button>
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
		border-color: transparent transparent #e9dfc6 transparent;
	}

	.corner.prev::before {
		left: 0;
		border-width: 0;
		border-color: transparent transparent #e9dfc6 transparent;
	}

	.corner.next:hover::before,
	.corner.next:focus-visible::before {
		border-width: 0 0 46px 46px;
		border-color: transparent transparent #d2c29b transparent;
		filter: drop-shadow(-2px -2px 3px rgb(0 0 0 / 0.25));
	}

	.corner.prev:hover::before,
	.corner.prev:focus-visible::before {
		border-width: 0 46px 46px 0;
		border-color: transparent transparent #d2c29b transparent;
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
