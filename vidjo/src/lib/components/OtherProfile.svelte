<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { censor } from '#lib/censor';
	import { cleanDisplayName, normalizeImageUrl, optimizedBannerUrl } from '#lib/avatar';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Skeleton from '#lib/components/ui/Skeleton.svelte';

	let { userId, onClose }: { userId: string; onClose: () => void } = $props();

	let busy = $state(false);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	// Only trust the loaded profile when it belongs to the person being viewed,
	// so a previous visitor's card never flashes while the next one loads.
	const viewedUser = $derived(
		profile.viewedProfile?.user_id === userId ? profile.viewedProfile : null
	);
	const settled = $derived(profile.viewedProfileFor === userId);
	const posts = $derived(settled ? profile.viewedProfilePosts : []);
	const viewedStreak = $derived(settled ? profile.viewedProfileStreak : null);

	const name = $derived(cleanDisplayName(viewedUser?.display_name, 'VidJo student'));
	const username = $derived(viewedUser?.username ?? '');
	const bio = $derived(viewedUser?.bio ?? '');
	const friendCode = $derived(viewedUser?.friend_code ?? '');
	const allowRequests = $derived(viewedUser?.allow_friend_requests !== false);

	const isFriend = $derived(friends.friends.some((friend) => friend.id === userId));
	const outgoing = $derived(
		friends.friendRequests.find(
			(request) => request.direction === 'outgoing' && request.toUserId === userId
		)
	);
	const incoming = $derived(
		friends.friendRequests.find(
			(request) => request.direction === 'incoming' && request.fromUserId === userId
		)
	);

	const memberSince = $derived.by(() => {
		const value = viewedUser?.created_at;
		if (!value) return 'New';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'New';
		return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
	});

	const videoCount = $derived(posts.filter((post) => post.hasVideo).length);

	// Banner: try the resized image first, then the original, then a gradient.
	const bannerOriginal = $derived(normalizeImageUrl(viewedUser?.banner_url ?? null));
	const bannerOptimized = $derived(optimizedBannerUrl(bannerOriginal));
	let bannerUseOriginal = $state(false);
	let bannerFailed = $state(false);
	const bannerSrc = $derived(bannerUseOriginal ? bannerOriginal : bannerOptimized);

	$effect(() => {
		void bannerOriginal;
		bannerFailed = false;
		bannerUseOriginal = false;
	});

	function handleBannerError() {
		if (!bannerUseOriginal && bannerOriginal && bannerOptimized !== bannerOriginal) {
			bannerUseOriginal = true;
			return;
		}
		bannerFailed = true;
	}

	$effect(() => {
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});

	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	}

	function addFriend() {
		if (!friendCode) {
			journal.toast('This student does not have a friend code yet.');
			return;
		}
		void run(async () => {
			const result = await friends.addFriendByCode(friendCode);
			// A successful request already shows its own toast.
			if (!result.success) journal.toast(result.message);
		});
	}

	function cancelRequest() {
		const request = outgoing;
		if (!request) return;
		void run(() => friends.cancelFriendRequest(request.id));
	}

	function acceptRequest() {
		const request = incoming;
		if (!request) return;
		void run(() => friends.acceptFriendRequest(request.id));
	}

	function declineRequest() {
		const request = incoming;
		if (!request) return;
		void run(() => friends.declineFriendRequest(request.id));
	}

	function openNotebook() {
		onClose();
		nav.setView('friends');
		friends.openJournal(userId);
	}

	function openMessages() {
		const friend = friends.friends.find((item) => item.id === userId);
		if (!friend) {
			journal.toast('Add this student as a friend to send messages.');
			return;
		}
		onClose();
		nav.openMessages();
		void messages.openDirect(friend);
	}

	function copyCode() {
		if (!friendCode) return;
		void navigator.clipboard?.writeText(friendCode);
		copied = true;
		journal.toast(`Friend code ${friendCode} copied!`);
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2400);
	}

	function formatDate(date: string) {
		const parsed = new Date(`${date}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) return date;
		return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm min-[720px]:p-5"
	role="dialog"
	aria-modal="true"
	aria-labelledby="profile-title"
>
	<button
		type="button"
		class="fixed inset-0 h-full w-full cursor-default"
		onclick={onClose}
		aria-label="Close profile"
	></button>

	<div
		class="relative z-10 flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[32px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_28px_70px_rgba(0,0,0,.6)]"
	>
		<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			<!-- Banner -->
			<div class="relative h-36 shrink-0 min-[720px]:h-40">
				{#if bannerSrc && !bannerFailed && viewedUser}
					<img
						src={bannerSrc}
						alt=""
						class="absolute inset-0 h-full w-full object-cover"
						decoding="async"
						referrerpolicy="no-referrer"
						onerror={handleBannerError}
					/>
				{:else}
					<div
						class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-cover)_0%,var(--color-cover-edge)_60%,var(--color-desk)_100%)]"
					></div>
				{/if}
				<div
					class="absolute inset-0 [background-image:radial-gradient(circle_at_20%_30%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_80%_20%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
				></div>
				<div
					class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-desk-2/80 to-transparent"
					aria-hidden="true"
				></div>

				<button
					type="button"
					class="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-black/35 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>

				<div class="absolute -bottom-14 left-1/2 -translate-x-1/2">
					{#if viewedUser}
						<Avatar
							src={viewedUser.avatar_url}
							{name}
							className="size-28"
							textClass="text-5xl"
							ring="border-4 border-book-accent/60 shadow-[0_18px_36px_rgba(0,0,0,.5)]"
						/>
					{:else}
						<Skeleton class="size-28 rounded-full border-4 border-desk-2" />
					{/if}
				</div>
			</div>

			<div class="px-5 pt-[4.5rem] pb-6 text-center min-[720px]:px-8">
				{#if !viewedUser && !settled}
					<!-- Loading -->
					<div class="flex flex-col items-center" role="status" aria-label="Loading profile">
						<Skeleton class="h-8 w-48" />
						<Skeleton class="mt-2 h-4 w-28" />
						<Skeleton class="mt-5 h-16 w-full max-w-[380px] rounded-2xl" />
						<div class="mt-6 grid w-full grid-cols-3 gap-3">
							<Skeleton class="h-20 rounded-2xl" />
							<Skeleton class="h-20 rounded-2xl" />
							<Skeleton class="h-20 rounded-2xl" />
						</div>
					</div>
				{:else if !viewedUser}
					<!-- Not found -->
					<h2 id="profile-title" class="font-display text-2xl font-bold">Profile unavailable</h2>
					<p class="mx-auto mt-2 max-w-[360px] font-ui text-sm leading-relaxed text-book-bg/65">
						We could not load this student's profile. They may have left VidJo, or your connection
						dropped. Please try again in a moment.
					</p>
					<Button class="mt-5" variant="outline" onclick={onClose}>Close</Button>
				{:else}
					<h2
						id="profile-title"
						class="line-clamp-2 font-display text-3xl font-bold [overflow-wrap:anywhere] min-[720px]:text-4xl"
					>
						{name}
					</h2>

					<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
						<span
							class="max-w-full truncate rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg/80"
						>
							@{username}
						</span>
						{#if isFriend}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-[#3F7A4F]/40 bg-[#3F7A4F]/15 px-3 py-1 font-ui text-xs font-semibold text-[#8BE2A4]"
							>
								<CommunityIcon name="check" size={12} />
								Friends
							</span>
						{:else if incoming}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-book-accent/40 bg-book-accent/15 px-3 py-1 font-ui text-xs font-semibold text-book-accent"
							>
								<CommunityIcon name="mail" size={12} />
								Sent you a request
							</span>
						{:else if outgoing}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-cover bg-cover/25 px-3 py-1 font-ui text-xs font-semibold text-book-bg/75"
							>
								<CommunityIcon name="mail" size={12} />
								Request sent
							</span>
						{/if}
					</div>

					<p class="mt-1.5 font-ui text-xs text-book-bg/65">Member since {memberSince}</p>

					{#if bio}
						<p
							class="mx-auto mt-4 max-w-[420px] font-hand text-xl leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap text-book-bg/90"
						>
							“{bio}”
						</p>
					{:else}
						<p class="mx-auto mt-4 max-w-[420px] font-hand text-lg text-book-bg/60">
							Small videos, big thoughts.
						</p>
					{/if}

					{#if friendCode}
						<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
							<span
								class="rounded-full bg-cover/35 px-3 py-1 font-mono text-xs font-bold tracking-wider text-book-accent tabular-nums select-all"
							>
								{friendCode}
							</span>
							<button
								type="button"
								class="inline-flex items-center gap-1.5 rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg transition-colors hover:bg-cover/50"
								onclick={copyCode}
							>
								<CommunityIcon name={copied ? 'check' : 'copy'} size={13} />
								{copied ? 'Copied' : 'Copy code'}
							</button>
						</div>
					{/if}

					<!-- Actions -->
					<div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
						{#if isFriend}
							<Button icon="book" onclick={openNotebook}>Open notebook</Button>
							<Button variant="outline" icon="mail" onclick={openMessages}>Message</Button>
						{:else if incoming}
							<Button icon="check" loading={busy} onclick={acceptRequest}>Accept request</Button>
							<Button variant="outline" disabled={busy} onclick={declineRequest}>Decline</Button>
						{:else if outgoing}
							<Button variant="outline" icon="check" disabled>Request sent</Button>
							<Button variant="ghost" disabled={busy} onclick={cancelRequest}>
								Cancel request
							</Button>
						{:else}
							<Button
								icon="plus"
								loading={busy}
								disabled={!allowRequests || !friendCode}
								onclick={addFriend}
							>
								Add friend
							</Button>
						{/if}
					</div>
					{#if !isFriend && !incoming && !outgoing && !allowRequests}
						<p class="mt-2 font-ui text-xs text-book-bg/60">
							This student is not accepting friend requests right now.
						</p>
					{/if}

					<!-- Stats -->
					<div class="mt-6 grid grid-cols-3 gap-3">
						<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3.5">
							<p class="font-display text-2xl font-bold tabular-nums">{posts.length}</p>
							<p class="font-ui text-[11px] text-book-bg/65">Shared pages</p>
						</div>
						<div class="rounded-2xl border border-book-accent/40 bg-book-accent/10 p-3.5">
							<p
								class="flex items-center justify-center gap-1.5 font-display text-2xl font-bold text-book-accent tabular-nums"
							>
								<CommunityIcon name="video" size={18} />
								{videoCount}
							</p>
							<p class="font-ui text-[11px] text-book-bg/65">With video</p>
						</div>
						<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3.5">
							<p class="truncate font-display text-lg leading-8 font-bold">{memberSince}</p>
							<p class="font-ui text-[11px] text-book-bg/65">Joined</p>
						</div>
					</div>

					{#if viewedStreak}
						<div
							class="mt-3 flex items-center gap-3 rounded-2xl border border-book-accent/40 bg-book-accent/10 p-3.5 text-left"
						>
							<span
								class="flex size-11 shrink-0 items-center justify-center rounded-full bg-book-accent/20 text-book-accent"
								aria-hidden="true"
							>
								<CommunityIcon name="flame" size={22} />
							</span>
							<div class="min-w-0 flex-1">
								<p class="font-display text-lg font-bold text-book-bg tabular-nums">
									{viewedStreak.current} day streak
								</p>
								<p class="font-ui text-[11px] text-book-bg/65">
									{#if viewedStreak.current === 0}
										No active streak right now
									{:else if viewedStreak.todayCounted}
										Wrote today
									{:else}
										Write today to keep it alive
									{/if}
									· best {viewedStreak.longest} · {viewedStreak.totalDays} pages
								</p>
							</div>
						</div>
					{/if}

					<!-- Shared pages -->
					<div class="mt-6 text-left">
						<div class="flex items-center justify-between gap-2">
							<h3 class="font-display text-lg font-bold">Shared with the community</h3>
							{#if posts.length > 0}
								<span
									class="rounded-full bg-book-accent/15 px-2.5 py-0.5 font-ui text-[11px] font-semibold text-book-accent tabular-nums"
								>
									{posts.length}
								</span>
							{/if}
						</div>

						{#if posts.length === 0}
							<div
								class="mt-3 rounded-2xl border border-cover-edge bg-cover/20 px-5 py-7 text-center"
							>
								<span
									class="mx-auto flex size-11 items-center justify-center rounded-full bg-cover/35 text-book-accent"
								>
									<CommunityIcon name="sparkles" size={20} />
								</span>
								<p class="mt-3 font-display text-base font-bold">Nothing shared yet</p>
								<p class="mt-1 font-ui text-xs leading-relaxed text-book-bg/65">
									{name.split(' ')[0]} has not shared a page with a community so far.
								</p>
							</div>
						{:else}
							<ul class="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
								{#each posts as post (post.date)}
									{@const mood =
										post.mood && MOOD_BY_KEY[post.mood] ? MOOD_BY_KEY[post.mood] : null}
									<li
										class="flex items-center gap-3 rounded-2xl border border-cover-edge bg-cover/25 p-3"
									>
										{#if mood}
											<span
												class="flex size-11 shrink-0 items-center justify-center rounded-full"
												style="background: {mood.c}88"
												aria-hidden="true"
											>
												<span class="size-8 [&>svg]:size-full">
													<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
													{@html mood.svg}
												</span>
											</span>
										{:else}
											<span
												class="flex size-11 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
												aria-hidden="true"
											>
												<CommunityIcon name="book" size={18} />
											</span>
										{/if}
										<div class="min-w-0 flex-1">
											<p
												class="line-clamp-1 font-display text-base font-bold [overflow-wrap:anywhere]"
											>
												{censor(post.title)}
											</p>
											<p class="font-ui text-[11px] text-book-bg/65">
												{formatDate(post.date)}{mood ? ` · ${mood.l}` : ''}
											</p>
										</div>
										{#if post.hasVideo}
											<CommunityIcon name="video" size={15} class="shrink-0 text-book-accent" />
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<p class="mt-5 font-ui text-[11px] leading-relaxed text-book-bg/55">
						Only pages shared with a community show up here. Friends can read more in their
						notebook.
					</p>
				{/if}
			</div>
		</div>
	</div>
</div>
