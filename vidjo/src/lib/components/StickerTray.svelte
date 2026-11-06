<script lang="ts">
	import { slide } from 'svelte/transition';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { STICKERS } from '#lib/data/stickers';
	import { journal } from '#lib/state/journal.svelte';
	import type { PaperStyle } from '#lib/types';

	const TRAY_KEY = 'vidjo-tray-open';
	// Stickers live inside the entry JSON (localStorage + `vidjo_entries.stickers`),
	// so keep every encoded image comfortably small. A 260px WebP is usually far
	// below this limit; the cap only catches unusually detailed images.
	const MAX_STICKER_FILE_BYTES = 5 * 1024 * 1024;
	const MAX_STICKER_DATA_URL_LENGTH = 120_000;

	function readTrayOpen() {
		try {
			return localStorage.getItem(TRAY_KEY) !== '0';
		} catch {
			return true;
		}
	}

	let { sidebar = false }: { sidebar?: boolean } = $props();

	const trayClass = $derived(
		sidebar
			? 'rounded-[20px] border border-[#4A3670] bg-desk-2 h-full w-64 px-3 py-4 flex flex-col gap-4'
			: 'rounded-[20px] border border-[#4A3670] bg-desk-2 mx-auto mt-5 max-w-[1160px] px-[18px] py-4'
	);

	const papers: { k: PaperStyle; label: string }[] = [
		{ k: 'lined', label: 'Lined' },
		{ k: 'dotted', label: 'Dotted' },
		{ k: 'grid', label: 'Grid' },
		{ k: 'plain', label: 'Plain' }
	];

	let imageInput = $state<HTMLInputElement | null>(null);
	let open = $state(readTrayOpen());

	function toggle() {
		open = !open;
		try {
			localStorage.setItem(TRAY_KEY, open ? '1' : '0');
		} catch {
			// A blocked storage should not stop the tray from working.
		}
	}

	function act(action: string) {
		const id = journal.selected[0];
		if (!id) return;

		const sticker = journal.findSticker(id);
		if (!sticker) return;

		if (action === 'bigger') {
			journal.updateSticker(id, { size: Math.min(260, sticker.size + 14) });
		} else if (action === 'smaller') {
			journal.updateSticker(id, { size: Math.max(36, sticker.size - 14) });
		} else if (action === 'rotl') {
			journal.updateSticker(id, { rot: sticker.rot - 15 });
		} else if (action === 'rotr') {
			journal.updateSticker(id, { rot: sticker.rot + 15 });
		} else if (action === 'del') {
			if (journal.selected.length > 1) {
				journal.deleteSelected();
			} else {
				journal.deleteSticker(id);
			}
		}
	}

	function pickImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			journal.toast('Choose an image file');
			return;
		}

		if (file.size > MAX_STICKER_FILE_BYTES) {
			journal.toast('Images must be 5 MB or smaller');
			return;
		}

		const image = new Image();
		const url = URL.createObjectURL(file);

		image.onload = () => {
			const max = 260;
			const ratio = Math.min(1, max / Math.max(image.width, image.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(image.width * ratio);
			canvas.height = Math.round(image.height * ratio);
			const context = canvas.getContext('2d');
			context?.drawImage(image, 0, 0, canvas.width, canvas.height);
			URL.revokeObjectURL(url);

			// WebP keeps transparency and is much smaller than PNG. Browsers that
			// cannot encode WebP fall back to PNG automatically.
			let dataUrl = canvas.toDataURL('image/webp', 0.85);
			if (dataUrl.length > MAX_STICKER_DATA_URL_LENGTH) {
				dataUrl = canvas.toDataURL('image/jpeg', 0.7);
			}
			if (dataUrl.length > MAX_STICKER_DATA_URL_LENGTH) {
				journal.toast('That image is too detailed to use as a sticker. Try a smaller one.');
				return;
			}

			journal.addImageSticker(dataUrl);
			journal.toast('Your image is now a sticker');
		};

		image.onerror = () => {
			URL.revokeObjectURL(url);
			journal.toast('That file could not be read as an image');
		};

		image.src = url;
	}
</script>

<section class={trayClass} aria-label="Decorate">
	{#if sidebar}
		<div class="flex flex-col items-center gap-2">
			<h2 class="mr-auto flex items-center gap-2 font-display text-xl font-bold text-white">
				<i class="text-gold not-italic">
					<CommunityIcon name="spark" size={14} />
				</i>
				Sticker tray
			</h2>
			<button
				type="button"
				class="flex min-h-10 items-center gap-1.5 rounded-xl border border-[#5A4580] bg-[#33224D] px-2.5 font-ui text-xs text-white hover:bg-[#43306A]"
				aria-expanded={open}
				aria-controls="sticker-tray-body"
				onclick={toggle}
			>
				{open ? 'Hide' : 'Show'}
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="transition-transform {open ? 'rotate-180' : ''}"
					aria-hidden="true"
				>
					<path d="M6 9l6 6 6-6"></path>
				</svg>
			</button>
		</div>

		{#if open}
			<div
				id="sticker-tray-body"
				class="mt-2 flex-1 overflow-y-auto"
				transition:slide={{ duration: 180 }}
			>
				<div class="flex flex-col items-center gap-2">
					<div
						class="flex w-full flex-wrap items-center gap-1.5"
						class:pointer-events-none={!journal.selected}
						class:opacity-40={!journal.selected}
						data-sticker-tools
						role="toolbar"
						aria-label="Selected sticker"
					>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Make smaller"
							onclick={() => act('smaller')}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M5 12h14"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Make bigger"
							onclick={() => act('bigger')}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M5 12h14M12 5v14"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Rotate left"
							onclick={() => act('rotl')}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 12a8 8 0 108-8H7M7 1L4 4l3 3"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Rotate right"
							onclick={() => act('rotr')}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M20 12a8 8 0 11-8-8h5M17 1l3 3-3 3"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Delete sticker"
							onclick={() => act('del')}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>
							</svg>
						</button>
					</div>

					<div
						class="mt-2 flex w-full flex-wrap items-center gap-1.5"
						role="group"
						aria-label="Paper style"
					>
						{#each papers as paper (paper.k)}
							<button
								type="button"
								class="flex size-10 items-center justify-center rounded-xl border px-3 text-xs {journal.paper ===
								paper.k
									? 'border-light bg-light font-bold text-ink'
									: 'border-[#5A4580] bg-[#33224D]'}"
								aria-pressed={journal.paper === paper.k}
								onclick={() => journal.setPaper(paper.k)}
							>
								{paper.label.slice(0, 3)}
							</button>
						{/each}
					</div>

					<div class="mt-2 flex w-full flex-col items-center gap-2">
						{#each STICKERS as sticker (sticker.k)}
							<button
								type="button"
								class="flex size-10 flex-none items-center justify-center rounded-2xl border border-[#4A3670] bg-light p-1 hover:bg-white"
								aria-label={'Add ' + sticker.n + ' sticker'}
								onclick={() => journal.addSticker(sticker.k)}
							>
								<span class="block size-full [&>svg]:size-8">{@html sticker.svg}</span>
							</button>
						{/each}

						<button
							type="button"
							class="flex size-10 flex-none flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed border-[#8B6FD0] bg-transparent text-[10px] text-[#D6CBEC]"
							aria-label="Add your own image as a sticker"
							onclick={() => imageInput?.click()}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<rect x="3" y="4" width="18" height="16" rx="3"></rect>
								<circle cx="9" cy="10" r="2"></circle>
								<path d="M21 16l-5-5-8 9"></path>
							</svg>
							Your image
						</button>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		<div class="flex flex-wrap items-center gap-[18px]">
			<h2 class="mr-auto flex items-center gap-2 font-display text-xl font-bold text-white">
				<i class="text-gold not-italic">
					<CommunityIcon name="spark" size={14} />
				</i>
				Sticker tray
			</h2>

			<button
				type="button"
				class="flex min-h-11 items-center gap-2 rounded-xl border border-[#5A4580] bg-[#33224D] px-3.5 font-ui text-sm text-white hover:bg-[#43306A]"
				aria-expanded={open}
				aria-controls="sticker-tray-body"
				onclick={toggle}
			>
				{open ? 'Hide tray' : 'Show tray'}
				<svg
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="transition-transform {open ? 'rotate-180' : ''}"
					aria-hidden="true"
				>
					<path d="M6 9l6 6 6-6"></path>
				</svg>
			</button>
		</div>

		{#if open}
			<div id="sticker-tray-body" class="mt-3" transition:slide={{ duration: 180 }}>
				<div class="mb-3 flex flex-wrap items-center gap-[18px]">
					<div
						class="flex flex-wrap items-center gap-1.5"
						class:pointer-events-none={!journal.selected}
						class:opacity-40={!journal.selected}
						data-sticker-tools
						role="toolbar"
						aria-label="Selected sticker"
					>
						<span class="mr-1 hidden text-[13px] text-[#BBA8E0] min-[900px]:inline">
							Selected sticker
						</span>
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Make smaller"
							onclick={() => act('smaller')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M5 12h14"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Make bigger"
							onclick={() => act('bigger')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M5 12h14M12 5v14"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Rotate left"
							onclick={() => act('rotl')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 12a8 8 0 108-8H7M7 1L4 4l3 3"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Rotate right"
							onclick={() => act('rotr')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M20 12a8 8 0 11-8-8h5M17 1l3 3-3 3"></path>
							</svg>
						</button>
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] hover:bg-[#43306A]"
							aria-label="Delete sticker"
							onclick={() => act('del')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="#fff"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>
							</svg>
						</button>
					</div>

					<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Paper style">
						<span class="mr-1 hidden text-[13px] text-[#BBA8E0] min-[900px]:inline">Paper</span>
						{#each papers as paper (paper.k)}
							<button
								type="button"
								class="min-h-11 rounded-xl border px-3.5 text-sm {journal.paper === paper.k
									? 'border-light bg-light font-bold text-ink'
									: 'border-[#5A4580] bg-[#33224D]'}"
								aria-pressed={journal.paper === paper.k}
								onclick={() => journal.setPaper(paper.k)}
							>
								{paper.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex [scrollbar-width:thin] gap-2.5 overflow-x-auto px-0.5 pt-1.5 pb-2.5">
					{#each STICKERS as sticker (sticker.k)}
						<button
							type="button"
							class="flex size-[76px] flex-none items-center justify-center rounded-2xl border border-[#4A3670] bg-light p-2 hover:-translate-y-0.5 hover:bg-white"
							aria-label={'Add ' + sticker.n + ' sticker'}
							onclick={() => journal.addSticker(sticker.k)}
						>
							<span class="block size-full [&>svg]:size-full">{@html sticker.svg}</span>
						</button>
					{/each}

					<button
						type="button"
						class="flex h-[76px] w-24 flex-none flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed border-[#8B6FD0] bg-transparent text-xs text-[#D6CBEC]"
						aria-label="Add your own image as a sticker"
						onclick={() => imageInput?.click()}
					>
						<svg
							width="26"
							height="26"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<rect x="3" y="4" width="18" height="16" rx="3"></rect>
							<circle cx="9" cy="10" r="2"></circle>
							<path d="M21 16l-5-5-8 9"></path>
						</svg>
						Your image
					</button>
				</div>
			</div>
		{/if}
	{/if}

	<input
		bind:this={imageInput}
		type="file"
		accept="image/*"
		class="hidden"
		aria-label="Choose an image for a sticker"
		onchange={pickImage}
	/>
</section>
