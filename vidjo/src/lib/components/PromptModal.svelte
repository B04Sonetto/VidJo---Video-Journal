<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let {
		open,
		title,
		message,
		hint = 'This is shown to the other person.',
		initialValue = '',
		placeholder = '',
		maxLength = 240,
		requiredPhrase = '',
		confirmLabel = 'Send',
		cancelLabel = 'Cancel',
		tone = 'primary',
		icon = 'pen',
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title: string;
		message: string;
		hint?: string;
		initialValue?: string;
		placeholder?: string;
		maxLength?: number;
		/** When set, the typed value must match exactly before confirming. */
		requiredPhrase?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		tone?: 'danger' | 'primary';
		icon?: 'pen' | 'trash' | 'alert' | 'shield';
		onConfirm: (value: string) => void;
		onCancel: () => void;
	} = $props();

	const id = $props.id();
	let input = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	const trimmed = $derived(input.trim());
	const phraseOk = $derived(!requiredPhrase || input === requiredPhrase);
	const valid = $derived(trimmed.length > 0 && phraseOk);

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			input = initialValue;
			void tick().then(() => {
				inputEl?.focus();
				inputEl?.select();
			});
		} else if (!open && wasOpen) {
			wasOpen = false;
			input = '';
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!valid) return;
		const value = trimmed;
		input = '';
		onConfirm(value);
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
		class="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(15,8,25,.78)] p-4"
		data-modal-open
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onCancel();
		}}
	>
		<div
			class="w-full max-w-[440px] rounded-[22px] border border-cover-edge bg-desk-2 p-5 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.65)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-message`}
		>
			<form onsubmit={submit}>
				<div class="flex items-start gap-3">
					<span
						class="flex size-11 shrink-0 items-center justify-center rounded-full {tone === 'danger'
							? 'bg-danger/20 text-[#FF9B9B]'
							: 'bg-book-accent/20 text-book-accent'}"
						aria-hidden="true"
					>
						<CommunityIcon name={icon} size={20} />
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

				<div class="mt-4">
					<input
						bind:this={inputEl}
						bind:value={input}
						type="text"
						maxlength={maxLength}
						{placeholder}
						autocomplete="off"
						class="h-11 w-full rounded-xl border border-cover-edge bg-desk px-3.5 font-ui text-sm text-book-bg placeholder:text-book-bg/45 focus:border-book-accent focus:outline-none"
					/>
					<div class="mt-1.5 flex items-center justify-between gap-2 font-ui text-[11px]">
						<span
							class={requiredPhrase && !phraseOk ? 'font-bold text-[#FF9B9B]' : 'text-book-bg/60'}
						>
							{#if requiredPhrase}
								Type <strong class="font-mono">{requiredPhrase}</strong> to confirm.
							{:else}
								{hint}
							{/if}
						</span>
						<span class="shrink-0 text-book-bg/50 tabular-nums">{input.length}/{maxLength}</span>
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
						type="submit"
						disabled={!valid}
						class="min-h-11 rounded-xl px-4 font-ui text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 {tone ===
						'danger'
							? 'bg-danger hover:bg-danger/80'
							: 'bg-cta text-cta-text hover:bg-cta-hover'}"
					>
						{confirmLabel}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
