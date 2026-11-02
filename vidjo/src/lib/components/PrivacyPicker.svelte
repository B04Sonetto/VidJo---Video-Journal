<script lang="ts">
	import type { Privacy } from '#lib/types';

	const options: { v: Privacy; label: string; small: string; icon: string }[] = [
		{
			v: 'private',
			label: 'Private',
			small: 'Only you',
			icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>'
		},
		{
			v: 'friends',
			label: 'Friends',
			small: 'Selected friends',
			icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6M16 4.8a3.5 3.5 0 010 6.4M18 14c2.2.6 3.5 2.6 3.5 6"/></svg>'
		},
		{
			v: 'community',
			label: 'Community',
			small: 'Your communities',
			icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>'
		}
	];

	let {
		value,
		readonly = false,
		onSelect
	}: {
		value: Privacy;
		readonly?: boolean;
		onSelect?: (privacy: Privacy) => void;
	} = $props();
</script>

<fieldset class="mt-1.5 grid min-w-0 grid-cols-3 gap-2.5 border-0 p-0">
	<legend class="sr-only">Who can see this VidJo</legend>
	{#each options as option (option.v)}
		<button
			type="button"
			class="flex min-h-[72px] flex-col justify-between rounded-xl border-2 border-line bg-[#FFFDF6] p-2.5 text-left font-hand text-lg font-bold text-ink transition-all hover:bg-light min-[400px]:p-3"
			class:border-accent={value === option.v}
			class:ring-2={value === option.v}
			class:ring-accent={value === option.v}
			class:ring-offset-1={value === option.v}
			class:shadow-[0_2px_8px_rgba(81,57,122,0.18)]={value === option.v}
			class:bg-[linear-gradient(120deg,#EFE6FA,#F7F1FD)]={value === option.v}
			aria-pressed={value === option.v}
			disabled={readonly}
			onclick={() => onSelect?.(option.v)}
		>
			<span class="flex items-center gap-1.5 leading-none text-ink">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG icon constants -->
				{@html option.icon} <span>{option.label}</span>
			</span>
			<small class="mt-1 block font-hand text-sm leading-tight font-normal text-ink-soft">
				{option.small}
			</small>
		</button>
	{/each}
</fieldset>
