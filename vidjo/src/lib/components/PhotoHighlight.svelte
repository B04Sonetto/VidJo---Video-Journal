<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ImageLightbox from '#lib/components/ImageLightbox.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';

	let {
		src,
		caption = '',
		class: className = '',
		showCaption = true,
		loading = false,
		onRemove,
		onReplace,
		onRetry
	}: {
		src: string;
		caption?: string;
		class?: string;
		showCaption?: boolean;
		loading?: boolean;
		onRemove?: () => void;
		onReplace?: () => void;
		onRetry?: () => void;
	} = $props();

	let loaded = $state(false);
	let failed = $state(false);
	let lightboxOpen = $state(false);
	let trackedSrc = '';

	$effect(() => {
		if (src === trackedSrc) return;
		trackedSrc = src;
		loaded = false;
		failed = false;
	});
</script>

<div
	class="photo-highlight relative isolate flex h-full w-full items-center justify-center {className}"
>
	<span
		class="photo-tape absolute top-0 left-[-14px] z-[3] h-7 w-[88px] rotate-[-34deg] bg-lav/[.85] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
		aria-hidden="true"
	></span>
	<span
		class="photo-tape absolute top-0 right-[-14px] z-[3] h-7 w-[88px] rotate-[34deg] bg-[rgba(240,200,115,.88)] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_2px_rgba(0,0,0,.15)]"
		aria-hidden="true"
	></span>

	<figure
		class="photo-print relative flex h-full max-h-full w-full max-w-[620px] rotate-[-.8deg] flex-col p-2 pb-2.5 transition-transform duration-200 hover:-translate-y-0.5 hover:rotate-0 min-[900px]:p-2.5"
	>
		{#if failed || (!src && !loading)}
			<div
				class="photo-open relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_25%,var(--color-cover),var(--color-desk)_75%)]"
			>
				<span class="flex flex-col items-center gap-2 px-4 text-center font-hand text-book-bg">
					<span
						class="flex size-12 items-center justify-center rounded-full bg-white/12 text-book-accent"
					>
						<CommunityIcon name="camera" size={22} />
					</span>
					<span class="font-ui text-[13px] font-semibold">
						{failed ? 'Photo unavailable' : 'No photo yet'}
					</span>
					{#if onRetry && (failed || !src)}
						<button
							type="button"
							class="rounded-lg bg-book-bg/90 px-2.5 py-1 font-ui text-[11px] font-bold text-book-ink"
							onclick={onRetry}
						>
							Try again
						</button>
					{/if}
				</span>
			</div>
		{:else}
			<button
				type="button"
				class="photo-open relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] bg-[radial-gradient(circle_at_30%_25%,var(--color-cover),var(--color-desk)_75%)] disabled:cursor-default"
				disabled={!src || !loaded}
				aria-label="Enlarge photo highlight"
				onclick={() => (lightboxOpen = true)}
			>
				{#if loading || !loaded}
					<span
						class="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-desk/55"
					>
						<Spinner size={22} class="text-lav" />
						<span class="font-ui text-[11px] font-semibold text-white">Opening photo…</span>
					</span>
				{/if}

				{#if src}
					<img
						{src}
						alt={caption || 'Photo highlight'}
						class="block h-full w-full object-cover transition-opacity duration-300"
						class:opacity-0={!loaded}
						class:opacity-100={loaded}
						loading="lazy"
						decoding="async"
						onload={() => (loaded = true)}
						onerror={() => (failed = true)}
					/>
				{/if}

				{#if src && loaded}
					<span
						class="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-desk/90 px-2 py-1 font-ui text-[10px] font-bold text-book-bg"
					>
						<CommunityIcon name="expand" size={11} />
						View
					</span>
				{/if}
			</button>
		{/if}

		{#if showCaption}
			<figcaption class="flex min-h-8 items-center gap-2 px-1 pt-1.5">
				<span class="min-w-0 flex-1 truncate font-hand text-[17px] leading-none font-bold text-ink">
					{caption || 'Photo highlight'}
				</span>
				{#if onReplace}
					<button
						type="button"
						class="photo-action flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-light text-ink-muted hover:border-book-accent/60 hover:text-book-accent"
						aria-label="Replace photo"
						title="Replace photo"
						onclick={onReplace}
					>
						<CommunityIcon name="pen" size={13} />
					</button>
				{/if}
				{#if onRemove}
					<button
						type="button"
						class="photo-action photo-remove flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-light text-accent hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
						aria-label="Remove photo"
						title="Remove photo"
						onclick={onRemove}
					>
						<CommunityIcon name="trash" size={13} />
					</button>
				{/if}
			</figcaption>
		{/if}
	</figure>
</div>

<ImageLightbox open={lightboxOpen} {src} onClose={() => (lightboxOpen = false)} />

<style>
	.photo-print {
		background: linear-gradient(180deg, #fffefa 0%, #f7f0df 100%);
		box-shadow:
			0 10px 24px rgba(45, 28, 12, 0.34),
			0 2px 0 rgba(255, 255, 255, 0.7) inset;
	}

	.photo-print::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		background-image: radial-gradient(rgba(80, 55, 25, 0.1) 0.5px, transparent 0.5px);
		background-size: 4px 4px;
		opacity: 0.4;
	}

	.photo-action {
		transition:
			opacity 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}

	@media (hover: hover) and (pointer: fine) {
		.photo-remove {
			opacity: 0;
		}

		.photo-highlight:hover .photo-remove,
		.photo-highlight:focus-within .photo-remove {
			opacity: 1;
		}
	}
</style>
