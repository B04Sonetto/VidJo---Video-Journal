<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description = '',
		meta,
		actions
	}: {
		title: string;
		description?: string;
		meta?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
	<div class="max-w-[640px] min-w-0">
		{#if meta}
			<div class="font-ui text-xs font-semibold text-[#CFC3E6] tabular-nums">
				{@render meta()}
			</div>
		{/if}
		<h1
			class="mt-1 font-display text-[34px] leading-[1.05] font-bold tracking-tight text-white min-[720px]:text-[44px]"
		>
			{title}
		</h1>
		{#if description}
			<p class="mt-2 font-ui text-sm leading-relaxed text-[#CFC3E6] min-[720px]:text-[15px]">
				{description}
			</p>
		{/if}
	</div>

	{#if actions}
		<div class="flex flex-wrap items-center gap-2.5">
			{@render actions()}
		</div>
	{/if}
</header>
