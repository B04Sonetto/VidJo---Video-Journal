<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
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
		reported_user_id: string | null;
	};

	type AdminUser = {
		user_id: string;
		username: string;
		display_name: string;
		avatar_url: string | null;
		user_role: string;
		created_at: string;
		ban_reason?: string | null;
		banned_at?: string | null;
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
	let busyWarn = $state('');

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
					.select(
						'user_id, username, display_name, avatar_url, user_role, created_at, ban_reason, banned_at'
					)
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

	function askReason(action: 'warn' | 'ban', name: string) {
		const fallback =
			action === 'warn'
				? 'Insulting another member'
				: 'Repeated or serious community guideline violations.';
		const value = prompt(
			`${action === 'warn' ? 'Warning' : 'Ban'} reason for ${name}.\nThis reason is shown to the member.`,
			fallback
		);
		if (value === null) return null;
		return value.trim() || fallback;
	}

	async function warnUser(userId: string | null | undefined, name: string) {
		if (!userId) {
			journal.toast('That comment has no author to warn.');
			return;
		}

		const reason = askReason('warn', name);
		if (!reason) return;

		busyWarn = userId;
		error = '';

		try {
			const { error: warnError } = await supabase.rpc('vidjo_admin_warn_user', {
				p_user_id: userId,
				p_reason: reason,
				p_message: ''
			});

			if (warnError) throw warnError;
			journal.toast(`Warning sent to ${name}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not send that warning.';
		} finally {
			busyWarn = '';
		}
	}

	async function banUser(userId: string | null | undefined, name: string) {
		if (!userId) {
			journal.toast('That comment has no author to ban.');
			return;
		}

		const reason = askReason('ban', name);
		if (!reason) return;

		busyUser = userId;
		error = '';

		try {
			const { error: banError } = await supabase.rpc('vidjo_admin_ban_user', {
				p_user_id: userId,
				p_reason: reason
			});

			if (banError) throw banError;

			users = users.map((item) =>
				item.user_id === userId
					? {
							...item,
							user_role: 'banned',
							ban_reason: reason,
							banned_at: new Date().toISOString()
						}
					: item
			);
			journal.toast(`${name} was suspended. Their journal was not deleted.`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not suspend this user.';
		} finally {
			busyUser = '';
		}
	}

	async function unbanUser(user: AdminUser) {
		busyUser = user.user_id;
		error = '';

		try {
			const { error: unbanError } = await supabase.rpc('vidjo_admin_unban_user', {
				p_user_id: user.user_id
			});

			if (unbanError) throw unbanError;

			users = users.map((item) =>
				item.user_id === user.user_id
					? { ...item, user_role: 'user', ban_reason: null, banned_at: null }
					: item
			);
			journal.toast('User restored');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not restore this user.';
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

{#if open}
	<div
		class="fixed inset-0 z-[50] flex items-center justify-center p-2 sm:p-4"
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
						<h2 class="font-display text-[26px] leading-tight font-bold text-white">
							Admin console
						</h2>
						<p class="mt-0.5 font-ui text-xs text-[#BBA8E0]">
							Moderation and privacy-friendly usage stats.
						</p>
					</div>

					<div class="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							icon="refresh"
							{loading}
							onclick={() => void loadAll()}
						>
							Refresh
						</Button>
						<button
							type="button"
							class="flex size-9 items-center justify-center rounded-xl border border-[#5A4580] bg-[#33224D] text-[#D6CBEC] transition-colors hover:bg-[#43306A] hover:text-white"
							aria-label="Close admin console"
							onclick={() => (open = false)}
						>
							<CommunityIcon name="x" size={16} />
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
								? 'bg-cta text-cta-text'
								: 'text-[#BBA8E0] hover:bg-white/5 hover:text-white'}"
							aria-current={tab === item.key ? 'page' : undefined}
							onclick={() => (tab = item.key)}
						>
							{item.label}
							{#if item.count !== null}
								<span
									class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums {tab ===
									item.key
										? 'bg-white/20 text-cta-text'
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
											<p class="font-ui text-xs font-semibold text-[#BBA8E0]">{kpi.label}</p>
											<span class="flex size-8 items-center justify-center rounded-full {kpi.chip}">
												<CommunityIcon name={kpi.icon} size={15} />
											</span>
										</div>
										<p
											class="mt-2 font-display text-3xl leading-none font-bold text-white tabular-nums"
										>
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
											<p
												class="font-display text-2xl leading-none font-bold text-gold tabular-nums"
											>
												{overview.events_total.toLocaleString()}
											</p>
											<p class="font-ui text-[11px] text-[#9E8CC0]">events</p>
										</div>
										<div class="text-right">
											<p class="font-display text-2xl leading-none font-bold text-lav tabular-nums">
												{overview.active_users.toLocaleString()}
											</p>
											<p class="font-ui text-[11px] text-[#9E8CC0]">active members</p>
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
										class="mt-4 rounded-xl border border-[#5A4580] bg-[#1E1133]/60 px-4 py-8 text-center"
									>
										<CommunityIcon name="trending" size={26} class="mx-auto text-gold/60" />
										<p class="mt-2 font-ui text-sm font-semibold text-[#D6CBEC]">
											No activity recorded yet.
										</p>
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
										<span class="font-ui text-[11px] text-[#9E8CC0] tabular-nums">
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
														<span class="font-ui text-xs font-semibold text-[#BBA8E0] tabular-nums">
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
										<p class="mt-4 font-ui text-sm text-[#9E8CC0]">
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
												<p
													class="font-display text-3xl leading-none font-bold text-gold tabular-nums"
												>
													{overview.events_today.toLocaleString()}
												</p>
												<p class="mt-1 font-ui text-[11px] text-[#9E8CC0]">events today</p>
											</div>
											<div class="rounded-xl bg-[#1B102B] px-3 py-3">
												<p
													class="font-display text-3xl leading-none font-bold text-lav tabular-nums"
												>
													{overview.active_users_today.toLocaleString()}
												</p>
												<p class="mt-1 font-ui text-[11px] text-[#9E8CC0]">members today</p>
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
											<Button size="sm" icon="alert" onclick={() => (tab = 'reports')}>
												Review reports
											</Button>
											<Button
												size="sm"
												variant="outline"
												icon="users"
												onclick={() => (tab = 'users')}
											>
												Manage members
											</Button>
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
							<span class="font-ui text-xs text-[#BBA8E0] tabular-nums">
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
								class="rounded-2xl border border-[#5A4580] bg-[#24143D]/60 px-6 py-14 text-center"
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
												class="ml-auto rounded-full bg-gold/20 px-2.5 py-0.5 font-ui text-[10px] font-semibold text-[#8A5A12] capitalize"
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
											<p class="mt-3 font-ui text-xs text-ink-soft">
												The comment is no longer available.
											</p>
										{/if}

										<div
											class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3"
										>
											<time class="font-ui text-[10px] text-ink-soft" datetime={report.created_at}>
												{formatDate(report.created_at)}
											</time>

											{#if report.reported_user_id}
												<div class="flex flex-wrap gap-2">
													<Button
														size="sm"
														variant="paper"
														icon="alert"
														loading={busyWarn === report.reported_user_id}
														disabled={Boolean(busyWarn || busyUser)}
														onclick={() =>
															void warnUser(
																report.reported_user_id,
																report.reported_user || 'this member'
															)}
													>
														Warn author
													</Button>
													<Button
														size="sm"
														variant="danger"
														icon="user-minus"
														loading={busyUser === report.reported_user_id}
														disabled={Boolean(busyWarn || busyUser)}
														onclick={() =>
															void banUser(
																report.reported_user_id,
																report.reported_user || 'this member'
															)}
													>
														Ban author
													</Button>
												</div>
											{:else}
												<span class="font-ui text-[10px] text-ink-soft">
													Comment author unavailable
												</span>
											{/if}
										</div>
									</article>
								{/each}
							</div>
						{/if}
					{:else if tab === 'users'}
						<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
							<div>
								<h3 class="font-display text-2xl leading-tight font-bold text-white">Members</h3>
								<p class="mt-0.5 font-ui text-xs text-[#9E8CC0]">
									Warn, ban, or restore accounts. Banning never deletes journals or posts.
								</p>
							</div>
							<span class="font-ui text-xs text-[#BBA8E0] tabular-nums">
								{filteredUsers.length} of {users.length}
							</span>
						</div>

						<div class="mb-4 flex flex-wrap items-center gap-2">
							<label class="relative min-w-[220px] flex-1">
								<span class="sr-only">Search members</span>
								<CommunityIcon
									name="search"
									size={16}
									class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#8B6FD0]"
								/>
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
										class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-ui text-xs font-semibold capitalize transition-colors {roleFilter ===
										role
											? 'bg-cta text-cta-text'
											: 'text-[#BBA8E0] hover:text-white'}"
										aria-pressed={roleFilter === role}
										onclick={() => (roleFilter = role as RoleFilter)}
									>
										{role}
										<span class="text-[10px] tabular-nums opacity-70">
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
								class="rounded-2xl border border-[#5A4580] bg-[#24143D]/60 px-6 py-12 text-center"
							>
								<CommunityIcon name="search" size={28} class="mx-auto text-gold/60" />
								<p class="mt-3 font-ui text-sm font-semibold text-[#D6CBEC]">
									No members match that search.
								</p>
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
											{#if user.user_role === 'banned' && user.ban_reason}
												<p class="mt-0.5 truncate font-ui text-[10px] text-[#F0A3A3]">
													Ban reason: {user.ban_reason}
												</p>
											{/if}
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
												<CommunityIcon name="shield" size={18} />
											</span>
										{:else if user.user_role === 'banned'}
											<Button
												size="sm"
												variant="outline"
												icon="check"
												loading={busyUser === user.user_id}
												disabled={busyUser === user.user_id}
												onclick={() => void unbanUser(user)}
											>
												Restore
											</Button>
										{:else}
											<div class="flex flex-wrap items-center gap-2">
												<Button
													size="sm"
													variant="outline"
													icon="alert"
													loading={busyWarn === user.user_id}
													disabled={Boolean(busyWarn || busyUser)}
													onclick={() =>
														void warnUser(user.user_id, user.display_name || `@${user.username}`)}
												>
													Warn
												</Button>
												<Button
													size="sm"
													variant="danger"
													icon="user-minus"
													loading={busyUser === user.user_id}
													disabled={Boolean(busyWarn || busyUser)}
													onclick={() =>
														void banUser(user.user_id, user.display_name || `@${user.username}`)}
												>
													Ban
												</Button>
											</div>
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
					<CommunityIcon name="lock" size={24} />
				</span>
				<h2 class="mt-4 font-display text-xl font-bold">Admin access required</h2>
				<p class="mt-2 font-ui text-sm text-[#FFB4B4]">
					Only administrators can open this console.
				</p>
				<Button class="mt-5" variant="outline" onclick={() => (open = false)}>Close</Button>
			</div>
		{/if}
	</div>
{/if}
