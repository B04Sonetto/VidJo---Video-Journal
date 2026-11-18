<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { PaperStyle } from '#lib/types';

	let {
		open,
		title,
		value,
		maxlength,
		placeholder,
		paper = 'plain',
		onClose,
		onInput
	}: {
		open: boolean;
		title: string;
		value: string;
		maxlength: number;
		placeholder: string;
		paper?: PaperStyle;
		onClose: () => void;
		onInput: (value: string) => void;
	} = $props();

	const id = $props.id();
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			void tick().then(() => {
				textarea?.focus();
				const end = textarea?.value.length ?? 0;
				textarea?.setSelectionRange(end, end);
			});
		} else if (!open && wasOpen) {
			wasOpen = false;
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});

	$effect(() => {
		if (!open) return;

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	function backdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}}
/>

{#if open}
	<div
		use:portal
		class="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgba(15,8,25,.78)] p-2 min-[640px]:items-center min-[640px]:p-6"
		data-modal-open
		role="presentation"
		onclick={backdrop}
	>
		<div
			class="flex h-full w-full max-w-[880px] flex-col overflow-hidden rounded-[20px] border border-line bg-paper font-hand text-ink shadow-[0_30px_80px_rgba(0,0,0,.6)] min-[640px]:h-[min(90vh,900px)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-help`}
		>
			<header
				class="flex items-start gap-3 border-b border-line/70 px-4 py-3 min-[640px]:px-6 min-[640px]:py-4"
			>
				<div class="mr-auto min-w-0">
					<h2
						id={`${id}-title`}
						class="m-0 font-display text-[22px] leading-tight font-bold text-ink min-[640px]:text-[26px]"
					>
						{title}
					</h2>
					<p id={`${id}-help`} class="mt-1 font-ui text-[11px] font-semibold text-ink-soft">
						Full screen writing · press Esc when you are done
					</p>
				</div>
				<button
					type="button"
					class="flex size-11 flex-none items-center justify-center rounded-xl border border-line bg-light text-accent transition-colors hover:bg-paper-deep"
					aria-label="Close full screen editor"
					onclick={onClose}
				>
					<CommunityIcon name="x" size={20} />
				</button>
			</header>

			<textarea
				bind:this={textarea}
				id={`${id}-text`}
				class="block min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-4 py-4 font-hand text-[22px] leading-[32px] text-ink placeholder:text-ink-muted focus:ring-0 min-[640px]:px-6 min-[640px]:text-[24px]"
				class:paper-lined={paper === 'lined'}
				class:paper-dotted={paper === 'dotted'}
				class:paper-grid={paper === 'grid'}
				style:background-position={paper === 'lined' ? '0 16px' : null}
				aria-label={title}
				{maxlength}
				{placeholder}
				{value}
				oninput={(event) => onInput(event.currentTarget.value)}></textarea>

			<footer
				class="flex flex-wrap items-center gap-3 border-t border-line/70 px-4 py-3 min-[640px]:px-6"
			>
				<span class="font-ui text-sm font-semibold text-ink-soft tabular-nums">
					{value.length}/{maxlength}
				</span>
				<button
					type="button"
					class="ml-auto min-h-11 rounded-xl bg-cta px-5 font-ui text-sm font-bold text-cta-text shadow-[0_6px_18px_var(--color-cta-shadow)] transition-colors hover:bg-cta-hover"
					onclick={onClose}
				>
					Done
				</button>
			</footer>
		</div>
	</div>
{/if}
