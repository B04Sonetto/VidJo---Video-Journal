<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { TODAY } from '#lib/dates';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { NotificationItem } from '#lib/types';

	type RequestNotification = NotificationItem & { type: 'friend_request' };

	let filter = $state<'all' | 'requests' | 'comments'>('all');
	let busyAction = $state('');

	$effect(() => {
		// A notification that arrives while this screen is open has been seen.
		// The effect also runs on mount, so no separate `onMount` is needed.
		void friends.notifications.length;
		friends.markNotificationsRead();
	});

	const requestNotifications = $derived.by<RequestNotification[]>(() =>
		friends.notifications
			.filter((n): n is RequestNotification => n.type === 'friend_request')
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
	);

	const commentNotifications = $derived.by<NotificationItem[]>(() =>
		friends.notifications
			.filter((n) => n.type === 'comment')
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
	);

	const visibleRequests = $derived(filter === 'comments' ? [] : requestNotifications);
	const visibleComments = $derived(filter === 'requests' ? [] : commentNotifications);
	const visibleCount = $derived(visibleRequests.length + visibleComments.length);

	const filters = $derived([
		{ key: 'all' as const, label: 'Everything', count: friends.notifications.length },
		{ key: 'requests' as const, label: 'Requests', count: requestNotifications.length },
		{ key: 'comments' as const, label: 'Comments', count: commentNotifications.length }
	]);

	function requestIdFor(item: RequestNotification) {
		return item.requestId || item.id.replace('friend-request-', '');
	}

	async function runRequestAction(itemId: string, action: () => Promise<void>) {
		if (busyAction) return;
		busyAction = itemId;
		try {
			await action();
		} finally {
			busyAction = '';
		}
	}

	function openCommentPage(item: NotificationItem) {
		if (!item.postDate) return;

		const ownerId = item.postOwnerId || friends.currentUserId;
		if (ownerId && ownerId !== friends.currentUserId) {
			// The comment lives on a friend's page, so open their journal reader
			// instead of the signed-in user's own book.
			friends.openJournal(ownerId, item.postDate);
			nav.setView('friends');
			return;
		}

		nav.jump(item.postDate);
	}

	function formatDate(iso: string) {
		const d = new Date(iso);
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		if (Number.isNaN(diff)) return '';

		if (diff < 60000) return 'Just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		if (diff < 172800000) return 'Yesterday';
		if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

		return d.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
		});
	}
</script>

