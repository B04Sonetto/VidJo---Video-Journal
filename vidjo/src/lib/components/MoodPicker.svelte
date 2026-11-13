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

<div
	class="mt-0.5 grid grid-cols-8 gap-x-0.5 gap-y-0.5 min-[480px]:gap-x-1"
	role="group"
	aria-label="Mood"
>
	{#each MOODS as item (item.k)}
		<button
			type="button"
			class="group flex min-w-0 flex-col items-center gap-1 rounded-xl border-0 bg-transparent px-0.5 py-0.5 font-hand text-[10px] leading-none text-ink transition-colors hover:text-accent disabled:pointer-events-none min-[480px]:text-[12px]"
			class:font-bold={mood === item.k}
			aria-pressed={mood === item.k}
			aria-label={item.l}
			title={item.l}
			disabled={readonly}
			onclick={() => onSelect?.(item.k)}
		>
			<span
				class="flex aspect-square w-full max-w-12 items-center justify-center rounded-full bg-light shadow-[0_0_0_1px_#E0D4EE] transition-[transform,box-shadow,background-color] duration-150 group-hover:-translate-y-0.5 group-hover:bg-[#F0E9F9]"
				class:bg-[#E4D8F6]={mood === item.k}
				class:shadow-[0_0_0_2.5px_var(--color-accent),0_3px_8px_rgba(81,57,122,.35)]={mood ===
					item.k}
				class:-rotate-3={mood === item.k}
				class:scale-105={mood === item.k}
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
				<span class="block h-[68%] w-[68%] [&>svg]:size-full">{@html item.svg}</span>
			</span>
			<span class="w-full truncate text-center">{item.l}</span>
		</button>
	{/each}
</div>
