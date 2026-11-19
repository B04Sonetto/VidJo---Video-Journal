<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import PromptModal from '#lib/components/PromptModal.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { isSupabaseConfigured, supabase } from '#lib/supabase';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	type AdminTab = 'overview' | 'reports' | 'users' | 'bans';
	type RoleFilter = 'all' | 'user' | 'admin' | 'banned';
	type LoadKey = 'overview' | 'reports' | 'users';

	const LOAD_FRESH_MS = 60_000;
	const USERS_LIMIT = 1000;

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
	let overviewError = $state('');
	let reportsError = $state('');
	let usersError = $state('');
	let usersCapped = $state(false);
	let pendingLoads = $state(0);
	let userSearch = $state('');
	let roleFilter = $state<RoleFilter>('all');
	let busyUser = $state('');
	let busyWarn = $state('');
	let busyDeleteComment = $state('');
	let confirmDeleteReport = $state<ReportRow | null>(null);
	let reasonPrompt = $state<{
		action: 'warn' | 'ban';
		userId: string;
		name: string;
		fallback: string;
	} | null>(null);

	/** Timestamps live outside `$state`: they gate loads but must not re-render. */
	const loadedAt: Record<LoadKey, number> = { overview: 0, reports: 0, users: 0 };
	const inFlight: Partial<Record<LoadKey, Promise<void>>> = {};
	let loaded = $state<Record<LoadKey, boolean>>({
		overview: false,
		reports: false,
		users: false
	});

	const loading = $derived(pendingLoads > 0);

	function isAdmin() {
		return (profile.profile?.user_role ?? '').trim().toLowerCase() === 'admin';
	}

	function errorText(err: unknown, fallback: string) {
		if (err instanceof Error && err.message) return err.message;
		if (typeof err === 'string' && err) return err;
		if (err && typeof err === 'object' && 'message' in err) {
			const message = (err as { message?: unknown }).message;
			if (typeof message === 'string' && message) return message;
		}
		return fallback;
	}

	const tabs = $derived([
		{ key: 'overview' as AdminTab, label: 'Overview', count: null as number | null },
		{
			key: 'reports' as AdminTab,
			label: 'Reports',
			count: loaded.reports ? reports.length : null
		},
		{ key: 'users' as AdminTab, label: 'Users', count: loaded.users ? users.length : null },
		{
			key: 'bans' as AdminTab,
			label: 'Ban list',
			count: loaded.users ? users.filter((user) => user.user_role === 'banned').length : null
		}
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

	const bannedUsers = $derived(users.filter((user) => user.user_role === 'banned'));

	const kpis = $derived([
		{
			label: 'Members',
			value: overview?.users_total ?? 0,
			note: `+${overview?.users_new ?? 0} in 30 days`,
			icon: 'users',
			chip: 'bg-book-accent/15 text-book-accent'
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
			chip: 'bg-book-accent/15 text-book-accent'
		},
		{
			label: 'Reports',
			value: overview?.reports_total ?? 0,
			note: `${overview?.reports_new ?? 0} in 30 days`,
			icon: 'flame',
			chip: 'bg-danger/15 text-danger-soft'
		}
	]);

	async function loadOverview() {
		overviewError = '';

		try {
			const { data, error: rpcError } = await supabase.rpc('vidjo_admin_overview', { days: 30 });
			if (rpcError) throw rpcError;
			overview = (data ?? null) as AdminOverview | null;
			if (!overview) overviewError = 'The stats function returned no data.';
		} catch (err) {
			overview = null;
			overviewError = errorText(err, 'Could not load the overview.');
		}
	}

	async function loadReports() {
		reportsError = '';

		try {
			const { data, error: rpcError } = await supabase.rpc('vidjo_admin_list_reports', {
				max_rows: 50
			});
			if (!rpcError) {
				reports = (data ?? []) as ReportRow[];
				return;
			}

			// Older projects may not have the admin RPC yet. The reports table has
			// its own admin select policy, so a direct read still works.
			const { data: rows, error: directError } = await supabase
				.from('vidjo_comment_reports')
				.select('id, comment_id, reason, created_at')
				.order('created_at', { ascending: false })
				.limit(50);

			if (directError) throw rpcError;

			reports = ((rows ?? []) as Partial<ReportRow>[]).map((row) => ({
				id: String(row.id ?? ''),
				comment_id: String(row.comment_id ?? ''),
				reason: row.reason ?? 'other',
				created_at: row.created_at ?? '',
				reporter_name: null,
				reported_user: null,
				comment_body: null,
				reported_user_id: null
			}));
		} catch (err) {
			reports = [];
			reportsError = errorText(err, 'Could not load reports.');
		}
	}

	async function loadUsers() {
		usersError = '';

		try {
			const columns =
				'user_id, username, display_name, avatar_url, user_role, created_at, ban_reason, banned_at';
			const { data, error: queryError } = await supabase
				.from('vidjo_profiles')
				.select(columns)
				.order('created_at', { ascending: false })
				.limit(USERS_LIMIT);

			if (!queryError) {
				users = (data ?? []) as AdminUser[];
				usersCapped = users.length >= USERS_LIMIT;
				return;
			}

			// Older schema without the ban columns: still show the member list.
			const { data: fallback, error: fallbackError } = await supabase
				.from('vidjo_profiles')
				.select('user_id, username, display_name, avatar_url, user_role, created_at')
				.order('created_at', { ascending: false })
				.limit(USERS_LIMIT);

			if (fallbackError) throw queryError;

			users = ((fallback ?? []) as AdminUser[]).map((user) => ({
				...user,
				ban_reason: null,
				banned_at: null
			}));
			usersCapped = users.length >= USERS_LIMIT;
			usersError =
				'Ban details are unavailable until the latest supabase/schema.sql is applied. Members can still be listed.';
		} catch (err) {
			users = [];
			usersCapped = false;
			usersError = errorText(err, 'Could not load members.');
		}
	}

	const loaders: Record<LoadKey, () => Promise<void>> = {
		overview: loadOverview,
		reports: loadReports,
		users: loadUsers
	};

	/**
	 * Loads only the section being viewed, and reuses a recent result when the
	 * console is reopened. The Refresh button calls `loadAll()` to force it.
	 */
	async function ensureTab(target: AdminTab, options: { force?: boolean } = {}) {
		if (!isSupabaseConfigured) {
			error = 'Supabase is not configured for this build.';
			return;
		}
		if (!isAdmin()) {
			error = `Your profile role is "${profile.profile?.user_role ?? 'unknown'}", so the admin functions will reject this account.`;
			return;
		}

		const key: LoadKey = target === 'bans' ? 'users' : target;
		if (!options.force && Date.now() - loadedAt[key] < LOAD_FRESH_MS) return;

		const running = inFlight[key];
		if (running) return running;

		error = '';
		pendingLoads += 1;

		const task = loaders[key]().finally(() => {
			inFlight[key] = undefined;
			pendingLoads = Math.max(0, pendingLoads - 1);
		});
		inFlight[key] = task;

		await task;
		loadedAt[key] = Date.now();
		loaded[key] = true;
	}

	async function loadAll() {
		// Each section loads on its own so one missing RPC or policy does not
		// blank the whole console.
		await Promise.all([
			ensureTab('overview', { force: true }),
			ensureTab('reports', { force: true }),
			ensureTab('users', { force: true })
		]);
	}

	function askReason(
		action: 'warn' | 'ban',
		userId: string | null | undefined,
		name: string
	): boolean {
		if (!userId) return false;
		reasonPrompt = {
			action,
			userId,
			name,
			fallback:
				action === 'warn'
					? 'Insulting another member'
					: 'Repeated or serious community guideline violations.'
		};
		return true;
	}

	async function warnUser(userId: string | null | undefined, name: string, reason?: string) {
		if (!userId) {
			journal.toast('That comment has no author to warn.');
			return;
		}

		if (reason === undefined) {
			askReason('warn', userId, name);
			return;
		}

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

	async function deleteReportedComment(report: ReportRow) {
		if (!report.comment_id) return;

		busyDeleteComment = report.comment_id;
		error = '';

		try {
			const { data, error: rpcError } = await supabase.rpc('vidjo_admin_delete_comment', {
				p_comment_id: report.comment_id
			});
			if (rpcError) throw rpcError;
			if (!data) {
				journal.toast('That comment is already gone.');
			} else {
				reports = reports.filter((item) => item.id !== report.id);
				journal.toast('Comment removed. The report was cleared too.');
			}
		} catch (err) {
			error = errorText(err, 'Could not remove that comment.');
		} finally {
			busyDeleteComment = '';
		}
	}

	async function banUser(userId: string | null | undefined, name: string, reason?: string) {
		if (!userId) {
			journal.toast('That comment has no author to ban.');
			return;
		}

		if (reason === undefined) {
			askReason('ban', userId, name);
			return;
		}

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
		if (role === 'admin') return 'border-book-accent/40 bg-book-accent/15 text-book-bg';
		if (role === 'banned') return 'border-danger/40 bg-danger/15 text-danger-soft';
		return 'border-cover-edge bg-cover-edge/20 text-lav';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') open = false;
	}

	$effect(() => {
		if (open && isAdmin()) {
			void ensureTab(tab);
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
				class="absolute inset-0 border-0 bg-black/85"
				aria-label="Close admin console"
				onclick={() => (open = false)}
			></button>

			<div
				class="relative flex max-h-[95vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[26px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_40px_120px_rgba(0,0,0,.7)]"
			>
				<!-- Header -->
				<header
					class="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-cover-edge bg-desk-2 px-5 py-4 sm:px-7 sm:py-5"
				>
					<div class="min-w-0">
						<h2 class="font-display text-[26px] leading-tight font-bold text-book-bg">
							Admin console
						</h2>
						<p class="mt-0.5 font-ui text-xs text-lav/80">
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
							class="flex size-9 items-center justify-center rounded-xl border border-cover-edge bg-cover/25 text-lav transition-colors hover:bg-cover/40 hover:text-book-bg"
							aria-label="Close admin console"
							onclick={() => (open = false)}
						>
							<CommunityIcon name="x" size={16} />
						</button>
					</div>
				</header>

				<!-- Tabs -->
				<nav
					class="flex shrink-0 gap-1 overflow-x-auto border-b border-cover-edge bg-desk px-3 py-2 sm:px-6"
					aria-label="Admin sections"
				>
					{#each tabs as item (item.key)}
						<button
							type="button"
							class="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-colors {tab ===
							item.key
								? 'bg-cta text-cta-text'
								: 'text-lav/80 hover:bg-white/5 hover:text-book-bg'}"
							aria-current={tab === item.key ? 'page' : undefined}
							onclick={() => (tab = item.key)}
						>
							{item.label}
							{#if item.count !== null}
								<span
									class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums {tab ===
									item.key
										? 'bg-white/20 text-cta-text'
										: 'bg-white/10 text-lav'}"
								>
									{item.count}
								</span>
							{/if}
						</button>
					{/each}
				</nav>

				<!-- Body -->
				<div class="min-h-0 flex-1 modal-scroll overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
					{#if error}
						<p
							class="mb-4 rounded-xl border border-danger/60 bg-danger/20 px-4 py-3 font-ui text-sm text-danger-soft"
							role="alert"
						>
							{error}
						</p>
					{/if}

					{#if tab === 'overview'}
						{#if overviewError}
							<div
								class="mb-4 rounded-xl border border-danger/60 bg-danger/20 px-4 py-3 font-ui text-sm text-danger-soft"
								role="alert"
							>
								<p class="font-semibold">Stats unavailable</p>
								<p class="mt-1 break-words opacity-90">{overviewError}</p>
								<button
									type="button"
									class="mt-2 font-ui text-xs font-bold underline"
									onclick={() => void loadOverview()}
								>
									Try again
								</button>
							</div>
						{/if}

						{#if !overview && loading}
							<div class="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
								{#each [0, 1, 2, 3] as slot (slot)}
									<div
										class="h-28 animate-pulse rounded-2xl border border-cover-edge/70 bg-desk-2"
									></div>
								{/each}
							</div>
						{:else if overview}
							<!-- Headline numbers -->
							<div class="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
								{#each kpis as kpi (kpi.label)}
									<div class="rounded-2xl border border-cover-edge/70 bg-desk-2 p-4">
										<div class="flex items-center justify-between gap-2">
											<p class="font-ui text-xs font-semibold text-lav/80">{kpi.label}</p>
											<span class="flex size-8 items-center justify-center rounded-full {kpi.chip}">
												<CommunityIcon name={kpi.icon} size={15} />
											</span>
										</div>
										<p
											class="mt-2 font-display text-3xl leading-none font-bold text-book-bg tabular-nums"
										>
											{kpi.value.toLocaleString()}
										</p>
										<p class="mt-1 font-ui text-[11px] text-lav/70">{kpi.note}</p>
									</div>
								{/each}
							</div>

							<!-- Activity chart -->
							<section class="mt-4 rounded-2xl border border-cover-edge/70 bg-desk-2 p-5">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div>
										<h3 class="font-display text-xl leading-tight font-bold text-book-bg">
											Activity, last {overview.window_days} days
										</h3>
										<p class="mt-0.5 font-ui text-xs text-lav/70">
											Feature names and counts only. Journal text is never recorded.
										</p>
									</div>
									<div class="flex items-center gap-5">
										<div class="text-right">
											<p
												class="font-display text-2xl leading-none font-bold text-book-accent tabular-nums"
											>
												{overview.events_total.toLocaleString()}
											</p>
											<p class="font-ui text-[11px] text-lav/70">events</p>
										</div>
										<div class="text-right">
											<p class="font-display text-2xl leading-none font-bold text-lav tabular-nums">
												{overview.active_users.toLocaleString()}
											</p>
											<p class="font-ui text-[11px] text-lav/70">active members</p>
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
													class="w-full rounded-t-[3px] bg-gradient-to-t from-book-accent/55 to-book-accent transition-opacity group-hover:opacity-80"
													style={`height: ${Math.max(2, (point.events / maxDaily) * 100)}%`}
												></div>
											</div>
										{/each}
									</div>
									<div class="mt-2 flex justify-between font-ui text-[10px] text-lav/70">
										<span>{dayLabel(overview.daily[0]?.day)}</span>
										<span>Today</span>
									</div>
								{:else}
									<div
										class="mt-4 rounded-xl border border-cover-edge bg-desk-2/60 px-4 py-8 text-center"
									>
										<CommunityIcon name="trending" size={26} class="mx-auto text-lav/70" />
										<p class="mt-2 font-ui text-sm font-semibold text-lav">
											No activity recorded yet.
										</p>
										<p class="mt-1 font-ui text-xs text-lav/70">
											Events appear here as members use VidJo. Only feature names and counts are
											stored.
										</p>
									</div>
								{/if}
							</section>

							<div class="mt-4 grid gap-4 min-[860px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
								<!-- Top features -->
								<section class="rounded-2xl border border-cover-edge/70 bg-desk-2 p-5">
									<div class="flex items-baseline justify-between gap-3">
										<h3 class="font-display text-xl leading-tight font-bold text-book-bg">
											Most used features
										</h3>
										<span class="font-ui text-[11px] text-lav/70 tabular-nums">
											last {overview.window_days} days
										</span>
									</div>

									{#if overview.top_events.length > 0}
										<ul class="mt-4 space-y-3">
											{#each overview.top_events as item (item.event)}
												<li>
													<div class="flex items-baseline justify-between gap-3">
														<span class="font-ui text-sm font-semibold text-book-bg">
															{eventLabel(item.event)}
														</span>
														<span class="font-ui text-xs font-semibold text-lav/80 tabular-nums">
															{item.count.toLocaleString()}
														</span>
													</div>
													<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cover/25">
														<div
															class="h-full rounded-full bg-gradient-to-r from-book-accent/55 to-book-accent"
															style={`width: ${(item.count / maxFeature) * 100}%`}
														></div>
													</div>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="mt-4 font-ui text-sm text-lav/70">
											Feature usage will show up after the first few sessions.
										</p>
									{/if}
								</section>

								<div class="space-y-4">
									<!-- Today -->
									<section class="rounded-2xl border border-cover-edge/70 bg-desk-2 p-5">
										<div class="flex items-center gap-2">
											<CommunityIcon name="sun" size={16} class="text-book-accent" />
											<h3 class="font-display text-xl leading-none font-bold text-book-bg">
												Right now
											</h3>
										</div>
										<div class="mt-4 grid grid-cols-2 gap-3">
											<div class="rounded-xl bg-desk px-3 py-3">
												<p
													class="font-display text-3xl leading-none font-bold text-book-accent tabular-nums"
												>
													{overview.events_today.toLocaleString()}
												</p>
												<p class="mt-1 font-ui text-[11px] text-lav/70">events today</p>
											</div>
											<div class="rounded-xl bg-desk px-3 py-3">
												<p
													class="font-display text-3xl leading-none font-bold text-lav tabular-nums"
												>
													{overview.active_users_today.toLocaleString()}
												</p>
												<p class="mt-1 font-ui text-[11px] text-lav/70">members today</p>
											</div>
										</div>
										<p class="mt-3 font-ui text-[11px] leading-relaxed text-lav/70">
											Counts use the server clock and reset at midnight.
										</p>
									</section>

									<!-- Moderation snapshot -->
									<section class="rounded-2xl border border-cover-edge/70 bg-desk-2 p-5">
										<div class="flex items-center gap-2">
											<CommunityIcon name="flame" size={16} class="text-danger-soft" />
											<h3 class="font-display text-xl leading-none font-bold text-book-bg">
												Moderation
											</h3>
										</div>
										<p class="mt-3 font-ui text-sm text-lav">
											<span class="font-bold text-book-bg">{overview.reports_new}</span>
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
								<h3 class="font-display text-2xl leading-tight font-bold text-book-bg">
									Comment reports
								</h3>
								<p class="mt-0.5 font-ui text-xs text-lav/80">
									Flagged comments from friends and community pages.
								</p>
							</div>
							<span class="font-ui text-xs text-lav/80 tabular-nums">
								{reports.length}
								{reports.length === 1 ? 'report' : 'reports'}
							</span>
						</div>

						{#if reportsError}
							<div
								class="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 font-ui text-sm text-book-bg"
								role="alert"
							>
								<p class="font-semibold">Reports could not be loaded</p>
								<p class="mt-1 break-words text-lav/85">{reportsError}</p>
								<button
									type="button"
									class="mt-2 font-ui text-xs font-bold underline"
									onclick={() => void loadReports()}
								>
									Try again
								</button>
							</div>
						{/if}

						{#if loading && reports.length === 0}
							<div class="space-y-3">
								{#each [0, 1, 2] as slot (slot)}
									<div
										class="h-28 animate-pulse rounded-2xl border border-cover-edge/70 bg-desk-2"
									></div>
								{/each}
							</div>
						{:else if reports.length === 0}
							<div class="rounded-2xl border border-cover-edge bg-desk-2/60 px-6 py-14 text-center">
								<CommunityIcon name="check" size={30} class="mx-auto text-book-accent/70" />
								<p class="mt-3 font-display text-2xl font-bold text-book-bg">Nothing flagged</p>
								<p class="mt-1 font-ui text-sm text-lav/80">
									Reports will appear here when someone flags a comment.
								</p>
							</div>
						{:else}
							<div class="space-y-3">
								{#each reports as report (report.id)}
									<article
										class="relative overflow-hidden rounded-2xl border border-cover-edge bg-desk p-4 pl-5 text-book-bg shadow-[0_10px_24px_rgba(0,0,0,.28)]"
									>
										<span
											class="absolute inset-y-0 left-0 w-1.5 bg-book-accent/80"
											aria-hidden="true"
										></span>

										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<span class="font-ui text-xs font-bold text-book-bg">
												{report.reporter_name || 'Unknown member'}
											</span>
											<span class="font-ui text-[11px] text-lav/80">reported</span>
											<span class="font-ui text-xs font-bold text-book-bg">
												{report.reported_user || 'Unknown member'}
											</span>
											<span
												class="ml-auto rounded-full border border-book-accent/40 bg-book-accent/15 px-2.5 py-0.5 font-ui text-[10px] font-semibold text-book-bg/90 capitalize"
											>
												{report.reason || 'other'}
											</span>
										</div>

										{#if report.comment_body}
											<blockquote
												class="mt-3 rounded-r-xl border-l-[3px] border-book-accent/60 bg-cover/20 px-3 py-2 font-hand text-lg leading-snug break-words text-book-bg/90"
											>
												{report.comment_body}
											</blockquote>
										{:else}
											<p class="mt-3 font-ui text-xs text-lav/75">
												The comment is no longer available.
											</p>
										{/if}

										<div
											class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-cover-edge/70 pt-3"
										>
											<time class="font-ui text-[10px] text-lav/70" datetime={report.created_at}>
												{formatDate(report.created_at)}
											</time>

											{#if report.reported_user_id}
												<div class="flex flex-wrap gap-2">
													<Button
														size="sm"
														variant="danger"
														icon="trash"
														loading={busyDeleteComment === report.comment_id}
														disabled={Boolean(busyWarn || busyUser || busyDeleteComment)}
														onclick={() => (confirmDeleteReport = report)}
													>
														Delete comment
													</Button>
													<Button
														size="sm"
														variant="outline"
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
												<span class="font-ui text-[10px] text-lav/70">
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
								<h3 class="font-display text-2xl leading-tight font-bold text-book-bg">Members</h3>
								<p class="mt-0.5 font-ui text-xs text-lav/70">
									Warn, ban, or restore accounts. Banning never deletes journals or posts.
								</p>
							</div>
							<span class="font-ui text-xs text-lav/80 tabular-nums">
								{filteredUsers.length} of {users.length}
							</span>
						</div>

						{#if usersCapped}
							<p class="mb-3 font-ui text-[11px] text-lav/70">
								Showing the newest {USERS_LIMIT.toLocaleString()} members.
							</p>
						{/if}

						<div class="mb-4 flex flex-wrap items-center gap-2">
							<label class="relative min-w-[220px] flex-1">
								<span class="sr-only">Search members</span>
								<CommunityIcon
									name="search"
									size={16}
									class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lav/70"
								/>
								<input
									type="search"
									class="h-11 w-full rounded-xl border border-cover-edge/70 bg-desk pr-3 pl-9 font-ui text-sm text-book-bg placeholder:text-lav/70 focus:border-book-accent focus:outline-none"
									placeholder="Search by nickname or @username"
									bind:value={userSearch}
								/>
							</label>

							<div
								class="inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-cover-edge/70 bg-desk p-1"
								role="group"
								aria-label="Filter members by role"
							>
								{#each ['all', 'user', 'admin', 'banned'] as role (role)}
									<button
										type="button"
										class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-ui text-xs font-semibold capitalize transition-colors {roleFilter ===
										role
											? 'bg-cta text-cta-text'
											: 'text-lav/80 hover:text-book-bg'}"
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

						{#if usersError}
							<div
								class="mb-4 rounded-xl border border-danger/60 bg-danger/20 px-4 py-3 font-ui text-sm text-danger-soft"
								role="alert"
							>
								<p class="font-semibold">Member list issue</p>
								<p class="mt-1 break-words opacity-90">{usersError}</p>
								<button
									type="button"
									class="mt-2 font-ui text-xs font-bold underline"
									onclick={() => void loadUsers()}
								>
									Try again
								</button>
							</div>
						{/if}

						{#if loading && users.length === 0}
							<div class="space-y-2">
								{#each [0, 1, 2, 3, 4] as slot (slot)}
									<div
										class="h-16 animate-pulse rounded-xl border border-cover-edge/70 bg-desk-2"
									></div>
								{/each}
							</div>
						{:else if filteredUsers.length === 0}
							<div class="rounded-2xl border border-cover-edge bg-desk-2/60 px-6 py-12 text-center">
								<CommunityIcon name="search" size={28} class="mx-auto text-lav/70" />
								<p class="mt-3 font-ui text-sm font-semibold text-lav">
									No members match that search.
								</p>
								<button
									type="button"
									class="mt-3 font-ui text-xs font-semibold text-book-bg underline decoration-book-accent/70 underline-offset-4 hover:decoration-book-accent"
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
										class="flex flex-wrap items-center gap-3 rounded-xl border border-cover-edge/70 bg-desk-2 px-3 py-3 transition-colors hover:border-cover-edge/70"
									>
										<Avatar
											src={user.avatar_url}
											name={user.display_name || user.username}
											className="size-10"
											textClass="text-base"
											ring="ring-2 ring-gold/30"
										/>

										<div class="min-w-0 flex-1">
											<p class="truncate font-ui text-sm font-bold text-book-bg">
												{user.display_name || user.username}
											</p>
											<p class="truncate font-ui text-[11px] text-lav/70">
												@{user.username} · joined {formatDate(user.created_at)}
											</p>
											{#if user.user_role === 'banned' && user.ban_reason}
												<p class="mt-0.5 truncate font-ui text-[10px] text-danger-soft">
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
					{:else if tab === 'bans'}
						<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
							<div>
								<h3 class="font-display text-2xl leading-tight font-bold text-book-bg">Ban list</h3>
								<p class="mt-0.5 font-ui text-xs text-lav/70">
									Accounts that cannot sign in. Restoring keeps all of their pages and posts.
								</p>
							</div>
							<span class="font-ui text-xs text-lav/80 tabular-nums">
								{bannedUsers.length}
								{bannedUsers.length === 1 ? 'account' : 'accounts'}
							</span>
						</div>

						{#if loading && users.length === 0}
							<div class="space-y-2">
								{#each [0, 1, 2, 3] as slot (slot)}
									<div
										class="h-16 animate-pulse rounded-xl border border-cover-edge/70 bg-desk-2"
									></div>
								{/each}
							</div>
						{:else if bannedUsers.length === 0}
							<div class="rounded-2xl border border-cover-edge bg-desk-2/60 px-6 py-12 text-center">
								<CommunityIcon name="shield" size={28} class="mx-auto text-lav/70" />
								<p class="mt-3 font-ui text-sm font-semibold text-lav">
									No banned accounts right now.
								</p>
								<p class="mt-1 font-ui text-xs text-lav/70">
									Issue a warning or ban from Reports or the Users tab.
								</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each bannedUsers as user (user.user_id)}
									<div
										class="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-3"
									>
										<Avatar
											src={user.avatar_url}
											name={user.display_name || user.username}
											className="size-10"
											textClass="text-base"
											ring="ring-2 ring-danger/40"
										/>

										<div class="min-w-0 flex-1">
											<p class="truncate font-ui text-sm font-bold text-book-bg">
												{user.display_name || user.username}
											</p>
											<p class="truncate font-ui text-[11px] text-lav/70">@{user.username}</p>
											<p class="mt-0.5 truncate font-ui text-[10px] text-danger-soft">
												Ban reason: {user.ban_reason || 'No reason recorded'}
											</p>
											{#if user.banned_at}
												<p class="font-ui text-[10px] text-lav/70">
													Banned {formatDate(user.banned_at)}
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
				class="absolute inset-0 border-0 bg-black/85"
				aria-label="Close admin console"
				onclick={() => (open = false)}
			></button>
			<div
				class="relative mx-4 max-w-[340px] rounded-[24px] border border-danger bg-danger/20 p-8 text-center text-book-bg shadow-[0_40px_100px_rgba(0,0,0,.7)]"
			>
				<span
					class="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/15 text-danger-soft"
				>
					<CommunityIcon name="lock" size={24} />
				</span>
				<h2 class="mt-4 font-display text-xl font-bold">Admin access required</h2>
				<p class="mt-2 font-ui text-sm text-danger-soft">
					Only administrators can open this console.
				</p>
				<p class="mt-3 rounded-lg bg-black/20 px-3 py-2 font-ui text-[11px] text-lav/90">
					Signed in as <strong>@{profile.username || 'unknown'}</strong><br />
					Role:
					<strong
						>{profile.profile?.user_role ?? (profile.loading ? 'loading…' : 'not loaded')}</strong
					>
				</p>
				<p class="mt-2 font-ui text-[11px] text-lav">
					An admin needs <code class="text-book-bg">user_role = 'admin'</code> in
					<code class="text-book-bg">vidjo_profiles</code>.
				</p>
				<Button class="mt-5" variant="outline" onclick={() => (open = false)}>Close</Button>
			</div>
		{/if}
	</div>
{/if}

<ConfirmModal
	open={confirmDeleteReport !== null}
	title="Delete this comment?"
	message="The comment will be removed for everyone and the report will be cleared. This cannot be undone."
	confirmLabel="Delete comment"
	onConfirm={() => {
		const report = confirmDeleteReport;
		confirmDeleteReport = null;
		if (report) void deleteReportedComment(report);
	}}
	onCancel={() => (confirmDeleteReport = null)}
/>

<PromptModal
	open={reasonPrompt !== null}
	title={reasonPrompt?.action === 'warn' ? 'Warn this member' : 'Suspend this member'}
	message={reasonPrompt ? `Reason for ${reasonPrompt.name}. This is shown to the member.` : ''}
	hint="This is shown to the member."
	initialValue={reasonPrompt?.fallback ?? ''}
	placeholder="Write a clear reason"
	confirmLabel={reasonPrompt?.action === 'warn' ? 'Send warning' : 'Suspend member'}
	tone="danger"
	icon="alert"
	maxLength={240}
	onConfirm={(reason) => {
		const prompt = reasonPrompt;
		reasonPrompt = null;
		if (!prompt) return;
		if (prompt.action === 'warn') void warnUser(prompt.userId, prompt.name, reason);
		else void banUser(prompt.userId, prompt.name, reason);
	}}
	onCancel={() => (reasonPrompt = null)}
/>
