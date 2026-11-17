<script lang="ts">
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { TODAY } from '#lib/dates';
	import { isSupabaseConfigured, supabase } from '#lib/supabase';
	import Avatar from '#lib/components/Avatar.svelte';
	import AdminPanel from '#lib/components/AdminPanel.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let { onCalendar }: { onCalendar: () => void } = $props();

	let menuOpen = $state(false);
	let adminOpen = $state(false);
	let newReports = $state(0);

	$effect(() => {
		document.documentElement.setAttribute('data-theme', profile.theme);
	});

	function isAdmin() {
		return (profile.profile?.user_role ?? '').trim().toLowerCase() === 'admin';
	}

	/** Badge on the account button so admins notice new reports without opening the console. */
	async function loadReportBadge() {
		if (!isSupabaseConfigured || !isAdmin()) {
			newReports = 0;
			return;
		}

		try {
			const { data, error } = await supabase.rpc('vidjo_admin_overview', { days: 30 });
			if (!error && data) {
				const overview = data as { reports_new?: number };
				newReports = Number(overview.reports_new ?? 0) || 0;
				return;
			}

			// Older schema without the admin RPC: the select policy still lets an
			// admin count report rows directly.
			const { count } = await supabase
				.from('vidjo_comment_reports')
				.select('*', { count: 'exact', head: true });
			newReports = count ?? 0;
		} catch {
			newReports = 0;
		}
	}

	$effect(() => {
		if (!isAdmin()) {
			newReports = 0;
			return;
		}
		void loadReportBadge();
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
		class="hidden items-center gap-1 rounded-full border border-[#5A4580]/60 bg-[#2A1B3F]/80 p-1 shadow-[0_8px_24px_rgba(0,0,0,.25)] backdrop-blur-sm min-[900px]:flex"
		aria-label="Main"
	>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'journal'
				? 'bg-white/15 font-semibold text-white'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'journal' ? 'page' : undefined}
			onclick={() => nav.setView('journal')}
		>
			<CommunityIcon name="book" size={16} />
			<span>Journal</span>
		</button>
		<button
			type="button"
			class="flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] text-[#D6CBEC] transition-colors hover:bg-white/[.08] hover:text-white"
			onclick={onCalendar}
		>
			<CommunityIcon name="calendar" size={16} />
			<span>Calendar</span>
		</button>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'friends'
				? 'bg-white/15 font-semibold text-white'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'friends' ? 'page' : undefined}
			onclick={() => nav.setView('friends')}
		>
			<CommunityIcon name="users" size={16} />
			<span>Friends</span>
			{#if friends.pendingCount > 0}
				<span
					class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 font-ui text-[10px] font-bold text-[#2A1B3F] tabular-nums shadow-[0_0_0_2px_#2A1B3F]"
				>
					{friends.pendingCount}
				</span>
			{/if}
		</button>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'community'
				? 'bg-white/15 font-semibold text-white'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'community' ? 'page' : undefined}
			onclick={() => nav.setView('community')}
		>
			<CommunityIcon name="globe" size={16} />
			<span>Community</span>
		</button>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'notifications'
				? 'bg-white/15 font-semibold text-white'
				: 'text-[#D6CBEC] hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'notifications' ? 'page' : undefined}
			aria-label={`Notifications${friends.unreadCount > 0 ? `, ${friends.unreadCount} unread` : ''}`}
			onclick={() => nav.setView('notifications')}
		>
			<CommunityIcon name="bell" size={16} />
			{#if friends.unreadCount > 0}
				<span
					class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 font-ui text-[10px] font-bold text-white tabular-nums shadow-[0_0_0_2px_#2A1B3F]"
				>
					{friends.unreadCount > 9 ? '9+' : friends.unreadCount}
				</span>
			{/if}
		</button>
	</nav>

	<button
		type="button"
		class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cta px-[18px] font-ui text-[15px] font-bold text-cta-text shadow-[0_6px_18px_var(--color-cta-shadow)] transition-all hover:bg-cta-hover hover:shadow-[0_8px_22px_var(--color-cta-shadow)] active:scale-[.98]"
		onclick={() => nav.jump(TODAY)}
	>
		<CommunityIcon name="plus" size={16} />
		Today's page
	</button>

	{#if isSupabaseConfigured}
		<div class="relative" data-account-menu>
			<button
				type="button"
				class="relative flex min-h-11 items-center gap-2 rounded-full border border-[#5A4580] bg-[#33224D] p-1 pr-3 text-left transition-colors hover:bg-[#43306A]"
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
				{#if newReports > 0}
					<span
						class="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[#33224D] bg-[#D9534F] px-1 font-ui text-[9px] font-bold text-white tabular-nums"
						aria-label={`${newReports} new ${newReports === 1 ? 'report' : 'reports'}`}
						title={`${newReports} new ${newReports === 1 ? 'report' : 'reports'}`}
					>
						{newReports > 9 ? '9+' : newReports}
					</span>
				{/if}
				<div class="hidden max-w-[130px] flex-col min-[1080px]:flex">
					<span class="truncate font-ui text-sm leading-tight font-semibold text-white">
						{profile.displayName}
					</span>
					<span class="truncate font-ui text-[11px] text-[#C9B8E8]">
						@{profile.username}
					</span>
				</div>
				<CommunityIcon
					name="chevron-down"
					size={15}
					class="text-[#BBA8E0] transition-transform {menuOpen ? 'rotate-180' : ''}"
				/>
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
							<CommunityIcon name="user" size={15} />
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
							<CommunityIcon name="settings" size={15} />
							Settings
						</button>
						{#if isAdmin()}
							<button
								type="button"
								class="flex min-h-10 items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#CDBBE9] bg-light px-4 font-ui text-xs font-bold text-accent transition-colors hover:bg-[#E8DCF8]"
								onclick={() => {
									menuOpen = false;
									adminOpen = true;
								}}
							>
								<CommunityIcon name="shield" size={15} />
								Admin
							</button>
						{/if}
					</div>

					<div class="mt-3">
						<p class="mb-2 block font-ui text-[11px] font-semibold text-ink-soft">Theme</p>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class={`rounded-lg px-3 py-1.5 font-display text-[11px] font-bold transition-all ${
									profile.theme === 'classic'
										? 'bg-[#51397A] text-white shadow-xs'
										: 'border border-[#4D366D]/40 bg-white/10 text-[#D6CBEC] hover:bg-white/20'
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
								class={`rounded-lg px-3 py-1.5 font-display text-[11px] font-bold transition-all ${
									profile.theme === 'sunset'
										? 'bg-[#B85C43] text-white shadow-xs'
										: 'border border-[#4D366D]/40 bg-white/10 text-[#D6CBEC] hover:bg-white/20'
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
								class={`rounded-lg px-3 py-1.5 font-display text-[11px] font-bold transition-all ${
									profile.theme === 'midnight'
										? 'bg-[#1F3557] text-white shadow-xs'
										: 'border border-[#4D366D]/40 bg-white/10 text-[#D6CBEC] hover:bg-white/20'
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
						<CommunityIcon name="logout" size={16} />
						Sign out
					</button>
				</div>
			{/if}
			{#if adminOpen}
				<AdminPanel bind:open={adminOpen} />
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
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors {nav.view ===
		'journal'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-[#BBA8E0] hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'journal' ? 'page' : undefined}
		onclick={() => nav.setView('journal')}
	>
		<CommunityIcon name="book" size={20} />
		<span class="font-ui text-[10px] font-semibold">Journal</span>
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[#BBA8E0] transition-colors hover:bg-white/[.07] hover:text-white"
		onclick={onCalendar}
	>
		<CommunityIcon name="calendar" size={20} />
		<span class="font-ui text-[10px] font-semibold">Calendar</span>
	</button>
	<button
		type="button"
		class="relative flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors {nav.view ===
		'friends'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-[#BBA8E0] hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'friends' ? 'page' : undefined}
		onclick={() => nav.setView('friends')}
	>
		<CommunityIcon name="users" size={20} />
		<span class="font-ui text-[10px] font-semibold">Friends</span>
		{#if friends.pendingCount > 0}
			<span
				class="absolute -top-0.5 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-ui text-[9px] font-bold text-[#2A1B3F] tabular-nums"
			>
				{friends.pendingCount}
			</span>
		{/if}
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors {nav.view ===
		'community'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-[#BBA8E0] hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'community' ? 'page' : undefined}
		onclick={() => nav.setView('community')}
	>
		<CommunityIcon name="globe" size={20} />
		<span class="font-ui text-[10px] font-semibold">Community</span>
	</button>
	<button
		type="button"
		class="relative flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors {nav.view ===
		'notifications'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-[#BBA8E0] hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'notifications' ? 'page' : undefined}
		aria-label={`Notifications${friends.unreadCount > 0 ? `, ${friends.unreadCount} unread` : ''}`}
		onclick={() => nav.setView('notifications')}
	>
		<CommunityIcon name="bell" size={20} />
		<span class="font-ui text-[10px] font-semibold">Alerts</span>
		{#if friends.unreadCount > 0}
			<span
				class="absolute -top-0.5 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-ui text-[9px] font-bold text-white tabular-nums"
			>
				{friends.unreadCount > 9 ? '9+' : friends.unreadCount}
			</span>
		{/if}
	</button>
	<button
		type="button"
		class="flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 transition-colors {nav.view ===
		'profile'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-[#BBA8E0] hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'profile' ? 'page' : undefined}
		onclick={() => nav.openProfile('overview')}
	>
		<CommunityIcon name="user" size={20} />
		<span class="font-ui text-[10px] font-semibold">Profile</span>
	</button>
</nav>
