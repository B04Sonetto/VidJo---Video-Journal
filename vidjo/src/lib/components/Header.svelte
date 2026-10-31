<script lang="ts">
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { TODAY } from '#lib/dates';
	import { isSupabaseConfigured } from '#lib/supabase';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import SocialModal from '#lib/components/SocialModal.svelte';

	let { onCalendar }: { onCalendar: () => void } = $props();

	let menuOpen = $state(false);
	let profileOpen = $state(false);
	let socialOpen = $state(false);
	let socialTab = $state<'friends' | 'community'>('friends');
	let clearCacheOnSignOut = $state(false);

	function openSocial(tab: 'friends' | 'community') {
		socialTab = tab;
		socialOpen = true;
	}

	async function signOut() {
		menuOpen = false;
		const owner = auth.ownerId;
		if (clearCacheOnSignOut && owner) {
			journal.clearLocalCache(owner);
		}
		await auth.signOut();
		journal.reset();
	}
</script>

<svelte:window
	onclick={(event) => {
		if (!menuOpen) return;
		const target = event.target as Element | null;
		if (!target?.closest('[data-account-menu]')) menuOpen = false;
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') menuOpen = false;
	}}
/>

<header class="mx-auto flex max-w-[1240px] flex-wrap items-center gap-5 py-4">
	<button
		type="button"
		class="mr-auto flex items-center gap-2.5 text-left font-display text-[28px] font-bold text-white transition-opacity hover:opacity-90 min-[900px]:text-[32px]"
		onclick={() => nav.setView('journal')}
		title="Go to Journal"
	>
		<svg width="34" height="40" viewBox="0 0 44 52" aria-hidden="true" class="shrink-0">
			<path d="M30 6a20 20 0 100 40 17 17 0 01-8-20 17 17 0 018-20z" fill="#E8C9A0"></path>
			<path d="M38 12l1.4 3.6 3.6 1.4-3.6 1.4L38 22l-1.4-3.6L33 17l3.6-1.4z" fill="#D4A24C"></path>
		</svg>
		<div>
			VidJo
			<small class="mt-0.5 block font-ui text-xs font-normal tracking-[.02em] text-[#BBA8E0]">
				Small videos, big thoughts.
			</small>
		</div>
	</button>

	<nav class="flex flex-wrap gap-1" aria-label="Main">
		<button
			type="button"
			class="flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 font-ui text-[15px] transition-colors {nav.view === 'journal' ? 'bg-white/10 font-semibold text-white shadow-inner' : 'text-[#D6CBEC] hover:bg-white/[.07] hover:text-white'}"
			aria-current={nav.view === 'journal' ? 'page' : undefined}
			onclick={() => nav.setView('journal')}
		>
			Journal
		</button>
		<button
			type="button"
			class="flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 font-ui text-[15px] text-[#D6CBEC] transition-colors hover:bg-white/[.07] hover:text-white"
			onclick={onCalendar}
		>
			Calendar
		</button>
		<button
			type="button"
			class="flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 font-ui text-[15px] transition-colors {nav.view === 'friends' ? 'bg-white/10 font-semibold text-white shadow-inner' : 'text-[#D6CBEC] hover:bg-white/[.07] hover:text-white'}"
			aria-current={nav.view === 'friends' ? 'page' : undefined}
			onclick={() => nav.setView('friends')}
		>
			<span>Friends</span>
			<span class="rounded-full bg-lav/20 px-1.5 py-0.2 font-ui text-[10px] text-lav">New</span>
		</button>
		<button
			type="button"
			class="flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 font-ui text-[15px] text-[#D6CBEC] transition-colors hover:bg-white/[.07] hover:text-white"
			onclick={() => openSocial('community')}
		>
			<span>Community</span>
			<span class="rounded-full bg-gold/20 px-1.5 py-0.2 font-ui text-[10px] text-gold">Soon</span>
		</button>
	</nav>

	<button
		type="button"
		class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/60 bg-[linear-gradient(135deg,rgba(212,162,76,0.18),rgba(81,57,122,0.3))] px-[18px] font-ui text-[15px] font-semibold text-[#FFFDF6] shadow-[0_2px_10px_rgba(212,162,76,0.15)] transition-all hover:border-gold hover:bg-[linear-gradient(135deg,rgba(212,162,76,0.28),rgba(81,57,122,0.4))] hover:shadow-[0_4px_16px_rgba(212,162,76,0.25)] active:scale-[0.98]"
		onclick={() => nav.jump(TODAY)}
	>
		<span class="text-base text-gold" aria-hidden="true">✦</span>
		Today's page
	</button>

	{#if isSupabaseConfigured}
		<div class="relative" data-account-menu>
			<button
				type="button"
				class="flex min-h-11 items-center gap-2 rounded-full border border-[#5A4580] bg-[#33224D] p-1 pr-3 text-left transition-colors hover:bg-[#43306A]"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-label={`Account menu for ${profile.displayName}`}
				onclick={() => (menuOpen = !menuOpen)}
			>
				{#if profile.avatarUrl}
					<img
						src={profile.avatarUrl}
						alt=""
						class="size-[38px] rounded-full object-cover shadow-[0_0_0_2px_var(--color-gold)]"
					/>
				{:else}
					<span
						class="flex size-[38px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-lg font-bold text-white shadow-[0_0_0_2px_var(--color-gold)]"
						aria-hidden="true"
					>
						{profile.initials}
					</span>
				{/if}
				<div class="hidden max-w-[130px] flex-col min-[1080px]:flex">
					<span class="truncate font-ui text-sm font-semibold text-white leading-tight">
						{profile.displayName}
					</span>
					<span class="truncate font-ui text-[11px] text-[#C9B8E8]">
						@{profile.username}
					</span>
				</div>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-[#BBA8E0] transition-transform {menuOpen ? 'rotate-180' : ''}"
					aria-hidden="true"
				>
					<path d="M6 9l6 6 6-6"></path>
				</svg>
			</button>

			{#if menuOpen}
				<div
					class="absolute top-[calc(100%+10px)] right-0 z-50 w-[min(300px,calc(100vw-32px))] rounded-2xl border border-line bg-paper p-4 text-ink shadow-[0_18px_40px_rgba(0,0,0,.45)]"
					role="menu"
					aria-label="Account"
				>
					<!-- Clickable user summary card -> opens Profile -->
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-light"
						onclick={() => {
							menuOpen = false;
							profileOpen = true;
						}}
					>
						{#if profile.avatarUrl}
							<img src={profile.avatarUrl} alt="" class="size-11 rounded-full object-cover ring-2 ring-gold/50" />
						{:else}
							<span
								class="flex size-11 flex-none items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white ring-2 ring-gold/50"
								aria-hidden="true"
							>
								{profile.initials}
							</span>
						{/if}
						<div class="min-w-0 flex-1">
							<b class="block truncate font-display text-base leading-tight">{profile.displayName}</b>
							<span class="block truncate font-ui text-xs font-semibold text-accent">@{profile.username}</span>
							<span class="block truncate font-ui text-[11px] text-ink-soft">{auth.email}</span>
						</div>
					</button>

					<!-- View & Edit Profile Button -->
					<button
						type="button"
						class="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent/10 px-3 font-ui text-xs font-bold text-accent transition-colors hover:bg-accent/20"
						onclick={() => {
							menuOpen = false;
							profileOpen = true;
						}}
					>
						<svg
							width="15"
							height="15"
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
						View & Edit Profile
					</button>

					<div class="my-3 h-px bg-line"></div>

					<div class="flex items-center justify-between gap-3 font-ui text-xs text-ink-soft">
						<span>
							{journal.syncing
								? 'Saving your page…'
								: journal.remote
									? 'Synced to Supabase'
									: 'Saved on this device'}
						</span>
						<span
							class="size-2.5 flex-none rounded-full {journal.remote ? 'bg-[#3F7A4F]' : 'bg-gold'}"
							aria-hidden="true"
						></span>
					</div>

					<!-- Shared computer checkbox on signout -->
					<label class="mt-3 flex cursor-pointer items-start gap-2 font-ui text-[11px] text-ink-soft">
						<input
							type="checkbox"
							bind:checked={clearCacheOnSignOut}
							class="mt-0.5 rounded border-line text-accent"
						/>
						<span>Clear cached pages on sign out (recommended on shared browsers)</span>
					</label>

					<button
						type="button"
						class="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#CDBBE9] bg-light px-4 font-ui text-xs font-bold text-accent transition-colors hover:bg-[#E8DCF8]"
						role="menuitem"
						onclick={signOut}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"></path>
						</svg>
						Sign out
					</button>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Offline / Device-only profile pill -->
		<button
			type="button"
			class="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-lg font-bold text-white shadow-[0_0_0_2px_var(--color-gold)] transition-transform hover:scale-105"
			onclick={() => (profileOpen = true)}
			title="View your profile"
		>
			{profile.initials}
		</button>
	{/if}
</header>

<ProfileModal open={profileOpen} onClose={() => (profileOpen = false)} />
<SocialModal open={socialOpen} tab={socialTab} onClose={() => (socialOpen = false)} />
