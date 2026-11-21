<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	/** A group icon: up to three overlapping member circles, or the group photo. */
	let {
		members = [],
		photoUrl = null,
		title = 'Group chat',
		size = 'md',
		ring = 'ring-2 ring-book-bg'
	}: {
		members?: { avatar?: string | null; name?: string }[];
		photoUrl?: string | null;
		title?: string;
		size?: 'sm' | 'md' | 'lg';
		ring?: string;
	} = $props();

	const sizes = {
		sm: { outer: 'size-10', avatar: 'size-7', overlap: '-ml-3', text: 'text-xs', icon: 15 },
		md: { outer: 'size-11', avatar: 'size-8', overlap: '-ml-3', text: 'text-sm', icon: 19 },
		lg: { outer: 'size-12', avatar: 'size-9', overlap: '-ml-3.5', text: 'text-base', icon: 20 }
	} as const;

	const config = $derived(sizes[size]);
	const shown = $derived(members.slice(0, 3));
</script>

<span class="relative inline-flex shrink-0 items-center {config.outer}" aria-hidden="true">
	{#if photoUrl}
		<Avatar src={photoUrl} name={title} className={config.outer} textClass={config.text} {ring} />
	{:else if shown.length === 0}
		<span
			class="flex {config.outer} items-center justify-center rounded-full bg-cover/45 text-book-accent {ring}"
		>
			<CommunityIcon name="users" size={config.icon} />
		</span>
	{:else}
		{#each shown as member, index (index)}
			<Avatar
				src={member.avatar ?? null}
				name={member.name || 'Friend'}
				className="{config.avatar} {index > 0 ? config.overlap : ''}"
				textClass={config.text}
				{ring}
			/>
		{/each}
	{/if}
</span>
