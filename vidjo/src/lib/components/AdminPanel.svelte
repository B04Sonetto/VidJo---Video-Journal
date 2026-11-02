<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { supabase, isSupabaseConfigured } from '#lib/supabase';
	import type { Profile } from '#lib/types';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let loading = $state(false);
	let error = $state('');
	let stats = $state<{ users: number; reports: number; posts: number } | null>(null);
	let reports = $state<Array<{ id: string; comment_id: string; reason: string; created_at: string; reporter: string; reported_user: string }>>([]);
	let users = $state<Array<{ user_id: string; username: string; display_name: string; user_role: string; created_at: string }>>([]);

	function isAdmin() {
		return profile.profile?.user_role === 'admin';
	}

	async function loadStats() {
		if (!isSupabaseConfigured) return;
		loading = true;
		try {
			const [{ count: u }, { count: r }, { count: p }] = await Promise.all([
				supabase.from('vidjo_profiles').select('*', { count: 'exact', head: true }),
				supabase.from('vidjo_comment_reports').select('*', { count: 'exact', head: true }),
				supabase.from('vidjo_entries').select('*', { count: 'exact', head: true })
			]);
			stats = { users: u ?? 0, reports: r ?? 0, posts: p ?? 0 };
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load stats.';
		} finally {
			loading = false;
		}
	}

	async function loadReports() {
		if (!isSupabaseConfigured) return;
		try {
			const { data } = await supabase
				.from('vidjo_comment_reports')
				.select('*, reporter:reporter_id (username, display_name), comment:comment_id (author_id)')
				.order('created_at', { ascending: false })
				.limit(50);

			// Enrich with reported user info.
			const enriched = await Promise.all(
				(data ?? []).map(async (report: any) => {
					const authorId = report.comment?.author_id;
					let reportedUser = 'Unknown';
					if (authorId) {
						const { data: p } = await supabase
							.from('vidjo_profiles')
							.select('display_name, username')
							.eq('user_id', authorId)
							.maybeSingle();
						reportedUser = p?.display_name || p?.username || 'Unknown';
					}
					return {
						id: report.id,
						comment_id: report.comment_id,
						reason: report.reason,
						created_at: report.created_at,
						reporter: report.reporter?.display_name || report.reporter?.username || 'Unknown',
						reported_user: reportedUser
					};
				})
			);
			reports = enriched;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load reports.';
		}
	}

	async function loadUsers() {
		if (!isSupabaseConfigured) return;
		try {
			const { data } = await supabase.from('vidjo_profiles').select('*').order('created_at', { ascending: false });
			users = (data ?? []) as Array<{ user_id: string; username: string; display_name: string; user_role: string; created_at: string }>;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load users.';
		}
	}

	async function banUser(userId: string) {
		if (!confirm('Ban this user? This cannot be undone.')) return;
		if (!isSupabaseConfigured) return;
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
		<div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={() => (open = false)}></div>
		<div
			class="relative w-full max-w-[700px] max-h-[90vh] rounded-[24px] border border-[#523A7A] bg-desk-2 p-6 shadow-[0_40px_100px_rgba(0,0,0,.6)] text-white flex flex-col"
		>
			<div class="flex items-center justify-between mb-6">
				<h2 class="font-display text-xl font-bold flex items-center gap-2">
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
				<p class="mb-4 rounded-lg border border-[#D19A9A] bg-[#3A222B] px-3 py-2 font-ui text-xs text-[#FF9B9B]">
					{error}
				</p>
			{/if}

			<!-- Stats -->
			<div class="mb-6 grid grid-cols-3 gap-3">
				{#if stats}
					{#each Object.entries(stats) as [key, value]}
						<div class="rounded-xl border border-[#4D366D] bg-[#24143D] p-4 text-center">
							<div class="font-display text-2xl font-bold text-gold">{value}</div>
							<div class="font-ui text-[11px] text-[#BBA8E0] uppercase tracking-wider">{key}</div>
						</div>
					{/each}
				{:else}
					<div class="rounded-xl border border-[#4D366D] bg-[#24143D] p-4 text-center">
						<div class="animate-pulse font-display text-2xl font-bold text-gold">--</div>
						<div class="font-ui text-[11px] text-[#BBA8E0] uppercase tracking-wider">loading</div>
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
								<div class="flex items-baseline justify-between gap-2 mb-1">
									<span class="font-ui text-xs font-bold text-white">{report.reporter}</span>
									<span class="font-ui text-[10px] text-[#BBA8E0]">reported</span>
									<span class="font-ui text-xs font-bold text-white">{report.reported_user}</span>
								</div>
								<p class="mb-2 font-hand text-sm text-[#D6CBEC]">
									"{report.reason}"
								</p>
								<time class="font-ui text-[10px] text-[#8B6FD0]">{new Date(report.created_at).toLocaleString()}</time>
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
							<div class="flex items-center justify-between rounded-lg border border-[#4D366D] bg-[#24143D]/50 p-3">
								<div>
									<div class="font-ui text-xs font-bold text-white">{user.display_name}</div>
									<div class="font-ui text-[10px] text-[#BBA8E0]">@{user.username}</div>
								</div>
								<div class="flex items-center gap-2">
									<span
										class="px-2 py-0.5 rounded text-[10px] font-bold {user.user_role === 'admin'
											? 'bg-[#4F9DEB]/20 text-[#4F9DEB] border border-[#4F9DEB]/40'
											: user.user_role === 'banned'
												? 'bg-[#D19A9A]/20 text-[#D19A9A] border border-[#D19A9A]/40'
												: 'bg-[#523A7A]/20 text-[#D6CBEC] border border-[#523A7A]/40'}"
									>
										{user.user_role}
									</span>
									<button
										type="button"
										class="size-7 rounded hover:bg-white/10 text-[#BBA8E0] hover:text-white"
										onclick={() =>
											user.user_role === 'banned' ? unbanUser(user.user_id) : banUser(user.user_id)
										}
										aria-label={user.user_role === 'banned' ? 'Unban user' : 'Ban user'}
									>
										{user.user_role === 'banned' ? '🔓' : '🚫'}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else if open && !isAdmin()}
		<div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={() => (open = false)}></div>
		<div
			class="relative rounded-[24px] border border-[#D19A9A] bg-[#3A222B] p-8 shadow-[0_40px_100px_rgba(0,0,0,.6)] text-center text-white max-w-[320px] mx-4"
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
