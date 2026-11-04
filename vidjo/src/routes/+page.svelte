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
	import ProfilePage from '#lib/components/ProfilePage.svelte';
	import StickerTray from '#lib/components/StickerTray.svelte';
	import Toast from '#lib/components/Toast.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import { supabase } from '#lib/supabase';

	let calendarOpen = $state(false);
	let activeOwner = $state('');
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
			initSeq += 1;
			friends.reset();
			community.reset();
			return;
		}

		const ownerId = auth.ownerId;
		if (!ownerId || ownerId === activeOwner) return;

		activeOwner = ownerId;
		const seq = ++initSeq;

		void (async () => {
			await journal.init(ownerId, auth.signedIn);
			await profile.init(ownerId);
			if (seq !== initSeq) return;
			await Promise.all([friends.init(ownerId), community.init(ownerId)]);
		})();
	});

	// After the profile loads, detect the placeholder username created for
	// OAuth accounts and prompt the user to finish their profile.
	$effect(() => {
		if (!auth.active || !profile.profile || profileCompletion) return;
		const username = (profile.profile.username || '').trim();
		const generated = generatedUsername();
		if (generated && username.toLowerCase() === generated.toLowerCase()) {
			profileCompletion = true;
			completionEmail = auth.email || '';
			completionUsername = username;
			completionNickname = profile.profile.display_name || '';
		}
	});

	/** The placeholder username the database trigger assigns to OAuth accounts. */
	function generatedUsername() {
		const userId = auth.user?.id ?? '';
		return userId ? `user_${userId.slice(0, 8)}` : '';
	}

	async function completeProfile() {
		completionError = '';
		const cleanUsername = completionUsername.trim();
		if (!cleanUsername || !/^[a-zA-Z0-9_.-]{2,24}$/.test(cleanUsername)) {
			completionError = 'Username must be 2–24 letters, numbers, dots, dashes, or underscores.';
			return;
		}
		const generated = generatedUsername();
		if (generated && cleanUsername.toLowerCase() === generated.toLowerCase()) {
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
				avatar_url: profile.profile?.avatar_url ?? null,
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
{:else if profileCompletion}
	<main
		class="mx-auto flex min-h-[100dvh] w-full max-w-[620px] items-center justify-center px-4 py-10 min-[420px]:px-6"
	>
		<div
			class="w-full rounded-[26px] border border-[#4A3670] bg-paper px-7 py-10 text-center text-ink shadow-[0_30px_80px_rgba(0,0,0,.55)] min-[420px]:px-10"
		>
			<h1 class="font-display text-3xl font-bold">Finish setting up VidJo</h1>
			<p class="mt-2 font-hand text-xl leading-snug text-ink-soft">
				Almost there — tell us how you'd like to appear to friends.
			</p>

			{#if completionError}
				<p
					class="mt-4 rounded-xl border-[1.5px] border-[#D19A9A] bg-[#FBEAEA] px-3 py-2 font-ui text-sm text-[#8A2F2F]"
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
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-[#FFFDF6] px-3.5 font-ui text-base text-ink transition-colors"
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
					maxlength="24"
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-[#FFFDF6] px-3.5 font-ui text-base text-ink transition-colors placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
					autocomplete="username"
				/>
				<p class="mt-1 font-ui text-[11px] text-ink-soft">
					Unique name for your journal, friends, and community.
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
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-[#FFFDF6] px-3.5 font-ui text-base text-ink transition-colors placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
					autocomplete="nickname"
				/>
				<p class="mt-1 font-ui text-[11px] text-ink-soft">
					Your nickname can be anything. Your @username stays unique.
				</p>

				<button
					type="submit"
					class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-ui text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(42,27,61,.3)] transition-colors hover:bg-[#624690] disabled:cursor-wait disabled:opacity-70"
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

	<CalendarModal open={calendarOpen} onClose={() => (calendarOpen = false)} />
{/if}

<Toast />
