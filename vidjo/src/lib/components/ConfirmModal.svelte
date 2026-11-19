<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		tone = 'danger',
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		tone?: 'danger' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	const id = $props.id();
	let confirmButton = $state<HTMLButtonElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			void tick().then(() => confirmButton?.focus());
		} else if (!open && wasOpen) {
			wasOpen = false;
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onCancel();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onCancel();
		}
	}}
/>

{#if open}
	<div
		use:portal
		class="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(15,8,25,.78)] p-4"
		data-modal-open
		role="presentation"
		onclick={backdrop}
	>
		<div
			class="w-full max-w-[420px] rounded-[22px] border border-cover-edge bg-desk-2 p-5 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.65)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-message`}
		>
			<div class="flex items-start gap-3">
				<span
					class="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/20 text-[#FF9B9B]"
					aria-hidden="true"
				>
					<CommunityIcon name="trash" size={20} />
				</span>
				<div class="min-w-0">
					<h2 id={`${id}-title`} class="font-display text-xl leading-tight font-bold">
						{title}
					</h2>
					<p id={`${id}-message`} class="mt-1 font-ui text-sm leading-relaxed text-book-bg/70">
						{message}
					</p>
				</div>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					class="min-h-11 rounded-xl border border-cover-edge bg-desk px-4 font-ui text-sm font-semibold text-book-bg/80 transition-colors hover:bg-cover"
					onclick={onCancel}
				>
					{cancelLabel}
				</button>
				<button
					bind:this={confirmButton}
					type="button"
					class="min-h-11 rounded-xl px-4 font-ui text-sm font-bold text-white transition-colors {tone ===
					'danger'
						? 'bg-danger hover:bg-danger/80'
						: 'bg-cta text-cta-text hover:bg-cta-hover'}"
					onclick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
