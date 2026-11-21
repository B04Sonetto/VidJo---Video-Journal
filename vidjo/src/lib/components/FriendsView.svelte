<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { todayKey } from '#lib/dates';
	import { onMount, untrack } from 'svelte';
	import { MOOD_BY_KEY, type MoodDef } from '#lib/data/moods';
	import { STICKERS } from '#lib/data/stickers';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import FriendJournalModal from '#lib/components/FriendJournalModal.svelte';
	import MessagesPanel from '#lib/components/MessagesPanel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Skeleton from '#lib/components/ui/Skeleton.svelte';
	import type { Friend, FriendPost } from '#lib/types';

	type Shelf = {
		friend: Friend;
		posts: FriendPost[];
		isOwner: boolean;
		newPosts: FriendPost[];
		newCount: number;
		latest: string;
	};

	type ShelfItem = { kind: 'shelf'; shelf: Shelf } | { kind: 'add' };

	const FILTERS = [
		{ key: 'all', label: 'All pages' },
		{ key: 'video', label: 'Video' },
		{ key: 'written', label: 'Written' }
	] as const;

	const COVERS: [string, string][] = [
		['#5A3A8C', '#3A2360'],
		['#2F6B73', '#1F4A55'],
		['#8C3A62', '#5E2444'],
		['#3C4B9C', '#27306B'],
		['#3F7A56', '#285038'],
		['#7A4A2E', '#4E2B1A'],
		['#6B3F87', '#42265A'],
		['#355E7A', '#1F3B52']
	];

	const STICKER_POOL = STICKERS.filter((sticker) => !sticker.flat && !sticker.k.startsWith('tape'));

	let addOpen = $state(false);
	let addCodeInput = $state('');
	let addBusy = $state(false);
	let addError = $state('');
	let addSuccess = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		void friends.refresh();
	});

	function hashString(value: string) {
		let hash = 0;
		for (let i = 0; i < value.length; i += 1) {
			hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
		}
		return hash;
	}

	function coverFor(seed: string) {
		return COVERS[hashString(seed) % COVERS.length];
	}

	function stickerFor(seed: string) {
		return STICKER_POOL[hashString(seed) % STICKER_POOL.length];
	}

	function firstName(name: string) {
		return name.trim().split(/\s+/)[0] || 'Friend';
	}

	function openAddFriend() {
		addError = '';
		addSuccess = '';
		addOpen = true;
	}

	function openReader(shelf: Shelf) {
		// Land on the unread page instead of always showing the newest one.
		friends.openJournal(shelf.friend.id, shelf.newPosts[0]?.date ?? null);
	}

	async function copyMyCode() {
		const code = friends.myFriendCode;
		if (!code) return;
		try {
			await navigator.clipboard?.writeText(code);
		} catch {
			// Clipboard access can be blocked; the code is still selectable.
		}
		copied = true;
		journal.toast(`Friend Code ${code} copied!`);
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
		}, 2500);
	}

	async function submitAddFriend(event: SubmitEvent) {
		event.preventDefault();
		if (!addCodeInput.trim()) return;

		addBusy = true;
		addError = '';
		addSuccess = '';

		try {
			const res = await friends.addFriendByCode(addCodeInput);
			if (res.success) {
				addSuccess = res.message;
				addCodeInput = '';
				setTimeout(() => {
					addSuccess = '';
				}, 5000);
			} else {
				addError = res.message;
			}
		} finally {
			addBusy = false;
		}
	}

	$effect(() => {
		// Refresh the current user's shared pages when a journal page changes.
		void journal.entries;
		void Object.keys(journal.entries).length;
		for (const entry of Object.values(journal.entries)) {
			void entry.privacy;
			void entry.title;
			void entry.mind;
			void entry.refl;
			void entry.videoPath;
			void entry.videoName;
			void entry.stickers;
			void entry.shareWithFriends;
			void entry.communitySlug;
			void entry.mood;
		}
		void profile.nickname;
		void profile.username;
		void profile.avatarUrl;
		void profile.friendCode;

		untrack(() => friends.syncOwnPosts());
	});

	const shelves = $derived.by<Shelf[]>(() => {
		const visible = friends.filteredPosts;
		const byAuthor: Record<string, FriendPost[]> = {};

		for (const post of visible) {
			(byAuthor[post.authorId] ??= []).push(post);
		}

		const list: Shelf[] = [];
		const ownPosts = visible.filter((post) => post.isOwner);
		const unread = (posts: FriendPost[]) =>
			posts
				.filter((post) => !friends.isPostSeen(post))
				.sort((a, b) => b.date.localeCompare(a.date));

		if (ownPosts.length > 0) {
			const newPosts = unread(ownPosts);
			list.push({
				friend: {
					id: profile.profile?.user_id || 'me',
					username: profile.username,
					displayName: profile.nickname || 'You',
					avatarUrl: profile.avatarUrl,
					bio: profile.bio,
					friendCode: profile.friendCode
				},
				posts: ownPosts,
				isOwner: true,
				newPosts,
				newCount: newPosts.length,
				latest: ownPosts[0]?.date ?? ''
			});
		}

		for (const friend of friends.friends) {
			const posts = byAuthor[friend.id] ?? [];
			const newPosts = unread(posts);
			list.push({
				friend,
				posts,
				isOwner: false,
				newPosts,
				newCount: newPosts.length,
				latest: posts[0]?.date ?? ''
			});
		}

		list.sort((a, b) => {
			if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
			if (a.newCount !== b.newCount) return b.newCount - a.newCount;
			return (
				b.latest.localeCompare(a.latest) || a.friend.displayName.localeCompare(b.friend.displayName)
			);
		});

		return list;
	});

	const shelfRows = $derived.by<ShelfItem[][]>(() => {
		const items: ShelfItem[] = shelves.map((shelf) => ({ kind: 'shelf', shelf }));
		items.push({ kind: 'add' });

		const rows: ShelfItem[][] = [];
		for (let i = 0; i < items.length; i += 3) {
			rows.push(items.slice(i, i + 3));
		}
		return rows;
	});

	const moodPeek = $derived.by<{ key: string; friend: Friend; mood: MoodDef; when: string }[]>(
		() => {
			const items: { key: string; friend: Friend; mood: MoodDef; when: string }[] = [];

			for (const shelf of shelves) {
				if (shelf.isOwner || shelf.posts.length === 0) continue;
				const moodPost = shelf.posts.find((post) => post.mood && MOOD_BY_KEY[post.mood]);
				if (!moodPost?.mood) continue;
				items.push({
					key: shelf.friend.id,
					friend: shelf.friend,
					mood: MOOD_BY_KEY[moodPost.mood],
					when: moodPost.dateFormatted
				});
			}

			return items.slice(0, 8);
		}
	);

	const readerShelf = $derived(
		shelves.find((shelf) => shelf.friend.id === friends.readerAuthorId) ?? null
	);
	const incoming = $derived(friends.incomingRequests.slice(0, 3));
	const outgoing = $derived(friends.outgoingRequests.slice(0, 2));
