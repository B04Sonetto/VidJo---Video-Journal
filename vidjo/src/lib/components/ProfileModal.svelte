<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import OtherProfile from '#lib/components/OtherProfile.svelte';
	import OwnProfile from '#lib/components/OwnProfile.svelte';

	let { open, onClose, userId }: { open: boolean; onClose: () => void; userId?: string | null } =
		$props();

	const isViewingOther = $derived(Boolean(userId) && userId !== auth.ownerId);

	$effect(() => {
		if (open && isViewingOther && userId) {
			void profile.loadViewedProfile(userId);
		} else if (!isViewingOther) {
			profile.viewedProfile = null;
			profile.viewedProfilePosts = [];
			profile.viewedProfileStreak = null;
		}
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') onClose();
	}}
/>

{#if open}
	{#if isViewingOther && userId}
		<OtherProfile {userId} {onClose} />
	{:else}
		<OwnProfile {onClose} />
	{/if}
{/if}