<div class="mx-auto w-full max-w-[1240px] px-4 py-6 min-[900px]:px-6">
	<!-- Page header -->
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-ui text-[11px] font-bold tracking-wide text-gold uppercase"
				>
					<span class="size-1.5 rounded-full bg-gold" aria-hidden="true"></span>
					Your inbox
				</span>
				<span class="font-ui text-xs text-[#BBA8E0]">
					{friends.notifications.length}
					{friends.notifications.length === 1 ? 'update' : 'updates'}
				</span>
			</div>
			<h1
				class="mt-2 font-display text-4xl font-bold tracking-tight text-white min-[720px]:text-5xl"
			>
				Notifications
			</h1>
			<p
				class="mt-2 max-w-[620px] font-ui text-sm leading-relaxed text-[#CFC3E6] min-[720px]:text-base"
			>
				Friend requests and notes people left on your pages. No likes to chase, no public counts.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="inline-flex min-h-11 items-center gap-2 rounded-[14px] border border-[#5A4580] bg-desk-2 px-4 font-ui text-sm font-semibold text-[#EDE6F7] transition-colors hover:border-lav/70 hover:bg-[#34214E]"
				onclick={() => nav.setView('journal')}
			>
				<svg
					class="size-[16px] shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M15 18l-6-6 6-6"></path>
				</svg>
				Back to journal
			</button>
			<button
				type="button"
				class="inline-flex min-h-12 items-center gap-2.5 rounded-[14px] border-[1.5px] border-gold bg-gold/10 px-5 font-ui text-sm font-semibold text-[#F3DDAE] transition-colors hover:bg-gold/20"
				onclick={() => nav.jump(TODAY)}
			>
				<svg
					class="size-[18px] shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M12 20h9"></path>
					<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
				</svg>
				Open today's page
			</button>
		</div>
	</header>

	{#if friends.notifications.length === 0}
		<!-- Empty inbox -->
		<div
			class="relative mt-7 overflow-hidden rounded-[10px] bg-paper px-6 py-14 text-center text-ink shadow-[0_16px_34px_rgba(0,0,0,.4)] min-[720px]:py-16"
		>
			<span
				class="absolute -top-3 left-1/2 h-[26px] w-[92px] -translate-x-1/2 rotate-[3deg] bg-lav/90"
				aria-hidden="true"
			></span>
			<span
				class="mx-auto flex size-16 items-center justify-center rounded-full bg-gold/20 text-[#8A5A12]"
			>
				<svg
					class="size-7"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
					<path d="M13.7 21a2 2 0 0 1-3.4 0"></path>
				</svg>
			</span>
			<h2 class="mt-4 font-display text-3xl font-bold text-ink">All quiet for now</h2>
			<p class="mx-auto mt-1.5 max-w-[420px] font-hand text-xl leading-snug text-ink-soft">
				When someone asks to be friends or leaves a note on one of your pages, it will land right
				here.
			</p>
			<button
				type="button"
				class="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white transition-colors hover:bg-[#624690]"
				onclick={() => nav.setView('journal')}
			>
				<CommunityIcon name="book" size={15} />
				Back to my journal
			</button>
		</div>
	{:else}
		<!-- Filters -->
		<div class="mt-7 flex flex-wrap items-center justify-between gap-3">
			<div
				class="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#4D366D] bg-desk-2 p-1"
				role="group"
				aria-label="Filter notifications"
			>
				{#each filters as item (item.key)}
					<button
						type="button"
						class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-colors {filter ===
						item.key
							? 'bg-accent text-white shadow-sm'
							: 'text-[#D6CBEC] hover:text-white'}"
						onclick={() => (filter = item.key)}
						aria-pressed={filter === item.key}
					>
						{item.label}
						<span class="text-[10px] opacity-70">{item.count}</span>
					</button>
				{/each}
			</div>
			<span class="font-ui text-xs text-[#BBA8E0]">
				{visibleCount}
				{visibleCount === 1 ? 'notification' : 'notifications'} shown
			</span>
		</div>

		<div
			class="mt-5 grid gap-6 min-[1040px]:grid-cols-[minmax(0,1fr)_320px] min-[1040px]:items-start"
		>
			<!-- Notification list -->
			<div class="min-w-0 space-y-6">
				{#if visibleRequests.length > 0}
					<section aria-labelledby="notifications-requests">
						<div class="mb-3 flex items-center gap-2.5">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"
							>
								<CommunityIcon name="users" size={15} />
							</span>
							<h2
								id="notifications-requests"
								class="font-display text-[24px] leading-none font-bold text-white"
							>
								Friend requests
							</h2>
							<span
								class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[11px] font-bold text-gold"
							>
								{visibleRequests.length}
							</span>
						</div>

						<div class="space-y-3">
							{#each visibleRequests as request (request.id)}
								{@const busy = busyAction === request.id}
								<article
									class="relative overflow-hidden rounded-[18px] border border-line bg-paper p-4 pl-5 text-ink shadow-[0_8px_20px_rgba(0,0,0,.25)]"
								>
									<span class="absolute inset-y-0 left-0 w-1.5 bg-gold" aria-hidden="true"></span>
									<div class="flex flex-wrap items-center gap-3.5">
										<div class="relative shrink-0">
											<Avatar
												src={request.fromUserAvatar}
												name={request.fromUserName}
												className="size-13"
												textClass="text-xl"
												ring="ring-2 ring-gold/40"
											/>
											<span
												class="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-gold text-lg leading-none font-bold text-ink shadow-[0_0_0_2px_var(--color-paper)]"
												aria-hidden="true"
											>
												+
											</span>
										</div>

										<div class="min-w-0 flex-1">
											<p class="truncate font-hand text-[23px] leading-tight font-bold text-ink">
												{request.fromUserName || 'VidJo student'}
											</p>
											<p class="mt-0.5 font-ui text-[12px] text-ink-soft">
												wants to be friends
												<span class="font-semibold text-[#8A5A12]"
													>· {formatDate(request.createdAt)}</span
												>
											</p>
										</div>

										<div class="flex w-full items-center gap-2 min-[540px]:w-auto">
											<button
												type="button"
												class="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 font-ui text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#624690] disabled:cursor-wait disabled:opacity-60 min-[540px]:flex-none"
												onclick={() =>
													runRequestAction(request.id, () =>
														friends.acceptFriendRequest(requestIdFor(request))
													)}
												disabled={Boolean(busyAction)}
												aria-busy={busy}
												aria-label={`Accept friend request from ${request.fromUserName}`}
											>
												{#if busy}
													<span
														class="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
														aria-hidden="true"
													></span>
												{:else}
													<CommunityIcon name="check" size={13} />
												{/if}
												Accept
											</button>
											<button
												type="button"
												class="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-[#D9C7EC] px-4 font-ui text-xs font-semibold text-accent transition-colors hover:bg-light disabled:cursor-wait disabled:opacity-60 min-[540px]:flex-none"
												onclick={() =>
													runRequestAction(request.id, () =>
														friends.declineFriendRequest(requestIdFor(request))
													)}
												disabled={Boolean(busyAction)}
												aria-label={`Decline friend request from ${request.fromUserName}`}
											>
												<CommunityIcon name="x" size={12} />
												Decline
											</button>
										</div>
									</div>
								</article>
							{/each}
						</div>
					</section>
				{/if}

				{#if visibleComments.length > 0}
					<section aria-labelledby="notifications-comments">
						<div class="mb-3 flex items-center gap-2.5">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-lav/15 text-lav"
							>
								<CommunityIcon name="book" size={15} />
							</span>
							<h2
								id="notifications-comments"
								class="font-display text-[24px] leading-none font-bold text-white"
							>
								Notes on your pages
							</h2>
							<span
								class="rounded-full bg-lav/20 px-2 py-0.5 font-ui text-[11px] font-bold text-lav"
							>
								{visibleComments.length}
							</span>
						</div>

						<div class="space-y-3">
							{#each visibleComments as comment (comment.id)}
								<article
									class="relative overflow-hidden rounded-[18px] border border-line bg-paper p-4 pl-5 text-ink shadow-[0_8px_20px_rgba(0,0,0,.25)]"
								>
									<span class="absolute inset-y-0 left-0 w-1.5 bg-lav" aria-hidden="true"></span>
									<div class="flex items-start gap-3.5">
										<Avatar
											src={comment.fromUserAvatar}
											name={comment.fromUserName}
											className="size-11"
											textClass="text-lg"
											ring="ring-2 ring-lav/40"
										/>

										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
												<p class="truncate font-hand text-[21px] leading-tight font-bold text-ink">
													{comment.fromUserName || 'VidJo student'}
												</p>
												<time
													class="shrink-0 font-ui text-[11px] text-ink-soft"
													datetime={comment.createdAt}
												>
													{formatDate(comment.createdAt)}
												</time>
											</div>

											<p class="mt-0.5 font-ui text-[12.5px] leading-snug text-ink-soft">
												commented on
												<span class="font-semibold text-ink"
													>“{comment.postTitle || 'your page'}”</span
												>
											</p>

											{#if comment.text}
												<blockquote
													class="mt-2.5 rounded-r-xl border-l-[3px] border-gold/70 bg-[#FFFDF6] px-3 py-2 font-hand text-[18px] leading-snug break-words text-ink"
												>
													{comment.text}
												</blockquote>
											{/if}

											{#if comment.postDate}
												<button
													type="button"
													class="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 font-ui text-[11px] font-semibold text-accent transition-colors hover:bg-light"
													onclick={() => openCommentPage(comment)}
												>
													<CommunityIcon name="book" size={12} />
													Open page
													<svg
														class="size-3"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														aria-hidden="true"
													>
														<path d="M5 12h14M13 6l6 6-6 6"></path>
													</svg>
												</button>
											{/if}
										</div>
									</div>
								</article>
							{/each}
						</div>
					</section>
				{/if}

				{#if filter !== 'all' && visibleCount === 0}
					<div
						class="rounded-[20px] border border-dashed border-[#5A4580] bg-white/[.02] px-6 py-12 text-center"
					>
						<CommunityIcon
							name={filter === 'requests' ? 'users' : 'book'}
							size={30}
							class="mx-auto text-gold/60"
						/>
						<p class="mt-3 font-hand text-xl text-[#D6CBEC]">
							{filter === 'requests'
								? 'No friend requests right now.'
								: 'No comments on your pages yet.'}
						</p>
						<p class="mt-1 font-ui text-sm text-[#BBA8E0]">
							{filter === 'requests'
								? 'When someone asks to join your shelf, you will see them here.'
								: 'When someone leaves a note on a page you shared, it will show up here.'}
						</p>
					</div>
				{/if}
			</div>

			<!-- Sidebar -->
			<aside class="space-y-4">
				<section
					class="relative overflow-hidden rounded-[20px] bg-paper p-5 text-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]"
				>
					<span
						class="absolute -top-2.5 left-6 h-[22px] w-[74px] -rotate-2 bg-gold/70"
						aria-hidden="true"
					></span>
					<h2 class="mt-1 font-display text-[23px] leading-tight font-bold text-ink">
						At a glance
					</h2>
					<p class="mt-1 font-hand text-lg leading-tight text-ink-soft">
						Only the things that need you.
					</p>

					<div class="mt-4 space-y-2.5">
						<div
							class="flex items-center gap-3 rounded-xl border border-line bg-[#FFFDF6] px-3 py-2.5"
						>
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/20 text-[#8A5A12]"
							>
								<CommunityIcon name="users" size={16} />
							</span>
							<span class="min-w-0 flex-1 font-ui text-sm font-semibold text-ink">
								Friend requests
							</span>
							<span class="font-display text-2xl leading-none font-bold text-ink">
								{requestNotifications.length}
							</span>
						</div>

						<div
							class="flex items-center gap-3 rounded-xl border border-line bg-[#FFFDF6] px-3 py-2.5"
						>
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
							>
								<CommunityIcon name="book" size={16} />
							</span>
							<span class="min-w-0 flex-1 font-ui text-sm font-semibold text-ink"> Comments </span>
							<span class="font-display text-2xl leading-none font-bold text-ink">
								{commentNotifications.length}
							</span>
						</div>
					</div>

					<p
						class="mt-4 border-t border-line pt-3 font-ui text-[11px] leading-relaxed text-ink-soft"
					>
						Opening this page marks everything as read. You will not get email for these.
					</p>
				</section>

				<section
					class="rounded-[20px] border border-[#4A3670] bg-desk-2 p-5 shadow-[0_10px_26px_rgba(0,0,0,.3)]"
				>
					<CommunityIcon name="sparkles" size={26} class="text-gold" />
					<h2 class="mt-2 font-display text-2xl leading-tight font-bold text-white">
						Only the good stuff
					</h2>
					<p class="mt-1.5 font-ui text-sm leading-relaxed text-[#CFC3E6]">
						No likes to chase or public follower counts. These are just people reaching out about
						your pages.
					</p>
					<button
						type="button"
						class="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gold/70 px-4 font-ui text-xs font-bold text-[#F3DDAE] transition-colors hover:bg-gold/10"
						onclick={() => nav.setView('friends')}
					>
						<CommunityIcon name="users" size={14} />
						Visit the friend shelf
					</button>
				</section>
			</aside>
		</div>
	{/if}
</div>
