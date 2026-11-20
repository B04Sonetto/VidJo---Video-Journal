<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Book from '#lib/components/Book.svelte';
	import CalendarModal from '#lib/components/CalendarModal.svelte';
	import CommunityView from '#lib/components/CommunityView.svelte';
	import FriendsView from '#lib/components/FriendsView.svelte';
	import Header from '#lib/components/Header.svelte';
	import LoginScreen from '#lib/components/LoginScreen.svelte';
	import ModerationNotice from '#lib/components/ModerationNotice.svelte';
	import NotificationsView from '#lib/components/NotificationsView.svelte';
	import ProfilePage from '#lib/components/ProfilePage.svelte';
	import StickerTray from '#lib/components/StickerTray.svelte';
	import Toast from '#lib/components/Toast.svelte';
	import { track } from '#lib/analytics';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { moderation } from '#lib/state/moderation.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import { supabase } from '#lib/supabase';
	import { isPlaceholderUsername, USERNAME_MAX, validateUsername } from '#lib/username';

	let calendarOpen = $state(false);
	let activeOwner = $state('');
	let profileReady = $state(false);
	let initSeq = 0;

	// Profile completion after OAuth sign-in (e.g. Google new-user flow).
	let profileCompletion = $state(false);
	let completionEmail = $state('');
	let completionUsername = $state('');
	let completionNickname = $state('');
	let completionBusy = $state(false);
	let completionError = $state('');

	onMount(() => {
		const cleanupViewport = viewport.init();
		void auth.init();

		// Spotify OAuth returns to this route after a full page load. Restore
		// the tab the user was on when they pressed Connect, then tidy the URL.
		const params = new URL(window.location.href).searchParams;
		let restored = false;
		const view = params.get('vj_view');
		if (
			view === 'journal' ||
			view === 'friends' ||
			view === 'community' ||
			view === 'profile' ||
			view === 'notifications'
		) {
			nav.setView(view);
			restored = true;
		}
		const friendsTab = params.get('vj_friends_tab');
		if (friendsTab === 'shelf' || friendsTab === 'messages') {
			nav.setFriendsTab(friendsTab);
			restored = true;
		}
		const profileTab = params.get('vj_profile_tab');
		if (
			profileTab === 'overview' ||
			profileTab === 'portfolio' ||
			profileTab === 'achievements' ||
			profileTab === 'settings' ||
			profileTab === 'edit'
		) {
			nav.profileTab = profileTab;
			restored = true;
		}
		if (restored) {
			const current = new URL(window.location.href);
			for (const key of ['vj_view', 'vj_friends_tab', 'vj_profile_tab'])
				current.searchParams.delete(key);
			history.replaceState(
				history.state,
				'',
				`${current.pathname}${current.search}${current.hash}`
			);
		}

		return () => {
			cleanupViewport();
			auth.destroy();
		};
	});

	$effect(() => {
		if (auth.ready && auth.passwordRecovery) {
			auth.passwordRecovery = false;
			void goto(resolve('/auth/reset'), { replaceState: true });
		}
	});

	$effect(() => {
		if (!auth.ready) return;

		if (!auth.active) {
			activeOwner = '';
			profileReady = false;
			initSeq += 1;
			moderation.reset();
			friends.reset();
			messages.reset();
			community.reset();
			return;
		}

		const ownerId = auth.ownerId;
		if (!ownerId || ownerId === activeOwner) return;

		activeOwner = ownerId;
		profileReady = false;
		const seq = ++initSeq;
		moderation.reset();

		void (async () => {
			// Banned members can still read their status through a SECURITY
			// DEFINER RPC, but their journal and profile are blocked by RLS.
			await moderation.init();
			if (seq !== initSeq || moderation.banned) return;

			// Load preferences first so the first blank page is created with the
			// saved default privacy instead of always starting as private.
			await profile.init(ownerId);
			if (seq !== initSeq) return;
			journal.defaultPrivacy = profile.defaultPrivacy;

			await journal.init(ownerId, auth.signedIn);
			if (seq !== initSeq) return;
			journal.setPaper(profile.paperStyle);
			profileReady = true;
			await Promise.all([friends.init(ownerId), community.init(ownerId), messages.init(ownerId)]);
		})();
	});

	// One session event per app load, then one event per view change. The
	// payload contains only the view name, never journal content.
	let analyticsSession = $state(false);
	let analyticsView = $state('');

	$effect(() => {
		if (!auth.active) {
			analyticsSession = false;
			analyticsView = '';
			return;
		}

		const view = nav.view;
		if (!analyticsSession) {
			analyticsSession = true;
			analyticsView = view;
			track('session_start', { view });
			return;
		}

		if (view === analyticsView) return;
		analyticsView = view;
		track('view_changed', { view });
	});

	// After the profile loads, detect accounts that have no profile row or only a
	// placeholder username and prompt them to finish their profile. This is the
	// only place a Google/OAuth account gets a real username.
	$effect(() => {
		if (!auth.active || !profileReady || profileCompletion) return;
		const username = (profile.profile?.username || '').trim();
		const needsCompletion = !profile.profile || !username || isPlaceholderUsername(username);
		if (!needsCompletion) return;

		profileCompletion = true;
		completionEmail = auth.email || '';
		completionUsername = isPlaceholderUsername(username) ? '' : username;
		completionNickname = profile.profile?.display_name || '';
	});

	async function completeProfile() {
		completionError = '';
		const cleanUsername = completionUsername.trim();
		const usernameError = validateUsername(cleanUsername);
		if (usernameError) {
			completionError = usernameError;
			return;
		}
		if (isPlaceholderUsername(cleanUsername)) {
			completionError = 'Choose your own username — the automatic one is just a placeholder.';
			return;
		}
		if (!completionNickname.trim()) {
			completionError = 'Nickname cannot be empty.';
			return;
		}
		if (completionNickname.trim().length > 32) {
			completionError = 'Nickname must be 32 characters or fewer.';
			return;
		}

		completionBusy = true;
		try {
			const result = await profile.saveProfile({
				username: cleanUsername,
				display_name: completionNickname.trim(),
				bio: profile.profile?.bio ?? '',
				avatar_url: profile.avatarUrl,
				banner_url: profile.bannerUrl
			});
			if (result.error) {
				completionError = result.error;
				return;
			}
			// Mark as registered in user_metadata so isRegisteredUser() and
			// vidjo_is_member() see it on the next auth state change.
			await supabaseAuthUpdateUser();
			profileCompletion = false;
			void goto(resolve('/'), { replaceState: true });
		} catch {
			completionError = 'Could not complete your profile. Try again.';
		} finally {
			completionBusy = false;
		}
	}

	async function supabaseAuthUpdateUser() {
		await supabase.auth.updateUser({
			data: { vidjo_registered: true }
		});
	}

	// Saved appearance preferences apply globally.
	$effect(() => {
		document.documentElement.style.setProperty('--color-accent', profile.accentColor);
	});

	$effect(() => {
		document.documentElement.dataset.theme = profile.theme;
	});

	$effect(() => {
		document.documentElement.dataset.textSize = profile.fontSize;
	});

	// New pages start with the privacy chosen in Profile → Settings.
	$effect(() => {
		journal.defaultPrivacy = profile.defaultPrivacy;
	});
