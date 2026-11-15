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

	type FilterKey = 'all' | 'requests' | 'comments';
	type RequestNotification = NotificationItem & { type: 'friend_request' };

	let filter = $state<FilterKey>('all');
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

{#snippet envelope(large: boolean)}
	<div
		class="relative rotate-[-5deg] rounded-[6px] border border-line bg-book-bg shadow-[0_12px_24px_rgba(0,0,0,.35)] {large
			? 'h-[104px] w-[150px]'
			: 'h-[74px] w-[108px]'}"
		aria-hidden="true"
	>
		<span
			class="absolute inset-x-0 top-0 rounded-t-[5px] border-b border-line/70 bg-paper-deep [clip-path:polygon(0_0,100%_0,50%_100%)] {large
				? 'h-[56px]'
				: 'h-[40px]'}"
		></span>
		<span
			class="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#E7BE6B,#A97827_70%)] text-book-ink shadow-[0_3px_8px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.35)] {large
				? 'top-[52px] size-12'
				: 'top-[36px] size-9'}"
		>
			<CommunityIcon name="bell" size={large ? 22 : 16} />
		</span>
		<span class="absolute right-3 bottom-3 left-3 h-px bg-line/60"></span>
		<span class="absolute right-4 bottom-6 left-4 h-px bg-line/40"></span>
	</div>
{/snippet}

