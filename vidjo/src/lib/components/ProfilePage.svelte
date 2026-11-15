<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { censor } from '#lib/censor';
	import { dateKey } from '#lib/dates';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav, type ProfileTab } from '#lib/state/navigation.svelte';
	import { pwa } from '#lib/state/pwa.svelte';
	import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
	import { normalizeImageUrl, optimizedBannerUrl } from '#lib/avatar';
	import { captureError } from '#lib/observability';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';

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

	$effect(() => {
		journal.paper = profile.paperStyle;
	});

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
			const key = dateKey(current);
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

	let bannerOriginal = $derived(normalizeImageUrl(profile.bannerUrl));
	let bannerOptimized = $derived(optimizedBannerUrl(bannerOriginal));
	let bannerUseOriginal = $state(false);
	let bannerFailed = $state(false);
	let bannerSrc = $derived(bannerUseOriginal ? bannerOriginal : bannerOptimized);

	$effect(() => {
		void bannerOriginal;
		bannerFailed = false;
		bannerUseOriginal = false;
	});

	function handleBannerError() {
		// Fall back to the original object URL when transformations are not
		// enabled for the Supabase project.
		if (!bannerUseOriginal && bannerOriginal && bannerOptimized !== bannerOriginal) {
			bannerUseOriginal = true;
			return;
		}
		bannerFailed = true;
	}

	$effect(() => {
		const key = [
			nav.profileTab,
			profile.profile?.updated_at ?? '',
			profile.username,
			profile.nickname,
			profile.bio,
			profile.avatarUrl ?? '',
			profile.bannerUrl ?? ''
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
		if (editSaving) return;
		editSaving = true;
		editError = '';

		let avatarUrl = editAvatar.trim() || null;
		let bannerUrl = editBanner.trim() || null;

		if (avatarFile) {
			const upload = await profile.uploadImage(avatarFile, 'avatar');
			if (upload.error || !upload.url) {
				editSaving = false;
				editError = upload.error || 'Could not upload your avatar.';
				return;
			}
			avatarUrl = upload.url;
			editAvatar = upload.url;
			avatarFile = null;
		}

		if (bannerFile) {
			const upload = await profile.uploadImage(bannerFile, 'banner');
			if (upload.error || !upload.url) {
				editSaving = false;
				editError = upload.error || 'Could not upload your banner.';
				return;
			}
			bannerUrl = upload.url;
			editBanner = upload.url;
			bannerFile = null;
		}

		const result = await profile.saveProfile({
			username: editUsername,
			display_name: editNickname,
			bio: editBio,
			avatar_url: avatarUrl,
			banner_url: bannerUrl
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

	async function exportJournal() {
		const entries = Object.entries(journal.entries)
			.filter(([, entry]) => entry.saved || entry.title || entry.mind || entry.videoPath)
			.map(([date, entry]) => ({ ...entry, date }));

		const data = {
			exportedAt: new Date().toISOString(),
			username: profile.username,
			displayName: profile.displayName,
			entries
		};

		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vidjo-journal-${new Date().toISOString().split('T')[0]}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		journal.toast('Journal data exported');
	}

	async function deleteAccount() {
		const confirmText = prompt('Type "DELETE" to confirm permanent account deletion:');
		if (confirmText !== 'DELETE') return;

		const userId = auth.user?.id ?? '';

		if (isSupabaseConfigured) {
			if (!userId) {
				journal.toast('You must be signed in to delete your account.');
				return;
			}

			try {
				// Remove storage objects first: the database RPC cannot delete files
				// from the underlying object store.
				const { data: videoRows } = await supabase
					.from('vidjo_entries')
					.select('video_path, video_thumb_path')
					.eq('owner_id', userId)
					.or('video_path.not.is.null,video_thumb_path.not.is.null');

				const videoPaths = (videoRows ?? []).flatMap((row) => {
					const paths: string[] = [];
					if (row.video_path) paths.push(row.video_path as string);
					if (row.video_thumb_path) paths.push(row.video_thumb_path as string);
					return paths;
				});

				if (videoPaths.length > 0) {
					const { error: videoRemoveError } = await supabase.storage
						.from(VIDEO_BUCKET)
						.remove(videoPaths);
					if (videoRemoveError) {
						console.warn('[VidJo] Could not remove account videos.', videoRemoveError);
						captureError(new Error(videoRemoveError.message), { area: 'account-delete-videos' });
					}
				}

				for (const folder of ['avatars', 'banners']) {
					const { data: imageFiles } = await supabase.storage
						.from('vidjo-images')
						.list(`${userId}/${folder}`);
					const imagePaths = (imageFiles ?? []).map((file) => `${userId}/${folder}/${file.name}`);
					if (imagePaths.length > 0) {
						const { error: imageRemoveError } = await supabase.storage
							.from('vidjo-images')
							.remove(imagePaths);
						if (imageRemoveError) {
							console.warn('[VidJo] Could not remove account images.', imageRemoveError);
							captureError(new Error(imageRemoveError.message), {
								area: 'account-delete-images'
							});
						}
					}
				}

				const { data, error } = await supabase.rpc('vidjo_delete_account');
				if (error) throw error;

				const result = data as { success?: boolean; message?: string } | null;
				if (!result?.success) {
					journal.toast(result?.message || 'Could not delete your account.');
					return;
				}
			} catch (err) {
				console.error('[VidJo] Could not delete the account.', err);
				captureError(err, { area: 'account-delete' });
				journal.toast('Could not delete your account. Please try again.');
				return;
			}
		}

		await auth.signOut();
		journal.reset();
		friends.reset();
		community.reset();
		profile.reset();

		try {
			localStorage.clear();
		} catch {
			// Ignore
		}

		journal.toast(isSupabaseConfigured ? 'Account deleted' : 'Local data cleared');
		nav.setView('journal');
	}

	function toneClasses(tone: Badge['tone']) {
		if (tone === 'gold') return 'border-book-accent/40 bg-book-accent/15 text-book-accent';
		if (tone === 'green') return 'border-[#3F7A4F]/40 bg-[#3F7A4F]/15 text-[#8BE2A4]';
		return 'border-cover bg-cover/25 text-book-bg/75';
	}
</script>

<div class="mx-auto w-full max-w-[1100px] px-4 py-6 min-[900px]:px-6">
	<!-- ── Profile hero ── -->
	<div
		class="relative overflow-hidden rounded-[32px] border border-cover-edge shadow-[0_28px_70px_rgba(0,0,0,.5)]"
	>
		<div class="relative h-44 min-[720px]:h-52">
			{#if bannerSrc && !bannerFailed}
				<img
					src={bannerSrc}
					alt=""
					class="absolute inset-0 h-full w-full object-cover"
					decoding="async"
					referrerpolicy="no-referrer"
					onerror={handleBannerError}
				/>
			{:else}
				<div
					class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-cover)_0%,var(--color-cover-edge)_60%,var(--color-desk)_100%)]"
				></div>
			{/if}
			<div
				class="absolute inset-0 [background-image:radial-gradient(circle_at_20%_30%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_80%_20%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
			></div>
			<div class="absolute top-5 right-5 flex flex-wrap gap-2">
				<Button size="sm" variant="outline" icon="pen" onclick={() => setTab('edit')}>
					Edit profile
				</Button>
				<Button size="sm" variant="outline" icon="settings" onclick={() => setTab('settings')}>
					Settings
				</Button>
			</div>
			<div class="absolute -bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center">
				<Avatar
					src={profile.avatarUrl}
					name={profile.displayName}
					className="size-32"
					textClass="text-5xl"
					ring="border-4 border-book-accent/60 shadow-[0_20px_40px_rgba(0,0,0,.45)]"
				/>
			</div>
		</div>

		<div class="bg-desk-2 px-6 pt-20 pb-8 text-center min-[720px]:px-10">
			<h1 class="font-display text-3xl font-bold text-book-bg min-[720px]:text-4xl">
				{profile.nickname}
			</h1>
			<p class="mt-1 font-ui text-sm font-semibold text-book-bg/70">@{profile.username}</p>
			<p class="mt-1 font-ui text-xs text-book-bg/65">
				{#if isSupabaseConfigured && auth.email}
					{auth.email} •
				{/if}
				Member since {profile.memberSince}
			</p>
			{#if profile.bio}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-book-bg/90">“{profile.bio}”</p>
			{:else}
				<p class="mx-auto mt-4 max-w-[560px] font-hand text-lg text-book-bg/65">
					Small videos, big thoughts.
				</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
				<span
					class="rounded-full bg-cover/35 px-3 py-1 font-mono text-xs font-bold tracking-wider text-book-accent tabular-nums"
				>
					{profile.friendCode}
				</span>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg transition-colors hover:bg-cover/50"
					onclick={copyFriendCode}
				>
					{#if copied}
						<CommunityIcon name="check" size={13} />
						Copied
					{:else}
						<CommunityIcon name="copy" size={13} />
						Copy friend code
					{/if}
				</button>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-3 min-[640px]:grid-cols-4">
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-4">
					<p class="font-display text-2xl font-bold text-book-bg tabular-nums">{totalPages}</p>
					<p class="font-ui text-xs text-book-bg/65">Pages written</p>
				</div>
				<div class="rounded-2xl border border-book-accent/40 bg-book-accent/10 p-4">
					<p
						class="flex items-center justify-center gap-1.5 font-display text-2xl font-bold text-book-accent tabular-nums"
					>
						<CommunityIcon name="flame" size={20} />
						{streak}
					</p>
					<p class="font-ui text-xs text-book-bg/65">Day streak</p>
				</div>
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-4">
					<p class="font-display text-2xl font-bold text-[#8BE2A4] tabular-nums">
						{friends.friendCount}
					</p>
					<p class="font-ui text-xs text-book-bg/65">Friends</p>
				</div>
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-4">
					<p class="font-display text-2xl font-bold text-book-bg/70 tabular-nums">
						{badges.length}
					</p>
					<p class="font-ui text-xs text-book-bg/65">Badges</p>
				</div>
			</div>
		</div>
	</div>

	<!-- ── Tabs ── -->
	<div class="mt-6 flex justify-center">
		<div
			class="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-cover-edge bg-desk-2 p-1"
		>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					class="shrink-0 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {nav.profileTab ===
					tab.id
						? 'bg-cta text-cta-text shadow-sm'
						: 'text-book-bg/70 hover:text-book-bg'}"
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
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">About</h2>
				<dl class="mt-4 grid gap-2.5 font-ui text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="text-book-bg/65">Nickname</dt>
						<dd class="font-semibold text-book-bg">{profile.nickname}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-book-bg/65">Username</dt>
						<dd class="font-semibold text-book-bg/70">@{profile.username}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-book-bg/65">Member since</dt>
						<dd class="font-semibold text-book-bg">{profile.memberSince}</dd>
					</div>
					<div class="flex items-center justify-between gap-4">
						<dt class="text-book-bg/65">Communities</dt>
						<dd class="font-semibold text-book-bg tabular-nums">
							{community.joinedCommunities.length}
						</dd>
					</div>
				</dl>
				{#if profile.bio}
					<p class="mt-4 rounded-xl bg-cover/20 p-4 font-hand text-lg text-book-bg/90">
						“{profile.bio}”
					</p>
				{:else}
					<p class="mt-4 rounded-xl bg-cover/20 p-4 font-ui text-sm text-book-bg/65">
						Add a short bio so friends and communities know what you're about.
					</p>
				{/if}
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Recent badges</h2>
					<button
						type="button"
						class="font-ui text-xs font-semibold text-book-accent hover:underline"
						onclick={() => setTab('achievements')}
					>
						View all
					</button>
				</div>
				{#if badges.length === 0}
					<p class="mt-4 font-ui text-sm text-book-bg/65">
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
						class="flex items-center justify-between rounded-xl bg-cover/20 px-4 py-3 text-left hover:bg-cover/35"
						onclick={() => nav.jump(journal.current)}
					>
						<span class="font-ui text-sm">Write today's page</span>
						<CommunityIcon name="arrow-right" size={15} class="text-book-accent" />
					</button>
					<button
						type="button"
						class="flex items-center justify-between rounded-xl bg-cover/20 px-4 py-3 text-left hover:bg-cover/35"
						onclick={() => nav.setView('friends')}
					>
						<span class="font-ui text-sm">Go to friends</span>
						<CommunityIcon name="arrow-right" size={15} class="text-book-accent" />
					</button>
					<button
						type="button"
						class="flex items-center justify-between rounded-xl bg-cover/20 px-4 py-3 text-left hover:bg-cover/35"
						onclick={() => nav.setView('community')}
					>
						<span class="font-ui text-sm">Explore communities</span>
						<CommunityIcon name="arrow-right" size={15} class="text-book-accent" />
					</button>
				</div>
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)] lg:col-span-2"
			>
				<div class="flex items-center justify-between">
					<h2 class="font-display text-xl font-bold">Recently shared</h2>
					<button
						type="button"
						class="font-ui text-xs font-semibold text-book-accent hover:underline"
						onclick={() => setTab('portfolio')}
					>
						Full portfolio
					</button>
				</div>
				{#if recentlyShared.length === 0}
					<div class="rounded-2xl border border-cover-edge bg-cover/20 p-8 text-center">
						<p class="font-display text-lg font-bold">Nothing shared yet</p>
						<p class="mt-1 font-ui text-sm text-book-bg/65">
							Set a page to Friends or Community to build your portfolio.
						</p>
						<button
							type="button"
							class="mt-3 rounded-xl bg-cta px-4 py-2 font-ui text-sm font-bold text-cta-text hover:bg-cta-hover"
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
								class="group rounded-2xl border border-cover-edge bg-cover/35 p-4 text-left text-book-bg transition-all hover:-translate-y-0.5 hover:shadow-md"
								onclick={() => nav.jump(post.date)}
							>
								<div class="flex items-center justify-between gap-2">
									<span
										class="rounded-full bg-book-accent/15 px-2 py-0.5 font-ui text-[10px] font-semibold text-book-accent"
									>
										{post.communityTag || post.privacy}
									</span>
									{#if post.hasVideo}
										<CommunityIcon name="video" size={14} class="text-book-bg/65" />
									{/if}
								</div>
								<p
									class="mt-2 truncate font-display text-base font-bold text-book-bg group-hover:text-book-accent"
								>
									{censor(post.title)}
								</p>
								<p class="mt-1 font-ui text-xs text-book-bg/65">{post.date}</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else if nav.profileTab === 'portfolio'}
		<div
			class="mt-6 rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="font-display text-xl font-bold">My posts portfolio</h2>
					<p class="mt-1 font-ui text-sm text-book-bg/65">
						Every page you've shared with friends or a community.
					</p>
				</div>
				<span
					class="rounded-full bg-book-accent/15 px-3 py-1 font-ui text-xs font-semibold text-book-accent"
					>{myPosts.length} shared</span
				>
			</div>

			{#if myPosts.length === 0}
				<div class="rounded-2xl border border-cover-edge bg-cover/20 p-10 text-center">
					<p class="font-display text-lg font-bold">No shared posts yet</p>
					<p class="mt-1 font-ui text-sm text-book-bg/65">
						Turn on Friends, Community, or both in the sharing picker on any page.
					</p>
					<button
						type="button"
						class="mt-3 rounded-xl bg-cta px-4 py-2 font-ui text-sm font-bold text-cta-text hover:bg-cta-hover"
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
							class="group rounded-2xl border border-cover-edge bg-cover/35 p-4 text-left text-book-bg transition-all hover:-translate-y-0.5 hover:shadow-md"
							onclick={() => nav.jump(post.date)}
						>
							<div class="flex items-center justify-between gap-2">
								<span
									class="rounded-full bg-book-accent/15 px-2 py-0.5 font-ui text-[10px] font-semibold text-book-accent"
								>
									{post.communityTag || post.privacy}
								</span>
								{#if post.hasVideo}
									<CommunityIcon name="video" size={14} class="text-book-bg/65" />
								{/if}
							</div>
							<p
								class="mt-2 truncate font-display text-base font-bold text-book-bg group-hover:text-book-accent"
							>
								{post.title}
							</p>
							<p class="mt-1 font-ui text-xs text-book-bg/65">{post.date}</p>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else if nav.profileTab === 'achievements'}
		<div
			class="mt-6 rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="font-display text-xl font-bold">Achievements</h2>
					<p class="mt-1 font-ui text-sm text-book-bg/65">
						Little milestones from your journal and your circle.
					</p>
				</div>
				<span
					class="rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg/70"
					>{badges.length} earned</span
				>
			</div>

			{#if badges.length === 0}
				<div class="mt-5 rounded-2xl border border-cover-edge bg-cover/20 p-8 text-center">
					<p class="font-display text-lg font-bold">Your first badge is close</p>
					<p class="mt-1 font-ui text-sm text-book-bg/65">
						Save a page, join a community, or add a friend to get started.
					</p>
				</div>
			{:else}
				<div class="mt-5 grid gap-3 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3">
					{#each badges as badge (badge.id)}
						<div class="flex items-start gap-3 rounded-2xl border p-4 {toneClasses(badge.tone)}">
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/35"
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
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">Appearance</h2>
				<p class="mt-1 font-ui text-sm text-book-bg/65">
					Your accent color follows you across the app.
				</p>

				<p class="mt-5 font-ui text-xs font-semibold text-book-accent">Accent color</p>
				<div class="mt-2 flex flex-wrap gap-2.5">
					{#each accentChoices as color (color)}
						<button
							type="button"
							class="size-10 rounded-full border-2 transition-transform hover:scale-105 {profile.accentColor ===
							color
								? 'border-book-bg'
								: 'border-transparent'}"
							style="background: {color}"
							aria-label={`Use accent color ${color}`}
							aria-pressed={profile.accentColor === color}
							onclick={() => (profile.accentColor = color)}
						></button>
					{/each}
					<label
						class="flex size-10 cursor-pointer items-center justify-center rounded-full border-2 border-cover text-book-bg/70 transition-colors hover:border-cover hover:text-book-bg"
					>
						<input
							type="color"
							class="size-0 overflow-hidden opacity-0"
							value={profile.accentColor}
							oninput={(event) => (profile.accentColor = event.currentTarget.value)}
						/>
						<CommunityIcon name="plus" size={16} />
					</label>
				</div>

				<p class="mt-6 font-ui text-xs font-semibold text-book-accent">Journal theme</p>
				<div class="mt-2 grid gap-2">
					{#each themes as theme (theme.id)}
						<button
							type="button"
							class="flex items-center justify-between rounded-xl px-4 py-3 transition-colors {profile.theme ===
							theme.id
								? 'bg-cta text-cta-text'
								: 'bg-cover/20 hover:bg-cover/35'}"
							onclick={() => (profile.theme = theme.id)}
						>
							<span class="flex items-center gap-2.5 font-ui text-sm">
								<span
									class="size-4 rounded-full ring-2 ring-book-bg/30"
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

				<p class="mt-6 font-ui text-xs font-semibold text-book-accent">Default paper style</p>
				<div class="mt-2 grid gap-2">
					{#each ['lined', 'dotted', 'grid', 'plain'] as const as style (style)}
						<button
							type="button"
							class="flex items-center justify-between rounded-xl px-4 py-3 transition-colors {profile.paperStyle ===
							style
								? 'bg-cta text-cta-text'
								: 'bg-cover/20 hover:bg-cover/35'}"
							onclick={() => (profile.paperStyle = style)}
						>
							<span class="flex items-center gap-2.5 font-ui text-sm">
								{style === 'lined'
									? 'Lined'
									: style === 'dotted'
										? 'Dotted'
										: style === 'grid'
											? 'Grid'
											: 'Plain'}
								<span class="text-xs text-book-bg/65">{style}</span>
							</span>
							{#if profile.paperStyle === style}
								<CommunityIcon name="check" size={16} />
							{/if}
						</button>
					{/each}
				</div>

				<p class="mt-6 font-ui text-xs font-semibold text-book-accent">Text size</p>
				<div class="mt-2 flex items-center gap-4">
					<span class="font-ui text-xs text-book-bg/65">A</span>
					<select
						bind:value={profile.fontSize}
						class="rounded-lg border border-cover-edge bg-desk px-3 py-2 font-ui text-sm text-book-bg focus:border-book-accent focus:outline-none"
					>
						<option value="sm">Small</option>
						<option value="base">Default</option>
						<option value="lg">Large</option>
					</select>
					<span class="font-ui text-xs text-book-bg/65">A</span>
				</div>
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<h2 class="font-display text-xl font-bold">Privacy</h2>
				<p class="mt-1 font-ui text-sm text-book-bg/65">Control who sees new pages and requests.</p>

				<div class="mt-5 space-y-3">
					<div class="flex items-center justify-between gap-3 rounded-xl bg-cover/20 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">New page default</p>
							<p class="font-ui text-xs text-book-bg/65">
								A starting point — each page can still go to friends and a community together
							</p>
						</div>
						<select
							bind:value={profile.defaultPrivacy}
							class="rounded-lg border border-cover-edge bg-desk px-3 py-2 font-ui text-sm text-book-bg"
						>
							<option value="private">Only me</option>
							<option value="friends">Friends</option>
							<option value="community">Community</option>
						</select>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-xl bg-cover/20 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Allow friend requests</p>
							<p class="font-ui text-xs text-book-bg/65">Let others send you requests by code</p>
						</div>
						<button
							type="button"
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {profile.allowFriendRequests
								? 'bg-[#3F7A4F] text-book-bg'
								: 'bg-cover/50 text-book-bg/80'}"
							onclick={() => (profile.allowFriendRequests = !profile.allowFriendRequests)}
						>
							{profile.allowFriendRequests ? 'Enabled' : 'Disabled'}
						</button>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-xl bg-cover/20 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Clear cache on sign out</p>
							<p class="font-ui text-xs text-book-bg/65">Remove local pages from shared devices</p>
						</div>
						<button
							type="button"
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {profile.clearCacheOnSignOut
								? 'bg-[#3F7A4F] text-book-bg'
								: 'bg-cover/50 text-book-bg/80'}"
							onclick={() => (profile.clearCacheOnSignOut = !profile.clearCacheOnSignOut)}
						>
							{profile.clearCacheOnSignOut ? 'Enabled' : 'Disabled'}
						</button>
					</div>
				</div>

				{#if settingsError}
					<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{settingsError}</p>
				{/if}

				<Button class="mt-5 w-full" loading={settingsSaving} onclick={saveSettings}>
					Save settings
				</Button>
				<Button class="mt-2 w-full" variant="outline" icon="refresh" onclick={clearCache}>
					Clear local journal cache
				</Button>

				<div class="mt-6 space-y-2 border-t border-cover-edge pt-6">
					<Button class="w-full" variant="outline" icon="upload" onclick={exportJournal}>
						Export journal data
					</Button>
					<Button class="w-full" variant="danger" icon="trash" onclick={deleteAccount}>
						Delete my account
					</Button>
				</div>
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)] lg:col-span-2"
			>
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div class="max-w-[560px]">
						<h2 class="font-display text-xl font-bold">Install VidJo</h2>
						<p class="mt-1 font-ui text-sm text-book-bg/65">
							Add VidJo to your home screen for a full-screen journal that opens without the
							browser, and keeps saved pages available offline.
						</p>
					</div>

					{#if pwa.installed}
						<span
							class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#3F7A4F]/60 bg-[#3F7A4F]/20 px-4 font-ui text-sm font-bold text-[#9BE0AC]"
						>
							<CommunityIcon name="check" size={15} />
							Installed
						</span>
					{:else if pwa.canInstall}
						<Button icon="rocket" onclick={() => void pwa.promptInstall()}>Install VidJo</Button>
					{:else if pwa.showIosHint}
						<p
							class="rounded-xl border border-cover-edge bg-cover/20 px-4 py-3 font-ui text-xs leading-relaxed text-book-bg/70"
						>
							In Safari, tap <b class="text-book-bg">Share</b>, then
							<b class="text-book-bg">Add to Home Screen</b>.
						</p>
					{:else}
						<p
							class="rounded-xl border border-cover-edge bg-cover/20 px-4 py-3 font-ui text-xs leading-relaxed text-book-bg/70"
						>
							Open your browser menu and choose <b class="text-book-bg">Install app</b> or
							<b class="text-book-bg">Add to Home Screen</b>.
						</p>
					{/if}
				</div>
			</div>
		</div>
	{:else if nav.profileTab === 'edit'}
		<div class="mx-auto mt-6 max-w-[680px]">
			<form
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
				onsubmit={saveEdits}
			>
				<h2 class="font-display text-xl font-bold">Edit profile</h2>
				<p class="mt-1 font-ui text-sm text-book-bg/65">
					Your nickname is what friends see. Your @username is your unique handle.
				</p>

				<div class="mt-5 grid gap-4">
					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-semibold text-book-accent">Nickname</span>
						<input
							bind:value={editNickname}
							type="text"
							maxlength="32"
							placeholder="Rice Shower"
							class="h-11 rounded-xl border border-cover-edge bg-desk px-3.5 font-ui text-sm text-book-bg placeholder:text-book-bg/45 focus:border-book-accent/60 focus:outline-none"
						/>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-semibold text-book-accent">Username</span>
						<div class="relative">
							<span
								class="absolute top-1/2 left-3.5 -translate-y-1/2 font-ui text-sm text-book-bg/45"
								>@</span
							>
							<input
								bind:value={editUsername}
								type="text"
								maxlength="24"
								autocomplete="username"
								placeholder="rice_shower"
								class="h-11 w-full rounded-xl border border-cover-edge bg-desk pr-3.5 pl-8 font-ui text-sm text-book-bg placeholder:text-book-bg/45 focus:border-book-accent/60 focus:outline-none"
							/>
						</div>
						<span class="font-ui text-[11px] text-book-bg/65"
							>2–24 characters. Letters, numbers, dots, dashes, underscores.</span
						>
					</label>

					<label class="grid gap-1.5">
						<span class="font-ui text-xs font-semibold text-book-accent">Bio</span>
						<textarea
							bind:value={editBio}
							maxlength="200"
							rows="3"
							placeholder="A sentence about you…"
							class="w-full resize-none rounded-xl border border-cover-edge bg-desk px-3.5 py-2.5 font-ui text-sm text-book-bg placeholder:text-book-bg/45 focus:border-book-accent/60 focus:outline-none"
						></textarea>
						<span class="text-right font-ui text-[11px] text-book-bg/65">{editBio.length}/200</span>
					</label>

					<div class="grid gap-1.5">
						<span class="font-ui text-xs font-semibold text-book-accent">Profile picture</span>
						<span class="font-ui text-[11px] text-book-bg/65"
							>Upload a PNG, JPG, GIF, or WebP image (max 5 MB).</span
						>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-xl border border-cover-edge bg-desk px-3.5 py-2 font-ui text-xs text-book-bg/70 hover:bg-cover/50"
						>
							Upload photo
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								class="hidden"
								onchange={(event) => {
									const input = event.currentTarget as HTMLInputElement;
									const file = input.files?.[0];
									if (file) avatarFile = file;
									input.value = '';
								}}
							/>
						</label>
						{#if avatarFile}
							<span class="font-ui text-[11px] text-book-bg/70">Selected: {avatarFile.name}</span>
						{:else if editAvatar}
							<button
								type="button"
								class="justify-self-start font-ui text-[11px] font-semibold text-[#FF9B9B] hover:underline"
								onclick={() => {
									editAvatar = '';
									avatarFile = null;
								}}
							>
								Remove photo
							</button>
						{/if}
					</div>

					<div class="grid gap-1.5">
						<span class="font-ui text-xs font-semibold text-book-accent">Profile banner</span>
						<span class="font-ui text-[11px] text-book-bg/65"
							>Upload a PNG, JPG, GIF, or WebP image (max 5 MB).</span
						>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-xl border border-cover-edge bg-desk px-3.5 py-2 font-ui text-xs text-book-bg/70 hover:bg-cover/50"
						>
							Upload banner
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								class="hidden"
								onchange={(event) => {
									const input = event.currentTarget as HTMLInputElement;
									const file = input.files?.[0];
									if (file) bannerFile = file;
									input.value = '';
								}}
							/>
						</label>
						{#if bannerFile}
							<span class="font-ui text-[11px] text-book-bg/70">Selected: {bannerFile.name}</span>
						{:else if editBanner}
							<button
								type="button"
								class="justify-self-start font-ui text-[11px] font-semibold text-[#FF9B9B] hover:underline"
								onclick={() => {
									editBanner = '';
									bannerFile = null;
								}}
							>
								Remove banner
							</button>
						{/if}
					</div>
				</div>

				{#if editError}
					<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{editError}</p>
				{/if}

				<div class="mt-5 flex flex-wrap gap-2">
					<Button type="submit" loading={editSaving} icon="check">Save profile</Button>
					<Button variant="outline" onclick={() => setTab('overview')}>Cancel</Button>
				</div>
			</form>
		</div>
	{/if}
</div>
