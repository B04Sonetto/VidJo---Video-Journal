<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { isSupabaseConfigured, supabase } from '#lib/supabase';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	type AdminTab = 'overview' | 'reports' | 'users';
	type RoleFilter = 'all' | 'user' | 'admin' | 'banned';

	type ReportRow = {
		id: string;
		comment_id: string;
		reason: string;
		created_at: string;
		reporter_name: string | null;
		reported_user: string | null;
		comment_body: string | null;
	};

	type AdminUser = {
		user_id: string;
		username: string;
		display_name: string;
		avatar_url: string | null;
		user_role: string;
		created_at: string;
	};

	type DailyPoint = { day: string; events: number; users: number };
	type TopEvent = { event: string; count: number };

	type AdminOverview = {
		window_days: number;
		generated_at: string;
		users_total: number;
		users_new: number;
		entries_total: number;
		entries_shared: number;
		entries_video: number;
		reports_total: number;
		reports_new: number;
		events_total: number;
		events_today: number;
		active_users: number;
		active_users_today: number;
		daily: DailyPoint[];
		top_events: TopEvent[];
	};

	const EVENT_LABELS: Record<string, string> = {
		session_start: 'App opens',
		view_changed: 'Page views',
		entry_saved: 'Pages saved',
		video_added: 'Videos added',
		video_removed: 'Videos removed',
		video_play_failed: 'Playback failures',
		friend_request_sent: 'Friend requests sent',
		friend_request_accepted: 'Friend requests accepted',
		friend_request_declined: 'Friend requests declined',
		friend_removed: 'Friends removed',
		community_joined: 'Communities joined',
		community_left: 'Communities left',
		comment_posted: 'Comments posted',
		reaction_added: 'Reactions added',
		profile_updated: 'Profile updates'
	};

	let tab = $state<AdminTab>('overview');
	let overview = $state<AdminOverview | null>(null);
	let reports = $state<ReportRow[]>([]);
	let users = $state<AdminUser[]>([]);
	let error = $state('');
	let loading = $state(false);
	let userSearch = $state('');
	let roleFilter = $state<RoleFilter>('all');
	let busyUser = $state('');

	function isAdmin() {
		return profile.profile?.user_role === 'admin';
	}

	const tabs = $derived([
		{ key: 'overview' as AdminTab, label: 'Overview', count: null as number | null },
		{ key: 'reports' as AdminTab, label: 'Reports', count: reports.length },
		{ key: 'users' as AdminTab, label: 'Users', count: users.length }
	]);

	const filteredUsers = $derived.by(() => {
		const query = userSearch.trim().toLowerCase();
		return users.filter((user) => {
			if (roleFilter !== 'all' && user.user_role !== roleFilter) return false;
			if (!query) return true;
			return (
				(user.display_name || '').toLowerCase().includes(query) ||
				(user.username || '').toLowerCase().includes(query)
			);
		});
	});

	const maxDaily = $derived(Math.max(1, ...(overview?.daily.map((point) => point.events) ?? [0])));
	const maxFeature = $derived(
		Math.max(1, ...(overview?.top_events.map((item) => item.count) ?? [0]))
	);

	const roleCounts = $derived({
		all: users.length,
		user: users.filter((user) => user.user_role === 'user').length,
		admin: users.filter((user) => user.user_role === 'admin').length,
		banned: users.filter((user) => user.user_role === 'banned').length
	});

	const kpis = $derived([
		{
			label: 'Members',
			value: overview?.users_total ?? 0,
			note: `+${overview?.users_new ?? 0} in 30 days`,
			icon: 'users',
			chip: 'bg-gold/15 text-gold'
		},
		{
			label: 'Journal pages',
			value: overview?.entries_total ?? 0,
			note: `${overview?.entries_shared ?? 0} shared`,
			icon: 'book',
			chip: 'bg-lav/15 text-lav'
		},
		{
			label: 'Videos',
			value: overview?.entries_video ?? 0,
			note: 'stored privately',
			icon: 'video',
			chip: 'bg-gold/15 text-gold'
		},
		{
			label: 'Reports',
			value: overview?.reports_total ?? 0,
			note: `${overview?.reports_new ?? 0} in 30 days`,
			icon: 'flame',
			chip: 'bg-[#D19A9A]/15 text-[#F0A3A3]'
		}
	]);

	async function loadAll() {
		if (!isSupabaseConfigured || !isAdmin()) return;

		loading = true;
		error = '';

		try {
			const [overviewRes, reportsRes, usersRes] = await Promise.all([
				supabase.rpc('vidjo_admin_overview', { days: 30 }),
				supabase.rpc('vidjo_admin_list_reports', { max_rows: 50 }),
				supabase
					.from('vidjo_profiles')
					.select('user_id, username, display_name, avatar_url, user_role, created_at')
					.order('created_at', { ascending: false })
			]);

			const failure = overviewRes.error ?? reportsRes.error ?? usersRes.error;
			if (failure) throw failure;

			overview = (overviewRes.data ?? null) as AdminOverview | null;
			reports = (reportsRes.data ?? []) as ReportRow[];
			users = (usersRes.data ?? []) as AdminUser[];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load the admin console.';
		} finally {
			loading = false;
		}
	}

	async function setRole(user: AdminUser, role: 'user' | 'banned') {
		if (user.user_role === 'admin') {
			journal.toast('Admin accounts cannot be banned.');
			return;
		}

		if (
			role === 'banned' &&
			!confirm('Ban this user? Their journal stays in place, but they lose access.')
		) {
			return;
		}

		busyUser = user.user_id;
		error = '';

		try {
			const { error: updateError } = await supabase
				.from('vidjo_profiles')
				.update({ user_role: role })
				.eq('user_id', user.user_id);

			if (updateError) throw updateError;

			users = users.map((item) =>
				item.user_id === user.user_id ? { ...item, user_role: role } : item
			);
			journal.toast(role === 'banned' ? 'User banned' : 'User unbanned');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not update this user.';
		} finally {
			busyUser = '';
		}
	}

	function eventLabel(event: string) {
		return EVENT_LABELS[event] ?? event.replace(/_/g, ' ');
	}

	function dayLabel(value: string | undefined) {
		if (!value) return '';
		const date = new Date(`${value}T00:00:00`);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function formatDate(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function roleClass(role: string) {
		if (role === 'admin') return 'border-[#4F9DEB]/40 bg-[#4F9DEB]/15 text-[#7CB8F5]';
		if (role === 'banned') return 'border-[#D19A9A]/40 bg-[#D19A9A]/15 text-[#F0A3A3]';
		return 'border-[#523A7A] bg-[#523A7A]/20 text-[#D6CBEC]';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') open = false;
	}

	$effect(() => {
		if (open && isAdmin()) {
			void loadAll();
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="fixed inset-0 z-[50] flex items-center justify-center p-2 sm:p-4"
	aria-hidden={!open || undefined}
	role="dialog"
	aria-modal="true"
	aria-label="Admin console"
>
	{#if open && isAdmin()}
		<button
			type="button"
			class="absolute inset-0 border-0 bg-black/75 backdrop-blur-sm"
			aria-label="Close admin console"
			onclick={() => (open = false)}
		></button>

		<div
			class="relative flex max-h-[95vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[26px] border border-[#523A7A] bg-[#1E1133] text-white shadow-[0_40px_120px_rgba(0,0,0,.7)]"
		>
			<!-- Header -->
			<header
				class="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[#3D2A5C] bg-[#24143D] px-5 py-4 sm:px-7 sm:py-5"
			>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="size-1.5 rounded-full bg-gold" aria-hidden="true"></span>
						<span class="font-ui text-[10px] font-bold tracking-[0.18em] text-gold uppercase">
							VidJo staff
						</span>
					</div>
					<h2 class="mt-1 font-display text-[26px] leading-tight font-bold text-white">
						Admin console
					</h2>
					<p class="mt-0.5 font-ui text-xs text-[#BBA8E0]">
						Moderation and privacy-friendly usage stats.
					</p>
				</div>

				<div class="flex items-center gap-2">
					<button
						type="button"
						class="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#5A4580] bg-[#33224D] px-3.5 font-ui text-xs font-semibold text-[#EDE6F7] transition-colors hover:bg-[#43306A] disabled:cursor-wait disabled:opacity-60"
						disabled={loading}
						onclick={() => void loadAll()}
					>
						<svg
							class="size-4 {loading ? 'animate-spin' : ''}"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
							<path d="M21 3v6h-6"></path>
						</svg>
						{loading ? 'Refreshing' : 'Refresh'}
					</button>
					<button
						type="button"
						class="flex size-10 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] text-[#D6CBEC] transition-colors hover:bg-[#43306A] hover:text-white"
						aria-label="Close admin console"
						onclick={() => (open = false)}
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<path d="M6 6l12 12M18 6L6 18"></path>
						</svg>
					</button>
				</div>
			</header>

			<!-- Tabs -->
			<nav
				class="flex shrink-0 gap-1 overflow-x-auto border-b border-[#3D2A5C] bg-[#1A0F2C] px-3 py-2 sm:px-6"
				aria-label="Admin sections"
			>
				{#each tabs as item (item.key)}
					<button
						type="button"
						class="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-colors {tab ===
						item.key
							? 'bg-gold text-[#2A1B3D]'
							: 'text-[#BBA8E0] hover:bg-white/5 hover:text-white'}"
						aria-current={tab === item.key ? 'page' : undefined}
						onclick={() => (tab = item.key)}
					>
						{item.label}
						{#if item.count !== null}
							<span
								class="rounded-full px-1.5 py-0.5 text-[10px] font-bold {tab === item.key
									? 'bg-[#2A1B3D]/15 text-[#2A1B3D]'
									: 'bg-white/10 text-[#D6CBEC]'}"
							>
								{item.count}
							</span>
						{/if}
					</button>
				{/each}
			</nav>

			<!-- Body -->
			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
				{#if error}
					<p
						class="mb-4 rounded-xl border border-[#D19A9A]/60 bg-[#3A222B] px-4 py-3 font-ui text-sm text-[#FFB4B4]"
						role="alert"
					>
						{error}
					</p>
				{/if}

				{#if tab === 'overview'}
					{#if !overview && loading}
						<div class="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
							{#each [0, 1, 2, 3] as slot (slot)}
								<div
									class="h-28 animate-pulse rounded-2xl border border-[#4D366D] bg-[#24143D]"
								></div>
							{/each}
						</div>
					{:else if overview}
						<!-- Headline numbers -->
						<div class="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
							{#each kpis as kpi (kpi.label)}
								<div class="rounded-2xl border border-[#4D366D] bg-[#24143D] p-4">
									<div class="flex items-center justify-between gap-2">
										<p
											class="font-ui text-[10px] font-bold tracking-[0.14em] text-[#BBA8E0] uppercase"
										>
											{kpi.label}
										</p>
										<span class="flex size-8 items-center justify-center rounded-full {kpi.chip}">
											<CommunityIcon name={kpi.icon} size={15} />
										</span>
									</div>
									<p class="mt-2 font-display text-3xl leading-none font-bold text-white">
										{kpi.value.toLocaleString()}
									</p>
									<p class="mt-1 font-ui text-[11px] text-[#9E8CC0]">{kpi.note}</p>
								</div>
							{/each}
						</div>

						<!-- Activity chart -->
						<section class="mt-4 rounded-2xl border border-[#4D366D] bg-[#24143D] p-5">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h3 class="font-display text-xl leading-tight font-bold text-white">
										Activity, last {overview.window_days} days
									</h3>
									<p class="mt-0.5 font-ui text-xs text-[#9E8CC0]">
										Feature names and counts only. Journal text is never recorded.
									</p>
								</div>
								<div class="flex items-center gap-5">
									<div class="text-right">
										<p class="font-display text-2xl leading-none font-bold text-gold">
											{overview.events_total.toLocaleString()}
										</p>
										<p class="font-ui text-[10px] tracking-wide text-[#9E8CC0] uppercase">events</p>
									</div>
									<div class="text-right">
										<p class="font-display text-2xl leading-none font-bold text-lav">
											{overview.active_users.toLocaleString()}
										</p>
										<p class="font-ui text-[10px] tracking-wide text-[#9E8CC0] uppercase">
											active members
										</p>
									</div>
								</div>
							</div>

							{#if overview.events_total > 0}
								<div class="mt-5 flex h-36 items-end gap-[3px]" aria-hidden="true">
									{#each overview.daily as point (point.day)}
										<div
											class="group flex h-full flex-1 items-end"
											title={`${dayLabel(point.day)}: ${point.events} events, ${point.users} members`}
										>
											<div
												class="w-full rounded-t-[3px] bg-gradient-to-t from-[#6B4FA8] to-gold transition-opacity group-hover:opacity-80"
												style={`height: ${Math.max(2, (point.events / maxDaily) * 100)}%`}
											></div>
										</div>
									{/each}
								</div>
								<div class="mt-2 flex justify-between font-ui text-[10px] text-[#8B6FD0]">
									<span>{dayLabel(overview.daily[0]?.day)}</span>
									<span>Today</span>
								</div>
							{:else}
								<div
									class="mt-4 rounded-xl border border-dashed border-[#5A4580] bg-[#1E1133]/60 px-4 py-8 text-center"
								>
									<CommunityIcon name="trending" size={26} class="mx-auto text-gold/60" />
									<p class="mt-2 font-hand text-xl text-[#D6CBEC]">No activity recorded yet.</p>
									<p class="mt-1 font-ui text-xs text-[#9E8CC0]">
										Events appear here as members use VidJo. Only feature names and counts are
										stored.
									</p>
								</div>
							{/if}
						</section>

						<div class="mt-4 grid gap-4 min-[860px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
							<!-- Top features -->
							<section class="rounded-2xl border border-[#4D366D] bg-[#24143D] p-5">
								<div class="flex items-baseline justify-between gap-3">
									<h3 class="font-display text-xl leading-tight font-bold text-white">
										Most used features
									</h3>
									<span class="font-ui text-[10px] tracking-wide text-[#9E8CC0] uppercase">
										last {overview.window_days} days
									</span>
								</div>

								{#if overview.top_events.length > 0}
									<ul class="mt-4 space-y-3">
										{#each overview.top_events as item (item.event)}
											<li>
												<div class="flex items-baseline justify-between gap-3">
													<span class="font-ui text-sm font-semibold text-[#EDE6F7]">
														{eventLabel(item.event)}
													</span>
													<span class="font-ui text-xs font-semibold text-[#BBA8E0]">
														{item.count.toLocaleString()}
													</span>
												</div>
												<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#33224D]">
													<div
														class="h-full rounded-full bg-gradient-to-r from-[#8B6FD0] to-gold"
														style={`width: ${(item.count / maxFeature) * 100}%`}
													></div>
												</div>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="mt-4 font-hand text-lg text-[#9E8CC0]">
										Feature usage will show up after the first few sessions.
									</p>
								{/if}
							</section>

							<div class="space-y-4">
								<!-- Today -->
								<section class="rounded-2xl border border-[#4D366D] bg-[#24143D] p-5">
									<div class="flex items-center gap-2">
										<CommunityIcon name="sun" size={16} class="text-gold" />
										<h3 class="font-display text-xl leading-none font-bold text-white">
											Right now
										</h3>
									</div>
									<div class="mt-4 grid grid-cols-2 gap-3">
										<div class="rounded-xl bg-[#1B102B] px-3 py-3">
											<p class="font-display text-3xl leading-none font-bold text-gold">
												{overview.events_today.toLocaleString()}
											</p>
											<p class="mt-1 font-ui text-[10px] tracking-wide text-[#9E8CC0] uppercase">
												events today
											</p>
										</div>
										<div class="rounded-xl bg-[#1B102B] px-3 py-3">
											<p class="font-display text-3xl leading-none font-bold text-lav">
												{overview.active_users_today.toLocaleString()}
											</p>
											<p class="mt-1 font-ui text-[10px] tracking-wide text-[#9E8CC0] uppercase">
												members today
											</p>
										</div>
									</div>
									<p class="mt-3 font-ui text-[11px] leading-relaxed text-[#8B6FD0]">
										Counts use the server clock and reset at midnight.
									</p>
								</section>

								<!-- Moderation snapshot -->
								<section class="rounded-2xl border border-[#4D366D] bg-[#24143D] p-5">
									<div class="flex items-center gap-2">
										<CommunityIcon name="flame" size={16} class="text-[#F0A3A3]" />
										<h3 class="font-display text-xl leading-none font-bold text-white">
											Moderation
										</h3>
									</div>
									<p class="mt-3 font-ui text-sm text-[#CFC3E6]">
										<span class="font-bold text-white">{overview.reports_new}</span>
										new {overview.reports_new === 1 ? 'report' : 'reports'} in the last
										{overview.window_days} days.
									</p>
									<div class="mt-4 flex flex-wrap gap-2">
										<button
											type="button"
											class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/10 px-3 font-ui text-xs font-semibold text-[#F3DDAE] transition-colors hover:bg-gold/20"
											onclick={() => (tab = 'reports')}
										>
											Review reports
										</button>
										<button
											type="button"
											class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#5A4580] px-3 font-ui text-xs font-semibold text-[#D6CBEC] transition-colors hover:bg-white/5"
											onclick={() => (tab = 'users')}
										>
											Manage members
										</button>
									</div>
								</section>
							</div>
						</div>
					{/if}
				{:else if tab === 'reports'}
					<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
						<div>
							<h3 class="font-display text-2xl leading-tight font-bold text-white">
								Comment reports
							</h3>
							<p class="mt-0.5 font-ui text-xs text-[#9E8CC0]">
								Flagged comments from friends and community pages.
							</p>
						</div>
						<span class="font-ui text-xs text-[#BBA8E0]">
							{reports.length}
							{reports.length === 1 ? 'report' : 'reports'}
						</span>
					</div>

					{#if loading && reports.length === 0}
						<div class="space-y-3">
							{#each [0, 1, 2] as slot (slot)}
								<div
									class="h-28 animate-pulse rounded-2xl border border-[#4D366D] bg-[#24143D]"
								></div>
							{/each}
						</div>
					{:else if reports.length === 0}
						<div
							class="rounded-2xl border border-dashed border-[#5A4580] bg-[#24143D]/60 px-6 py-14 text-center"
						>
							<CommunityIcon name="check" size={30} class="mx-auto text-gold/70" />
							<p class="mt-3 font-display text-2xl font-bold text-white">Nothing flagged</p>
							<p class="mt-1 font-ui text-sm text-[#9E8CC0]">
								Reports will appear here when someone flags a comment.
							</p>
						</div>
					{:else}
						<div class="space-y-3">
							{#each reports as report (report.id)}
								<article
									class="relative overflow-hidden rounded-2xl border border-line bg-paper p-4 pl-5 text-ink shadow-[0_10px_24px_rgba(0,0,0,.28)]"
								>
									<span class="absolute inset-y-0 left-0 w-1.5 bg-gold" aria-hidden="true"></span>

									<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<span class="font-ui text-xs font-bold text-ink">
											{report.reporter_name || 'Unknown member'}
										</span>
										<span class="font-ui text-[11px] text-ink-soft">reported</span>
										<span class="font-ui text-xs font-bold text-ink">
											{report.reported_user || 'Unknown member'}
										</span>
										<span
											class="ml-auto rounded-full bg-gold/20 px-2.5 py-0.5 font-ui text-[10px] font-bold text-[#8A5A12] capitalize"
										>
											{report.reason || 'other'}
										</span>
									</div>

									{#if report.comment_body}
										<blockquote
											class="mt-3 rounded-r-xl border-l-[3px] border-gold/70 bg-[#FFFDF6] px-3 py-2 font-hand text-lg leading-snug break-words text-ink"
										>
											{report.comment_body}
										</blockquote>
									{:else}
										<p class="mt-3 font-ui text-xs text-ink-soft italic">
											The comment is no longer available.
										</p>
									{/if}

									<time
										class="mt-3 block font-ui text-[10px] text-ink-soft"
										datetime={report.created_at}
									>
										{formatDate(report.created_at)}
									</time>
								</article>
							{/each}
						</div>
					{/if}
				{:else if tab === 'users'}
					<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
						<div>
							<h3 class="font-display text-2xl leading-tight font-bold text-white">Members</h3>
							<p class="mt-0.5 font-ui text-xs text-[#9E8CC0]">
								Ban or restore accounts. Admin accounts are protected.
							</p>
						</div>
						<span class="font-ui text-xs text-[#BBA8E0]">
							{filteredUsers.length} of {users.length}
						</span>
					</div>

					<div class="mb-4 flex flex-wrap items-center gap-2">
						<label class="relative min-w-[220px] flex-1">
							<span class="sr-only">Search members</span>
							<svg
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8B6FD0]"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<circle cx="11" cy="11" r="7"></circle>
								<path d="M20 20l-3.5-3.5"></path>
							</svg>
							<input
								type="search"
								class="h-11 w-full rounded-xl border border-[#4D366D] bg-[#1B102B] pr-3 pl-9 font-ui text-sm text-white placeholder:text-[#7C6A9C] focus:border-gold focus:outline-none"
								placeholder="Search by nickname or @username"
								bind:value={userSearch}
							/>
						</label>

						<div
							class="inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-[#4D366D] bg-[#1B102B] p-1"
							role="group"
							aria-label="Filter members by role"
						>
							{#each ['all', 'user', 'admin', 'banned'] as role (role)}
								<button
									type="button"
									class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-ui text-xs font-bold capitalize transition-colors {roleFilter ===
									role
										? 'bg-gold text-[#2A1B3D]'
										: 'text-[#BBA8E0] hover:text-white'}"
									aria-pressed={roleFilter === role}
									onclick={() => (roleFilter = role as RoleFilter)}
								>
									{role}
									<span class="text-[10px] opacity-70">
										{roleCounts[role as RoleFilter]}
									</span>
								</button>
							{/each}
						</div>
					</div>

					{#if loading && users.length === 0}
						<div class="space-y-2">
							{#each [0, 1, 2, 3, 4] as slot (slot)}
								<div
									class="h-16 animate-pulse rounded-xl border border-[#4D366D] bg-[#24143D]"
								></div>
							{/each}
						</div>
					{:else if filteredUsers.length === 0}
						<div
							class="rounded-2xl border border-dashed border-[#5A4580] bg-[#24143D]/60 px-6 py-12 text-center"
						>
							<CommunityIcon name="search" size={28} class="mx-auto text-gold/60" />
							<p class="mt-3 font-hand text-xl text-[#D6CBEC]">No members match that search.</p>
							<button
								type="button"
								class="mt-3 font-ui text-xs font-semibold text-gold hover:underline"
								onclick={() => {
									userSearch = '';
									roleFilter = 'all';
								}}
							>
								Clear filters
							</button>
						</div>
					{:else}
						<div class="space-y-2">
							{#each filteredUsers as user (user.user_id)}
								<div
									class="flex flex-wrap items-center gap-3 rounded-xl border border-[#4D366D] bg-[#24143D] px-3 py-3 transition-colors hover:border-[#5A4580]"
								>
									<Avatar
										src={user.avatar_url}
										name={user.display_name || user.username}
										className="size-10"
										textClass="text-base"
										ring="ring-2 ring-gold/30"
									/>

									<div class="min-w-0 flex-1">
										<p class="truncate font-ui text-sm font-bold text-white">
											{user.display_name || user.username}
										</p>
										<p class="truncate font-ui text-[11px] text-[#9E8CC0]">
											@{user.username} · joined {formatDate(user.created_at)}
										</p>
									</div>

									<span
										class="rounded-full border px-2.5 py-0.5 font-ui text-[10px] font-bold capitalize {roleClass(
											user.user_role
										)}"
									>
										{user.user_role}
									</span>

									{#if user.user_role === 'admin'}
										<span
											class="flex size-9 items-center justify-center rounded-lg text-[#7CB8F5]"
											title="Admin accounts cannot be banned"
											aria-label="Admin account, protected"
										>
											<svg
												class="size-[18px]"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
											>
												<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"></path>
												<path d="M9.5 12l1.7 1.7L15 10"></path>
											</svg>
										</span>
									{:else}
										<button
											type="button"
											class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 font-ui text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 {user.user_role ===
											'banned'
												? 'border-[#5A4580] text-[#D6CBEC] hover:bg-white/5'
												: 'border-[#D19A9A]/40 bg-[#D19A9A]/10 text-[#F0A3A3] hover:bg-[#D19A9A]/20'}"
											disabled={busyUser === user.user_id}
											onclick={() => setRole(user, user.user_role === 'banned' ? 'user' : 'banned')}
										>
											{#if busyUser === user.user_id}
												<span
													class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
													aria-hidden="true"
												></span>
											{:else if user.user_role === 'banned'}
												<svg
													class="size-3.5"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<rect x="4" y="11" width="16" height="10" rx="2"></rect>
													<path d="M8 11V7a4 4 0 0 1 7.5-2"></path>
												</svg>
												Unban
											{:else}
												<svg
													class="size-3.5"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
												>
													<circle cx="12" cy="12" r="9"></circle>
													<path d="M5.6 5.6l12.8 12.8"></path>
												</svg>
												Ban
											{/if}
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{:else if open && !isAdmin()}
		<button
			type="button"
			class="absolute inset-0 border-0 bg-black/75 backdrop-blur-sm"
			aria-label="Close admin console"
			onclick={() => (open = false)}
		></button>
		<div
			class="relative mx-4 max-w-[340px] rounded-[24px] border border-[#D19A9A] bg-[#3A222B] p-8 text-center text-white shadow-[0_40px_100px_rgba(0,0,0,.7)]"
		>
			<span
				class="mx-auto flex size-12 items-center justify-center rounded-full bg-[#D19A9A]/15 text-[#F0A3A3]"
			>
				<svg
					class="size-6"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<rect x="4" y="10.5" width="16" height="10.5" rx="2"></rect>
					<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path>
				</svg>
			</span>
			<h2 class="mt-4 font-display text-xl font-bold">Admin access required</h2>
			<p class="mt-2 font-ui text-sm text-[#FFB4B4]">Only administrators can open this console.</p>
			<button
				type="button"
				class="mt-5 min-h-10 rounded-xl border border-white/20 bg-white/10 px-5 font-ui text-sm text-[#EDE6F7] hover:bg-white/20"
				onclick={() => (open = false)}
			>
				Close
			</button>
		</div>
	{/if}
</div>