</script>

<svelte:window
	onkeydown={(event) => {
		if (addOpen && event.key === 'Escape') addOpen = false;
	}}
/>

<div
	class="mx-auto w-full max-w-[1240px] {nav.friendsTab === 'messages'
		? 'px-3 py-3 min-[900px]:px-6 min-[900px]:py-6'
		: 'px-3 py-4 min-[720px]:px-5 min-[900px]:px-6'}"
>
	{#if nav.friendsTab === 'shelf'}
		<PageHeader
			title="Friends"
			description="Open a friend's notebook to read the pages they shared. Nothing else is visible."
		>
			{#snippet meta()}
				{friends.friendCount}
				{friends.friendCount === 1 ? 'friend' : 'friends'}
			{/snippet}
			{#snippet actions()}
				<Button variant="ghost" trailingIcon="arrow-right" onclick={() => nav.jump(todayKey())}>
					Open my journal
				</Button>
				<Button icon="plus" onclick={openAddFriend}>Add a friend</Button>
			{/snippet}
		</PageHeader>
	{/if}

	{#snippet sectionTabs()}
		<div
			class="inline-flex rounded-full border border-cover-edge bg-desk-2/80 p-1"
			role="tablist"
			aria-label="Friends sections"
		>
			<button
				type="button"
				role="tab"
				aria-selected={nav.friendsTab === 'shelf'}
				class="inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 font-ui text-xs font-bold transition-colors {nav.friendsTab ===
				'shelf'
					? 'bg-cta text-cta-text'
					: 'text-book-bg/70 hover:text-book-bg'}"
				onclick={() => nav.setFriendsTab('shelf')}
			>
				<CommunityIcon name="book" size={14} />
				Shelf
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={nav.friendsTab === 'messages'}
				class="inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 font-ui text-xs font-bold transition-colors {nav.friendsTab ===
				'messages'
					? 'bg-cta text-cta-text'
					: 'text-book-bg/70 hover:text-book-bg'}"
				onclick={() => nav.setFriendsTab('messages')}
			>
				<CommunityIcon name="mail" size={14} />
				Messages
				{#if messages.unreadTotal > 0}
					<span
						class="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 font-ui text-[10px] font-bold text-desk tabular-nums"
						aria-label="{messages.unreadTotal} unread messages"
					>
						{messages.unreadTotal > 9 ? '9+' : messages.unreadTotal}
					</span>
				{/if}
			</button>
		</div>

		{#if nav.friendsTab === 'messages' && friends.pendingCount > 0}
			<p class="font-ui text-xs font-semibold text-book-bg/65">
				{friends.pendingCount}
				{friends.pendingCount === 1 ? 'friend request is' : 'friend requests are'} waiting on the Shelf.
			</p>
		{/if}
	{/snippet}

	<div
		class="flex flex-wrap items-center justify-between gap-3 {nav.friendsTab === 'messages'
			? 'mb-3'
			: 'mt-4 min-[720px]:mt-6'}"
	>
		{@render sectionTabs()}
	</div>

	{#if nav.friendsTab === 'messages'}
		<MessagesPanel />
	{:else}
		<div
			class="grid gap-4 min-[720px]:gap-6 min-[1040px]:grid-cols-[minmax(0,1fr)_340px] min-[1040px]:items-start"
		>
			<!-- Shelf -->
			<section
				class="rounded-[18px] border border-cover-edge bg-desk-2 p-3 shadow-[0_14px_30px_rgba(0,0,0,.35)] min-[480px]:p-4 min-[720px]:rounded-[22px] min-[720px]:p-7"
			>
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-baseline gap-3">
						<h2 class="font-display text-[26px] leading-none font-bold text-book-bg">The shelf</h2>
						<span class="font-ui text-sm text-book-bg/65 tabular-nums">
							{friends.friendCount}
							{friends.friendCount === 1 ? 'friend' : 'friends'}
						</span>
					</div>

					<div class="flex items-center gap-1 rounded-full border border-cover-edge bg-desk/60 p-1">
						{#each FILTERS as filter (filter.key)}
							<button
								type="button"
								class="min-h-8 rounded-full px-3 py-1.5 font-ui text-[11px] font-bold transition-colors {friends.activeFilter ===
								filter.key
									? 'bg-cta text-cta-text'
									: 'text-book-bg/70 hover:text-book-bg'}"
								onclick={() => friends.setFilter(filter.key)}
								aria-pressed={friends.activeFilter === filter.key}
							>
								{filter.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="mt-4 min-[720px]:mt-6">
					{#if friends.loading && shelves.length === 0}
						<div
							class="grid grid-cols-3 gap-x-3 gap-y-4 min-[480px]:gap-x-4 min-[720px]:gap-x-6 min-[720px]:gap-y-6"
						>
							{#each [0, 1, 2] as slot (slot)}
								<div>
									<Skeleton
										class="aspect-[4/5] w-full rounded-[6px_12px_12px_6px] min-[720px]:aspect-[3/4]"
									/>
									<Skeleton class="mx-auto mt-3 h-3.5 w-2/3" />
								</div>
							{/each}
						</div>
					{:else}
						{#each shelfRows as row, rowIndex (rowIndex)}
							<div class={rowIndex === 0 ? '' : 'mt-6 min-[720px]:mt-9'}>
								<div
									class="grid grid-cols-3 gap-x-3 gap-y-4 min-[480px]:gap-x-4 min-[720px]:gap-x-6 min-[720px]:gap-y-6"
								>
									{#each row as item, itemIndex (item.kind === 'shelf' ? item.shelf.friend.id : `add-${itemIndex}`)}
										{#if item.kind === 'add'}
											<button
												type="button"
												class="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-cover p-2 text-center text-book-bg/70 transition-colors hover:border-book-accent hover:bg-cover/30 hover:text-book-bg min-[720px]:aspect-[3/4] min-[720px]:gap-2.5 min-[720px]:p-3"
												onclick={openAddFriend}
												aria-label="Add a friend with a friend code"
											>
												<span
													class="flex size-8 items-center justify-center rounded-full border border-cover text-book-accent min-[720px]:size-9"
													aria-hidden="true"
												>
													<CommunityIcon name="plus" size={16} />
												</span>
												<span
													class="font-hand text-base leading-tight font-bold min-[480px]:text-xl"
													>Add a friend</span
												>
												<span class="font-ui text-[10px] leading-tight text-book-bg/60">
													with a friend code
												</span>
											</button>
											<div class="mt-2 h-5" aria-hidden="true"></div>
										{:else}
											{@const shelf = item.shelf}
											{@const cover = coverFor(shelf.friend.id + shelf.friend.displayName)}
											{@const sticker = stickerFor(shelf.friend.id + shelf.friend.displayName)}
											{@const moodPost = shelf.posts.find(
												(entry) => entry.mood && MOOD_BY_KEY[entry.mood]
											)}
											{@const shelfLabel = `Open ${shelf.friend.displayName}'s notebook, ${shelf.newCount} new pages${shelf.newPosts[0] ? `, newest ${shelf.newPosts[0].dateFormatted}` : ''}`}
											<div class="min-w-0">
												<button
													type="button"
													class="group relative block w-full text-left"
													onclick={() => openReader(shelf)}
													aria-label={shelfLabel}
													title={shelf.newPosts[0]
														? `New page: ${shelf.newPosts[0].dateFormatted}`
														: undefined}
												>
													{#if shelf.newCount > 0}
														<span
															class="absolute -top-1.5 -right-1.5 z-10 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-gold px-1 font-ui text-[11px] font-bold text-desk shadow-[0_0_0_3px_var(--color-desk-2)]"
														>
															{shelf.newCount}
														</span>
													{/if}

													<span
														class="relative block aspect-[4/5] overflow-hidden rounded-[6px_12px_12px_6px] shadow-[0_12px_20px_rgba(0,0,0,.5),inset_-3px_0_0_rgba(255,255,255,.08)] transition-transform duration-200 group-hover:-translate-y-1 min-[720px]:aspect-[3/4]"
														style="background: linear-gradient(135deg, {cover[0]}, {cover[1]})"
													>
														<span
															class="absolute inset-y-0 left-0 w-[13%] bg-black/30"
															aria-hidden="true"
														></span>
														<span
															class="absolute inset-2 left-[19%] rounded-[8px] border border-gold/40"
															aria-hidden="true"
														></span>

														{#if shelf.isOwner}
															<span
																class="absolute top-[8%] left-[21%] z-10 rounded-full bg-white/20 px-1.5 py-0.5 font-ui text-[8px] font-bold text-white"
															>
																Your notebook
															</span>
														{/if}

														<span
															class="absolute top-1/2 right-[12%] left-[26%] -translate-y-1/2 -rotate-2 rounded bg-paper px-1 py-0.5 text-center font-hand text-[14px] leading-none font-bold text-ink shadow-[0_2px_4px_rgba(0,0,0,.3)] min-[480px]:text-[19px] min-[720px]:px-1.5 min-[720px]:py-1 min-[720px]:text-[22px]"
														>
															<span class="block truncate">
																{firstName(shelf.friend.displayName)}
															</span>
														</span>

														{#if sticker}
															<span
																class="absolute top-[9%] right-[8%] w-[36%] rotate-[8deg] sticker-shadow [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
																aria-hidden="true"
															>
																<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/stickers.ts -->
																{@html sticker.svg}
															</span>
														{/if}
													</span>
												</button>

												<div
													class="mt-2 flex items-center justify-center gap-1.5 text-[11px] leading-tight text-book-bg/70 min-[480px]:text-[13px] min-[720px]:mt-3 min-[720px]:gap-2"
												>
													{#if moodPost?.mood && MOOD_BY_KEY[moodPost.mood]}
														<span class="size-5 shrink-0 [&>svg]:size-full" aria-hidden="true">
															<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
															{@html MOOD_BY_KEY[moodPost.mood].svg}
														</span>
													{:else}
														<svg
															class="size-5 shrink-0 text-gold"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="1.8"
															stroke-linejoin="round"
															aria-hidden="true"
														>
															<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"
															></path>
														</svg>
													{/if}
													<span>
														{#if shelf.newCount > 0}
															{shelf.newCount} new
															{shelf.newCount === 1 ? 'page' : 'pages'}
															<span class="font-semibold text-gold"
																>· {shelf.newPosts[0].dateFormatted}</span
															>
														{:else if shelf.posts.length > 0}
															{shelf.posts.length} shared
															{shelf.posts.length === 1 ? 'page' : 'pages'}
														{:else}
															No shared pages
														{/if}
													</span>
												</div>
											</div>
										{/if}
									{/each}
								</div>

								<div
									class="mx-[-8px] mt-2 h-4 rounded-[4px] bg-[linear-gradient(var(--color-cover),var(--color-cover-edge))] shadow-[0_8px_12px_rgba(0,0,0,.4)]"
									aria-hidden="true"
								></div>
							</div>
						{/each}
					{/if}
				</div>

				{#if !friends.loading && friends.friendCount === 0}
					<p class="mt-6 text-center font-ui text-sm leading-relaxed text-book-bg/65">
						Your shelf is waiting. Add a friend with their code and their notebook will appear here.
					</p>
				{/if}
			</section>

			<!-- Sidebar -->
			<aside class="space-y-4">
				<!-- Moods -->
				<section
					class="rounded-[20px] note-scrap p-5 text-book-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]"
				>
					<h2 class="font-display text-[23px] leading-tight font-bold text-book-ink">
						How everyone's feeling
					</h2>
					<p class="mt-1 font-hand text-lg leading-tight text-book-ink/70">
						Only the mood. No details.
					</p>

					{#if moodPeek.length > 0}
						<div class="mt-4 flex flex-wrap gap-x-3 gap-y-4">
							{#each moodPeek as item (item.key)}
								<div class="flex min-w-[60px] flex-col items-center gap-1 text-center">
									<div
										class="flex size-14 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--color-line)]"
										style="background: {item.mood.c}88"
									>
										<span class="size-10 [&>svg]:size-full" aria-hidden="true">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
											{@html item.mood.svg}
										</span>
									</div>
									<span
										class="max-w-[68px] truncate font-hand text-lg leading-none font-bold text-book-ink"
									>
										{firstName(item.friend.displayName)}
									</span>
									<span class="font-hand text-[13px] leading-none text-book-ink/70">
										{item.when.toLowerCase()}
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="mt-4 font-hand text-base leading-snug text-book-ink/70">
							No moods shared yet. When friends post, their weather shows up here.
						</p>
					{/if}
				</section>

				<!-- Requests -->
				<section
					class="rounded-[20px] note-scrap p-5 text-book-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]"
				>
					<div class="flex items-start justify-between gap-2">
						<h2 class="font-display text-[23px] leading-tight font-bold text-book-ink">
							Friend requests
						</h2>
						{#if friends.pendingCount > 0}
							<span
								class="rounded-full bg-book-accent/20 px-2 py-0.5 font-ui text-[11px] font-bold note-accent"
							>
								{friends.pendingCount}
							</span>
						{/if}
					</div>
					<p class="mt-1 font-hand text-lg leading-tight text-book-ink/70">
						{#if friends.incomingRequests.length > 0}
							{friends.incomingRequests.length}
							{friends.incomingRequests.length === 1 ? 'person wants' : 'people want'} to read your shared
							pages.
						{:else}
							No one is waiting right now.
						{/if}
					</p>

					{#if incoming.length > 0 || outgoing.length > 0}
						<div class="mt-3 space-y-3">
							{#each incoming as request (request.id)}
								<div class="flex flex-wrap items-center gap-2.5">
									<Avatar
										src={request.fromAvatarUrl}
										name={request.fromDisplayName}
										className="size-11"
										textClass="text-lg"
										ring="ring-2 ring-gold/40"
									/>
									<div class="min-w-[90px] flex-1">
										<div class="truncate font-hand text-xl leading-tight font-bold text-book-ink">
											{request.fromDisplayName || 'VidJo student'}
										</div>
										<div class="truncate font-ui text-[11px] text-book-ink/70">
											@{request.fromUsername}
										</div>
									</div>
									<div class="flex gap-1.5">
										<button
											type="button"
											class="min-h-9 rounded-lg bg-cta px-3 font-ui text-xs font-semibold text-cta-text transition-colors hover:bg-cta-hover"
											onclick={() => friends.acceptFriendRequest(request.id)}
										>
											Accept
										</button>
										<button
											type="button"
											class="min-h-9 rounded-lg border-[1.5px] border-line px-3 font-ui text-xs font-semibold text-book-ink/80 transition-colors hover:bg-paper-deep"
											onclick={() => friends.declineFriendRequest(request.id)}
										>
											Decline
										</button>
									</div>
								</div>
							{/each}

							{#if friends.incomingRequests.length > incoming.length}
								<p class="font-ui text-[11px] text-book-ink/70">
									+{friends.incomingRequests.length - incoming.length} more waiting below in the list.
								</p>
							{/if}

							{#each outgoing as request (request.id)}
								<div class="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
									<Avatar
										src={request.toAvatarUrl}
										name={request.toDisplayName || 'VidJo student'}
										className="size-10"
										textClass="text-base"
										ring="ring-2 ring-lav/40"
									/>
									<div class="min-w-[90px] flex-1">
										<div class="truncate font-hand text-lg leading-tight font-bold text-book-ink">
											{request.toDisplayName || 'Request sent'}
										</div>
										<div class="font-ui text-[11px] text-book-ink/70">Waiting to be accepted</div>
									</div>
									<button
										type="button"
										class="min-h-9 rounded-lg border border-line px-2.5 font-ui text-[11px] font-semibold text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
										onclick={() => friends.cancelFriendRequest(request.id)}
									>
										Cancel
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="mt-3 font-hand text-base leading-snug text-book-ink/70">
							Share your friend code below to get discovered by classmates.
						</p>
					{/if}
				</section>

				<!-- Friend code -->
				<section
					class="rounded-[20px] note-scrap p-5 text-book-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]"
				>
					<h2 class="font-display text-[23px] leading-tight font-bold text-book-ink">
						Invite a friend
					</h2>
					<p class="mt-1 font-hand text-lg leading-tight text-book-ink/70">
						Friends add you with your friend code. Usernames and links will not work.
					</p>

					<div class="mt-4 flex flex-wrap gap-2.5">
						<label class="sr-only" for="my-friend-code">Your friend code</label>
						<input
							id="my-friend-code"
							readonly
							value={friends.myFriendCode}
							class="h-11 min-w-0 flex-1 rounded-xl border border-line bg-book-bg px-3.5 font-hand text-lg font-bold tracking-wide text-book-ink select-all"
						/>
						<button
							type="button"
							class="min-h-11 rounded-xl bg-cta px-4 font-ui text-sm font-semibold text-cta-text transition-colors hover:bg-cta-hover"
							onclick={copyMyCode}
						>
							{copied ? 'Copied!' : 'Copy code'}
						</button>
					</div>

					<div class="mt-3 flex items-start gap-2 border-t border-line pt-3">
						<svg
							class="mt-0.5 size-4 shrink-0 note-accent"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="8" cy="15" r="4"></circle>
							<path d="m10.85 12.15 8.65-8.65M18 5l3 3M15 8l3 3"></path>
						</svg>
						<p class="font-ui text-[11px] leading-relaxed text-book-ink/70">
							Share your code only with classmates you want on your shelf. Nothing else about your
							journal becomes visible.
						</p>
					</div>
				</section>
			</aside>
		</div>
	{/if}
</div>

<!-- Add friend modal -->
{#if addOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-friend-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={() => (addOpen = false)}
			aria-label="Close add friend dialog"
		></button>

		<div
			class="relative z-10 w-full max-w-[440px] overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-4 text-book-bg"
			>
				<div>
					<h2 id="add-friend-title" class="font-display text-xl font-bold">Add a friend</h2>
					<p class="font-ui text-[11px] text-book-bg/65">Friend codes only</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
					onclick={() => (addOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<form class="p-5" onsubmit={submitAddFriend}>
				<label for="friend-code-input" class="block font-ui text-xs font-semibold text-book-ink/70">
					Their friend code
				</label>
				<input
					id="friend-code-input"
					bind:value={addCodeInput}
					type="text"
					placeholder="VJ-7K9M2P"
					maxlength="16"
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-book-bg px-3.5 font-mono text-base font-bold tracking-wider text-book-ink uppercase placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
					disabled={addBusy}
					autocomplete="off"
					spellcheck="false"
				/>
				<p class="mt-2 font-hand text-base leading-snug text-book-ink/70">
					Ask your friend for the code on their profile. Usernames and invite links cannot be used.
				</p>

				{#if addSuccess}
					<p
						class="mt-3 rounded-xl border border-success/35 bg-success/10 px-3 py-2 font-ui text-xs font-semibold text-success"
					>
						{addSuccess}
					</p>
				{/if}
				{#if addError}
					<p
						class="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 font-ui text-xs font-semibold text-danger"
					>
						{addError}
					</p>
				{/if}

				<div class="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
					<Button variant="note" onclick={() => (addOpen = false)}>Cancel</Button>
					<Button
						type="submit"
						icon="mail"
						loading={addBusy}
						disabled={addBusy || !addCodeInput.trim()}
					>
						{addBusy ? 'Sending…' : 'Send request'}
					</Button>
				</div>
			</form>

			<div class="border-t border-line bg-paper-deep/70 px-5 py-3">
				<p class="font-ui text-[11px] font-semibold text-book-ink/70">Your friend code</p>
				<div class="mt-1 flex items-center gap-2">
					<code
						class="rounded-md bg-book-bg px-2 py-1 font-mono text-xs font-bold note-accent tabular-nums"
					>
						{friends.myFriendCode}
					</code>
					<button
						type="button"
						class="inline-flex items-center gap-1 font-ui text-xs font-semibold note-accent hover:underline"
						onclick={copyMyCode}
					>
						<CommunityIcon name="copy" size={12} />
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<FriendJournalModal
	open={friends.readerAuthorId !== null}
	friend={readerShelf?.friend ?? null}
	posts={readerShelf?.posts ?? []}
	initialDate={friends.readerDate}
	onClose={() => friends.closeJournal()}
/>
