<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { onMount } from 'svelte';

	let activeTab = $state<'portfolio' | 'theme' | 'privacy'>('portfolio');

	let streak = $state(0);
	let badges = $state<string[]>([]);

	function calculateStreak() {
		const dates = Object.keys(journal.entries).sort((a, b) => b.localeCompare(a));
		if (dates.length === 0) {
			streak = 0;
			return;
		}
		let count = 0;
		let current = new Date();
		for (let i = 0; i < 365; i++) {
			const key = current.toISOString().split('T')[0];
			if (dates.includes(key) && journal.entries[key]?.saved) {
				count++;
				current.setDate(current.getDate() - 1);
			} else if (count > 0) {
				break;
			} else {
				current.setDate(current.getDate() - 1);
			}
		}
		streak = count;
	}

	function calculateBadges() {
		const earned: string[] = [];
		const totalPages = Object.keys(journal.entries).length;
		if (totalPages >= 1) earned.push('first-post');
		if (totalPages >= 5) earned.push('five-pages');
		if (totalPages >= 10) earned.push('ten-pages');
		if (streak >= 3) earned.push('three-day-streak');
		if (streak >= 7) earned.push('week-streak');
		if (friends.friendCount >= 1) earned.push('made-friend');
		if (friends.friendCount >= 3) earned.push('social-circle');
		badges = earned;
	}

	let totalPages = $derived(Object.keys(journal.entries).length);
	let myPosts = $derived(
		Object.entries(journal.entries)
			.filter(([, entry]) => entry.privacy !== 'private')
			.map(([date, entry]) => ({
				date,
				title: entry.title || 'Untitled page',
				mood: entry.mood,
				hasVideo: Boolean(entry.videoPath),
				privacy: entry.privacy
			}))
			.slice(0, 12)
	);

	onMount(() => {
		calculateStreak();
		calculateBadges();
	});

	$effect(() => {
		calculateStreak();
		calculateBadges();
	});
</script>

