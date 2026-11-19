<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { censor } from '#lib/censor';
	import { messages } from '#lib/state/messages.svelte';

	let { text, compact = false }: { text: string; compact?: boolean } = $props();

	const LINK_PATTERN = /(https?:\/\/[^\s<>"'`]+)/gi;

	function hostOf(url: string) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return 'link';
		}
	}

	function displayUrl(value: string) {
		return value.replace(/[),.;!?\]}]+$/, '');
	}

	const parts = $derived.by(() => {
		const result: { kind: 'text' | 'link'; value: string }[] = [];
		let cursor = 0;
		for (const match of text.matchAll(LINK_PATTERN)) {
			const start = match.index ?? 0;
			if (start > cursor) {
				result.push({ kind: 'text', value: text.slice(cursor, start) });
			}
			result.push({ kind: 'link', value: displayUrl(match[0]) });
			cursor = start + match[0].length;
		}
		if (cursor < text.length) result.push({ kind: 'text', value: text.slice(cursor) });
		return result;
	});

	const links = $derived(parts.filter((part) => part.kind === 'link').map((part) => part.value));

	$effect(() => {
		for (const url of links) void messages.fetchLinkPreview(url);
	});
</script>

<span class="[overflow-wrap:anywhere] whitespace-pre-wrap">
	{#each parts as part, index (index)}
		{#if part.kind === 'text'}
			{censor(part.value)}
		{:else}
			{@const preview = messages.linkPreviews[part.value]}
			<a
				href={part.value}
				target="_blank"
				rel="noopener noreferrer external"
				class="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
			>
				{hostOf(part.value)}
			</a>
			{#if preview}
				<a
					href={part.value}
					target="_blank"
					rel="noopener noreferrer external"
					class="mt-1.5 flex gap-2.5 {compact
						? 'max-w-[240px]'
						: 'max-w-[280px]'} overflow-hidden rounded-xl border border-line bg-book-bg/90 text-left text-book-ink shadow-sm transition-colors hover:border-book-accent"
				>
					{#if preview.image}
						<img
							src={preview.image}
							alt=""
							class="size-16 shrink-0 object-cover"
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
						/>
					{/if}
					<span class="min-w-0 flex-1 py-1.5 pr-2">
						<span
							class="block truncate font-ui text-[9px] font-bold tracking-wide text-ink-soft uppercase"
						>
							{preview.siteName || hostOf(part.value)}
						</span>
						<span class="mt-0.5 line-clamp-2 block font-ui text-[11px] leading-snug font-bold">
							{preview.title || hostOf(part.value)}
						</span>
						{#if preview.description}
							<span
								class="mt-0.5 line-clamp-2 block font-ui text-[10px] leading-snug text-ink-soft"
							>
								{preview.description}
							</span>
						{/if}
					</span>
					<CommunityIcon name="external" size={12} class="mt-1.5 mr-1.5 shrink-0 text-ink-soft" />
				</a>
			{/if}
		{/if}
	{/each}
</span>
