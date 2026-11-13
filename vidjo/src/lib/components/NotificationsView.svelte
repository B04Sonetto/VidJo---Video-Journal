<script lang="ts">
	import { censor } from '#lib/censor';
	import { friends } from '#lib/state/friends.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { TODAY } from '#lib/dates';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
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
	<PageHeader
		title="Notifications"
		description="Friend requests and notes people left on your pages. No likes to chase, no public counts."
	>
		{#snippet meta()}
			{friends.notifications.length}
			{friends.notifications.length === 1 ? 'update' : 'updates'}
		{/snippet}
		{#snippet actions()}
			<Button variant="outline" icon="arrow-left" onclick={() => nav.setView('journal')}>
				Back to journal
			</Button>
			<Button icon="pen" onclick={() => nav.jump(TODAY)}>Open today's page</Button>
		{/snippet}
	</PageHeader>

	{#if friends.notifications.length === 0}
		<!-- Empty inbox -->
		<div
			class="mt-7 rounded-[10px] bg-paper px-6 py-14 text-center text-ink shadow-[0_16px_34px_rgba(0,0,0,.4)] min-[720px]:py-16"
		>
			<span
				class="mx-auto flex size-16 items-center justify-center rounded-full bg-gold/20 text-[#8A5A12]"
			>
				<CommunityIcon name="bell" size={28} />
			</span>
			<h2 class="mt-4 font-display text-3xl font-bold text-ink">All quiet for now</h2>
			<p class="mx-auto mt-1.5 max-w-[420px] font-ui text-sm leading-relaxed text-ink-soft">
				When someone asks to be friends or leaves a note on one of your pages, it will land right
				here.
			</p>
			<Button class="mt-5" icon="book" onclick={() => nav.setView('journal')}>
				Back to my journal
			</Button>
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
						<span class="text-[10px] tabular-nums opacity-70">{item.count}</span>
					</button>
				{/each}
			</div>
			<span class="font-ui text-xs text-[#BBA8E0] tabular-nums">
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
								class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[11px] font-semibold text-gold tabular-nums"
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
										<div class="shrink-0">
											<Avatar
												src={request.fromUserAvatar}
												name={request.fromUserName}
												className="size-13"
												textClass="text-xl"
												ring="ring-2 ring-gold/40"
											/>
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
											<Button
												size="sm"
												icon="check"
												class="flex-1 min-[540px]:flex-none"
												loading={busy}
												disabled={Boolean(busyAction)}
												onclick={() =>
													runRequestAction(request.id, () =>
														friends.acceptFriendRequest(requestIdFor(request))
													)}
											>
												Accept
											</Button>
											<Button
												size="sm"
												variant="paper"
												icon="x"
												class="flex-1 min-[540px]:flex-none"
												disabled={Boolean(busyAction)}
												onclick={() =>
													runRequestAction(request.id, () =>
														friends.declineFriendRequest(requestIdFor(request))
													)}
											>
												Decline
											</Button>
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
								class="rounded-full bg-lav/20 px-2 py-0.5 font-ui text-[11px] font-semibold text-lav tabular-nums"
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
													>“{censor(comment.postTitle || 'your page')}”</span
												>
											</p>

											{#if comment.text}
												<blockquote
													class="mt-2.5 rounded-r-xl border-l-[3px] border-gold/70 bg-[#FFFDF6] px-3 py-2 font-hand text-[18px] leading-snug break-words text-ink"
												>
													{censor(comment.text)}
												</blockquote>
											{/if}

											{#if comment.postDate}
												<Button
													class="mt-3"
													size="sm"
													variant="paper"
													icon="book"
													trailingIcon="arrow-right"
													onclick={() => openCommentPage(comment)}
												>
													Open page
												</Button>
											{/if}
										</div>
									</div>
								</article>
							{/each}
						</div>
					</section>
				{/if}

				{#if filter !== 'all' && visibleCount === 0}
					<div class="rounded-[20px] border border-[#5A4580] bg-white/[.02] px-6 py-12 text-center">
						<CommunityIcon
							name={filter === 'requests' ? 'users' : 'book'}
							size={30}
							class="mx-auto text-gold/60"
						/>
						<p class="mt-3 font-display text-xl font-bold text-[#EDE6F7]">
							{filter === 'requests'
								? 'No friend requests right now.'
								: 'No comments on your pages yet.'}
						</p>
						<p class="mt-1 font-ui text-sm leading-relaxed text-[#BBA8E0]">
							{filter === 'requests'
								? 'When someone asks to join your shelf, you will see them here.'
								: 'When someone leaves a note on a page you shared, it will show up here.'}
						</p>
					</div>
				{/if}
			</div>

			<!-- Sidebar -->
			<aside class="space-y-4">
				<section class="rounded-[20px] bg-paper p-5 text-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]">
					<h2 class="font-display text-[23px] leading-tight font-bold text-ink">At a glance</h2>
					<p class="mt-1 font-ui text-sm leading-relaxed text-ink-soft">
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
							<span class="font-display text-2xl leading-none font-bold text-ink tabular-nums">
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
							<span class="font-display text-2xl leading-none font-bold text-ink tabular-nums">
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
					<CommunityIcon name="bell" size={24} class="text-gold" />
					<h2 class="mt-2 font-display text-2xl leading-tight font-bold text-white">
						Only the good stuff
					</h2>
					<p class="mt-1.5 font-ui text-sm leading-relaxed text-[#CFC3E6]">
						No likes to chase or public follower counts. These are just people reaching out about
						your pages.
					</p>
					<Button
						class="mt-4 w-full"
						size="sm"
						variant="outline"
						icon="users"
						onclick={() => nav.setView('friends')}
					>
						Visit the friend shelf
					</Button>
				</section>
			</aside>
		</div>
	{/if}
</div>
