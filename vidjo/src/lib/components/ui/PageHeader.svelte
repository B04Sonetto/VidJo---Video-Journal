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

<header class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
	<div class="max-w-[640px] min-w-0">
		{#if meta}
			<div
				class="font-ui text-[11px] font-semibold text-book-bg/65 tabular-nums min-[720px]:text-xs"
			>
				{@render meta()}
			</div>
		{/if}
		<h1
			class="mt-1 font-display text-[26px] leading-[1.05] font-bold tracking-tight text-book-bg min-[480px]:text-[30px] min-[720px]:text-[44px]"
		>
			{title}
		</h1>
		{#if description}
			<p
				class="mt-1.5 font-ui text-[13px] leading-snug text-book-bg/65 min-[720px]:mt-2 min-[720px]:text-[15px] min-[720px]:leading-relaxed"
			>
				{description}
			</p>
		{/if}
	</div>

	{#if actions}
		<div
			class="flex flex-wrap items-center gap-2 min-[720px]:gap-2.5 [&_button]:min-h-10 [&_button]:gap-1.5 [&_button]:px-3 [&_button]:text-[13px] min-[720px]:[&_button]:min-h-11 min-[720px]:[&_button]:gap-2 min-[720px]:[&_button]:px-4 min-[720px]:[&_button]:text-sm"
		>
			{@render actions()}
		</div>
	{/if}
</header>
