<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { censor } from '#lib/censor';
	import { DEFAULT_PREFERENCES, profile, type NotebookStyle } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav, type ProfileTab } from '#lib/state/navigation.svelte';
	import { notifications } from '#lib/state/notifications.svelte';
	import { pwa } from '#lib/state/pwa.svelte';
	import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
	import { normalizeImageUrl, optimizedBannerUrl } from '#lib/avatar';
	import { captureError } from '#lib/observability';
	import { portal } from '#lib/actions/portal';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ProfileBadgeList from '#lib/components/ProfileBadgeList.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import PromptModal from '#lib/components/PromptModal.svelte';
	import { spotify } from '#lib/state/spotify.svelte';
	import { THEMES, type ThemeName } from '#lib/themes';
	import { USERNAME_MAX, validateUsername } from '#lib/username';

	const tabs: { id: ProfileTab; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'portfolio', label: 'Portfolio' },
		{ id: 'achievements', label: 'Achievements' },
		{ id: 'settings', label: 'Settings' },
		{ id: 'edit', label: 'Edit Profile' }
	];

	const accentChoices = ['#51397A', '#7D58C2', '#D4A24C', '#3F7A4F', '#E85D5D', '#4F9DEB'];

	const notebookStyles: { id: NotebookStyle; label: string; hint: string }[] = [
		{ id: 'scrapbook', label: 'Scrapbook', hint: 'A cream note card' },
		{ id: 'dark', label: 'Dark journal', hint: 'Dark page, gold edge' },
		{ id: 'spread', label: 'Book spread', hint: 'Two pages, like a book' },
		{ id: 'polaroid', label: 'Polaroid', hint: 'Taped photo and a note' }
	];

	const paperStyles = [
		{ id: 'lined', label: 'Lined' },
		{ id: 'dotted', label: 'Dotted' },
		{ id: 'grid', label: 'Grid' },
		{ id: 'plain', label: 'Plain' }
	] as const;

	type AppearanceSection = 'accent' | 'theme' | 'paper' | 'text' | 'notebook';

	let openSections = $state<Record<AppearanceSection, boolean>>({
		accent: true,
		theme: false,
		paper: false,
		text: false,
		notebook: false
	});

	function toggleSection(id: AppearanceSection) {
		openSections[id] = !openSections[id];
	}

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
	let confirmRemove = $state<'avatar' | 'banner' | null>(null);
	let deleteAccountOpen = $state(false);

	let settingsError = $state('');
	let settingsSaving = $state(false);
	let installHelpOpen = $state(false);

	type SettingsDraft = {
		accentColor: string;
		theme: ThemeName;
		defaultPrivacy: 'private' | 'friends' | 'community';
		allowFriendRequests: boolean;
		clearCacheOnSignOut: boolean;
		paperStyle: (typeof paperStyles)[number]['id'];
		fontSize: 'sm' | 'base' | 'lg';
		notebookStyle: NotebookStyle;
	};

	function currentSettings(): SettingsDraft {
		return {
			accentColor: profile.accentColor,
			theme: profile.theme,
			defaultPrivacy: profile.defaultPrivacy,
			allowFriendRequests: profile.allowFriendRequests,
			clearCacheOnSignOut: profile.clearCacheOnSignOut,
			paperStyle: profile.paperStyle,
			fontSize: profile.fontSize,
			notebookStyle: profile.notebookStyle
		};
	}

	let settingsDraft = $state<SettingsDraft>(currentSettings());
	let settingsSeed = '';

	// Stage changes while the Settings tab is open. Nothing is written to the
	// profile until Save settings is clicked, and re-entering the tab always
	// starts from the saved values.
	$effect(() => {
		const key = [
			nav.profileTab,
			profile.accentColor,
			profile.theme,
			profile.defaultPrivacy,
			profile.allowFriendRequests,
			profile.clearCacheOnSignOut,
			profile.paperStyle,
			profile.fontSize
		].join('|');

		if (nav.profileTab !== 'settings' || key === settingsSeed) return;
		settingsSeed = key;
		settingsDraft = currentSettings();
	});

	// Drives the sticky save bar: it only appears while the draft differs from
	// the saved preferences, so the button is always within reach when it matters.
	let settingsDirty = $derived(
		settingsDraft.accentColor !== profile.accentColor ||
			settingsDraft.theme !== profile.theme ||
			settingsDraft.defaultPrivacy !== profile.defaultPrivacy ||
			settingsDraft.allowFriendRequests !== profile.allowFriendRequests ||
			settingsDraft.clearCacheOnSignOut !== profile.clearCacheOnSignOut ||
			settingsDraft.paperStyle !== profile.paperStyle ||
			settingsDraft.fontSize !== profile.fontSize ||
			settingsDraft.notebookStyle !== profile.notebookStyle
	);

	// Compact labels shown on collapsed Appearance sections.
	let themeLabel = $derived(
		THEMES.find((theme) => theme.id === settingsDraft.theme)?.label ?? 'Classic'
	);
	let paperLabel = $derived(
		paperStyles.find((option) => option.id === settingsDraft.paperStyle)?.label ?? 'Lined'
	);
	let textLabel = $derived(
		settingsDraft.fontSize === 'sm'
			? 'Small'
			: settingsDraft.fontSize === 'lg'
				? 'Large'
				: 'Default'
	);
	let notebookLabel = $derived(
		notebookStyles.find((option) => option.id === settingsDraft.notebookStyle)?.label ?? 'Scrapbook'
	);

	let totalPages = $derived(
		Object.values(journal.entries).filter(
			(entry) => entry.saved || entry.title || entry.mind || entry.videoPath
		).length
	);

	let streak = $derived(journal.streak.current);

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
		if (streak >= 30) {
			earned.push({
				id: 'month-streak',
				label: 'Month of Pages',
				description: 'Thirty days in a row without missing a page.',
				icon: 'flame',
				tone: 'gold'
			});
		}
		if (streak >= 100) {
			earned.push({
				id: 'hundred-day-streak',
				label: '100-Day Streak',
				description: 'One hundred days of showing up for yourself.',
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

	function finishRemove() {
		if (confirmRemove === 'avatar') {
			editAvatar = '';
			avatarFile = null;
		} else if (confirmRemove === 'banner') {
			editBanner = '';
			bannerFile = null;
		}
		confirmRemove = null;
	}

	async function saveEdits(event: SubmitEvent) {
		event.preventDefault();
		if (editSaving) return;
		editError = '';

		const usernameError = validateUsername(editUsername);
		if (usernameError) {
			editError = usernameError;
			return;
		}

		editSaving = true;

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

	function applySettings(draft: SettingsDraft) {
		profile.accentColor = draft.accentColor;
		profile.theme = draft.theme;
		profile.defaultPrivacy = draft.defaultPrivacy;
		profile.allowFriendRequests = draft.allowFriendRequests;
		profile.clearCacheOnSignOut = draft.clearCacheOnSignOut;
		profile.paperStyle = draft.paperStyle;
		profile.fontSize = draft.fontSize;
		profile.notebookStyle = draft.notebookStyle;
		journal.setPaper(draft.paperStyle);
	}

	async function saveSettings() {
		if (settingsSaving) return;
		settingsSaving = true;
		settingsError = '';

		// Keep the previously saved values so a failed request can be rolled
		// back locally instead of leaving the draft looking like it was saved.
		const previous = currentSettings();
		applySettings(settingsDraft);

		const result = await profile.savePreferences();
		settingsSaving = false;
		if (result.error) {
			applySettings(previous);
			settingsError = result.error;
			journal.toast('Could not save settings');
			return;
		}
		journal.toast('Settings saved');
	}

	function discardSettings() {
		settingsDraft = currentSettings();
		settingsError = '';
		journal.toast('Settings changes discarded');
	}

	function resetSettings() {
		settingsDraft = {
			accentColor: DEFAULT_PREFERENCES.accentColor,
			theme: DEFAULT_PREFERENCES.theme,
			defaultPrivacy: DEFAULT_PREFERENCES.defaultPrivacy,
			allowFriendRequests: DEFAULT_PREFERENCES.allowFriendRequests,
			clearCacheOnSignOut: DEFAULT_PREFERENCES.clearCacheOnSignOut,
			paperStyle: DEFAULT_PREFERENCES.paperStyle,
			fontSize: DEFAULT_PREFERENCES.fontSize,
			notebookStyle: DEFAULT_PREFERENCES.notebookStyle
		};
		settingsError = '';
		journal.toast('Defaults restored — save to apply');
	}

	async function installApp() {
		if (pwa.canInstall) {
			const outcome = await pwa.promptInstall();
			if (outcome === 'accepted') journal.toast('VidJo installed');
			else if (outcome === 'unavailable') installHelpOpen = true;
			return;
		}
		installHelpOpen = !installHelpOpen;
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

	async function deleteAccount(confirmText: string) {
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
</script>

<div class="mx-auto w-full max-w-[1240px] px-4 py-6 min-[900px]:px-6">
	<!-- ── Profile hero ── -->
	<div
		class="relative overflow-hidden rounded-[24px] border border-cover-edge shadow-[0_28px_70px_rgba(0,0,0,.5)] min-[720px]:rounded-[32px]"
	>
		<div class="relative h-32 min-[480px]:h-40 min-[720px]:h-52">
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
			<div
				class="absolute top-3 right-3 flex flex-wrap gap-1.5 min-[480px]:top-4 min-[480px]:right-4 min-[720px]:top-5 min-[720px]:right-5 min-[720px]:gap-2"
			>
				<Button size="sm" variant="outline" icon="pen" onclick={() => setTab('edit')}>
					Edit profile
				</Button>
				<Button size="sm" variant="outline" icon="settings" onclick={() => setTab('settings')}>
					Settings
				</Button>
			</div>
			<div
				class="absolute -bottom-12 left-1/2 flex -translate-x-1/2 flex-col items-center min-[480px]:-bottom-14 min-[720px]:-bottom-16"
			>
				<Avatar
					src={profile.avatarUrl}
					name={profile.displayName}
					className="size-24 min-[480px]:size-28 min-[720px]:size-32"
					textClass="text-4xl min-[720px]:text-5xl"
					ring="border-4 border-book-accent/60 shadow-[0_20px_40px_rgba(0,0,0,.45)]"
				/>
			</div>
		</div>

		<div
			class="bg-desk-2 px-4 pt-16 pb-6 text-center min-[480px]:px-6 min-[720px]:px-10 min-[720px]:pt-20 min-[720px]:pb-8"
		>
			<h1
				class="font-display text-2xl font-bold text-book-bg min-[480px]:text-3xl min-[720px]:text-4xl"
			>
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
				<p
					class="mx-auto mt-3 max-w-[560px] font-hand text-base text-book-bg/90 min-[720px]:mt-4 min-[720px]:text-lg"
				>
					“{profile.bio}”
				</p>
			{:else}
				<p
					class="mx-auto mt-3 max-w-[560px] font-hand text-base text-book-bg/65 min-[720px]:mt-4 min-[720px]:text-lg"
				>
					Small videos, big thoughts.
				</p>
			{/if}

			<div class="mt-4 flex flex-wrap items-center justify-center gap-2 min-[720px]:mt-5">
				<span
					class="rounded-full bg-cover/35 px-3 py-1 font-mono text-xs font-bold tracking-wider text-book-accent tabular-nums"
				>
					{profile.friendCode}
				</span>
				<button
					type="button"
					class="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg transition-colors hover:bg-cover/50"
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

			<div
				class="mt-5 grid grid-cols-2 gap-2 min-[480px]:gap-3 min-[640px]:grid-cols-4 min-[720px]:mt-6"
			>
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3 min-[720px]:p-4">
					<p class="font-display text-xl font-bold text-book-bg tabular-nums min-[720px]:text-2xl">
						{totalPages}
					</p>
					<p class="font-ui text-[11px] text-book-bg/65 min-[720px]:text-xs">Pages written</p>
				</div>
				<div class="rounded-2xl border border-book-accent/40 bg-book-accent/10 p-3 min-[720px]:p-4">
					<p
						class="flex items-center justify-center gap-1.5 font-display text-xl font-bold text-book-accent tabular-nums min-[720px]:text-2xl"
					>
						<CommunityIcon name="flame" size={18} />
						{streak}
					</p>
					<p class="font-ui text-[11px] text-book-bg/65 min-[720px]:text-xs">
						Day streak{journal.streak.longest > streak ? ` · best ${journal.streak.longest}` : ''}
					</p>
				</div>
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3 min-[720px]:p-4">
					<p
						class="font-display text-xl font-bold text-[#8BE2A4] tabular-nums min-[720px]:text-2xl"
					>
						{friends.friendCount}
					</p>
					<p class="font-ui text-[11px] text-book-bg/65 min-[720px]:text-xs">Friends</p>
				</div>
				<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3 min-[720px]:p-4">
					<p
						class="font-display text-xl font-bold text-book-bg/70 tabular-nums min-[720px]:text-2xl"
					>
						{badges.length}
					</p>
					<p class="font-ui text-[11px] text-book-bg/65 min-[720px]:text-xs">Badges</p>
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
					{#if tab.id === 'settings' && settingsDirty}
						<span
							class="size-1.5 rounded-full bg-gold"
							title="Unsaved settings"
							aria-label="Unsaved settings"
						></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	{#if nav.profileTab === 'settings' && settingsDirty}
		<div
			use:portal
			class="fixed right-4 bottom-4 z-[80] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-book-accent/50 bg-desk/95 p-4 shadow-[0_16px_44px_rgba(0,0,0,.55)] backdrop-blur-lg"
			role="region"
			aria-label="Unsaved settings"
		>
			<div class="flex items-start gap-2.5">
				<span
					class="flex size-8 shrink-0 items-center justify-center rounded-full bg-book-accent/20 text-book-accent"
					aria-hidden="true"
				>
					<CommunityIcon name="pen" size={15} />
				</span>
				<div>
					<p class="font-ui text-sm font-bold">Unsaved changes</p>
					<p class="font-ui text-[11px] text-book-bg/65">Save to apply them to your journal.</p>
				</div>
			</div>
			<div class="mt-3 flex items-center gap-2">
				<Button class="flex-1" size="sm" variant="outline" onclick={discardSettings}>
					Discard
				</Button>
				<Button
					class="flex-1"
					size="sm"
					icon="check"
					loading={settingsSaving}
					onclick={saveSettings}
				>
					Save settings
				</Button>
			</div>
		</div>
	{/if}

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
						class="inline-flex min-h-9 items-center font-ui text-xs font-semibold text-book-accent hover:underline"
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
					<ProfileBadgeList badges={badges.slice(0, 3)} layout="pills" />
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
						class="inline-flex min-h-9 items-center font-ui text-xs font-semibold text-book-accent hover:underline"
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
				<ProfileBadgeList {badges} />
			{/if}
		</div>
	{:else if nav.profileTab === 'settings'}
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)] lg:col-span-2"
			>
				<div class="flex flex-wrap items-center justify-between gap-4">
					<div class="max-w-[560px]">
						<h2 class="font-display text-xl font-bold">Install VidJo</h2>
						<p class="mt-1 font-ui text-sm text-book-bg/65">
							Add VidJo to your home screen for a full-screen journal that opens without the
							browser, and keeps saved pages available offline.
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if pwa.installed}
							<span
								class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#3F7A4F]/60 bg-[#3F7A4F]/20 px-4 font-ui text-sm font-bold text-[#9BE0AC]"
							>
								<CommunityIcon name="check" size={15} />
								Installed
							</span>
						{:else}
							<Button
								icon={pwa.canInstall ? 'rocket' : 'settings'}
								onclick={() => void installApp()}
							>
								{pwa.canInstall ? 'Install VidJo' : 'How to install'}
							</Button>
						{/if}
						{#if pwa.showUpdateCard}
							<Button variant="outline" icon="refresh" onclick={() => pwa.applyUpdate()}>
								Update app
							</Button>
						{/if}
					</div>
				</div>
				{#if installHelpOpen && !pwa.installed}
					<div
						class="mt-4 rounded-xl border border-cover-edge bg-cover/20 p-4 font-ui text-xs leading-relaxed text-book-bg/75"
					>
						{#if pwa.showIosHint}
							<p>
								On iPhone or iPad, tap <b class="text-book-bg">Share</b> in Safari, then
								<b class="text-book-bg">Add to Home Screen</b>.
							</p>
						{:else}
							<p>
								Open your browser menu and choose <b class="text-book-bg">Install app</b> or
								<b class="text-book-bg">Add to Home Screen</b>. Chrome and Edge also show an install
								icon in the address bar.
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)] lg:col-span-2"
			>
				<div class="flex flex-wrap items-center justify-between gap-4">
					<div class="max-w-[620px]">
						<div class="flex items-center gap-2.5">
							<span
								class="flex size-9 items-center justify-center rounded-xl bg-[#1DB954]/18 text-[#1ED760] shadow-[0_8px_20px_rgba(29,185,84,.12)]"
							>
								<CommunityIcon name="spotify" size={18} />
							</span>
							<h2 class="font-display text-xl font-bold">Music &amp; Spotify</h2>
						</div>
						<p class="mt-2 font-ui text-sm text-book-bg/65">
							Connect your Spotify Premium account to search tracks and listen inside VidJo while
							you write, browse, and reflect. The mini-player follows your journal theme and keeps
							playing across views.
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if spotify.connected}
							<Button variant="outline" icon="headphones" onclick={() => spotify.openPanel()}>
								Open player
							</Button>
							<Button variant="outline" onclick={() => void spotify.disconnect()}>
								Disconnect
							</Button>
						{:else if !spotify.connectionKnown}
							<button
								type="button"
								class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1DB954]/70 px-4 font-ui text-sm font-bold text-[#062012] shadow-[0_10px_24px_rgba(29,185,84,.16)] disabled:cursor-not-allowed disabled:opacity-70"
								disabled
							>
								<CommunityIcon name="refresh" size={16} class="animate-spin" />
								Checking Spotify…
							</button>
						{:else}
							<button
								type="button"
								class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 font-ui text-sm font-bold text-[#062012] shadow-[0_10px_24px_rgba(29,185,84,.24)] transition-all hover:bg-[#1ED760] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
								onclick={() => void spotify.connect()}
								disabled={!spotify.configured}
							>
								<CommunityIcon name="spotify" size={16} />
								Connect Spotify
							</button>
						{/if}
					</div>
				</div>

				<div class="mt-4 grid gap-3 min-[720px]:grid-cols-[1.2fr_.8fr]">
					<div
						class="rounded-2xl border border-cover-edge bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-cover)_45%,transparent),color-mix(in_srgb,var(--color-desk)_75%,transparent))] p-4"
					>
						{#if spotify.connected}
							<div class="flex items-center gap-3">
								{#if spotify.accountImage}
									<img
										src={spotify.accountImage}
										alt=""
										class="size-12 rounded-xl border border-cover-edge/70 object-cover"
									/>
								{:else}
									<div
										class="flex size-12 items-center justify-center rounded-xl border border-cover-edge/70 bg-cover/40 text-[#1ED760]"
									>
										<CommunityIcon name="spotify" size={20} />
									</div>
								{/if}
								<div class="min-w-0">
									<p class="font-ui text-sm font-bold text-book-bg">
										{spotify.accountName || 'Spotify account'} connected
									</p>
									<p class="font-ui text-xs text-book-bg/65">
										{spotify.accountProduct
											? `Plan: ${spotify.accountProduct}`
											: 'Premium account required for in-app playback'}
										{#if spotify.ready}
											· Player ready{/if}
									</p>
								</div>
								<span
									class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[#1DB954]/35 bg-[#1DB954]/12 px-2.5 py-1 font-ui text-[11px] font-semibold text-[#BFF3D1]"
								>
									<span class="size-1.5 rounded-full bg-[#1ED760]"></span>
									Connected
								</span>
							</div>
							{#if spotify.track}
								<div
									class="mt-3 flex items-center gap-3 rounded-xl border border-cover-edge/70 bg-desk/35 p-2.5"
								>
									{#if spotify.track.image}
										<img src={spotify.track.image} alt="" class="size-11 rounded-lg object-cover" />
									{:else}
										<div
											class="flex size-11 items-center justify-center rounded-lg bg-cover/40 text-book-bg/50"
										>
											<CommunityIcon name="music" size={16} />
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="truncate font-ui text-sm font-semibold">{spotify.track.name}</p>
										<p class="truncate font-ui text-[11px] text-book-bg/65">
											{spotify.track.artists || 'Now playing in VidJo'}
										</p>
									</div>
									<button
										type="button"
										class="flex size-9 items-center justify-center rounded-full bg-cta text-cta-text"
										onclick={() => void spotify.togglePlay()}
										aria-label={spotify.playing ? 'Pause' : 'Play'}
									>
										<CommunityIcon name={spotify.playing ? 'pause' : 'play'} size={14} />
									</button>
								</div>
							{:else}
								<p class="mt-3 font-ui text-xs text-book-bg/65">
									No track playing yet. Open the player to search and start listening.
								</p>
							{/if}
							{#if spotify.error}
								<p class="mt-3 font-ui text-xs font-semibold text-[#FFB4B4]">{spotify.error}</p>
							{:else if spotify.notice}
								<p class="mt-3 font-ui text-xs font-semibold text-[#BFF3D1]">{spotify.notice}</p>
							{/if}
						{:else}
							<div class="flex items-start gap-3">
								<div
									class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#1DB954]/15 text-[#1ED760]"
								>
									<CommunityIcon name="headphones" size={22} />
								</div>
								<div>
									<p class="font-ui text-sm font-semibold">Listen without leaving your journal</p>
									<p class="mt-1 font-ui text-xs leading-relaxed text-book-bg/65">
										Search songs from Spotify, play them in a persistent mini-player, and keep the
										music going as you move through pages and views.
									</p>
									<ul class="mt-2 space-y-1 font-ui text-[11px] text-book-bg/60">
										<li>• Requires a Spotify Premium account for in-app playback</li>
										<li>• Uses secure server-side token refresh (no secrets in the browser)</li>
										<li>• Theme-matched controls and mini-player</li>
									</ul>
									{#if !spotify.configured}
										<p class="mt-2 font-ui text-[11px] font-semibold text-[#FFCF8A]">
											Spotify server configuration is missing. Add credentials and redeploy.
										</p>
									{/if}
									{#if spotify.error}
										<p class="mt-2 font-ui text-[11px] font-semibold text-[#FFB4B4]">
											{spotify.error}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<div class="rounded-2xl border border-cover-edge bg-cover/15 p-4">
						<p class="font-ui text-xs font-bold tracking-wide text-book-accent uppercase">
							Quick actions
						</p>
						<div class="mt-3 grid gap-2">
							<button
								type="button"
								class="flex items-center justify-between rounded-xl bg-cover/20 px-3 py-2.5 text-left font-ui text-sm hover:bg-cover/35 disabled:opacity-50"
								onclick={() => spotify.openPanel()}
								disabled={!spotify.configured}
							>
								<span class="flex items-center gap-2"
									><CommunityIcon name="list-music" size={15} class="text-book-accent" />Search &
									play</span
								>
								<CommunityIcon name="arrow-right" size={14} class="text-book-bg/60" />
							</button>
							{#if spotify.connected}
								<button
									type="button"
									class="flex items-center justify-between rounded-xl bg-cover/20 px-3 py-2.5 text-left font-ui text-sm hover:bg-cover/35 disabled:opacity-50"
									onclick={() => void spotify.togglePlay()}
									disabled={!spotify.canControl && !spotify.track}
								>
									<span class="flex items-center gap-2"
										><CommunityIcon
											name={spotify.playing ? 'pause' : 'play'}
											size={15}
											class="text-book-accent"
										/>{spotify.playing ? 'Pause music' : 'Resume music'}</span
									>
									<CommunityIcon name="arrow-right" size={14} class="text-book-bg/60" />
								</button>
							{:else}
								<button
									type="button"
									class="flex items-center justify-between rounded-xl bg-cover/20 px-3 py-2.5 text-left font-ui text-sm hover:bg-cover/35 disabled:opacity-50"
									onclick={() => void spotify.connect()}
									disabled={!spotify.configured}
								>
									<span class="flex items-center gap-2"
										><CommunityIcon name="spotify" size={15} class="text-[#1ED760]" />Connect
										account</span
									>
									<CommunityIcon name="arrow-right" size={14} class="text-book-bg/60" />
								</button>
							{/if}
						</div>
						<p class="mt-3 font-ui text-[11px] leading-relaxed text-book-bg/55">
							Playback happens in the VidJo web player device. Keep this tab open while listening.
						</p>
					</div>
				</div>
			</div>

			<div
				class="rounded-[26px] border border-cover-edge bg-desk-2 p-6 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.38)]"
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="font-display text-xl font-bold">Appearance</h2>
						<p class="mt-1 font-ui text-sm text-book-bg/65">
							Your accent color follows you across the app.
						</p>
					</div>
					<Button size="sm" variant="outline" icon="refresh" onclick={resetSettings}>
						Reset to defaults
					</Button>
				</div>

				<div class="mt-5 overflow-hidden rounded-xl border border-cover-edge/60">
					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 bg-cover/15 px-4 py-3 text-left transition-colors hover:bg-cover/25"
						aria-expanded={openSections.accent}
						onclick={() => toggleSection('accent')}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span class="font-ui text-sm font-bold">Accent color</span>
							<span class="truncate font-ui text-[11px] text-book-bg/65">
								{settingsDraft.accentColor}
							</span>
						</span>
						<CommunityIcon
							name="chevron-down"
							size={15}
							class="shrink-0 transition-transform {openSections.accent ? 'rotate-180' : ''}"
						/>
					</button>
					{#if openSections.accent}
						<div class="border-t border-cover-edge/60 px-4 py-4">
							<div class="flex flex-wrap gap-2.5">
								{#each accentChoices as color (color)}
									<button
										type="button"
										class="size-10 rounded-full border-2 transition-transform hover:scale-105 {settingsDraft.accentColor ===
										color
											? 'border-book-bg'
											: 'border-transparent'}"
										style="background: {color}"
										aria-label={`Use accent color ${color}`}
										aria-pressed={settingsDraft.accentColor === color}
										onclick={() => (settingsDraft.accentColor = color)}
									></button>
								{/each}
								<label
									class="flex size-10 cursor-pointer items-center justify-center rounded-full border-2 border-cover text-book-bg/70 transition-colors hover:border-cover hover:text-book-bg"
								>
									<input
										type="color"
										class="size-0 overflow-hidden opacity-0"
										value={settingsDraft.accentColor}
										oninput={(event) => (settingsDraft.accentColor = event.currentTarget.value)}
									/>
									<CommunityIcon name="plus" size={16} />
								</label>
							</div>
							<p class="mt-3 font-ui text-[11px] leading-relaxed text-book-bg/65">
								This color is used for your default profile picture and the cursor in navigation, so
								picking one changes both.
							</p>
						</div>
					{/if}

					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 bg-cover/15 px-4 py-3 text-left transition-colors hover:bg-cover/25"
						aria-expanded={openSections.theme}
						onclick={() => toggleSection('theme')}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span class="font-ui text-sm font-bold">Journal theme</span>
							<span class="truncate font-ui text-[11px] text-book-bg/65">{themeLabel}</span>
						</span>
						<CommunityIcon
							name="chevron-down"
							size={15}
							class="shrink-0 transition-transform {openSections.theme ? 'rotate-180' : ''}"
						/>
					</button>
					{#if openSections.theme}
						<div class="border-t border-cover-edge/60 px-4 py-4">
							<div class="grid gap-2">
								{#each THEMES as theme (theme.id)}
									<button
										type="button"
										class="flex items-center justify-between rounded-xl px-4 py-3 transition-colors {settingsDraft.theme ===
										theme.id
											? 'bg-cta text-cta-text'
											: 'bg-cover/20 hover:bg-cover/35'}"
										onclick={() => (settingsDraft.theme = theme.id)}
									>
										<span class="flex items-center gap-2.5 font-ui text-sm">
											<span
												class="size-4 rounded-full ring-2 ring-book-bg/30"
												style="background: {theme.swatch}"
											></span>
											{theme.label}
										</span>
										{#if settingsDraft.theme === theme.id}
											<CommunityIcon name="check" size={16} />
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 bg-cover/15 px-4 py-3 text-left transition-colors hover:bg-cover/25"
						aria-expanded={openSections.paper}
						onclick={() => toggleSection('paper')}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span class="font-ui text-sm font-bold">Default paper style</span>
							<span class="truncate font-ui text-[11px] text-book-bg/65">{paperLabel}</span>
						</span>
						<CommunityIcon
							name="chevron-down"
							size={15}
							class="shrink-0 transition-transform {openSections.paper ? 'rotate-180' : ''}"
						/>
					</button>
					{#if openSections.paper}
						<div class="border-t border-cover-edge/60 px-4 py-4">
							<div class="grid grid-cols-2 gap-2">
								{#each paperStyles as option (option.id)}
									<button
										type="button"
										class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors {settingsDraft.paperStyle ===
										option.id
											? 'bg-cta text-cta-text'
											: 'bg-cover/20 hover:bg-cover/35'}"
										onclick={() => (settingsDraft.paperStyle = option.id)}
										aria-pressed={settingsDraft.paperStyle === option.id}
									>
										<span
											class="h-10 w-14 shrink-0 rounded-md border border-line bg-paper {option.id ===
											'lined'
												? 'paper-lined'
												: option.id === 'dotted'
													? 'paper-dotted'
													: option.id === 'grid'
														? 'paper-grid'
														: ''}"
											aria-hidden="true"
										></span>
										<span class="flex min-w-0 flex-1 items-center justify-between gap-2">
											<span class="font-ui text-sm font-semibold">{option.label}</span>
											{#if settingsDraft.paperStyle === option.id}
												<CommunityIcon name="check" size={16} />
											{/if}
										</span>
									</button>
								{/each}
							</div>
							<p class="mt-2 font-ui text-[11px] text-book-bg/65">
								Each preview shows the paper texture used on new journal pages.
							</p>
						</div>
					{/if}

					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 bg-cover/15 px-4 py-3 text-left transition-colors hover:bg-cover/25"
						aria-expanded={openSections.text}
						onclick={() => toggleSection('text')}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span class="font-ui text-sm font-bold">Text size</span>
							<span class="truncate font-ui text-[11px] text-book-bg/65">{textLabel}</span>
						</span>
						<CommunityIcon
							name="chevron-down"
							size={15}
							class="shrink-0 transition-transform {openSections.text ? 'rotate-180' : ''}"
						/>
					</button>
					{#if openSections.text}
						<div class="space-y-2 border-t border-cover-edge/60 px-4 py-4">
							<div class="flex items-center gap-4">
								<span class="font-ui text-xs text-book-bg/65">A</span>
								<select
									bind:value={settingsDraft.fontSize}
									class="rounded-lg border border-cover-edge bg-desk px-3 py-2 font-ui text-sm text-book-bg focus:border-book-accent focus:outline-none"
								>
									<option value="sm">Small</option>
									<option value="base">Default</option>
									<option value="lg">Large</option>
								</select>
								<span class="font-ui text-xs text-book-bg/65">A</span>
							</div>
							<p
								class="mt-2 rounded-lg border border-cover-edge bg-desk px-3 py-2 font-hand leading-snug text-book-bg/90"
								style:font-size={settingsDraft.fontSize === 'sm'
									? '0.95rem'
									: settingsDraft.fontSize === 'lg'
										? '1.35rem'
										: '1.1rem'}
							>
								Today felt like a page worth keeping.
							</p>
							<p class="mt-1 font-ui text-[11px] text-book-bg/65">
								The preview and your journal writing scale after you save.
							</p>
						</div>
					{/if}

					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 bg-cover/15 px-4 py-3 text-left transition-colors hover:bg-cover/25"
						aria-expanded={openSections.notebook}
						onclick={() => toggleSection('notebook')}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<span class="font-ui text-sm font-bold">Friend notebook style</span>
							<span class="truncate font-ui text-[11px] text-book-bg/65">{notebookLabel}</span>
						</span>
						<CommunityIcon
							name="chevron-down"
							size={15}
							class="shrink-0 transition-transform {openSections.notebook ? 'rotate-180' : ''}"
						/>
					</button>
					{#if openSections.notebook}
						<div class="border-t border-cover-edge/60 px-4 py-4">
							<div class="grid grid-cols-2 gap-2">
								{#each notebookStyles as option (option.id)}
									<button
										type="button"
										class="flex flex-col gap-2 rounded-xl p-2.5 text-left transition-colors {settingsDraft.notebookStyle ===
										option.id
											? 'bg-cta text-cta-text'
											: 'bg-cover/20 hover:bg-cover/35'}"
										onclick={() => (settingsDraft.notebookStyle = option.id)}
										aria-pressed={settingsDraft.notebookStyle === option.id}
									>
										<span
											class="relative block h-[72px] w-full overflow-hidden rounded-lg border border-cover-edge bg-desk"
											aria-hidden="true"
										>
											{#if option.id === 'scrapbook'}
												<span
													class="absolute inset-x-4 inset-y-2 rotate-[-2deg] rounded-sm note-scrap shadow-md"
												>
													<span
														class="absolute top-2 left-2 h-1.5 w-8 rounded-full bg-book-accent/70"
													></span>
													<span class="absolute top-5 left-2 h-1 w-[70%] rounded-full bg-line"
													></span>
													<span class="absolute top-7 left-2 h-1 w-[55%] rounded-full bg-line"
													></span>
												</span>
											{:else if option.id === 'dark'}
												<span
													class="absolute inset-x-4 inset-y-2 rounded-md border border-book-accent/60 bg-[linear-gradient(160deg,var(--color-cover),var(--color-desk))]"
												>
													<span class="absolute top-2 left-2 h-1.5 w-8 rounded-full bg-book-accent"
													></span>
													<span
														class="absolute top-5 left-2 h-1 w-[70%] rounded-full bg-book-accent/40"
													></span>
													<span
														class="absolute top-7 left-2 h-1 w-[55%] rounded-full bg-book-accent/40"
													></span>
												</span>
											{:else if option.id === 'spread'}
												<span
													class="absolute inset-x-3 inset-y-2 flex overflow-hidden rounded-sm bg-cover-edge p-0.5"
												>
													<span class="relative flex-1 note-scrap">
														<span class="absolute inset-2 rounded-sm bg-cover/50"></span>
													</span>
													<span class="relative flex-1 bg-book-bg">
														<span class="absolute top-2 left-2 h-1 w-[70%] rounded-full bg-line"
														></span>
														<span class="absolute top-4 left-2 h-1 w-[55%] rounded-full bg-line"
														></span>
														<span class="absolute top-6 left-2 h-1 w-[65%] rounded-full bg-line"
														></span>
													</span>
												</span>
											{:else}
												<span
													class="absolute top-2 left-4 h-[58px] w-[44px] rotate-[-5deg] rounded-[2px] note-scrap shadow-md"
												>
													<span
														class="absolute -top-1 left-2 h-1.5 w-5 rotate-[4deg] bg-book-accent/70"
													></span>
													<span class="absolute inset-x-1 top-1.5 h-[36px] bg-cover/60"></span>
												</span>
												<span
													class="absolute top-3 right-3 h-[46px] w-[52px] rotate-[3deg] rounded-[2px] note-scrap shadow-md"
												>
													<span class="absolute top-2 left-2 h-1 w-[70%] rounded-full bg-line"
													></span>
													<span class="absolute top-4 left-2 h-1 w-[50%] rounded-full bg-line"
													></span>
												</span>
											{/if}
										</span>
										<span class="flex items-center justify-between gap-2">
											<span class="font-ui text-sm font-semibold">{option.label}</span>
											{#if settingsDraft.notebookStyle === option.id}
												<CommunityIcon name="check" size={16} />
											{/if}
										</span>
										<span class="-mt-1.5 font-ui text-[11px] opacity-75">{option.hint}</span>
									</button>
								{/each}
							</div>
							<p class="mt-2 font-ui text-[11px] text-book-bg/65">
								Changes how a friend's pages look when you open their notebook.
							</p>
						</div>
					{/if}
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
							bind:value={settingsDraft.defaultPrivacy}
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
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {settingsDraft.allowFriendRequests
								? 'bg-[#3F7A4F] text-book-bg'
								: 'bg-cover/50 text-book-bg/80'}"
							onclick={() =>
								(settingsDraft.allowFriendRequests = !settingsDraft.allowFriendRequests)}
						>
							{settingsDraft.allowFriendRequests ? 'Enabled' : 'Disabled'}
						</button>
					</div>
					<div class="flex items-center justify-between gap-3 rounded-xl bg-cover/20 p-4">
						<div>
							<p class="font-ui text-sm font-semibold">Clear cache on sign out</p>
							<p class="font-ui text-xs text-book-bg/65">Remove local pages from shared devices</p>
						</div>
						<button
							type="button"
							class="rounded-full px-4 py-1.5 font-ui text-xs font-semibold transition-colors {settingsDraft.clearCacheOnSignOut
								? 'bg-[#3F7A4F] text-book-bg'
								: 'bg-cover/50 text-book-bg/80'}"
							onclick={() =>
								(settingsDraft.clearCacheOnSignOut = !settingsDraft.clearCacheOnSignOut)}
						>
							{settingsDraft.clearCacheOnSignOut ? 'Enabled' : 'Disabled'}
						</button>
					</div>
					<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cover/20 p-4">
						<div class="min-w-0">
							<p class="font-ui text-sm font-semibold">Message notifications</p>
							<p class="font-ui text-xs text-book-bg/65">
								{#if !notifications.supported}
									This browser does not support notifications.
								{:else if notifications.permission === 'denied'}
									Blocked in your browser settings. Allow notifications for this site there first.
								{:else if !notifications.granted}
									Get a notification when a friend sends you a message.
								{:else if notifications.pushEnabled}
									On — including when VidJo is closed.
								{:else}
									On while VidJo is open. Background alerts need push configured by the admin.
								{/if}
							</p>
							{#if notifications.error}
								<p class="mt-1 font-ui text-[11px] font-semibold text-[#FF9B9B]">
									{notifications.error}
								</p>
							{/if}
						</div>
						{#if notifications.supported && notifications.permission !== 'denied'}
							{#if notifications.granted}
								<Button
									variant="outline"
									loading={notifications.busy}
									onclick={() => void notifications.disable()}
								>
									Turn off
								</Button>
							{:else}
								<Button loading={notifications.busy} onclick={() => void notifications.enable()}>
									Turn on
								</Button>
							{/if}
						{/if}
					</div>
				</div>

				{#if settingsError}
					<p class="mt-3 font-ui text-xs font-semibold text-[#FF9B9B]">{settingsError}</p>
				{/if}

				<Button class="mt-5 w-full" loading={settingsSaving} onclick={saveSettings}>
					Save settings
				</Button>
				<p class="mt-2 text-center font-ui text-[11px] text-book-bg/65">
					Changes apply after you save.
				</p>
				<Button class="mt-2 w-full" variant="outline" icon="refresh" onclick={clearCache}>
					Clear local journal cache
				</Button>

				<div class="mt-6 space-y-2 border-t border-cover-edge pt-6">
					<Button class="w-full" variant="outline" icon="upload" onclick={exportJournal}>
						Export journal data
					</Button>
					<Button
						class="w-full"
						variant="danger"
						icon="trash"
						onclick={() => (deleteAccountOpen = true)}
					>
						Delete my account
					</Button>
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
								maxlength={USERNAME_MAX}
								autocomplete="username"
								placeholder="rice_shower"
								class="h-11 w-full rounded-xl border border-cover-edge bg-desk pr-3.5 pl-8 font-ui text-sm text-book-bg placeholder:text-book-bg/45 focus:border-book-accent/60 focus:outline-none"
							/>
						</div>
						<span class="font-ui text-[11px] text-book-bg/65"
							>2–{USERNAME_MAX} characters. Letters, numbers, dots, dashes, underscores.</span
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
								onclick={() => (confirmRemove = 'avatar')}
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
								onclick={() => (confirmRemove = 'banner')}
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

	<ConfirmModal
		open={confirmRemove !== null}
		title={confirmRemove === 'avatar' ? 'Remove profile photo?' : 'Remove banner?'}
		message={confirmRemove === 'avatar'
			? 'Your current profile photo will be cleared. You can upload a new one any time.'
			: 'Your current banner will be cleared. You can upload a new one any time.'}
		confirmLabel="Remove"
		onConfirm={finishRemove}
		onCancel={() => (confirmRemove = null)}
	/>

	<PromptModal
		open={deleteAccountOpen}
		title="Delete your account?"
		message="This removes your journal, pages, and profile for good. It cannot be undone."
		placeholder="Type DELETE"
		confirmLabel="Delete my account"
		requiredPhrase="DELETE"
		tone="danger"
		icon="trash"
		maxLength={6}
		onConfirm={(value) => {
			deleteAccountOpen = false;
			void deleteAccount(value);
		}}
		onCancel={() => (deleteAccountOpen = false)}
	/>
</div>
