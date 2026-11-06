<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { NotificationItem } from '#lib/types';

	$effect(() => {
		// A notification that arrives while this screen is open has been seen.
		// The effect also runs on mount, so no separate `onMount` is needed.
		void friends.notifications.length;
		friends.markNotificationsRead();
	});

	const requestNotifications = $derived(
		friends.notifications.filter(
			(n): n is NotificationItem & { type: 'friend_request' } => n.type === 'friend_request'
		)
	);
	const commentNotifications = $derived(
		friends.notifications.filter(
			(n): n is NotificationItem & { type: 'comment' } => n.type === 'comment'
		)
	);

	function requestIdFor(item: NotificationItem & { type: 'friend_request' }) {
		return item.requestId || item.id.replace('friend-request-', '');
	}

	async function acceptRequest(requestId: string) {
		await friends.acceptFriendRequest(requestId);
	}

	async function declineRequest(requestId: string) {
		await friends.declineFriendRequest(requestId);
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
		if (diff < 60000) return 'Just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="flex h-[700px] flex-col">
	<header
		class="flex h-12 items-center justify-between gap-2 border-b border-line bg-paper/50 px-6"
	>
		<button
			type="button"
			class="flex size-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-light"
			onclick={() => nav.setView('journal')}
			aria-label="Back"
		>
			<svg
				width="14"
				height="14"
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
		</button>
		<h1 class="flex-1 font-display text-xl font-bold text-ink">Notifications</h1>
	</header>

	<div class="flex-1 overflow-y-auto p-6">
		{#if friends.notifications.length === 0}
			<div class="flex h-full flex-col items-center justify-center text-center">
				<CommunityIcon name="sparkles" size={48} class="mb-4 text-gold/40" />
				<p class="font-hand text-lg text-ink-soft">No new notifications</p>
				<p class="mt-1 font-ui text-sm text-ink-soft">
					Friend requests and comments on your pages will appear here.
				</p>
			</div>
		{:else}
			{#if requestNotifications.length > 0}
				<section class="mb-8">
					<h2 class="mb-3 font-display text-lg font-bold text-ink">Friend Requests</h2>
					<div class="space-y-3">
						{#each requestNotifications as request (request.id)}
							<div class="flex items-center gap-3 rounded-xl border border-line bg-white/50 p-3">
								<Avatar
									src={request.fromUserAvatar}
									name={request.fromUserName}
									className="size-10"
									textClass="text-base"
									ring=""
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate font-ui text-sm font-semibold text-ink">
										{request.fromUserName}
									</p>
									<p class="mt-0.5 font-ui text-[11px] text-ink-soft">
										wants to be friends
										<span class="ml-1 text-gold">{formatDate(request.createdAt)}</span>
									</p>
								</div>
								<div class="flex items-center gap-2">
									<button
										type="button"
										class="flex size-9 items-center justify-center rounded-lg bg-[#3F7A4F] text-white transition-colors hover:bg-[#2F6A40]"
										onclick={() => acceptRequest(requestIdFor(request))}
										aria-label={`Accept friend request from ${request.fromUserName}`}
									>
										<CommunityIcon name="check" size={14} />
									</button>
									<button
										type="button"
										class="flex size-9 items-center justify-center rounded-lg border border-[#D19A9A] text-[#9A5B5B] transition-colors hover:bg-[#3A222B]/30"
										onclick={() => declineRequest(requestIdFor(request))}
										aria-label={`Decline friend request from ${request.fromUserName}`}
									>
										<CommunityIcon name="x" size={14} />
									</button>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if commentNotifications.length > 0}
				<section>
					<h2 class="mb-3 font-display text-lg font-bold text-ink">Comments on Your Pages</h2>
					<div class="space-y-3">
						{#each commentNotifications as comment (comment.id)}
							<div class="flex items-start gap-3 rounded-xl border border-line bg-white/50 p-3">
								<Avatar
									src={comment.fromUserAvatar}
									name={comment.fromUserName}
									className="size-10"
									textClass="text-base"
									ring=""
								/>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between gap-2">
										<p class="truncate font-ui text-sm font-semibold text-ink">
											{comment.fromUserName}
										</p>
										<time class="shrink-0 font-ui text-[10px] text-ink-soft">
											{formatDate(comment.createdAt)}
										</time>
									</div>
									<p class="mt-1 font-ui text-sm break-words text-ink-soft">
										commented on "{comment.postTitle}"
									</p>
									<p class="mt-1.5 font-hand text-base break-words text-ink">
										"{comment.text}"
									</p>
									{#if comment.postDate}
										<button
											type="button"
											class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-ui text-[11px] font-semibold text-accent transition-colors hover:bg-light"
											onclick={() => openCommentPage(comment)}
										>
											<CommunityIcon name="book" size={12} />
											Open page
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>