<div class="mx-auto w-full max-w-[1100px] px-4 py-6 min-[900px]:px-6">
	<div class="relative overflow-hidden rounded-[32px] border border-[#523A7A] shadow-[0_28px_70px_rgba(0,0,0,.5)]">
		<div class="relative h-48 bg-[radial-gradient(ellipse_at_top,#7D58C2_0%,#3A2360_60%,#24143D_100%)] min-[720px]:h-56">
			<div class="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_30%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_80%_20%,rgba(201,184,232,.3)_0%,transparent_35%)]"></div>
			<div class="absolute -bottom-16 left-1/2 -translate-x-1/2 flex flex-col items-center">
				<div class="relative">
					{#if profile.avatarUrl}
						<img src={profile.avatarUrl} alt="" class="size-32 rounded-full border-4 border-gold/60 object-cover shadow-[0_20px_40px_rgba(0,0,0,.45)]" />
					{:else}
						<div class="flex size-32 items-center justify-center rounded-full border-4 border-gold/60 bg-[linear-gradient(135deg,#C9B8E8,#7D58C2)] font-display text-5xl font-bold text-white shadow-[0_20px_40px_rgba(0,0,0,.45)]">
							{profile.initials}
						</div>
					{/if}
					<span class="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full bg-[#3F7A4F] text-sm text-white ring-4 ring-[#24143D]">✓</span>
				</div>
			</div>
		</div>

		<div class="bg-desk-2 px-6 pb-8 pt-20 text-center min-[720px]:px-10">
			<h1 class="font-display text-3xl font-bold text-white min-[720px]:text-4xl">{profile.displayName}</h1>
			<p class="mt-1 font-ui text-sm font-semibold text-lav">@{profile.username}</p>
			{#if auth.email}
				<p class="mt-1 font-ui text-xs text-[#BBA8E0]">{auth.email}</p>
			{/if}
			{#if profile.bio}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-[#EDE6F7]">“{profile.bio}”</p>
			{:else}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-[#BBA8E0]">Small videos, big thoughts.</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
				<span class="rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-bold text-gold">{profile.friendCode}</span>
				<button
					type="button"
					class="rounded-full bg-white/10 px-3 py-1 font-ui text-xs font-semibold text-white hover:bg-white/20"
					onclick={() => {
						navigator.clipboard?.writeText(profile.friendCode);
						journal.toast('Friend code copied!');
					}}
				>
					Copy Code
				</button>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-3 min-[640px]:grid-cols-4">
				<div class="rounded-2xl border border-[#4D366D] bg-white/[.04] p-4">
					<p class="font-display text-2xl font-bold text-white">{totalPages}</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Pages Written</p>
				</div>
				<div class="rounded-2xl border border-[#F0D9A8] bg-[linear-gradient(135deg,rgba(212,162,76,.18),transparent)] p-4">
					<p class="flex items-center justify-center gap-1 font-display text-2xl font-bold text-gold">🔥 {streak}</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Day Streak</p>
				</div>
				<div class="rounded-2xl border border-[#4D366D] bg-white/[.04] p-4">
					<p class="font-display text-2xl font-bold text-[#8BE2A4]">{friends.friendCount}</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Friends</p>
				</div>
				<div class="rounded-2xl border border-[#4D366D] bg-white/[.04] p-4">
					<p class="font-display text-2xl font-bold text-lav">{badges.length}</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Badges</p>
				</div>
			</div>
		</div>
	</div>

	<div class="mt-6 flex justify-center">
		<div class="flex items-center gap-1 rounded-full border border-[#4D366D] bg-desk-2 p-1">
			<button type="button" class="rounded-full px-5 py-2 font-ui text-sm font-semibold transition-all {activeTab === 'portfolio' ? 'bg-accent text-white' : 'text-[#D6CBEC] hover:text-white'}" onclick={() => (activeTab = 'portfolio')}>Portfolio</button>
			<button type="button" class="rounded-full px-5 py-2 font-ui text-sm font-semibold transition-all {activeTab === 'theme' ? 'bg-accent text-white' : 'text-[#D6CBEC] hover:text-white'}" onclick={() => (activeTab = 'theme')}>Theme</button>
			<button type="button" class="rounded-full px-5 py-2 font-ui text-sm font-semibold transition-all {activeTab === 'privacy' ? 'bg-accent text-white' : 'text-[#D6CBEC] hover:text-white'}" onclick={() => (activeTab = 'privacy')}>Privacy</button>
		</div>
	</div>

	{#if activeTab === 'portfolio'}
		<div class="mt-6 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
			<div class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]">
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Achievements</h2>
					<span class="font-ui text-xs text-[#BBA8E0]">{badges.length} earned</span>
				</div>
				<div class="mt-4 flex flex-wrap gap-2">
					{#if badges.includes('first-post')}
						<span class="rounded-full bg-accent/20 px-3 py-1 font-ui text-xs font-semibold text-lav">✨ First Page</span>
					{/if}
					{#if badges.includes('five-pages')}
						<span class="rounded-full bg-accent/20 px-3 py-1 font-ui text-xs font-semibold text-lav">📓 Scribbler</span>
					{/if}
					{#if badges.includes('ten-pages')}
						<span class="rounded-full bg-accent/20 px-3 py-1 font-ui text-xs font-semibold text-lav">📚 Storyteller</span>
					{/if}
					{#if badges.includes('three-day-streak')}
						<span class="rounded-full bg-gold/20 px-3 py-1 font-ui text-xs font-semibold text-gold">🔥 3-Day Streak</span>
					{/if}
					{#if badges.includes('week-streak')}
						<span class="rounded-full bg-gold/20 px-3 py-1 font-ui text-xs font-semibold text-gold">🔥 Week Streak</span>
					{/if}
					{#if badges.includes('made-friend')}
						<span class="rounded-full bg-[#3F7A4F]/20 px-3 py-1 font-ui text-xs font-semibold text-[#8BE2A4]">🤝 Friendly</span>
					{/if}
					{#if badges.includes('social-circle')}
						<span class="rounded-full bg-[#3F7A4F]/20 px-3 py-1 font-ui text-xs font-semibold text-[#8BE2A4]">👥 Social Circle</span>
					{/if}
					{#if badges.length === 0}
						<p class="font-ui text-sm text-[#BBA8E0]">Start writing and making friends to earn badges!</p>
					{/if}
				</div>
			</div>

			<div class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]">
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Quick Actions</h2>
				</div>
				<div class="mt-4 grid gap-2">
					<button type="button" class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 hover:bg-white/10" onclick={() => nav.jump(journal.current)}>
						<span class="font-ui text-sm">Write today's page</span>
						<span class="text-gold">→</span>
					</button>
					<button type="button" class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 hover:bg-white/10" onclick={() => nav.setView('friends')}>
						<span class="font-ui text-sm">Go to Friends</span>
						<span class="text-gold">→</span>
					</button>
					<button type="button" class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 hover:bg-white/10" onclick={() => nav.setView('community')}>
						<span class="font-ui text-sm">Explore Community</span>
						<span class="text-gold">→</span>
					</button>
				</div>
			</div>
		</div>

		<div class="mt-6 rounded-[26px] border border-[#E6D9B8] bg-paper p-6 text-ink shadow-[0_18px_44px_rgba(0,0,0,.38)]">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-xl font-bold">My Posts Portfolio</h2>
				<span class="font-ui text-xs text-ink-soft">{myPosts.length} shared</span>
			</div>
			{#if myPosts.length === 0}
				<div class="mt-4 rounded-2xl border border-line bg-paper-2 p-8 text-center">
					<p class="font-display text-lg font-bold">No shared posts yet</p>
					<p class="mt-1 font-ui text-sm text-ink-soft">Set a page to Friends or Community to build your portfolio.</p>
					<button type="button" class="mt-3 rounded-xl bg-accent px-4 py-2 font-ui text-sm font-bold text-white hover:bg-[#624690]" onclick={() => nav.jump(journal.current)}>Create a page</button>
				</div>
			{:else}
				<div class="mt-4 grid gap-3 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
					{#each myPosts as post}
						<button type="button" class="group rounded-2xl border border-line bg-white/80 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md" onclick={() => nav.jump(post.date)}>
							<div class="flex items-center justify-between">
								<span class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[10px] font-bold text-accent uppercase">{post.privacy}</span>
								{#if post.hasVideo}
									<span class="text-xs">🎬</span>
								{/if}
							</div>
							<p class="mt-2 font-display text-base font-bold text-ink truncate group-hover:text-accent">{post.title}</p>
							<p class="mt-1 font-ui text-xs text-ink-soft">{post.date}</p>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'theme'}
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			<div class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]">
				<h2 class="font-display text-xl font-bold">Accent Color</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">Personalize your profile accents</p>
				<div class="mt-4 flex flex-wrap gap-2">
					{#each ['#7D58C2', '#D4A24C', '#3F7A4F', '#E85D5D', '#4F9DEB'] as color}
						<button type="button" class="size-10 rounded-full border-2 {profile.accentColor === color ? 'border-white' : 'border-transparent'}" style="background: {color}" onclick={() => (profile.accentColor = color)}></button>
					{/each}
				</div>
			</div>
			<div class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]">
				<h2 class="font-display text-xl font-bold">Journal Theme</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">Choose your vibe</p>
				<div class="mt-4 grid gap-2">
					<button type="button" class="flex items-center justify-between rounded-xl px-4 py-3 {profile.theme === 'classic' ? 'bg-accent' : 'bg-white/5 hover:bg-white/10'}" onclick={() => (profile.theme = 'classic')}>
						<span class="font-ui text-sm">Classic Scrapbook</span>
						{#if profile.theme === 'classic'}<span>✓</span>{/if}
					</button>
					<button type="button" class="flex items-center justify-between rounded-xl px-4 py-3 {profile.theme === 'sunset' ? 'bg-accent' : 'bg-white/5 hover:bg-white/10'}" onclick={() => (profile.theme = 'sunset')}>
						<span class="font-ui text-sm">Sunset Warmth</span>
						{#if profile.theme === 'sunset'}<span>✓</span>{/if}
					</button>
					<button type="button" class="flex items-center justify-between rounded-xl px-4 py-3 {profile.theme === 'midnight' ? 'bg-accent' : 'bg-white/5 hover:bg-white/10'}" onclick={() => (profile.theme = 'midnight')}>
						<span class="font-ui text-sm">Midnight Study</span>
						{#if profile.theme === 'midnight'}<span>✓</span>{/if}
					</button>
				</div>
			</div>
		</div>
	{:else if activeTab === 'privacy'}
		<div class="mt-6 max-w-[640px] mx-auto">
			<div class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]">
				<h2 class="font-display text-xl font-bold">Privacy Settings</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">Control who sees your content</p>
				<div class="mt-5 space-y-4">
					<div class="flex items-center justify-between rounded-xl bg-white/5 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Default Privacy</p>
							<p class="font-ui text-xs text-[#BBA8E0]">Applied to new pages</p>
						</div>
						<select bind:value={profile.defaultPrivacy} class="rounded-lg bg-[#2A1B3F] px-3 py-2 font-ui text-sm">
							<option value="private">Private</option>
							<option value="friends">Friends</option>
							<option value="community">Community</option>
						</select>
					</div>
					<div class="flex items-center justify-between rounded-xl bg-white/5 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Allow Friend Requests</p>
							<p class="font-ui text-xs text-[#BBA8E0]">Let others send you requests</p>
						</div>
						<button type="button" class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold {profile.allowFriendRequests ? 'bg-[#3F7A4F]' : 'bg-white/20'}" onclick={() => (profile.allowFriendRequests = !profile.allowFriendRequests)}>
							{profile.allowFriendRequests ? 'Enabled' : 'Disabled'}
						</button>
					</div>
				</div>
				<button type="button" class="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-ui text-sm font-bold hover:bg-[#624690]" onclick={() => journal.toast('Privacy settings saved!')}>Save Settings</button>
			</div>
		</div>
	{/if}
</div>
