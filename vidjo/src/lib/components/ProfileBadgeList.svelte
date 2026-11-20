<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let {
		badges,
		layout = 'grid'
	}: {
		badges: {
			id: string;
			label: string;
			description: string;
			icon: string;
			tone: 'lav' | 'gold' | 'green';
		}[];
		layout?: 'grid' | 'pills';
	} = $props();

	function toneClasses(tone: 'lav' | 'gold' | 'green') {
		if (tone === 'gold') return 'border-book-accent/40 bg-book-accent/15 text-book-accent';
		if (tone === 'green') return 'border-[#3F7A4F]/40 bg-[#3F7A4F]/15 text-[#8BE2A4]';
		return 'border-cover bg-cover/25 text-book-bg/75';
	}
</script>

{#if layout === 'pills'}
	<div class="mt-4 flex flex-wrap gap-2">
		{#each badges as badge (badge.id)}
			<span
				class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-ui text-xs font-semibold {toneClasses(
					badge.tone
				)}"
			>
				<CommunityIcon name={badge.icon} size={13} />
				{badge.label}
			</span>
		{/each}
	</div>
{:else}
	<div class="mt-5 grid gap-3 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
		{#each badges as badge (badge.id)}
			<div class="flex items-start gap-3 rounded-2xl border p-4 {toneClasses(badge.tone)}">
				<span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/35">
					<CommunityIcon name={badge.icon} size={20} />
				</span>
				<div>
					<p class="font-display text-base font-bold">{badge.label}</p>
					<p class="mt-0.5 font-ui text-xs opacity-80">{badge.description}</p>
				</div>
			</div>
		{/each}
	</div>
{/if}
