<script lang="ts">
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import { journal } from '#lib/state/journal.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import type { Entry, Side, Sticker } from '#lib/types';

	let { entry, side, preview = false }: { entry: Entry; side: Side; preview?: boolean } = $props();

	let layer = $state<HTMLDivElement | null>(null);
	let drag = $state<{
		id: string;
		pageEl: HTMLElement;
		ox: number;
		oy: number;
		moved: boolean;
	} | null>(null);

	const stickers = $derived(entry.stickers.filter((sticker) => sticker.page === side));

	function pointerDown(event: PointerEvent, sticker: Sticker) {
		if (preview || event.button > 0) return;

		journal.selectSticker(sticker.id, event.ctrlKey || event.metaKey);
		journal.lastPage = side;

		const pageEl = layer?.closest('.page') as HTMLElement | null;
		if (!pageEl) return;

		const rect = pageEl.getBoundingClientRect();
		drag = {
			id: sticker.id,
			pageEl,
			ox: ((event.clientX - rect.left) / rect.width) * 100 - sticker.x,
			oy: ((event.clientY - rect.top) / rect.height) * 100 - sticker.y,
			moved: false
		};

		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function pointerMove(event: PointerEvent) {
		if (!drag) return;

		const sticker = journal.findSticker(drag.id);
		if (!sticker) return;

		const rect = drag.pageEl.getBoundingClientRect();
		sticker.x = Math.max(
			-12,
			Math.min(112, ((event.clientX - rect.left) / rect.width) * 100 - drag.ox)
		);
		sticker.y = Math.max(
			-6,
			Math.min(106, ((event.clientY - rect.top) / rect.height) * 100 - drag.oy)
		);
		drag.moved = true;
	}

	function pointerUp(event: PointerEvent) {
		if (!drag) return;

		const current = drag;
		drag = null;

		try {
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		} catch {
			// The element may already have lost capture.
		}

		const sticker = journal.findSticker(current.id);
		if (!sticker) return;

		if (!viewport.single) {
			const book = layer?.closest('.book') as HTMLElement | null;
			if (book) {
				const pageRect = current.pageEl.getBoundingClientRect();
				const bookRect = book.getBoundingClientRect();
				const absX = pageRect.left + (sticker.x / 100) * pageRect.width;
				const targetSide: Side = absX < bookRect.left + bookRect.width / 2 ? 'L' : 'R';

				if (targetSide !== sticker.page) {
					const targetEl = book.querySelector<HTMLElement>(
						targetSide === 'L' ? '.page.left' : '.page.right'
					);

					if (targetEl) {
						const targetRect = targetEl.getBoundingClientRect();
						sticker.x = ((absX - targetRect.left) / targetRect.width) * 100;
						sticker.y =
							((pageRect.top + (sticker.y / 100) * pageRect.height - targetRect.top) /
								targetRect.height) *
							100;
						sticker.page = targetSide;
						journal.lastPage = targetSide;
					}
				}
			}
		}

		sticker.x = Math.max(3, Math.min(97, sticker.x));
		sticker.y = Math.max(3, Math.min(97, sticker.y));

		if (current.moved) journal.commit();
	}

	function keyDown(event: KeyboardEvent, sticker: Sticker) {
		if (preview) return;

		const key = event.key;
		let moved = false;

		if (key === 'ArrowLeft') {
			sticker.x = Math.max(3, sticker.x - 1.5);
			moved = true;
		} else if (key === 'ArrowRight') {
			sticker.x = Math.min(97, sticker.x + 1.5);
			moved = true;
		} else if (key === 'ArrowUp') {
			sticker.y = Math.max(3, sticker.y - 1.5);
			moved = true;
		} else if (key === 'ArrowDown') {
			sticker.y = Math.min(97, sticker.y + 1.5);
			moved = true;
		} else if (key === 'Delete' || key === 'Backspace') {
			event.preventDefault();
			if (journal.selected.length > 1) {
				journal.deleteSelected();
			} else if (journal.selected.length === 1) {
				journal.deleteSticker(journal.selected[0]);
			}
			return;
		}

		if (moved) {
			event.preventDefault();
			event.stopPropagation();
			journal.commit();
		}
	}
</script>

<div bind:this={layer} class="pointer-events-none absolute inset-0 z-[5]">
	{#each stickers as sticker (sticker.id)}
		{@const definition = STICKER_BY_KEY[sticker.type]}
		<div
			class="stk absolute cursor-grab touch-none select-none active:cursor-grabbing"
			class:sticker-flat={definition?.flat}
			class:sticker-shadow={!definition?.flat}
			class:sel={journal.selected.includes(sticker.id)}
			class:pointer-events-auto={!preview}
			style:left={`${sticker.x}%`}
			style:top={`${sticker.y}%`}
			style:width={`${sticker.size}px`}
			style:transform={`translate(-50%, -50%) rotate(${sticker.rot}deg)`}
			role="button"
			tabindex={preview ? -1 : 0}
			aria-label={preview
				? undefined
				: `${definition?.n ?? 'Your image'} sticker. Arrow keys move it, Delete removes it.`}
			onpointerdown={(event) => pointerDown(event, sticker)}
			onpointermove={pointerMove}
			onpointerup={pointerUp}
			onpointercancel={pointerUp}
			onkeydown={(event) => keyDown(event, sticker)}
			onfocus={() => !preview && journal.selectSticker(sticker.id)}
		>
			<button
				type="button"
				class="absolute -top-3 -right-3 size-6 rounded-full bg-[#1B102B]/80 border border-[#4D366D]/60 text-white text-[10px] font-bold hover:bg-[#51397A] hover:border-[#D4A24C] transition-colors active:scale-95"
				onclick={(event) => {
					event.stopPropagation();
					journal.deleteSticker(sticker.id);
					journal.commit();
				}}
				aria-label="Remove sticker"
			>
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="3 6 5 6 21 6"></polyline>
					<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
				</svg>
			</button>
			{#if sticker.type === 'img' && sticker.src}
				<img src={sticker.src} alt="" class="block h-auto w-full" draggable="false" />
			{:else}
				<div class="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/stickers.ts -->
					{@html definition?.svg ?? ''}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.stk.sel {
		outline: 2px dashed var(--color-gold);
		outline-offset: 6px;
		cursor: grabbing;
		z-index: 2;
	}
</style>
