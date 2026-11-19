<script lang="ts">
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { community } from '#lib/state/community.svelte';
	import { spotify } from '#lib/state/spotify.svelte';
	import { todayKey } from '#lib/dates';
	import { isSupabaseConfigured, supabase } from '#lib/supabase';
	import Avatar from '#lib/components/Avatar.svelte';
	import AdminPanel from '#lib/components/AdminPanel.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { THEMES } from '#lib/themes';

	let { onCalendar }: { onCalendar: () => void } = $props();

	let menuOpen = $state(false);
	let adminOpen = $state(false);
	let newReports = $state(0);

	const friendsBadge = $derived(friends.pendingCount + messages.unreadTotal);
	const friendsBadgeLabel = $derived(
		[
			friends.pendingCount > 0
				? `${friends.pendingCount} pending friend ${friends.pendingCount === 1 ? 'request' : 'requests'}`
				: '',
			messages.unreadTotal > 0
				? `${messages.unreadTotal} unread ${messages.unreadTotal === 1 ? 'message' : 'messages'}`
				: ''
		]
			.filter(Boolean)
			.join(', ')
	);
	/** Alerts (bell on desktop, Alerts on mobile) now includes unread messages too. */
	const alertsBadge = $derived(friends.unreadCount + messages.unreadTotal);
	const alertsBadgeLabel = $derived(
		[
			friends.unreadCount > 0
				? `${friends.unreadCount} unread ${friends.unreadCount === 1 ? 'notification' : 'notifications'}`
				: '',
			messages.unreadTotal > 0
				? `${messages.unreadTotal} unread ${messages.unreadTotal === 1 ? 'message' : 'messages'}`
				: ''
		]
			.filter(Boolean)
			.join(', ')
	);

	$effect(() => {
		document.documentElement.setAttribute('data-theme', profile.theme);
	});

	function isAdmin() {
		return (profile.profile?.user_role ?? '').trim().toLowerCase() === 'admin';
	}

	function reportsSeenKey() {
		return `vidjo-admin-reports-seen:v2:${auth.ownerId || 'local'}`;
	}

	/**
	 * The newest report timestamp the admin has already reviewed. Stored as an
	 * ISO string from the database so it can be compared with `created_at`
	 * without depending on the browser clock.
	 */
	function readReportsSeen(): number {
		try {
			const raw = localStorage.getItem(reportsSeenKey()) ?? '';
			const parsed = Date.parse(raw);
			return Number.isFinite(parsed) ? parsed : 0;
		} catch {
			return 0;
		}
	}

	async function fetchReportTimes(): Promise<number[]> {
		const { data, error } = await supabase
			.from('vidjo_comment_reports')
			.select('created_at')
			.order('created_at', { ascending: false })
			.limit(200);

		if (!error && data) {
			return data
				.map((row) => Date.parse((row as { created_at?: string }).created_at ?? ''))
				.filter((at) => Number.isFinite(at));
		}

		// Older schema without the direct policy: the admin RPC still returns
		// timestamps, so the badge stays clearable.
		const { data: rpcData, error: rpcError } = await supabase.rpc('vidjo_admin_list_reports', {
			max_rows: 200
		});
		if (rpcError || !Array.isArray(rpcData)) return [];

		return (rpcData as { created_at?: string }[])
			.map((row) => Date.parse(row.created_at ?? ''))
			.filter((at) => Number.isFinite(at));
	}

	/** Clear the badge when an admin opens the console. */
	async function markReportsSeen() {
		newReports = 0;

		try {
			const times = await fetchReportTimes();
			if (times.length === 0) return;
			const newest = new Date(Math.max(...times)).toISOString();
			localStorage.setItem(reportsSeenKey(), newest);
		} catch {
			// Ignore storage access errors.
		}
	}

	/** Badge on the account button so admins notice new reports without opening the console. */
	async function loadReportBadge() {
		if (!isSupabaseConfigured || !isAdmin()) {
			newReports = 0;
			return;
		}

		const seen = readReportsSeen();

		try {
			// Count reports that arrived after the admin last reviewed the console.
			const times = await fetchReportTimes();
			newReports = times.filter((at) => at > seen).length;
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

	function openFriends() {
		nav.setFriendsTab('shelf');
		nav.setView('friends');
	}

	async function signOut() {
		menuOpen = false;
		const owner = auth.ownerId;
		if (profile.clearCacheOnSignOut && owner) {
			journal.clearLocalCache(owner);
		}
		await auth.signOut();
		journal.reset();
		friends.reset();
		messages.reset();
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

<header
	class="mx-auto flex max-w-[1240px] flex-nowrap items-center gap-3 py-3 min-[900px]:flex-wrap min-[900px]:gap-5 min-[900px]:py-4"
>
	<button
		type="button"
		class="mr-auto flex min-w-0 items-center gap-2 text-left font-display text-[24px] font-bold text-white transition-opacity hover:opacity-90 min-[480px]:gap-2.5 min-[900px]:text-[32px]"
		onclick={() => nav.setView('journal')}
		title="Go to Journal"
	>
		<svg
			width="30"
			height="36"
			viewBox="0 0 44 52"
			aria-hidden="true"
			class="h-9 w-[27px] shrink-0 min-[900px]:h-10 min-[900px]:w-[34px]"
		>
			<path d="M30 6a20 20 0 100 40 17 17 0 01-8-20 17 17 0 018-20z" fill="#E8C9A0"></path>
			<path d="M38 12l1.4 3.6 3.6 1.4-3.6 1.4L38 22l-1.4-3.6L33 17l3.6-1.4z" fill="#D4A24C"></path>
		</svg>
		<div class="min-w-0">
			VidJo
			<small
				class="mt-0.5 hidden font-ui text-[10px] font-normal tracking-[.02em] text-lav/80 min-[400px]:block min-[900px]:text-xs"
			>
				Small videos, big thoughts.
			</small>
		</div>
	</button>

	<nav
		class="hidden items-center gap-1 rounded-full border border-cover-edge/60 bg-desk-2/80 p-1 shadow-[0_8px_24px_rgba(0,0,0,.25)] backdrop-blur-sm min-[900px]:flex"
		aria-label="Main"
	>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'journal'
				? 'bg-white/15 font-semibold text-white'
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'journal' ? 'page' : undefined}
			onclick={() => nav.setView('journal')}
		>
			<CommunityIcon name="book" size={16} />
			<span>Journal</span>
		</button>
		<button
			type="button"
			class="flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] text-lav transition-colors hover:bg-white/[.08] hover:text-white"
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
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'friends' ? 'page' : undefined}
			aria-label={`Friends${friendsBadgeLabel ? `, ${friendsBadgeLabel}` : ''}`}
			onclick={openFriends}
		>
			<CommunityIcon name="users" size={16} />
			<span>Friends</span>
			{#if friendsBadge > 0}
				<span
					class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 font-ui text-[10px] font-bold text-desk tabular-nums shadow-[0_0_0_2px_var(--color-desk)]"
				>
					{friendsBadge > 9 ? '9+' : friendsBadge}
				</span>
			{/if}
		</button>
		<button
			type="button"
			class="relative flex min-h-10 items-center gap-2 rounded-full px-4 py-2 font-ui text-[14px] transition-colors {nav.view ===
			'community'
				? 'bg-white/15 font-semibold text-white'
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
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
				: 'text-lav hover:bg-white/[.08] hover:text-white'}"
			aria-current={nav.view === 'notifications' ? 'page' : undefined}
			aria-label={`Notifications${alertsBadgeLabel ? `, ${alertsBadgeLabel}` : ''}`}
			onclick={() => nav.setView('notifications')}
		>
			<CommunityIcon name="bell" size={16} />
			{#if alertsBadge > 0}
				<span
					class="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 font-ui text-[10px] font-bold text-white tabular-nums shadow-[0_0_0_2px_var(--color-desk)]"
				>
					{alertsBadge > 9 ? '9+' : alertsBadge}
				</span>
			{/if}
		</button>
	</nav>

	<button
		type="button"
		class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-cta px-3 font-ui text-[13px] font-bold text-cta-text shadow-[0_6px_18px_var(--color-cta-shadow)] transition-all hover:bg-cta-hover hover:shadow-[0_8px_22px_var(--color-cta-shadow)] active:scale-[.98] min-[480px]:min-h-11 min-[480px]:gap-2 min-[480px]:px-[18px] min-[480px]:text-[15px]"
		onclick={() => nav.jump(todayKey())}
	>
		<CommunityIcon name="plus" size={16} />
		<span class="min-[480px]:hidden">Today</span>
		<span class="hidden min-[480px]:inline">Today's page</span>
	</button>

	<button
		type="button"
		class="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-cover-edge bg-desk-2/80 text-lav shadow-[0_6px_16px_rgba(0,0,0,.2)] transition-all hover:border-book-accent/50 hover:bg-cover/35 hover:text-book-bg active:scale-[.98] min-[480px]:size-11 {spotify.playing
			? 'border-[#1DB954]/50 text-[#1ED760]'
			: ''}"
		onclick={() => spotify.togglePanel()}
		aria-label={spotify.connected ? 'Open music player' : 'Connect and play music with Spotify'}
		title={spotify.playing && spotify.track ? `Playing: ${spotify.track.name}` : 'Music'}
	>
		<CommunityIcon name={spotify.playing ? 'headphones' : 'spotify'} size={18} />
		{#if spotify.connected}
			<span
				class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-desk {spotify.playing
					? 'bg-[#1DB954] shadow-[0_0_0_3px_rgba(29,185,84,.18)]'
					: 'bg-book-accent'}"
				aria-hidden="true"
			></span>
		{/if}
	</button>

	{#if isSupabaseConfigured}
		<div class="relative" data-account-menu>
			<button
				type="button"
				class="relative flex min-h-10 items-center gap-2 rounded-full border border-cover-edge bg-cover/25 p-1 pr-1.5 text-left transition-colors hover:bg-cover/40 min-[480px]:min-h-11 min-[480px]:pr-3"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-label={`Account menu for ${profile.displayName}`}
				onclick={() => {
					menuOpen = !menuOpen;
					if (menuOpen && isAdmin()) void loadReportBadge();
				}}
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
						class="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-desk-2 bg-danger px-1 font-ui text-[9px] font-bold text-book-bg tabular-nums"
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
					<span class="truncate font-ui text-[11px] text-lav">
						@{profile.username}
					</span>
				</div>
				<CommunityIcon
					name="chevron-down"
					size={15}
					class="text-lav/80 transition-transform {menuOpen ? 'rotate-180' : ''}"
				/>
			</button>

			{#if menuOpen}
				<div
					class="absolute top-[calc(100%+10px)] right-0 z-50 w-[min(330px,calc(100vw-32px))] overflow-hidden rounded-[24px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_22px_50px_rgba(0,0,0,.55)]"
					role="menu"
					aria-label="Account"
				>
					<!-- Clickable user summary card -> opens Profile -->
					<button
						type="button"
						class="relative flex w-full items-center gap-3.5 overflow-hidden bg-[radial-gradient(ellipse_at_top,var(--color-cover)_0%,var(--color-cover-edge)_65%,var(--color-desk)_100%)] px-4 py-4 text-left transition-[filter] hover:brightness-110"
						onclick={() => {
							menuOpen = false;
							nav.openProfile('overview');
						}}
					>
						<span
							class="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_15%_25%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_85%_15%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
							aria-hidden="true"
						></span>
						<Avatar
							src={profile.avatarUrl}
							name={profile.displayName}
							className="relative size-14"
							textClass="text-2xl"
							ring="border-[3px] border-book-accent/60 shadow-[0_10px_22px_rgba(0,0,0,.4)]"
						/>
						<div class="relative min-w-0 flex-1">
							<b class="block truncate font-display text-xl leading-tight font-bold text-book-bg"
								>{profile.displayName}</b
							>
							<span class="block truncate font-ui text-xs font-semibold text-book-accent"
								>@{profile.username}</span
							>
							<span class="block truncate font-ui text-[11px] text-book-bg/65">{auth.email}</span>
						</div>
						<CommunityIcon name="arrow-right" size={16} class="relative shrink-0 text-book-bg/60" />
					</button>

					<div class="p-4">
						<div class="grid grid-cols-2 gap-2">
							<button
								type="button"
								class="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-cover-edge bg-cover/30 px-3 font-ui text-xs font-bold text-book-bg transition-colors hover:border-book-accent/50 hover:bg-cover/50"
								onclick={() => {
									menuOpen = false;
									nav.openProfile('overview');
								}}
							>
								<CommunityIcon name="user" size={15} class="text-book-accent" />
								Profile
							</button>
							<button
								type="button"
								class="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-cover-edge bg-cover/30 px-3 font-ui text-xs font-bold text-book-bg transition-colors hover:border-book-accent/50 hover:bg-cover/50"
								onclick={() => {
									menuOpen = false;
									nav.openProfile('settings');
								}}
							>
								<CommunityIcon name="settings" size={15} class="text-book-accent" />
								Settings
							</button>
							{#if isAdmin()}
								<button
									type="button"
									class="col-span-2 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-book-accent/40 bg-book-accent/15 px-3 font-ui text-xs font-bold text-book-accent transition-colors hover:bg-book-accent/25"
									onclick={() => {
										menuOpen = false;
										void markReportsSeen();
										adminOpen = true;
									}}
								>
									<CommunityIcon name="shield" size={15} />
									Admin console
								</button>
							{/if}
						</div>

						<div class="mt-4">
							<p class="mb-2 font-ui text-xs font-semibold text-book-accent">Journal theme</p>
							<div class="grid grid-cols-2 gap-1.5">
								{#each THEMES as theme (theme.id)}
									<button
										type="button"
										class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left font-ui text-[11px] font-semibold transition-colors {profile.theme ===
										theme.id
											? 'bg-cta text-cta-text'
											: 'bg-cover/20 text-book-bg/85 hover:bg-cover/40'}"
										onclick={() => {
											profile.theme = theme.id;
											void profile.savePreferences();
										}}
										aria-pressed={profile.theme === theme.id}
									>
										<span
											class="size-4 shrink-0 rounded-full ring-2 ring-book-bg/30"
											style="background: {theme.swatch}"
											aria-hidden="true"
										></span>
										<span class="min-w-0 flex-1 truncate">{theme.short}</span>
										{#if profile.theme === theme.id}
											<CommunityIcon name="check" size={13} />
										{/if}
									</button>
								{/each}
							</div>
						</div>

						<button
							type="button"
							class="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger/50 bg-danger/20 px-4 font-ui text-xs font-bold text-white transition-colors hover:bg-danger/30"
							role="menuitem"
							onclick={signOut}
						>
							<CommunityIcon name="logout" size={16} />
							Sign out
						</button>
					</div>
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
			class="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-strong))] font-display text-lg font-bold text-white shadow-[0_0_0_2px_var(--color-gold)] transition-transform hover:scale-105"
			onclick={() => nav.openProfile('overview')}
			title="View your profile"
		>
			{profile.initials}
		</button>
	{/if}
</header>

<!-- Mobile Bottom Navigation -->
<nav
	class="fixed right-0 bottom-0 left-0 z-40 mx-auto flex w-full max-w-[480px] items-stretch gap-0.5 rounded-t-3xl border-t border-cover-edge/60 bg-desk/95 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)] shadow-[0_-16px_40px_rgba(0,0,0,.45)] backdrop-blur-lg min-[900px]:hidden"
	aria-label="Mobile navigation"
>
	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors {nav.view ===
		'journal'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-lav/80 hover:bg-white/[.07] hover:text-white'}"
		aria-label="Journal"
		aria-current={nav.view === 'journal' ? 'page' : undefined}
		onclick={() => nav.setView('journal')}
	>
		<CommunityIcon name="book" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Journal
		</span>
	</button>
	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 text-lav/80 transition-colors hover:bg-white/[.07] hover:text-white"
		aria-label="Calendar"
		onclick={onCalendar}
	>
		<CommunityIcon name="calendar" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Calendar
		</span>
	</button>
	<button
		type="button"
		class="relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors {nav.view ===
		'friends'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-lav/80 hover:bg-white/[.07] hover:text-white'}"
		aria-label={`Friends${friendsBadgeLabel ? `, ${friendsBadgeLabel}` : ''}`}
		aria-current={nav.view === 'friends' ? 'page' : undefined}
		onclick={openFriends}
	>
		<CommunityIcon name="users" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Friends
		</span>
		{#if friendsBadge > 0}
			<span
				class="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-ui text-[9px] font-bold text-desk tabular-nums"
			>
				{friendsBadge > 9 ? '9+' : friendsBadge}
			</span>
		{/if}
	</button>
	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors {nav.view ===
		'community'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-lav/80 hover:bg-white/[.07] hover:text-white'}"
		aria-label="Community"
		aria-current={nav.view === 'community' ? 'page' : undefined}
		onclick={() => nav.setView('community')}
	>
		<CommunityIcon name="globe" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Community
		</span>
	</button>
	<button
		type="button"
		class="relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors {nav.view ===
		'notifications'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-lav/80 hover:bg-white/[.07] hover:text-white'}"
		aria-current={nav.view === 'notifications' ? 'page' : undefined}
		aria-label={`Alerts${alertsBadgeLabel ? `, ${alertsBadgeLabel}` : ''}`}
		onclick={() => nav.setView('notifications')}
	>
		<CommunityIcon name="bell" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Alerts
		</span>
		{#if alertsBadge > 0}
			<span
				class="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-ui text-[9px] font-bold text-book-bg tabular-nums"
			>
				{alertsBadge > 9 ? '9+' : alertsBadge}
			</span>
		{/if}
	</button>
	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors {nav.view ===
		'profile'
			? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]'
			: 'text-lav/80 hover:bg-white/[.07] hover:text-white'}"
		aria-label="Profile"
		aria-current={nav.view === 'profile' ? 'page' : undefined}
		onclick={() => nav.openProfile('overview')}
	>
		<CommunityIcon name="user" size={20} />
		<span
			class="w-full truncate text-center font-ui text-[9px] leading-none font-semibold min-[380px]:text-[10px]"
		>
			Profile
		</span>
	</button>
</nav>
