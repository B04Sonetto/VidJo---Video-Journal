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

	let calendarOpen = $state(false);
	let activeOwner = $state('');
	let initSeq = 0;

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

	// Saved appearance preferences apply globally.
	$effect(() => {
		document.documentElement.style.setProperty('--color-accent', profile.accentColor);
	});

	$effect(() => {
		document.documentElement.dataset.theme = profile.theme;
	});
</script>

<svelte:head>
	<title>VidJo Journal — small videos, big thoughts</title>
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
