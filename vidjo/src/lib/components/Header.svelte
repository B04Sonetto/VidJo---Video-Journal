<script lang="ts">
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { TODAY } from '#lib/dates';
	import { isSupabaseConfigured } from '#lib/supabase';
	import Avatar from '#lib/components/Avatar.svelte';

	let { onCalendar }: { onCalendar: () => void } = $props();

	let menuOpen = $state(false);

	$effect(() => {
		document.documentElement.setAttribute('data-theme', profile.theme);
	});

	async function signOut() {
		menuOpen = false;
		const owner = auth.ownerId;
		if (profile.clearCacheOnSignOut && owner) {
			journal.clearLocalCache(owner);
		}
		await auth.signOut();
		journal.reset();
		friends.reset();
		community.reset();
		profile.reset();
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

	<nav
		class="flex items-center gap-1 rounded-full border border-[#5A4580]/60 bg-[#2A1B3F]/80 p-1 shadow-[0_8px_24px_rgba(0,0,0,.25)] backdrop-blur-sm"
		aria-label="Main"
	>
		<button
			type="button"
			class="group relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-all {nav.view ===
			'journal'
				? 'bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'journal' ? 'page' : undefined}
			onclick={() => nav.setView('journal')}
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
				class="transition-transform group-hover:scale-105"
				aria-hidden="true"
			>
				<path
					d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
				></path>
			</svg>
			<span>Journal</span>
		</button>
		<button
			type="button"
			class="group flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] text-[#D6CBEC] transition-all hover:bg-white/[.08] hover:text-white"
			onclick={onCalendar}
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
				class="transition-transform group-hover:scale-105"
				aria-hidden="true"
			>
				<rect width="18" height="18" x="3" y="4" rx="2" ry="2"></rect>
				<line x1="16" x2="16" y1="2" y2="6"></line>
				<line x1="8" x2="8" y1="2" y2="6"></line>
				<line x1="3" x2="21" y1="10" y2="10"></line>
			</svg>
			<span>Calendar</span>
		</button>
		<button
			type="button"
			class="group relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-all {nav.view ===
			'friends'
				? 'bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'friends' ? 'page' : undefined}
			onclick={() => nav.setView('friends')}
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
				class="transition-transform group-hover:scale-105"
				aria-hidden="true"
			>
				<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
				<circle cx="9" cy="7" r="4"></circle>
				<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
				<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
			</svg>
			<span>Friends</span>
			{#if friends.pendingCount > 0}
				<span
					class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-[#2A1B3F] shadow-[0_0_0_2px_#2A1B3F]"
				>
					{friends.pendingCount}
				</span>
			{/if}
		</button>
		<button
			type="button"
			class="group relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-all {nav.view ===
			'community'
				? 'bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'community' ? 'page' : undefined}
			onclick={() => nav.setView('community')}
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
				class="transition-transform group-hover:scale-105"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10"></circle>
				<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
				<path d="M2 12h20"></path>
			</svg>
			<span>Community</span>
		</button>
	</nav>

	<button
		type="button"
		class="group inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/60 bg-[linear-gradient(135deg,rgba(212,162,76,0.22),rgba(81,57,122,0.35))] px-[18px] font-ui text-[15px] font-semibold text-[#FFFDF6] shadow-[0_4px_18px_rgba(212,162,76,0.18)] transition-all hover:scale-[1.02] hover:border-gold hover:bg-[linear-gradient(135deg,rgba(212,162,76,0.32),rgba(81,57,122,0.45))] hover:shadow-[0_6px_22px_rgba(212,162,76,0.28)] active:scale-[0.98]"
		onclick={() => nav.jump(TODAY)}
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="currentColor"
			class="text-gold transition-transform group-hover:scale-110"
			aria-hidden="true"
		>
			<path
				d="M12 2L13.09 8.26L19 6L14.74 10.74L21 12L14.74 13.26L19 18L13.09 15.74L12 22L10.91 15.74L5 18L9.26 13.26L3 12L9.26 10.74L5 6L10.91 8.26L12 2Z"
			></path>
		</svg>
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
				<Avatar
					src={profile.avatarUrl}
					name={profile.displayName}
					className="size-[38px]"
					textClass="text-lg"
					ring="shadow-[0_0_0_2px_var(--color-gold)]"
				/>
				<div class="hidden max-w-[130px] flex-col min-[1080px]:flex">
					<span class="truncate font-ui text-sm leading-tight font-semibold text-white">
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
							nav.openProfile('overview');
						}}
					>
						<Avatar
							src={profile.avatarUrl}
							name={profile.displayName}
							className="size-11"
							textClass="text-xl"
							ring="ring-2 ring-gold/50"
						/>
						<div class="min-w-0 flex-1">
							<b class="block truncate font-display text-base leading-tight"
								>{profile.displayName}</b
							>
							<span class="block truncate font-ui text-xs font-semibold text-accent"
								>@{profile.username}</span
							>
							<span class="block truncate font-ui text-[11px] text-ink-soft">{auth.email}</span>
						</div>
					</button>

					<div class="mt-2 grid grid-cols-2 gap-2">
						<button
							type="button"
							class="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent/10 px-3 font-ui text-xs font-bold text-accent transition-colors hover:bg-accent/20"
							onclick={() => {
								menuOpen = false;
								nav.openProfile('overview');
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
								<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
								<circle cx="12" cy="7" r="4"></circle>
							</svg>
							Profile
						</button>
						<button
							type="button"
							class="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent/10 px-3 font-ui text-xs font-bold text-accent transition-colors hover:bg-accent/20"
							onclick={() => {
								menuOpen = false;
								nav.openProfile('settings');
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
								<circle cx="12" cy="12" r="3"></circle>
								<path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
								></path>
							</svg>
							Settings
						</button>
					</div>

					<div class="mt-3">
						<p class="mb-2 block font-ui text-[11px] font-bold tracking-wider text-[#9B8CB5] uppercase">
							Theme
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class={`px-3 py-1.5 rounded-lg text-[11px] font-display font-bold transition-all ${
									profile.theme === 'classic'
										? 'bg-[#51397A] text-white shadow-xs'
										: 'bg-white/10 text-[#D6CBEC] border border-[#4D366D]/40 hover:bg-white/20'
								}`}
								onclick={() => {
									profile.theme = 'classic';
									menuOpen = false;
								}}
								aria-pressed={profile.theme === 'classic'}
							>
								Classic
							</button>
							<button
								type="button"
								class={`px-3 py-1.5 rounded-lg text-[11px] font-display font-bold transition-all ${
									profile.theme === 'sunset'
										? 'bg-[#B85C43] text-white shadow-xs'
										: 'bg-white/10 text-[#D6CBEC] border border-[#4D366D]/40 hover:bg-white/20'
								}`}
								onclick={() => {
									profile.theme = 'sunset';
									menuOpen = false;
								}}
								aria-pressed={profile.theme === 'sunset'}
							>
								Sunset
							</button>
							<button
								type="button"
								class={`px-3 py-1.5 rounded-lg text-[11px] font-display font-bold transition-all ${
									profile.theme === 'midnight'
										? 'bg-[#1F3557] text-white shadow-xs'
										: 'bg-white/10 text-[#D6CBEC] border border-[#4D366D]/40 hover:bg-white/20'
								}`}
								onclick={() => {
									profile.theme = 'midnight';
									menuOpen = false;
								}}
								aria-pressed={profile.theme === 'midnight'}
							>
								Midnight
							</button>
						</div>
					</div>

					<button
						type="button"
						class="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#CDBBE9] bg-light px-4 font-ui text-xs font-bold text-accent transition-colors hover:bg-[#E8DCF8]"
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
			onclick={() => nav.openProfile('overview')}
			title="View your profile"
		>
			{profile.initials}
		</button>
	{/if}
</header>

<!-- Mobile Bottom Navigation -->
<nav
	class="fixed right-0 bottom-0 left-0 z-40 mx-auto flex max-w-[480px] items-center justify-around rounded-t-3xl border border-x-[#5A4580]/40 border-t-[#5A4580]/60 bg-[#1C142B]/95 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+6px)] shadow-[0_-16px_40px_rgba(0,0,0,.45)] backdrop-blur-lg min-[900px]:hidden"
	aria-label="Mobile navigation"
>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-all {nav.view ===
		'journal'
			? 'text-white'
			: 'text-[#BBA8E0]'}"
		onclick={() => nav.setView('journal')}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path
				d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
			></path>
		</svg>
		<span class="font-ui text-[10px] font-semibold">Journal</span>
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[#BBA8E0] transition-all"
		onclick={onCalendar}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<rect width="18" height="18" x="3" y="4" rx="2" ry="2"></rect>
			<line x1="16" x2="16" y1="2" y2="6"></line>
			<line x1="8" x2="8" y1="2" y2="6"></line>
			<line x1="3" x2="21" y1="10" y2="10"></line>
		</svg>
		<span class="font-ui text-[10px] font-semibold">Calendar</span>
	</button>
	<button
		type="button"
		class="relative flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-all {nav.view ===
		'friends'
			? 'text-white'
			: 'text-[#BBA8E0]'}"
		onclick={() => nav.setView('friends')}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
			<circle cx="9" cy="7" r="4"></circle>
			<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
			<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
		</svg>
		<span class="font-ui text-[10px] font-semibold">Friends</span>
		{#if friends.pendingCount > 0}
			<span
				class="absolute -top-0.5 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#2A1B3F]"
			>
				{friends.pendingCount}
			</span>
		{/if}
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-all {nav.view ===
		'community'
			? 'text-white'
			: 'text-[#BBA8E0]'}"
		onclick={() => nav.setView('community')}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10"></circle>
			<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
			<path d="M2 12h20"></path>
		</svg>
		<span class="font-ui text-[10px] font-semibold">Community</span>
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-all {nav.view ===
		'profile'
			? 'text-white'
			: 'text-[#BBA8E0]'}"
		onclick={() => nav.openProfile('overview')}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
			<circle cx="12" cy="7" r="4"></circle>
		</svg>
		<span class="font-ui text-[10px] font-semibold">Profile</span>
	</button>
</nav>
<div class="h-20 min-[900px]:hidden"></div>