<div class="mx-auto w-full max-w-[1240px] px-4 py-6 min-[900px]:px-6">
	<PageHeader
		title="Notifications"
		description="Friend requests and notes people left on your pages. No likes to chase, no public counts."
	>
		{#snippet meta()}
			<span class="inline-flex items-center gap-1.5">
				<CommunityIcon name="mail" size={12} class="text-gold" />
				{friends.notifications.length}
				{friends.notifications.length === 1 ? 'note in the tray' : 'notes in the tray'}
			</span>
		{/snippet}
		{#snippet actions()}
			<Button variant="outline" icon="arrow-left" onclick={() => nav.setView('journal')}>
				Back to journal
			</Button>
			<Button icon="pen" onclick={() => nav.jump(TODAY)}>Open today's page</Button>
		{/snippet}
	</PageHeader>

	{#if friends.notifications.length === 0}
		<!-- Empty tray -->
		<div
			class="relative mt-7 overflow-hidden rounded-[24px] bg-book-bg px-6 py-14 text-center text-book-ink shadow-[0_16px_34px_rgba(0,0,0,.4)] min-[720px]:py-16"
		>
			<span
				class="pointer-events-none absolute -top-16 -left-12 size-52 rounded-full border border-dashed border-book-accent/20"
				aria-hidden="true"
			></span>
			<span
				class="pointer-events-none absolute -right-14 -bottom-20 size-56 rounded-full border border-book-accent/10"
				aria-hidden="true"
			></span>

			<div class="relative mx-auto w-fit">{@render envelope(true)}</div>

			<h2 class="relative mt-6 font-display text-[32px] leading-tight font-bold">
				All quiet for now
			</h2>
			<p
				class="relative mx-auto mt-2 max-w-[440px] font-hand text-xl leading-snug text-book-ink/70"
			>
				The tray is empty. When someone asks to be friends or leaves a note on one of your pages, it
				will land right here.
			</p>
			<div class="relative mt-6 flex flex-wrap justify-center gap-2.5">
				<Button icon="book" onclick={() => nav.setView('journal')}>Back to my journal</Button>
				<Button variant="note" icon="users" onclick={() => nav.setView('friends')}>
					Visit the friend shelf
				</Button>
			</div>
		</div>
	{:else}
		<!-- The letter tray -->
		<section
			class="relative mt-6 overflow-hidden rounded-[22px] border border-[#4A3670] bg-desk-2 p-5 shadow-[0_14px_34px_rgba(0,0,0,.35)] min-[720px]:p-6"
			aria-labelledby="tray-summary"
		>
			<span
				class="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full border border-dashed border-gold/20"
				aria-hidden="true"
			></span>
			<span
				class="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full border border-gold/10"
				aria-hidden="true"
			></span>

			<div class="relative flex flex-wrap items-center gap-x-5 gap-y-4">
				<div class="hidden shrink-0 min-[540px]:block">{@render envelope(false)}</div>

				<div class="min-w-0 flex-1">
					<p class="font-ui text-[10px] font-bold tracking-[.22em] text-gold uppercase">
						The letter tray
					</p>
					<h2
						id="tray-summary"
						class="mt-1 font-display text-[26px] leading-tight font-bold text-white"
					>
						Everything that needs you, in one quiet place.
					</h2>
					<p class="mt-1 font-hand text-lg leading-snug text-[#CFC3E6]">
						Opening this page marks the tray as read. No pings, no email, no noise.
					</p>
				</div>

				<div class="flex w-full gap-2.5 min-[720px]:w-auto" role="group" aria-label="Quick filters">
					<button
						type="button"
						class="flex min-w-[104px] flex-1 flex-col items-center gap-1 rounded-[6px] border border-dashed border-book-accent/70 bg-book-bg px-3 py-2.5 text-book-ink shadow-[0_6px_14px_rgba(0,0,0,.28)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_18px_rgba(0,0,0,.35)] min-[720px]:flex-none {filter ===
						'requests'
							? 'ring-2 ring-gold ring-offset-2 ring-offset-desk-2'
							: ''}"
						onclick={() => (filter = 'requests')}
						aria-pressed={filter === 'requests'}
						aria-label={`Show ${requestNotifications.length} friend requests`}
					>
						<span
							class="flex size-7 items-center justify-center rounded-full bg-book-accent/20 note-accent"
						>
							<CommunityIcon name="users" size={14} />
						</span>
						<span class="font-display text-[26px] leading-none font-bold tabular-nums">
							{requestNotifications.length}
						</span>
						<span class="font-ui text-[9px] font-bold tracking-[.16em] text-book-ink/70 uppercase">
							Requests
						</span>
					</button>

					<button
						type="button"
						class="flex min-w-[104px] flex-1 flex-col items-center gap-1 rounded-[6px] border border-dashed border-book-ink/25 bg-book-bg px-3 py-2.5 text-book-ink shadow-[0_6px_14px_rgba(0,0,0,.28)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_18px_rgba(0,0,0,.35)] min-[720px]:flex-none {filter ===
						'comments'
							? 'ring-2 ring-gold ring-offset-2 ring-offset-desk-2'
							: ''}"
						onclick={() => (filter = 'comments')}
						aria-pressed={filter === 'comments'}
						aria-label={`Show ${commentNotifications.length} comments`}
					>
						<span
							class="flex size-7 items-center justify-center rounded-full bg-book-ink/10 text-book-ink/70"
						>
							<CommunityIcon name="pen" size={14} />
						</span>
						<span class="font-display text-[26px] leading-none font-bold tabular-nums">
							{commentNotifications.length}
						</span>
						<span class="font-ui text-[9px] font-bold tracking-[.16em] text-book-ink/70 uppercase">
							Comments
						</span>
					</button>
				</div>
			</div>
		</section>

		<!-- Index tabs -->
		<div
			class="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[#4D366D]"
		>
			<div
				class="-mb-px flex max-w-full items-end gap-1 overflow-x-auto"
				role="group"
				aria-label="Filter notifications"
			>
				{#each filters as item (item.key)}
					{@const active = filter === item.key}
					<button
						type="button"
						class="-mb-px inline-flex shrink-0 items-center gap-1.5 rounded-t-[10px] border border-b-0 px-3.5 pt-2 pb-2 font-ui text-xs font-bold transition-colors {active
							? 'border-line bg-book-bg text-book-ink'
							: 'border-[#4D366D] text-[#CFC3E6] hover:text-white'}"
						onclick={() => (filter = item.key)}
						aria-pressed={active}
					>
						<span
							class="size-1.5 rounded-full {active ? 'bg-gold' : 'bg-[#6B558E]'}"
							aria-hidden="true"
						></span>
						{item.label}
						<span
							class="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums {active
								? 'bg-book-edge text-book-ink/70'
								: 'bg-white/10 text-[#BBA8E0]'}"
						>
							{item.count}
						</span>
					</button>
				{/each}
			</div>
			<span class="pb-2 font-ui text-[11px] text-[#BBA8E0] tabular-nums">
				{visibleCount}
				{visibleCount === 1 ? 'note' : 'notes'} shown
			</span>
		</div>

		<div
			class="mt-6 grid gap-6 min-[1040px]:grid-cols-[minmax(0,1fr)_320px] min-[1040px]:items-start"
		>
			<!-- Notes -->
			<div class="min-w-0 space-y-8">
				{#if visibleRequests.length > 0}
					<section aria-labelledby="notifications-requests">
						<div class="flex items-center gap-2.5">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"
							>
								<CommunityIcon name="users" size={15} />
							</span>
							<h2
								id="notifications-requests"
								class="font-display text-[25px] leading-none font-bold text-white"
							>
								Sealed invitations
							</h2>
							<span
								class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[11px] font-semibold text-gold tabular-nums"
							>
								{visibleRequests.length}
							</span>
							<span
								class="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent"
								aria-hidden="true"
							></span>
						</div>
						<p class="mt-1 mb-3 font-hand text-lg leading-snug text-[#BBA8E0]">
							People who would like to read the pages you share.
						</p>

						<div class="space-y-3.5">
							{#each visibleRequests as request (request.id)}
								{@const busy = busyAction === request.id}
								<article
									class="note-card relative rounded-[16px] border border-line bg-book-bg p-4 text-book-ink shadow-[0_10px_24px_rgba(0,0,0,.32)] min-[540px]:pl-5"
								>
									<span class="tape tape-gold" aria-hidden="true"></span>
									<div class="flex flex-wrap items-center gap-3.5">
										<div class="relative shrink-0">
											<span
												class="absolute -inset-1 rounded-full border border-dashed border-book-accent/60"
												aria-hidden="true"
											></span>
											<Avatar
												src={request.fromUserAvatar}
												name={request.fromUserName}
												className="size-12"
												textClass="text-xl"
												ring="ring-2 ring-book-accent/50"
											/>
										</div>

										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
												<p
													class="truncate font-hand text-[23px] leading-tight font-bold text-book-ink"
												>
													{request.fromUserName || 'VidJo student'}
												</p>
												<span
													class="inline-flex rotate-[-4deg] items-center rounded-[3px] border border-book-accent/70 px-1.5 py-0.5 font-ui text-[8px] font-bold tracking-[.16em] note-accent uppercase"
												>
													Friend request
												</span>
											</div>
											<p class="mt-0.5 font-ui text-[12px] text-book-ink/70">
												wants to read your shared pages
												<span class="font-semibold note-accent"
													>· {formatDate(request.createdAt)}</span
												>
											</p>
										</div>

										<div class="flex w-full items-center gap-2 min-[560px]:w-auto">
											<Button
												size="sm"
												icon="check"
												class="flex-1 min-[560px]:flex-none"
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
												variant="note"
												icon="x"
												class="flex-1 min-[560px]:flex-none"
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
						<div class="flex items-center gap-2.5">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-lav/15 text-lav"
							>
								<CommunityIcon name="pen" size={15} />
							</span>
							<h2
								id="notifications-comments"
								class="font-display text-[25px] leading-none font-bold text-white"
							>
								Notes in the margins
							</h2>
							<span
								class="rounded-full bg-lav/20 px-2 py-0.5 font-ui text-[11px] font-semibold text-lav tabular-nums"
							>
								{visibleComments.length}
							</span>
							<span
								class="h-px flex-1 bg-gradient-to-r from-lav/30 to-transparent"
								aria-hidden="true"
							></span>
						</div>
						<p class="mt-1 mb-3 font-hand text-lg leading-snug text-[#BBA8E0]">
							Comments left on the pages you chose to share.
						</p>

						<div class="space-y-3.5">
							{#each visibleComments as comment (comment.id)}
								<article
									class="note-card relative rounded-[16px] border border-line bg-book-bg p-4 text-book-ink shadow-[0_10px_24px_rgba(0,0,0,.32)] min-[540px]:pl-5"
								>
									<span class="tape tape-lav" aria-hidden="true"></span>
									<div class="flex items-start gap-3.5">
										<div class="relative shrink-0">
											<span
												class="absolute -inset-1 rounded-full border border-dashed border-book-ink/25"
												aria-hidden="true"
											></span>
											<Avatar
												src={comment.fromUserAvatar}
												name={comment.fromUserName}
												className="size-11"
												textClass="text-lg"
												ring="ring-2 ring-book-ink/25"
											/>
										</div>

										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
												<p
													class="truncate font-hand text-[21px] leading-tight font-bold text-book-ink"
												>
													{comment.fromUserName || 'VidJo student'}
												</p>
												<time
													class="shrink-0 font-ui text-[11px] text-book-ink/70 tabular-nums"
													datetime={comment.createdAt}
												>
													{formatDate(comment.createdAt)}
												</time>
											</div>

											<p class="mt-0.5 font-ui text-[12.5px] leading-snug text-book-ink/70">
												left a note on
												<span class="font-semibold text-book-ink"
													>“{censor(comment.postTitle || 'your page')}”</span
												>
											</p>

											{#if comment.text}
												<blockquote
													class="relative mt-3 overflow-hidden rounded-l-[3px] rounded-r-lg border-l-[3px] border-book-accent/70 note-scrap py-2.5 pr-7 pl-3.5 font-hand text-[18px] leading-snug break-words text-book-ink shadow-[0_2px_5px_rgba(0,0,0,.06)]"
												>
													<span
														class="absolute top-0 right-0 size-0 border-b-[12px] border-l-[12px] note-fold border-l-transparent"
														aria-hidden="true"
													></span>
													{censor(comment.text)}
												</blockquote>
											{/if}

											{#if comment.postDate}
												<button
													type="button"
													class="mt-3 inline-flex items-center gap-1.5 font-ui text-xs font-bold text-accent underline-offset-4 transition-colors hover:text-accent-strong hover:underline"
													onclick={() => openCommentPage(comment)}
												>
													Open the page
													<CommunityIcon name="arrow-right" size={13} />
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
						class="relative overflow-hidden rounded-[20px] border border-dashed border-[#5A4580] bg-white/[.02] px-6 py-12 text-center"
					>
						<span
							class="mx-auto flex size-14 items-center justify-center rounded-full bg-white/[.04] text-gold/70"
						>
							<CommunityIcon name={filter === 'requests' ? 'users' : 'pen'} size={24} />
						</span>
						<p class="mt-4 font-display text-2xl font-bold text-[#EDE6F7]">
							{filter === 'requests' ? 'No invitations waiting.' : 'No notes in the margins yet.'}
						</p>
						<p class="mx-auto mt-1.5 max-w-[380px] font-hand text-lg leading-snug text-[#BBA8E0]">
							{filter === 'requests'
								? 'When someone asks to read your shared pages, their invitation lands here.'
								: 'When someone leaves a note on a page you shared, it will appear here.'}
						</p>
						<button
							type="button"
							class="mt-4 font-ui text-xs font-bold text-gold underline-offset-4 hover:underline"
							onclick={() => (filter = 'all')}
						>
							Show everything
						</button>
					</div>
				{/if}
			</div>

			<!-- Sidebar -->
			<aside class="space-y-4">
				<section
					class="relative overflow-hidden rounded-[20px] bg-book-bg p-5 text-book-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]"
				>
					<span
						class="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full border border-dashed border-book-accent/30"
						aria-hidden="true"
					></span>
					<div class="relative flex items-start justify-between gap-3">
						<h2 class="font-display text-[23px] leading-tight font-bold text-book-ink">
							How the tray works
						</h2>
						<span
							class="mt-1 inline-flex shrink-0 rotate-3 items-center rounded-[3px] border border-book-accent/70 px-1.5 py-0.5 font-ui text-[8px] font-bold tracking-[.16em] note-accent uppercase"
						>
							No likes
						</span>
					</div>

					<ul class="relative mt-4 space-y-3">
						<li class="flex gap-3">
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-full bg-book-accent/20 note-accent"
							>
								<CommunityIcon name="users" size={16} />
							</span>
							<div class="min-w-0">
								<p class="font-ui text-[13px] font-semibold text-book-ink">Invitations</p>
								<p class="font-hand text-[16px] leading-tight text-book-ink/70">
									Someone asked to read the pages you share.
								</p>
							</div>
						</li>
						<li class="flex gap-3">
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-full bg-book-ink/10 text-book-ink/70"
							>
								<CommunityIcon name="pen" size={16} />
							</span>
							<div class="min-w-0">
								<p class="font-ui text-[13px] font-semibold text-book-ink">Margin notes</p>
								<p class="font-hand text-[16px] leading-tight text-book-ink/70">
									A comment on one of your shared pages.
								</p>
							</div>
						</li>
					</ul>

					<p
						class="relative mt-4 border-t border-dashed border-line pt-3 font-ui text-[11px] leading-relaxed text-book-ink/70"
					>
						Opening this page marks the tray as read. There are no emails, badges, or streaks.
					</p>
				</section>

				<section
					class="relative overflow-hidden rounded-[20px] border border-[#4A3670] bg-desk-2 p-5 shadow-[0_10px_26px_rgba(0,0,0,.3)]"
				>
					<span
						class="pointer-events-none absolute -top-8 -right-6 size-24 rounded-full border border-dashed border-gold/20"
						aria-hidden="true"
					></span>
					<div
						class="absolute top-4 right-4 rotate-3 rounded-[3px] border border-dashed border-book-accent/60 bg-book-bg px-2 py-1.5 text-center note-accent"
						aria-hidden="true"
					>
						<CommunityIcon name="mail" size={14} class="mx-auto" />
						<span class="mt-0.5 block font-ui text-[7px] font-bold tracking-[.16em] uppercase">
							Postage
						</span>
					</div>

					<p class="relative font-ui text-[10px] font-bold tracking-[.2em] text-gold uppercase">
						A gentle inbox
					</p>
					<h2
						class="relative mt-2 max-w-[210px] font-display text-[24px] leading-tight font-bold text-white"
					>
						Only the good stuff.
					</h2>
					<p class="relative mt-1.5 font-hand text-lg leading-snug text-[#CFC3E6]">
						No likes to chase. No public follower counts. Just people reaching out about your pages.
					</p>
					<Button
						class="relative mt-4 w-full"
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

<style>
	.note-card {
		animation: note-in 0.32s ease-out backwards;
		transition:
			translate 0.18s ease,
			rotate 0.18s ease,
			box-shadow 0.18s ease;
	}

	.tape {
		position: absolute;
		top: -8px;
		left: 22px;
		z-index: 1;
		height: 18px;
		width: 62px;
		transform: rotate(-3deg);
		background-image: repeating-linear-gradient(
			90deg,
			rgb(255 255 255 / 0.35) 0 5px,
			transparent 5px 10px
		);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
	}

	.tape-gold {
		background-color: color-mix(in srgb, var(--color-book-accent) 82%, transparent);
	}

	.tape-lav {
		background-color: color-mix(in srgb, var(--color-book-ink) 32%, var(--color-book-bg));
	}

	@media (min-width: 720px) {
		.note-card:nth-child(odd) {
			rotate: -0.25deg;
		}

		.note-card:nth-child(even) {
			rotate: 0.25deg;
		}
	}

	@media (min-width: 720px) and (hover: hover) {
		.note-card:hover {
			translate: 0 -2px;
			rotate: 0deg;
		}
	}

	@keyframes note-in {
		from {
			opacity: 0;
			translate: 0 8px;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.note-card {
			animation: none;
		}
	}
</style>