</script>

<svelte:head>
	<title>VidJo │ Journal</title>
	<meta
		name="description"
		content="A video journal for students: record a small video, write how you feel, and decorate the page."
	/>
</svelte:head>

{#if !auth.ready}
	<main>
		<div class="mx-auto flex max-w-[1240px] items-center justify-center py-24">
			<div
				class="rounded-3xl bg-paper px-10 py-14 text-center font-hand text-ink shadow-[0_30px_60px_rgba(0,0,0,.45)]"
			>
				<p class="font-display text-3xl font-bold">Opening your journal…</p>
				<p class="mt-2 text-ink-soft">Checking your session.</p>
			</div>
		</div>
	</main>
{:else if !auth.active}
	<LoginScreen />
{:else if moderation.checking || !moderation.ready}
	<main>
		<div class="mx-auto flex max-w-[1240px] items-center justify-center py-24">
			<div
				class="rounded-3xl bg-paper px-10 py-14 text-center font-hand text-ink shadow-[0_30px_60px_rgba(0,0,0,.45)]"
			>
				<p class="font-display text-3xl font-bold">Checking your account…</p>
				<p class="mt-2 text-ink-soft">Making sure everything is in order.</p>
			</div>
		</div>
	</main>
{:else if moderation.banned}
	<!-- ModerationNotice renders the suspension screen above the app shell. -->
	<div class="min-h-[100dvh]" aria-hidden="true"></div>
{:else if profileCompletion}
	<main
		class="mx-auto flex min-h-[100dvh] w-full max-w-[620px] items-center justify-center px-4 py-10 min-[420px]:px-6"
	>
		<div
			class="w-full rounded-[26px] border border-cover-edge bg-paper px-7 py-10 text-center text-ink shadow-[0_30px_80px_rgba(0,0,0,.55)] min-[420px]:px-10"
		>
			<h1 class="font-display text-3xl font-bold">Finish setting up VidJo</h1>
			<p class="mt-2 font-hand text-xl leading-snug text-ink-soft">
				Almost there - tell us how you'd like to appear to friends.
			</p>

			{#if completionError}
				<p
					class="mt-4 rounded-xl border-[1.5px] border-danger/50 bg-danger/10 px-3 py-2 font-ui text-sm text-danger"
				>
					{completionError}
				</p>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					void completeProfile();
				}}
				class="mt-6 space-y-4"
				novalidate
			>
				<label
					for="completion-email"
					class="block text-left font-ui text-[13px] font-bold text-ink"
				>
					Email address
				</label>
				<input
					id="completion-email"
					type="email"
					value={completionEmail}
					disabled
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors"
					readonly
				/>

				<label
					for="completion-username"
					class="mt-4 block text-left font-ui text-[13px] font-bold text-ink"
				>
					Username
				</label>
				<input
					id="completion-username"
					bind:value={completionUsername}
					type="text"
					placeholder="e.g. mara"
					maxlength={USERNAME_MAX}
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
					autocomplete="username"
				/>
				<p class="mt-1 font-ui text-[11px] text-ink-soft">
					Unique name for your journal, friends, and community (2–{USERNAME_MAX} characters).
				</p>

				<label
					for="completion-nickname"
					class="mt-4 block text-left font-ui text-[13px] font-bold text-ink"
				>
					Nickname <span class="text-xs font-normal text-ink-soft">(shown to friends)</span>
				</label>
				<input
					id="completion-nickname"
					bind:value={completionNickname}
					type="text"
					placeholder="e.g. Rice Shower"
					maxlength="32"
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
					autocomplete="nickname"
				/>
				<p class="mt-1 font-ui text-[11px] text-ink-soft">
					Your nickname can be anything. Your @username stays unique.
				</p>

				<button
					type="submit"
					class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-ui text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(42,27,61,.3)] transition-colors hover:bg-accent-strong disabled:cursor-wait disabled:opacity-70"
					disabled={completionBusy}
				>
					{#if completionBusy}
						Creating account…
					{:else}
						Create account
					{/if}
				</button>
			</form>

			<p class="mt-6 font-ui text-[12px] leading-relaxed text-ink-soft">
				Your email ({completionEmail}) was used from your Google account.
			</p>
		</div>
	</main>
{:else}
	<Header onCalendar={() => (calendarOpen = true)} />

	<main>
		{#if nav.view === 'friends'}
			<FriendsView />
		{:else if nav.view === 'community'}
			<CommunityView />
		{:else if nav.view === 'notifications'}
			<NotificationsView />
		{:else if nav.view === 'profile'}
			<ProfilePage />
		{:else if journal.ready}
			<Book />
			<StickerTray />
		{:else}
			<div class="mx-auto flex max-w-[1240px] items-center justify-center py-24">
				<div
					class="rounded-3xl bg-paper px-10 py-14 text-center font-hand text-ink shadow-[0_30px_60px_rgba(0,0,0,.45)]"
				>
					<p class="font-display text-3xl font-bold">Opening your journal…</p>
					<p class="mt-2 text-ink-soft">Dusting off the pages.</p>
				</div>
			</div>
		{/if}
	</main>

	<!-- Reserve space for the fixed mobile bottom navigation. -->
	<div
		class="h-[calc(env(safe-area-inset-bottom)+72px)] min-[900px]:hidden"
		aria-hidden="true"
	></div>

	<CalendarModal open={calendarOpen} onClose={() => (calendarOpen = false)} />
{/if}

<ModerationNotice />
<Toast />
