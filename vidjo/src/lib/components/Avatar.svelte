<script lang="ts">
	import { avatarInitial, isEmojiAvatar, normalizeImageUrl } from '#lib/avatar';

	let {
		src = null,
		name = '',
		className = 'size-11',
		textClass = 'text-lg',
		ring = 'ring-2 ring-gold/50',
		alt = ''
	}: {
		src?: string | null;
		name?: string;
		className?: string;
		textClass?: string;
		ring?: string;
		alt?: string;
	} = $props();

	let failed = $state(false);

	const resolved = $derived(normalizeImageUrl(src));
	const emoji = $derived(isEmojiAvatar(resolved));

	$effect(() => {
		// Reset the broken-image flag whenever the avatar changes.
		void resolved;
		failed = false;
	});
</script>

{#if resolved && !emoji && !failed}
	<img
		src={resolved}
		alt={alt || name}
		class="{className} shrink-0 rounded-full object-cover {ring}"
		loading="lazy"
		referrerpolicy="no-referrer"
		onerror={() => (failed = true)}
	/>
{:else if emoji}
	<span
		class="flex {className} shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] {textClass} {ring}"
		title={name}
		aria-label={name}
	>
		{resolved}
	</span>
{:else}
	<span
		class="flex {className} shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display {textClass} font-bold text-white {ring}"
		title={name}
		aria-hidden="true"
	>
		{avatarInitial(name)}
	</span>
{/if}
