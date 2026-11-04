<script lang="ts">
	const LOCK_ICON =
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';

	const FRIENDS_ICON =
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6M16 4.8a3.5 3.5 0 010 6.4M18 14c2.2.6 3.5 2.6 3.5 6"/></svg>';

	const COMMUNITY_ICON =
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>';

	let {
		friendsShared,
		communityShared,
		communityLabel = '',
		readonly = false,
		onToggleFriends,
		onToggleCommunity,
		onSelectPrivate
	}: {
		friendsShared: boolean;
		communityShared: boolean;
		/** Tag of the selected community, shown when community sharing is on. */
		communityLabel?: string;
		readonly?: boolean;
		onToggleFriends?: (enabled: boolean) => void;
		onToggleCommunity?: (enabled: boolean) => void;
		/** Makes the page private again by turning off every sharing destination. */
		onSelectPrivate?: () => void;
	} = $props();

	const isPrivate = $derived(!friendsShared && !communityShared);

	const options = $derived([
		{
			key: 'private',
			label: 'Private',
			small: 'Only you',
			active: isPrivate,
			icon: LOCK_ICON,
			toggle: () => onSelectPrivate?.()
		},
		{
			key: 'friends',
			label: 'Friends',
			small: friendsShared ? 'Friends can see' : 'Tap to share',
			active: friendsShared,
			icon: FRIENDS_ICON,
			toggle: () => onToggleFriends?.(!friendsShared)
		},
		{
			key: 'community',
			label: 'Community',
			small: communityShared ? communityLabel || 'Community can see' : 'Tap to share',
			active: communityShared,
			icon: COMMUNITY_ICON,
			toggle: () => onToggleCommunity?.(!communityShared)
		}
	]);
</script>

<fieldset class="mt-1.5 grid min-w-0 grid-cols-3 gap-2 border-0 p-0">
	<legend class="sr-only">Who can see this VidJo</legend>
	{#each options as option (option.key)}
		<button
			type="button"
			class="relative flex min-h-[68px] flex-col justify-between rounded-xl border-2 border-line bg-[#FFFDF6] p-2 text-left font-hand text-base font-bold text-ink transition-all hover:bg-light min-[400px]:p-2.5 min-[400px]:text-lg"
			class:border-accent={option.active}
			class:ring-2={option.active}
			class:ring-accent={option.active}
			class:ring-offset-1={option.active}
			class:shadow-[0_2px_8px_rgba(81,57,122,0.18)]={option.active}
			class:bg-[linear-gradient(120deg,#EFE6FA,#F7F1FD)]={option.active}
			aria-pressed={option.active}
			disabled={readonly}
			onclick={option.toggle}
		>
			<span class="flex items-center gap-1 leading-none text-ink">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG icon constants -->
				{@html option.icon} <span>{option.label}</span>
			</span>
			<small
				class="mt-1 block max-w-full truncate font-hand text-xs leading-tight font-normal text-ink-soft"
			>
				{option.small}
			</small>
			{#if option.active}
				<span
					class="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white"
					aria-hidden="true">✓</span
				>
			{/if}
		</button>
	{/each}
</fieldset>
