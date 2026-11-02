<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav, type ProfileTab } from '#lib/state/navigation.svelte';
	import { isSupabaseConfigured } from '#lib/supabase';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	const tabs: { id: ProfileTab; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'portfolio', label: 'Portfolio' },
		{ id: 'achievements', label: 'Achievements' },
		{ id: 'settings', label: 'Settings' },
		{ id: 'edit', label: 'Edit Profile' }
	];

	const accentChoices = ['#51397A', '#7D58C2', '#D4A24C', '#3F7A4F', '#E85D5D', '#4F9DEB'];
	const themes = [
		{ id: 'classic', label: 'Classic Scrapbook', swatch: '#51397A' },
		{ id: 'sunset', label: 'Sunset Warmth', swatch: '#B85C43' },
		{ id: 'midnight', label: 'Midnight Study', swatch: '#1F3557' }
	] as const;

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	let editUsername = $state('');
	let editNickname = $state('');
	let editBio = $state('');
	let editAvatar = $state('');
	let editBanner = $state('');
	let avatarFile = $state<File | null>(null);
	let bannerFile = $state<File | null>(null);
	let editError = $state('');
	let editSaving = $state(false);
	let editSeed = '';

	let settingsError = $state('');
	let settingsSaving = $state(false);

	let totalPages = $derived(
		Object.values(journal.entries).filter(
			(entry) => entry.saved || entry.title || entry.mind || entry.videoPath
		).length
	);

	let streak = $derived.by(() => {
		const entries = journal.entries;
		const dates = Object.keys(entries).sort((a, b) => b.localeCompare(a));
		if (dates.length === 0) return 0;

		let count = 0;
		const current = new SvelteDate();
		for (let i = 0; i < 365; i++) {
			const key = current.toISOString().split('T')[0];
			const entry = entries[key];
			if (entry && (entry.saved || entry.title || entry.mind || entry.videoPath)) {
				count++;
				current.setDate(current.getDate() - 1);
			} else if (count > 0) {
				break;
			} else {
				current.setDate(current.getDate() - 1);
			}
		}
		return count;
	});

	type Badge = {
		id: string;
		label: string;
		description: string;
		icon: string;
		tone: 'lav' | 'gold' | 'green';
	};

	let badges = $derived.by<Badge[]>(() => {
		const earned: Badge[] = [];
		if (totalPages >= 1) {
			earned.push({
				id: 'first-post',
				label: 'First Page',
				description: 'Wrote your very first VidJo page.',
				icon: 'sparkles',
				tone: 'lav'
			});
		}
		if (totalPages >= 5) {
			earned.push({
				id: 'five-pages',
				label: 'Scribbler',
				description: 'Filled five pages with thoughts and moments.',
				icon: 'book',
				tone: 'lav'
			});
		}
		if (totalPages >= 10) {
			earned.push({
				id: 'ten-pages',
				label: 'Storyteller',
				description: 'Ten pages of your story are now on record.',
				icon: 'star',
				tone: 'gold'
			});
		}
		if (streak >= 3) {
			earned.push({
				id: 'three-day-streak',
				label: '3-Day Streak',
				description: 'Showed up three days in a row.',
				icon: 'flame',
				tone: 'gold'
			});
		}
		if (streak >= 7) {
			earned.push({
				id: 'week-streak',
				label: 'Week Streak',
				description: 'A full week of daily pages.',
				icon: 'flame',
				tone: 'gold'
			});
		}
		if (friends.friendCount >= 1) {
			earned.push({
				id: 'made-friend',
				label: 'Friendly',
				description: 'Connected with your first friend.',
				icon: 'users',
				tone: 'green'
			});
		}
		if (friends.friendCount >= 3) {
			earned.push({
				id: 'social-circle',
				label: 'Social Circle',
				description: 'Built a circle of three or more friends.',
				icon: 'users',
				tone: 'green'
			});
		}
		if (community.joinedCommunities.length >= 1) {
			earned.push({
				id: 'community-member',
				label: 'Community Member',
				description: 'Joined your first campus community.',
				icon: 'globe',
				tone: 'lav'
			});
		}
		return earned;
	});

	let myPosts = $derived(
		Object.entries(journal.entries)
			.filter(
				([, entry]) =>
					entry.privacy !== 'private' &&
					(entry.title || entry.mind || entry.refl || entry.videoPath)
			)
			.map(([date, entry]) => ({
				date,
				title: entry.title || 'Untitled page',
				mood: entry.mood,
				hasVideo: Boolean(entry.videoPath),
				privacy: entry.privacy,
				communityTag: entry.communitySlug ? community.tagFor(entry.communitySlug) : ''
			}))
			.sort((a, b) => b.date.localeCompare(a.date))
	);

	let recentlyShared = $derived(myPosts.slice(0, 4));

	$effect(() => {
		const key = [
			nav.profileTab,
			profile.profile?.updated_at ?? '',
			profile.username,
			profile.nickname,
			profile.bio,
			profile.avatarUrl ?? ''
		].join('|');

		if (nav.profileTab === 'edit' && key !== editSeed) {
			editSeed = key;
			editUsername = profile.username;
			editNickname = profile.nickname;
			editBio = profile.bio;
			editAvatar = profile.avatarUrl ?? '';
			editBanner = profile.bannerUrl ?? '';
			editError = '';
		}
	});

	$effect(() => {
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});

	function copyFriendCode() {
		if (!profile.friendCode) return;
		void navigator.clipboard?.writeText(profile.friendCode);
		copied = true;
		journal.toast('Friend code copied!');
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2400);
	}

	function setTab(tab: ProfileTab) {
		nav.profileTab = tab;
	}

	async function saveEdits(event: SubmitEvent) {
		event.preventDefault();
		editSaving = true;
		editError = '';

		const result = await profile.saveProfile({
			username: editUsername,
			display_name: editNickname,
			bio: editBio,
			avatar_url: editAvatar.trim() || null,
			banner_url: editBanner.trim() || profile.bannerUrl
		});

		editSaving = false;
		if (result.error) {
			editError = result.error;
			return;
		}

		journal.toast('Profile updated');
		nav.profileTab = 'overview';
	}

	async function saveSettings() {
		settingsSaving = true;
		settingsError = '';
		const result = await profile.savePreferences();
		settingsSaving = false;
		if (result.error) {
			settingsError = result.error;
			journal.toast('Could not save settings');
			return;
		}
		journal.toast('Settings saved');
	}

	function clearCache() {
		const owner = auth.ownerId;
		journal.clearLocalCache(owner);
		journal.toast('Local journal cache cleared for this device');
	}

	function toneClasses(tone: Badge['tone']) {
		if (tone === 'gold') return 'border-gold/40 bg-gold/15 text-gold';
		if (tone === 'green') return 'border-[#3F7A4F]/40 bg-[#3F7A4F]/15 text-[#8BE2A4]';
		return 'border-lav/40 bg-lav/15 text-lav';
	}
