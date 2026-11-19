<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let {
		open,
		src,
		onClose
	}: {
		open: boolean;
		src: string;
		onClose: () => void;
	} = $props();

	const id = $props.id();
	let closeEl = $state<HTMLButtonElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			void tick().then(() => closeEl?.focus());
		} else if (!open && wasOpen) {
			wasOpen = false;
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}}
/>

{#if open && src}
	<div
		use:portal
		class="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(15,8,25,.9)] p-3 min-[720px]:p-6"
		data-modal-open
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[24px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.7)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-title`}
		>
			<div
				class="flex shrink-0 items-center justify-between gap-3 border-b border-cover-edge px-4 py-3"
			>
				<h2 id={`${id}-title`} class="font-ui text-sm font-bold">Photo</h2>
				<button
					bind:this={closeEl}
					type="button"
					class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20"
					onclick={onClose}
					aria-label="Close photo"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>
			<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
				<img
					{src}
					alt="Message attachment"
					class="max-h-[80vh] max-w-full rounded-xl object-contain"
				/>
			</div>
		</div>
	</div>
{/if}
