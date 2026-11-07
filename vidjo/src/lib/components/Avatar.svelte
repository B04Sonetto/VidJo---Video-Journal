<script lang="ts">
	import { avatarInitial, isEmojiAvatar, normalizeImageUrl, optimizedAvatarUrl } from '#lib/avatar';

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
	let useOriginal = $state(false);

	const resolved = $derived(normalizeImageUrl(src));
	const optimized = $derived(optimizedAvatarUrl(resolved));
	const displaySrc = $derived(useOriginal ? resolved : optimized);
	const emoji = $derived(isEmojiAvatar(resolved));

	$effect(() => {
		// Reset the broken-image flags whenever the avatar changes.
		void resolved;
		failed = false;
		useOriginal = false;
	});

	function handleImageError() {
		// Image transformations need a paid Supabase plan. If the render
		// endpoint is unavailable, retry the original object URL before
		// falling back to initials.
		if (!useOriginal && resolved && optimized !== resolved) {
			useOriginal = true;
			return;
		}
		failed = true;
	}
</script>

{#if resolved && !emoji && !failed}
	<img
		src={displaySrc ?? resolved}
		alt={alt || name}
		class="{className} shrink-0 rounded-full object-cover {ring}"
		loading="lazy"
		decoding="async"
		referrerpolicy="no-referrer"
		onerror={handleImageError}
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