</script>

<div class="mx-auto w-full max-w-[1100px] px-4 py-6 min-[900px]:px-6">
	<!-- ── Profile hero ── -->
	<div
		class="relative overflow-hidden rounded-[32px] border border-[#523A7A] shadow-[0_28px_70px_rgba(0,0,0,.5)]"
	>
		<div
			class="relative h-44 min-[720px]:h-52"
		>
			{#if profile.bannerUrl}
				<img
					src={profile.bannerUrl}
					alt=""
					class="absolute inset-0 h-full w-full object-cover"
				/>
			{:else}
				<div
					class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#7D58C2_0%,#3A2360_60%,#24143D_100%)]"
				></div>
			{/if}
			<div
				class="absolute inset-0 [background-image:radial-gradient(circle_at_20%_30%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_80%_20%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
			></div>
			<div class="absolute top-5 right-5 flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 font-ui text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
					onclick={() => setTab('edit')}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path>
					</svg>
					Edit profile
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 font-ui text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
					onclick={() => setTab('settings')}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="3"></circle>
						<path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
						></path>
					</svg>
					Settings
				</button>
			</div>
			<div class="absolute -bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center">
				<div class="relative">
					{#if profile.avatarUrl}
						<img
							src={profile.avatarUrl}
							alt=""
							class="size-32 rounded-full border-4 border-gold/60 object-cover shadow-[0_20px_40px_rgba(0,0,0,.45)]"
						/>
					{:else}
						<div
							class="flex size-32 items-center justify-center rounded-full border-4 border-gold/60 bg-[linear-gradient(135deg,#C9B8E8,#7D58C2)] font-display text-5xl font-bold text-white shadow-[0_20px_40px_rgba(0,0,0,.45)]"
						>
							{profile.initials}
						</div>
					{/if}
					<span
						class="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-[#3F7A4F] text-white ring-4 ring-[#24143D]"
					>
						<CommunityIcon name="check" size={15} />
					</span>
				</div>
			</div>
		</div>

		<div class="bg-desk-2 px-6 pt-20 pb-8 text-center min-[720px]:px-10">
			<h1 class="font-display text-3xl font-bold text-white min-[720px]:text-4xl">
				{profile.nickname}
			</h1>
			<p class="mt-1 font-ui text-sm font-semibold text-lav">@{profile.username}</p>
			<p class="mt-1 font-ui text-xs text-[#BBA8E0]">
				{#if isSupabaseConfigured && auth.email}
					{auth.email} •
				{/if}
				Member since {profile.memberSince}
			</p>
			{#if profile.bio}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-[#EDE6F7]">“{profile.bio}”</p>
			{:else}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-[#BBA8E0]">
					Small videos, big thoughts.
				</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
				<span
					class="rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-bold tracking-wider text-gold"
				>
					{profile.friendCode}
				</span>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-ui text-xs font-semibold text-white transition-colors hover:bg-white/20"
					onclick={copyFriendCode}
				>
					{#if copied}
						<CommunityIcon name="check" size={13} />
						Copied
					{:else}
						<svg
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
							<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
						</svg>
						Copy friend code
					{/if}
				</button>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-3 min-[640px]:grid-cols-4">
				<div class="rounded-2xl border border-[#4D366D] bg-white/[.04] p-4">
					<p class="font-display text-2xl font-bold text-white">{totalPages}</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Pages written</p>
				</div>
				<div
					class="rounded-2xl border border-[#F0D9A8] bg-[linear-gradient(135deg,rgba(212,162,76,.18),transparent)] p-4"
				>
					<p
						class="flex items-center justify-center gap-1.5 font-display text-2xl font-bold text-gold"
					>
						<CommunityIcon name="flame" size={20} />
						{streak}
					</p>
					<p class="font-ui text-xs text-[#BBA8E0]">Day streak</p>
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

	<!-- ── Tabs ── -->
	<div class="mt-6 flex justify-center">
		<div
			class="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#4D366D] bg-desk-2 p-1"
		>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					class="shrink-0 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {nav.profileTab ===
					tab.id
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => setTab(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	{#if nav.profileTab === 'overview'}
		<div class="mt-6 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
			<div
				class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">About</h2>
				<dl class="mt-4 grid gap-3 font-ui text-sm">
					<div class="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
						<dt class="text-[#BBA8E0]">Nickname</dt>
						<dd class="font-semibold text-white">{profile.nickname}</dd>
					</div>
					<div class="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
						<dt class="text-[#BBA8E0]">Username</dt>
						<dd class="font-semibold text-lav">@{profile.username}</dd>
					</div>
					<div class="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
						<dt class="text-[#BBA8E0]">Member since</dt>
						<dd class="font-semibold text-white">{profile.memberSince}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-[#BBA8E0]">Communities</dt>
						<dd class="font-semibold text-white">{community.joinedCommunities.length}</dd>
					</div>
				</dl>
				{#if profile.bio}
					<p class="mt-4 rounded-xl bg-white/5 p-4 font-hand text-lg text-[#EDE6F7]">
						“{profile.bio}”
					</p>
				{:else}
					<p class="mt-4 rounded-xl bg-white/5 p-4 font-ui text-sm text-[#BBA8E0]">
						Add a short bio so friends and communities know what you're about.
					</p>
				{/if}
			</div>

			<div
				class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Recent badges</h2>
					<button
						type="button"
						class="font-ui text-xs font-semibold text-gold hover:underline"
						onclick={() => setTab('achievements')}
					>
						View all
					</button>
				</div>
				{#if badges.length === 0}
					<p class="mt-4 font-ui text-sm text-[#BBA8E0]">
						Write a page or make a friend to start earning badges.
					</p>
				{:else}
					<div class="mt-4 flex flex-wrap gap-2">
						{#each badges.slice(0, 3) as badge (badge.id)}
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
				{/if}

				<h3 class="mt-6 font-display text-lg font-bold">Quick actions</h3>
				<div class="mt-3 grid gap-2">
					<button
						type="button"
						class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-left hover:bg-white/10"
						onclick={() => nav.jump(journal.current)}
					>
						<span class="font-ui text-sm">Write today's page</span>
						<span class="text-gold">→</span>
					</button>
					<button
						type="button"
						class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-left hover:bg-white/10"
						onclick={() => nav.setView('friends')}
					>
						<span class="font-ui text-sm">Go to friends</span>
						<span class="text-gold">→</span>
					</button>
					<button
						type="button"
						class="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-left hover:bg-white/10"
						onclick={() => nav.setView('community')}
					>
						<span class="font-ui text-sm">Explore communities</span>
						<span class="text-gold">→</span>
					</button>
				</div>
			</div>

			<div
				class="rounded-[26px] border border-[#E6D9B8] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)] lg:col-span-2"
			>
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Recently shared</h2>
					<button
						type="button"
						class="font-ui text-xs font-semibold text-gold hover:underline"
						onclick={() => setTab('portfolio')}
					>
						Full portfolio
					</button>
				</div>
				{#if recentlyShared.length === 0}
					<div class="rounded-2xl border border-[#4D366D] bg-white/5 p-8 text-center">
						<p class="font-display text-lg font-bold">Nothing shared yet</p>
						<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
							Set a page to Friends or Community to build your portfolio.
						</p>
						<button
							type="button"
							class="mt-3 rounded-xl bg-accent px-4 py-2 font-ui text-sm font-bold text-white hover:bg-[#624690]"
							onclick={() => nav.jump(journal.current)}
						>
							Create a page
						</button>
					</div>
				{:else}
					<div class="mt-4 grid gap-3 min-[640px]:grid-cols-2">
						{#each recentlyShared as post (post.date)}
							<button
								type="button"
								class="group rounded-2xl border border-line bg-white/10 p-4 text-left text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
								onclick={() => nav.jump(post.date)}
							>
								<div class="flex items-center justify-between gap-2">
									<span
										class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[10px] font-bold text-gold uppercase"
									>
										{post.communityTag || post.privacy}
									</span>
									{#if post.hasVideo}
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											class="text-[#BBA8E0]"
											aria-hidden="true"
										>
											<polygon points="23 7 16 12 23 17 23 7"></polygon>
											<rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
										</svg>
									{/if}
								</div>
								<p
									class="mt-2 truncate font-display text-base font-bold text-white group-hover:text-gold"
								>
									{post.title}
								</p>
								<p class="mt-1 font-ui text-xs text-[#BBA8E0]">{post.date}</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else if nav.profileTab === 'portfolio'}
		<div
			class="mt-6 rounded-[26px] border border-[#E6D9B8] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="font-display text-xl font-bold">My posts portfolio</h2>
					<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
						Every page you've shared with friends or a community.
					</p>
				</div>
				<span class="rounded-full bg-accent/10 px-3 py-1 font-ui text-xs font-semibold text-accent"
					>{myPosts.length} shared</span
				>
			</div>

			{#if myPosts.length === 0}
				<div class="rounded-2xl border border-[#4D366D] bg-white/5 p-10 text-center">
					<p class="font-display text-lg font-bold">No shared posts yet</p>
					<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
						Choose Friends or Community in the privacy picker on any page.
					</p>
					<button
						type="button"
						class="mt-3 rounded-xl bg-accent px-4 py-2 font-ui text-sm font-bold text-white hover:bg-[#624690]"
						onclick={() => nav.jump(journal.current)}
					>
						Write a page
					</button>
				</div>
			{:else}
				<div class="mt-4 grid gap-3 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
					{#each myPosts as post (post.date)}
						<button
							type="button"
							class="group rounded-2xl border border-line bg-white/10 p-4 text-left text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
							onclick={() => nav.jump(post.date)}
						>
							<div class="flex items-center justify-between gap-2">
								<span
									class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[10px] font-bold text-gold uppercase"
								>
									{post.communityTag || post.privacy}
								</span>
								{#if post.hasVideo}
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="text-[#BBA8E0]"
										aria-hidden="true"
									>
										<polygon points="23 7 16 12 23 17 23 7"></polygon>
										<rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
									</svg>
								{/if}
							</div>
							<p
								class="mt-2 truncate font-display text-base font-bold text-white group-hover:text-gold"
							>
								{post.title}
							</p>
							<p class="mt-1 font-ui text-xs text-[#BBA8E0]">{post.date}</p>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else if nav.profileTab === 'achievements'}
		<div
			class="mt-6 rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="font-display text-xl font-bold">Achievements</h2>
					<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
						Little milestones from your journal and your circle.
					</p>
				</div>
				<span class="rounded-full bg-white/10 px-3 py-1 font-ui text-xs font-semibold text-lav"
					>{badges.length} earned</span
				>
			</div>

			{#if badges.length === 0}
				<div class="mt-5 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
					<p class="font-display text-lg font-bold">Your first badge is close</p>
					<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
						Save a page, join a community, or add a friend to get started.
					</p>
				</div>
			{:else}
				<div class="mt-5 grid gap-3 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
					{#each badges as badge (badge.id)}
						<div class="flex items-start gap-3 rounded-2xl border p-4 {toneClasses(badge.tone)}">
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10"
							>
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
		</div>
	{:else if nav.profileTab === 'settings'}
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			<div
				class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">Appearance</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
					Your accent color follows you across the app.
				</p>

				<p class="mt-5 font-ui text-xs font-bold tracking-wider text-gold uppercase">
					Accent color
				</p>
				<div class="mt-2 flex flex-wrap gap-2.5">
					{#each accentChoices as color (color)}
						<button
							type="button"
							class="size-10 rounded-full border-2 transition-transform hover:scale-105 {profile.accentColor ===
							color
								? 'border-white'
								: 'border-transparent'}"
							style="background: {color}"
							aria-label={`Use accent color ${color}`}
							aria-pressed={profile.accentColor === color}
							onclick={() => (profile.accentColor = color)}
						></button>
					{/each}
					<label
						class="flex size-10 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-white/30 text-xs text-white/70 hover:border-white/60"
					>
						<input
							type="color"
							class="size-0 overflow-hidden opacity-0"
							value={profile.accentColor}
							oninput={(event) => (profile.accentColor = event.currentTarget.value)}
						/>
						+
					</label>
				</div>

				<p class="mt-6 font-ui text-xs font-bold tracking-wider text-gold uppercase">
					Journal theme
				</p>
				<div class="mt-2 grid gap-2">
					{#each themes as theme (theme.id)}
						<button
							type="button"
							class="flex items-center justify-between rounded-xl px-4 py-3 transition-colors {profile.theme ===
							theme.id
								? 'bg-accent'
								: 'bg-white/5 hover:bg-white/10'}"
							onclick={() => (profile.theme = theme.id)}
						>
							<span class="flex items-center gap-2.5 font-ui text-sm">
								<span
									class="size-4 rounded-full ring-2 ring-white/30"
									style="background: {theme.swatch}"
								></span>
								{theme.label}
							</span>
							{#if profile.theme === theme.id}
								<CommunityIcon name="check" size={16} />
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div
				class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">Privacy</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">Control who sees new pages and requests.</p>

				<div class="mt-5 space-y-3">
					<div class="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Default privacy</p>
							<p class="font-ui text-xs text-[#BBA8E0]">Applied to new pages</p>
						</div>
						<select
							bind:value={profile.defaultPrivacy}
							class="rounded-lg border border-white/15 bg-[#2A1B3F] px-3 py-2 font-ui text-sm text-white"
						>
							<option value="private">Private</option>
							<option value="friends">Friends</option>
							<option value="community">Community</option>
						</select>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Allow friend requests</p>
							<p class="font-ui text-xs text-[#BBA8E0]">Let others send you requests by code</p>
						</div>
						<button
							type="button"
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {profile.allowFriendRequests
								? 'bg-[#3F7A4F] text-white'
								: 'bg-white/20 text-white/80'}"
							onclick={() => (profile.allowFriendRequests = !profile.allowFriendRequests)}
						>
							{profile.allowFriendRequests ? 'Enabled' : 'Disabled'}
						</button>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Clear cache on sign out</p>
							<p class="font-ui text-xs text-[#BBA8E0]">Remove local pages from shared devices</p>
						</div>
						<button
							type="button"
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {profile.clearCacheOnSignOut
								? 'bg-[#3F7A4F] text-white'
								: 'bg-white/20 text-white/80'}"
							onclick={() => (profile.clearCacheOnSignOut = !profile.clearCacheOnSignOut)}
						>
							{profile.clearCacheOnSignOut ? 'Enabled' : 'Disabled'}
						</button>
					</div>
				</div>

				{#if settingsError}
					<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{settingsError}</p>
				{/if}

				<button
					type="button"
					class="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-ui text-sm font-bold text-white transition-colors hover:bg-[#624690] disabled:opacity-60"
					disabled={settingsSaving}
					onclick={saveSettings}
				>
					{settingsSaving ? 'Saving…' : 'Save settings'}
				</button>
				<button
					type="button"
					class="mt-2 w-full rounded-xl border border-white/20 px-4 py-2.5 font-ui text-sm font-semibold text-[#D6CBEC] transition-colors hover:bg-white/10"
					onclick={clearCache}
				>
					Clear local journal cache
				</button>
			</div>
		</div>
	{:else if nav.profileTab === 'edit'}
		<div class="mx-auto mt-6 max-w-[680px]">
			<form
				class="rounded-[26px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_18px_44px_rgba(0,0,0,.38)]"
				onsubmit={saveEdits}
			>
				<h2 class="font-display text-xl font-bold">Edit profile</h2>
				<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
					Your nickname is what friends see. Your @username is your unique handle.
				</p>

				<div class="mt-5 grid gap-4">
					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-bold tracking-wider text-gold uppercase"
							>Nickname</span
						>
						<input
							bind:value={editNickname}
							type="text"
							maxlength="32"
							placeholder="Rice Shower"
							class="h-11 rounded-xl border border-white/15 bg-[#24143D] px-3.5 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
						/>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-bold tracking-wider text-gold uppercase"
							>Username</span
						>
						<div class="relative">
							<span
								class="absolute top-1/2 left-3.5 -translate-y-1/2 font-ui text-sm text-[#9B8CB5]"
								>@</span
							>
							<input
								bind:value={editUsername}
								type="text"
								maxlength="24"
								autocomplete="username"
								placeholder="rice_shower"
								class="h-11 w-full rounded-xl border border-white/15 bg-[#24143D] pr-3.5 pl-8 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
							/>
						</div>
						<span class="font-ui text-[11px] text-[#BBA8E0]"
							>2–24 characters. Letters, numbers, dots, dashes, underscores.</span
						>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-bold tracking-wider text-gold uppercase">Bio</span>
						<textarea
							bind:value={editBio}
							maxlength="200"
							rows="3"
							placeholder="A sentence about you…"
							class="w-full resize-none rounded-xl border border-white/15 bg-[#24143D] px-3.5 py-2.5 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
						></textarea>
						<span class="text-right font-ui text-[11px] text-[#BBA8E0]">{editBio.length}/200</span>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-bold tracking-wider text-gold uppercase"
							>Avatar image URL</span
						>
						<input
							bind:value={editAvatar}
							type="url"
							placeholder="https://…"
							class="h-11 rounded-xl border border-white/15 bg-[#24143D] px-3.5 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
						/>
						<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-[#24143D] px-3.5 py-2 font-ui text-xs text-[#D6CBEC] hover:bg-[#3A2A55]">
							Upload photo
							<input
								type="file"
								accept="image/*"
								class="hidden"
								onchange={(event) => {
									const file = (event.currentTarget as HTMLInputElement).files?.[0];
									if (file) avatarFile = file;
								}}
							/>
						</label>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-bold tracking-wider text-gold uppercase"
							>Profile banner URL</span
						>
						<input
							bind:value={editBanner}
							type="url"
							placeholder="https://…"
							class="h-11 rounded-xl border border-white/15 bg-[#24143D] px-3.5 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
						/>
						<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-[#24143D] px-3.5 py-2 font-ui text-xs text-[#D6CBEC] hover:bg-[#3A2A55]">
							Upload banner
							<input
								type="file"
								accept="image/*"
								class="hidden"
								onchange={(event) => {
									const file = (event.currentTarget as HTMLInputElement).files?.[0];
									if (file) bannerFile = file;
								}}
							/>
						</label>
					</label>
				</div>

				{#if editError}
					<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{editError}</p>
				{/if}

				<div class="mt-5 flex flex-wrap gap-2">
					<button
						type="submit"
						class="rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white transition-colors hover:bg-[#624690] disabled:opacity-60"
						disabled={editSaving}
					>
						{editSaving ? 'Saving…' : 'Save profile'}
					</button>
					<button
						type="button"
						class="rounded-xl border border-white/20 px-5 py-2.5 font-ui text-sm font-semibold text-[#D6CBEC] transition-colors hover:bg-white/10"
						onclick={() => setTab('overview')}
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
