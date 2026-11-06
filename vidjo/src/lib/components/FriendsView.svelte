<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { TODAY } from '#lib/dates';
	import { onMount, untrack } from 'svelte';
	import { MOOD_BY_KEY, type MoodDef } from '#lib/data/moods';
	import { STICKERS } from '#lib/data/stickers';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import FriendJournalModal from '#lib/components/FriendJournalModal.svelte';
	import type { Friend, FriendPost } from '#lib/types';

	type Shelf = {
		friend: Friend;
		posts: FriendPost[];
		isOwner: boolean;
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
		friends.openJournal(shelf.friend.id);
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

		if (ownPosts.length > 0) {
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
				newCount: ownPosts.filter((post) => post.date === TODAY).length,
				latest: ownPosts[0]?.date ?? ''
			});
		}

		for (const friend of friends.friends) {
			const posts = byAuthor[friend.id] ?? [];
			list.push({
				friend,
				posts,
				isOwner: false,
				newCount: posts.filter((post) => post.date === TODAY).length,
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

<div class="mx-auto w-full max-w-[1240px] px-4 py-6 min-[900px]:px-6">
	<!-- Header -->
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-ui text-[11px] font-bold tracking-wide text-gold uppercase"
				>
					<span class="size-1.5 rounded-full bg-gold" aria-hidden="true"></span>
					Notebook shelf
				</span>
				<span class="font-ui text-xs text-[#BBA8E0]">
					{friends.friendCount}
					{friends.friendCount === 1 ? 'friend' : 'friends'}
				</span>
			</div>
			<h1
				class="mt-2 font-display text-4xl font-bold tracking-tight text-white min-[720px]:text-5xl"
			>
				Friends
			</h1>
			<p
				class="mt-2 max-w-[620px] font-ui text-sm leading-relaxed text-[#CFC3E6] min-[720px]:text-base"
			>
				Open a friend's notebook to read the pages they shared with friends. Nothing else is
				visible.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="font-ui text-xs font-semibold text-gold hover:underline"
				onclick={() => nav.jump(TODAY)}
			>
				Open my journal →
			</button>
			<button
				type="button"
				class="inline-flex min-h-12 items-center gap-2.5 rounded-[14px] border-[1.5px] border-gold bg-gold/10 px-5 font-ui text-sm font-semibold text-[#F3DDAE] transition-colors hover:bg-gold/20"
				onclick={openAddFriend}
			>
				<span class="text-lg leading-none" aria-hidden="true">+</span>
				Add a friend
			</button>
		</div>
	</div>

	<div
		class="mt-7 grid gap-6 min-[1040px]:grid-cols-[minmax(0,1fr)_340px] min-[1040px]:items-start"
	>
		<!-- Shelf -->
		<section
			class="rounded-[22px] border border-[#4A3670] bg-desk-2 p-5 shadow-[0_14px_30px_rgba(0,0,0,.35)] min-[720px]:p-7"
		>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-baseline gap-3">
					<h2 class="font-display text-[26px] leading-none font-bold text-white">The shelf</h2>
					<span class="font-ui text-sm text-[#BBA8E0]">
						{friends.friendCount}
						{friends.friendCount === 1 ? 'friend' : 'friends'}
					</span>
				</div>

				<div class="flex items-center gap-1 rounded-full border border-[#4D366D] bg-desk/60 p-1">
					{#each FILTERS as filter (filter.key)}
						<button
							type="button"
							class="rounded-full px-3 py-1.5 font-ui text-[11px] font-bold transition-colors {friends.activeFilter ===
							filter.key
								? 'bg-accent text-white'
								: 'text-[#D6CBEC] hover:text-white'}"
							onclick={() => friends.setFilter(filter.key)}
							aria-pressed={friends.activeFilter === filter.key}
						>
							{filter.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="mt-6">
				{#each shelfRows as row, rowIndex (rowIndex)}
					<div class={rowIndex === 0 ? '' : 'mt-9'}>
						<div class="grid grid-cols-2 gap-x-6 gap-y-6 min-[720px]:grid-cols-3">
							{#each row as item, itemIndex (item.kind === 'shelf' ? item.shelf.friend.id : `add-${itemIndex}`)}
								{#if item.kind === 'add'}
									<button
										type="button"
										class="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2.5 rounded-[6px_12px_12px_6px] border-2 border-dashed border-[#8B6FD0] p-3 text-center text-[#D6CBEC] transition-colors hover:border-gold hover:bg-white/[.03] hover:text-white"
										onclick={openAddFriend}
										aria-label="Add a friend with a friend code"
									>
										<span
											class="flex size-9 items-center justify-center rounded-full border border-[#8B6FD0] text-xl leading-none"
											aria-hidden="true"
										>
											+
										</span>
										<span class="font-hand text-xl leading-tight font-bold">Add a friend</span>
										<span class="font-ui text-[10px] leading-tight text-[#BBA8E0]">
											with a friend code
										</span>
									</button>
									<div class="mt-3 h-6" aria-hidden="true"></div>
								{:else}
									{@const shelf = item.shelf}
									{@const cover = coverFor(shelf.friend.id + shelf.friend.displayName)}
									{@const sticker = stickerFor(shelf.friend.id + shelf.friend.displayName)}
									{@const moodPost = shelf.posts.find(
										(entry) => entry.mood && MOOD_BY_KEY[entry.mood]
									)}
									<div class="min-w-0">
										<button
											type="button"
											class="group relative block w-full text-left"
											onclick={() => openReader(shelf)}
											aria-label="Open {shelf.friend.displayName}'s notebook, {shelf.newCount}
												new pages"
										>
											{#if shelf.newCount > 0}
												<span
													class="absolute -top-1.5 -right-1.5 z-10 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-gold px-1 font-ui text-[11px] font-bold text-[#2A1B3D] shadow-[0_0_0_3px_#2A1B3D]"
												>
													{shelf.newCount}
												</span>
											{/if}

											<span
												class="relative block aspect-[3/4] overflow-hidden rounded-[6px_12px_12px_6px] shadow-[0_12px_20px_rgba(0,0,0,.5),inset_-3px_0_0_rgba(255,255,255,.08)] transition-transform duration-200 group-hover:-translate-y-1"
												style="background: linear-gradient(135deg, {cover[0]}, {cover[1]})"
											>
												<span
													class="absolute inset-y-0 left-0 w-[13%] bg-black/30"
													aria-hidden="true"
												></span>
												<span
													class="absolute inset-2 left-[19%] rounded-[8px] border-2 border-dashed border-gold/55"
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
													class="absolute top-1/2 right-[12%] left-[26%] -translate-y-1/2 -rotate-2 rounded bg-paper px-1.5 py-1 text-center font-hand text-[22px] leading-none font-bold text-ink shadow-[0_2px_4px_rgba(0,0,0,.3)]"
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
											class="mt-3 flex items-center justify-center gap-2 text-[13px] leading-tight text-[#D6CBEC]"
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
							class="mx-[-8px] mt-2 h-4 rounded-[4px] bg-[linear-gradient(#4A3470,#33224F)] shadow-[0_8px_12px_rgba(0,0,0,.4)]"
							aria-hidden="true"
						></div>
					</div>
				{/each}
			</div>

			{#if friends.friendCount === 0}
				<p class="mt-6 text-center font-hand text-base leading-snug text-[#C9B8E8]">
					Your shelf is waiting. Add a friend with their code and their notebook will appear here.
				</p>
			{/if}
		</section>

		<!-- Sidebar -->
		<aside class="space-y-4">
			<!-- Moods -->
			<section class="rounded-[20px] bg-paper p-5 text-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]">
				<h2 class="font-display text-[23px] leading-tight font-bold text-ink">
					How everyone's feeling
				</h2>
				<p class="mt-1 font-hand text-lg leading-tight text-ink-soft">Only the mood. No details.</p>

				{#if moodPeek.length > 0}
					<div class="mt-4 flex flex-wrap gap-x-3 gap-y-4">
						{#each moodPeek as item (item.key)}
							<div class="flex min-w-[60px] flex-col items-center gap-1 text-center">
								<div
									class="flex size-14 items-center justify-center rounded-full shadow-[0_0_0_1px_#E0D4EE]"
									style="background: {item.mood.c}88"
								>
									<span class="size-10 [&>svg]:size-full" aria-hidden="true">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
										{@html item.mood.svg}
									</span>
								</div>
								<span
									class="max-w-[68px] truncate font-hand text-lg leading-none font-bold text-ink"
								>
									{firstName(item.friend.displayName)}
								</span>
								<span class="font-hand text-[13px] leading-none text-ink-soft">
									{item.when.toLowerCase()}
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-4 font-hand text-base leading-snug text-ink-soft">
						No moods shared yet. When friends post, their weather shows up here.
					</p>
				{/if}
			</section>

			<!-- Requests -->
			<section class="rounded-[20px] bg-paper p-5 text-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]">
				<div class="flex items-start justify-between gap-2">
					<h2 class="font-display text-[23px] leading-tight font-bold text-ink">Friend requests</h2>
					{#if friends.pendingCount > 0}
						<span
							class="rounded-full bg-gold/25 px-2 py-0.5 font-ui text-[11px] font-bold text-[#7A5618]"
						>
							{friends.pendingCount}
						</span>
					{/if}
				</div>
				<p class="mt-1 font-hand text-lg leading-tight text-ink-soft">
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
									<div class="truncate font-hand text-xl leading-tight font-bold text-ink">
										{request.fromDisplayName || 'VidJo student'}
									</div>
									<div class="truncate font-ui text-[11px] text-ink-soft">
										@{request.fromUsername}
									</div>
								</div>
								<div class="flex gap-1.5">
									<button
										type="button"
										class="min-h-9 rounded-lg bg-accent px-3 font-ui text-xs font-semibold text-white transition-colors hover:bg-[#624690]"
										onclick={() => friends.acceptFriendRequest(request.id)}
									>
										Accept
									</button>
									<button
										type="button"
										class="min-h-9 rounded-lg border-[1.5px] border-[#CDBBE9] px-3 font-ui text-xs font-semibold text-accent transition-colors hover:bg-light"
										onclick={() => friends.declineFriendRequest(request.id)}
									>
										Decline
									</button>
								</div>
							</div>
						{/each}

						{#if friends.incomingRequests.length > incoming.length}
							<p class="font-ui text-[11px] text-ink-soft">
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
									<div class="truncate font-hand text-lg leading-tight font-bold text-ink">
										{request.toDisplayName || 'Request sent'}
									</div>
									<div class="font-ui text-[11px] text-ink-soft">Waiting to be accepted</div>
								</div>
								<button
									type="button"
									class="min-h-9 rounded-lg border border-line px-2.5 font-ui text-[11px] font-semibold text-ink-soft transition-colors hover:bg-light hover:text-ink"
									onclick={() => friends.cancelFriendRequest(request.id)}
								>
									Cancel
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-3 font-hand text-base leading-snug text-ink-soft">
						Share your friend code below to get discovered by classmates.
					</p>
				{/if}
			</section>

			<!-- Friend code -->
			<section class="rounded-[20px] bg-paper p-5 text-ink shadow-[0_10px_26px_rgba(0,0,0,.35)]">
				<h2 class="font-display text-[23px] leading-tight font-bold text-ink">Invite a friend</h2>
				<p class="mt-1 font-hand text-lg leading-tight text-ink-soft">
					Friends add you with your friend code. Usernames and links will not work.
				</p>

				<div class="mt-4 flex flex-wrap gap-2.5">
					<label class="sr-only" for="my-friend-code">Your friend code</label>
					<input
						id="my-friend-code"
						readonly
						value={friends.myFriendCode}
						class="h-11 min-w-0 flex-1 rounded-xl border border-line bg-[#FFFDF6] px-3.5 font-hand text-lg font-bold tracking-wide text-ink select-all"
					/>
					<button
						type="button"
						class="min-h-11 rounded-xl bg-accent px-4 font-ui text-sm font-semibold text-white transition-colors hover:bg-[#624690]"
						onclick={copyMyCode}
					>
						{copied ? 'Copied!' : 'Copy code'}
					</button>
				</div>

				<div class="mt-3 flex items-start gap-2 border-t border-line pt-3">
					<svg
						class="mt-0.5 size-4 shrink-0 text-[#8A5A12]"
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
					<p class="font-ui text-[11px] leading-relaxed text-ink-soft">
						Share your code only with classmates you want on your shelf. Nothing else about your
						journal becomes visible.
					</p>
				</div>
			</section>
		</aside>
	</div>
</div>

<!-- Add friend modal -->
{#if addOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
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
			class="relative z-10 w-full max-w-[440px] overflow-hidden rounded-[26px] border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,#34214E,#231438)] px-5 py-4 text-white"
			>
				<div>
					<h2 id="add-friend-title" class="font-display text-xl font-bold">Add a friend</h2>
					<p class="font-ui text-[11px] text-[#C9B8E8]">Friend codes only</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={() => (addOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<form class="p-5" onsubmit={submitAddFriend}>
				<label
					for="friend-code-input"
					class="block font-ui text-xs font-bold tracking-wide text-ink-soft uppercase"
				>
					Their friend code
				</label>
				<input
					id="friend-code-input"
					bind:value={addCodeInput}
					type="text"
					placeholder="VJ-7K9M2P"
					maxlength="16"
					class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-[#FFFDF6] px-3.5 font-mono text-base font-bold tracking-wider text-ink uppercase placeholder:text-ink-soft/50 focus:border-accent focus:outline-none"
					disabled={addBusy}
					autocomplete="off"
					spellcheck="false"
				/>
				<p class="mt-2 font-hand text-base leading-snug text-ink-soft">
					Ask your friend for the code on their profile. Usernames and invite links cannot be used.
				</p>

				{#if addSuccess}
					<p
						class="mt-3 rounded-xl border border-[#BFDCC7] bg-[#EDF6EF] px-3 py-2 font-ui text-xs font-semibold text-[#2F6B45]"
					>
						{addSuccess}
					</p>
				{/if}
				{#if addError}
					<p
						class="mt-3 rounded-xl border border-[#E3B9B9] bg-[#FBEAEA] px-3 py-2 font-ui text-xs font-semibold text-[#8A2F2F]"
					>
						{addError}
					</p>
				{/if}

				<div class="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
					<button
						type="button"
						class="min-h-10 rounded-xl border border-line px-4 font-ui text-sm font-semibold text-ink-soft transition-colors hover:bg-light hover:text-ink"
						onclick={() => (addOpen = false)}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="flex min-h-10 items-center gap-2 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white transition-colors hover:bg-[#624690] disabled:cursor-not-allowed disabled:opacity-50"
						disabled={addBusy || !addCodeInput.trim()}
					>
						{#if addBusy}
							<span
								class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								aria-hidden="true"
							></span>
							Sending…
						{:else}
							Send request
						{/if}
					</button>
				</div>
			</form>

			<div class="border-t border-line bg-light/70 px-5 py-3">
				<p class="font-ui text-[10px] font-bold tracking-wide text-ink-soft uppercase">Your code</p>
				<div class="mt-1 flex items-center gap-2">
					<code class="rounded-lg bg-paper px-2 py-1 font-mono text-xs font-bold text-accent">
						{friends.myFriendCode}
					</code>
					<button
						type="button"
						class="font-ui text-xs font-semibold text-accent hover:underline"
						onclick={copyMyCode}
					>
						{copied ? 'Copied!' : 'Copy'}
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
