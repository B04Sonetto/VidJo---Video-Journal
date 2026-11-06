<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { supabase, isSupabaseConfigured } from '#lib/supabase';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let error = $state('');
	let stats = $state<{ users: number; reports: number; posts: number } | null>(null);
	let reports = $state<
		Array<{
			id: string;
			comment_id: string;
			reason: string;
			created_at: string;
			reporter: string;
			reported_user: string;
		}>
	>([]);
	let users = $state<
		Array<{
			user_id: string;
			username: string;
			display_name: string;
			user_role: string;
			created_at: string;
		}>
	>([]);

	type ReportRow = {
		id: string;
		comment_id: string;
		reason: string;
		created_at: string;
		reporter_name: string | null;
		reported_user: string | null;
	};

	function isAdmin() {
		return profile.profile?.user_role === 'admin';
	}

	async function loadStats() {
		if (!isSupabaseConfigured) return;
		error = '';
		try {
			const [usersRes, reportsRes, postsRes] = await Promise.all([
				supabase.from('vidjo_profiles').select('*', { count: 'exact', head: true }),
				supabase.from('vidjo_comment_reports').select('*', { count: 'exact', head: true }),
				supabase.from('vidjo_entries').select('*', { count: 'exact', head: true })
			]);
			const failure = usersRes.error ?? reportsRes.error ?? postsRes.error;
			if (failure) throw failure;
			stats = {
				users: usersRes.count ?? 0,
				reports: reportsRes.count ?? 0,
				posts: postsRes.count ?? 0
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load stats.';
		}
	}

	async function loadReports() {
		if (!isSupabaseConfigured) return;
		error = '';
		try {
			// A SECURITY DEFINER RPC (schema.sql) joins the reporter, the comment
			// author, and the comment body. PostgREST cannot embed auth.users, and
			// admins may not be allowed to SELECT the reported comment directly, so
			// a plain `.select('*, reporter:…, comment:…')` silently returned nothing.
			const { data, error: loadError } = await supabase.rpc('vidjo_admin_list_reports', {
				max_rows: 50
			});
			if (loadError) throw loadError;

			reports = ((data ?? []) as ReportRow[]).map((row) => ({
				id: row.id,
				comment_id: row.comment_id,
				reason: row.reason,
				created_at: row.created_at,
				reporter: row.reporter_name || 'Unknown',
				reported_user: row.reported_user || 'Unknown'
			}));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load reports.';
		}
	}

	async function loadUsers() {
		if (!isSupabaseConfigured) return;
		error = '';
		try {
			const { data, error: loadError } = await supabase
				.from('vidjo_profiles')
				.select('*')
				.order('created_at', { ascending: false });
			if (loadError) throw loadError;
			users = (data ?? []) as Array<{
				user_id: string;
				username: string;
				display_name: string;
				user_role: string;
				created_at: string;
			}>;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load users.';
		}
	}

	async function banUser(userId: string) {
		const target = users.find((user) => user.user_id === userId);
		if (target?.user_role === 'admin') {
			journal.toast('Admin accounts cannot be banned.');
			return;
		}
		if (!confirm('Ban this user? This cannot be undone.')) return;
		if (!isSupabaseConfigured) return;
		error = '';
		try {
			const { error } = await supabase
				.from('vidjo_profiles')
				.update({ user_role: 'banned' })
				.eq('user_id', userId);
			if (error) throw error;
			await loadUsers();
			journal.toast('User banned');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to ban user.';
		}
	}

	async function unbanUser(userId: string) {
		if (!isSupabaseConfigured) return;
		error = '';
		try {
			const { error } = await supabase
				.from('vidjo_profiles')
				.update({ user_role: 'user' })
				.eq('user_id', userId);
			if (error) throw error;
			await loadUsers();
			journal.toast('User unbanned');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to unban user.';
		}
	}

	$effect(() => {
		if (open && isAdmin()) {
			void loadStats();
			void loadReports();
			void loadUsers();
		}
	});
</script>

<div
	class="fixed inset-0 z-[50] flex items-center justify-center"
	aria-hidden={!open || undefined}
	role="dialog"
	aria-modal="true"
	aria-label="Admin panel"
>
	{#if open && isAdmin()}
		<button
			type="button"
			class="absolute inset-0 border-0 bg-black/70 backdrop-blur-sm"
			aria-label="Close admin panel"
			onclick={() => (open = false)}
		></button>
		<div
			class="relative flex max-h-[90vh] w-full max-w-[700px] flex-col rounded-[24px] border border-[#523A7A] bg-desk-2 p-6 text-white shadow-[0_40px_100px_rgba(0,0,0,.6)]"
		>
			<div class="mb-6 flex items-center justify-between">
				<h2 class="flex items-center gap-2 font-display text-xl font-bold">
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
						<line x1="12" y1="8" x2="12.01" y2="12"></line>
					</svg>
					Admin Panel
				</h2>
				<button
					type="button"
					class="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 font-ui text-xs text-[#D6CBEC] hover:bg-white/20"
					onclick={() => (open = false)}
				>
					Close
				</button>
			</div>

			{#if error}
				<p
					class="mb-4 rounded-lg border border-[#D19A9A] bg-[#3A222B] px-3 py-2 font-ui text-xs text-[#FF9B9B]"
				>
					{error}
				</p>
			{/if}

			<!-- Stats -->
			<div class="mb-6 grid grid-cols-3 gap-3">
				{#if stats}
					{#each Object.entries(stats) as [key, value] (key)}
						<div class="rounded-xl border border-[#4D366D] bg-[#24143D] p-4 text-center">
							<div class="font-display text-2xl font-bold text-gold">{value}</div>
							<div class="font-ui text-[11px] tracking-wider text-[#BBA8E0] uppercase">{key}</div>
						</div>
					{/each}
				{:else}
					<div class="rounded-xl border border-[#4D366D] bg-[#24143D] p-4 text-center">
						<div class="animate-pulse font-display text-2xl font-bold text-gold">--</div>
						<div class="font-ui text-[11px] tracking-wider text-[#BBA8E0] uppercase">loading</div>
					</div>
				{/if}
			</div>

			<!-- Reports -->
			<div class="mb-6 flex-1 overflow-y-auto">
				<h3 class="mb-3 font-ui text-xs font-bold tracking-wider text-gold uppercase">
					Comment Reports ({reports.length})
				</h3>
				{#if reports.length === 0}
					<p class="text-xs text-[#BBA8E0]">No reports filed.</p>
				{:else}
					<div class="space-y-2">
						{#each reports as report (report.id)}
							<div class="rounded-lg border border-[#4D366D] bg-[#24143D]/50 p-3">
								<div class="mb-1 flex items-baseline justify-between gap-2">
									<span class="font-ui text-xs font-bold text-white">{report.reporter}</span>
									<span class="font-ui text-[10px] text-[#BBA8E0]">reported</span>
									<span class="font-ui text-xs font-bold text-white">{report.reported_user}</span>
								</div>
								<p class="mb-2 font-hand text-sm text-[#D6CBEC]">
									"{report.reason}"
								</p>
								<time class="font-ui text-[10px] text-[#8B6FD0]"
									>{new Date(report.created_at).toLocaleString()}</time
								>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Users -->
			<div class="mb-6 flex-1 overflow-y-auto">
				<h3 class="mb-3 font-ui text-xs font-bold tracking-wider text-gold uppercase">
					Users ({users.length})
				</h3>
				{#if users.length === 0}
					<p class="text-xs text-[#BBA8E0]">No users found.</p>
				{:else}
					<div class="space-y-2">
						{#each users as user (user.user_id)}
							<div
								class="flex items-center justify-between rounded-lg border border-[#4D366D] bg-[#24143D]/50 p-3"
							>
								<div>
									<div class="font-ui text-xs font-bold text-white">{user.display_name}</div>
									<div class="font-ui text-[10px] text-[#BBA8E0]">@{user.username}</div>
								</div>
								<div class="flex items-center gap-2">
									<span
										class="rounded px-2 py-0.5 text-[10px] font-bold {user.user_role === 'admin'
											? 'border border-[#4F9DEB]/40 bg-[#4F9DEB]/20 text-[#4F9DEB]'
											: user.user_role === 'banned'
												? 'border border-[#D19A9A]/40 bg-[#D19A9A]/20 text-[#D19A9A]'
												: 'border border-[#523A7A]/40 bg-[#523A7A]/20 text-[#D6CBEC]'}"
									>
										{user.user_role}
									</span>
									{#if user.user_role === 'admin'}
										<span
											class="flex size-7 items-center justify-center text-[#8B6FD0]"
											title="Admin accounts cannot be banned"
											aria-label="Admin account"
										>
											🛡️
										</span>
									{:else}
										<button
											type="button"
											class="size-7 rounded text-[#BBA8E0] hover:bg-white/10 hover:text-white"
											onclick={() =>
												user.user_role === 'banned'
													? unbanUser(user.user_id)
													: banUser(user.user_id)}
											aria-label={user.user_role === 'banned' ? 'Unban user' : 'Ban user'}
										>
											{user.user_role === 'banned' ? '🔓' : '🚫'}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else if open && !isAdmin()}
		<button
			type="button"
			class="absolute inset-0 border-0 bg-black/70 backdrop-blur-sm"
			aria-label="Close admin panel"
			onclick={() => (open = false)}
		></button>
		<div
			class="relative mx-4 max-w-[320px] rounded-[24px] border border-[#D19A9A] bg-[#3A222B] p-8 text-center text-white shadow-[0_40px_100px_rgba(0,0,0,.6)]"
		>
			<h2 class="font-display text-xl font-bold">Admin access required</h2>
			<p class="mt-3 font-ui text-sm text-[#FF9B9B]">
				Only administrators can open the admin panel.
			</p>
			<button
				type="button"
				class="mt-5 rounded-xl border border-white/20 bg-white/10 px-4 py-2 font-ui text-sm text-[#D6CBEC] hover:bg-white/20"
				onclick={() => (open = false)}
			>
				OK
			</button>
		</div>
	{/if}
</div>
