<script lang="ts">
	import { MOODS } from '#lib/data/moods';
	import type { MoodKey } from '#lib/types';

	let {
		mood,
		readonly = false,
		onSelect
	}: {
		mood: MoodKey | '';
		readonly?: boolean;
		onSelect?: (mood: MoodKey) => void;
	} = $props();
</script>

<div class="mt-0.5 grid grid-cols-7 gap-1" role="group" aria-label="Mood">
	{#each MOODS as item (item.k)}
		<button
			type="button"
			class="group flex flex-col items-center gap-0.5 rounded-xl border-0 bg-transparent py-1 font-hand text-[17px] text-ink"
			class:font-bold={mood === item.k}
			aria-pressed={mood === item.k}
			aria-label={item.l}
			disabled={readonly}
			onclick={() => onSelect?.(item.k)}
		>
			<span
				class="flex size-[60px] items-center justify-center rounded-full bg-light shadow-[0_0_0_1px_#E0D4EE] transition-transform duration-150 group-hover:-translate-y-0.5"
				class:bg-[#E4D8F6]={mood === item.k}
				class:shadow-[0_0_0_3px_var(--color-accent),0_3px_8px_rgba(81,57,122,.35)]={mood === item.k}
				class:-rotate-6={mood === item.k}
				class:scale-105={mood === item.k}
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
				<span class="block size-[46px] [&>svg]:size-full">{@html item.svg}</span>
			</span>
			{item.l}
		</button>
	{/each}
</div>
