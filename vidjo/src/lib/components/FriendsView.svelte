<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { TODAY } from '#lib/dates';
	import { untrack } from 'svelte';
	import type { MoodKey } from '#lib/types';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import { censor } from '#lib/censor';

	let activeSubTab = $state<'feed' | 'requests' | 'list'>('feed');
	let addCodeInput = $state('');
	let addBusy = $state(false);
	let addError = $state('');
	let addSuccess = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let commentInputs = $state<Record<string, string>>({});
	let openCommentPost = $state<string | null>(null);
	let profileModalOpen = $state(false);
	let viewedUserId = $state<string | null>(null);

	const MOOD_ICONS: Record<MoodKey, { label: string; icon: string }> = {
		happy: { label: 'Happy', icon: 'smile' },
		calm: { label: 'Calm', icon: 'cloud' },
		tired: { label: 'Tired', icon: 'moon' },
		sad: { label: 'Sad', icon: 'frown' },
		stressed: { label: 'Stressed', icon: 'zap' },
		angry: { label: 'Fired Up', icon: 'flame' },
		excited: { label: 'Excited', icon: 'spark' }
	};

	function copyMyCode() {
		if (!friends.myFriendCode) return;
		void navigator.clipboard?.writeText(friends.myFriendCode);
		copied = true;
		journal.toast(`Friend Code ${friends.myFriendCode} copied!`);
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
		}, 2500);
	}

	async function submitAddFriend(e: SubmitEvent) {
		e.preventDefault();
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
				}, 4000);
			} else {
				addError = res.message;
			}
		} finally {
			addBusy = false;
		}
	}

	$effect(() => {
		// Track the sharing fields of every page so the feed refreshes when a
		// page is saved, made private, or gets a new video.
		for (const entry of Object.values(journal.entries)) {
			void entry.privacy;
			void entry.title;
			void entry.mind;
			void entry.refl;
			void entry.videoPath;
			void entry.videoName;
			void entry.stickers;
		}
		void profile.nickname;
		void profile.username;
		void profile.avatarUrl;
		void profile.friendCode;

		untrack(() => friends.syncOwnPosts());
	});

	function toggleNoteBox(postId: string) {
		openCommentPost = openCommentPost === postId ? null : postId;
	}

	function sendComment(postId: string) {
		const text = commentInputs[postId]?.trim();
		if (!text) return;
		friends.addComment(postId, text);
		commentInputs[postId] = '';
	}
</script>

<div class="mx-auto w-full max-w-[1100px] px-4 py-6 min-[900px]:px-6">
	<!-- ── Top Hero Bar ── -->
	<header
		class="relative overflow-hidden rounded-[28px] border border-[#523A7A] bg-[radial-gradient(ellipse_at_top,#4A2F7A_0%,#24143D_70%)] p-6 text-white shadow-[0_24px_60px_rgba(0,0,0,.5)] min-[720px]:p-8"
	>
		<!-- Background sparkles -->
		<span
			class="pointer-events-none absolute -top-10 right-24 h-36 w-36 rounded-full bg-gold/10 blur-3xl"
		></span>
		<span
			class="pointer-events-none absolute bottom-0 left-12 h-28 w-28 rounded-full bg-lav/10 blur-3xl"
		></span>

		<div
			class="relative flex flex-col gap-5 min-[800px]:flex-row min-[800px]:items-center min-[800px]:justify-between"
		>
			<div>
				<div class="flex items-center gap-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-lav/20 px-3 py-1 font-ui text-xs font-semibold text-lav"
					>
						<span class="size-2 animate-pulse rounded-full bg-gold"></span>
						Social Circle
					</span>
					<span class="font-ui text-xs text-[#BBA8E0]">• Friends Feed</span>
				</div>
				<h1
					class="mt-2 font-display text-3xl font-bold tracking-tight text-white min-[720px]:text-5xl"
				>
					Friends Journal
				</h1>
				<p class="mt-2 max-w-[620px] font-ui text-sm text-[#D6CBEC] min-[720px]:text-base">
					A full social feed of small video moments and handwritten reflections shared by your
					friends. Add friends with your unique friend code to grow your circle.
				</p>
			</div>

			<!-- User's Friend Code Badge -->
			<div
				class="flex flex-col items-start gap-1.5 rounded-2xl border border-gold/40 bg-white/[.08] p-3.5 backdrop-blur-sm min-[800px]:items-end"
			>
				<span class="font-ui text-[11px] font-bold tracking-wider text-gold uppercase">
					Your Friend Code
				</span>
				<div class="flex items-center gap-2">
					<code
						class="rounded-lg bg-black/40 px-2.5 py-1 font-mono text-base font-bold tracking-wider text-white select-all"
					>
						{friends.myFriendCode}
					</code>
					<button
						type="button"
						class="flex h-9 items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/20 px-3 font-ui text-xs font-bold text-white transition-all hover:bg-gold/30 active:scale-95"
						onclick={copyMyCode}
						title="Copy your friend code to share with friends"
					>
						{#if copied}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M20 6L9 17l-5-5"></path>
							</svg>
							Copied!
						{:else}
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
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
							</svg>
							Copy Code
						{/if}
					</button>
				</div>
				<span class="font-ui text-[11px] text-[#C9B8E8]">
					Share with friends so they can add you
				</span>
			</div>
		</div>

		<!-- Sub-Nav Pill Switcher -->
		<div
			class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"
		>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="flex items-center gap-2 rounded-full px-5 py-2.5 font-ui text-sm font-semibold transition-all {activeSubTab ===
					'feed'
						? 'bg-white/20 text-white shadow-inner'
						: 'text-[#D6CBEC] hover:bg-white/10 hover:text-white'}"
					onclick={() => (activeSubTab = 'feed')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="7" height="7"></rect>
						<rect x="14" y="3" width="7" height="7"></rect>
						<rect x="14" y="14" width="7" height="7"></rect>
						<rect x="3" y="14" width="7" height="7"></rect>
					</svg>
					Feed Roll
					<span class="rounded-full bg-accent px-2 py-0.5 text-[10px] text-white">
						{friends.posts.length}
					</span>
				</button>

				<button
					type="button"
					class="relative flex items-center gap-2 rounded-full px-5 py-2.5 font-ui text-sm font-semibold transition-all {activeSubTab ===
					'requests'
						? 'bg-white/20 text-white shadow-inner'
						: 'text-[#D6CBEC] hover:bg-white/10 hover:text-white'}"
					onclick={() => (activeSubTab = 'requests')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<line x1="19" y1="8" x2="19" y2="14"></line>
						<line x1="22" y1="11" x2="16" y2="11"></line>
					</svg>
					Requests
					{#if friends.pendingCount > 0}
						<span class="rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-[#2A1B3F]">
							{friends.pendingCount}
						</span>
					{/if}
				</button>

				<button
					type="button"
					class="flex items-center gap-2 rounded-full px-5 py-2.5 font-ui text-sm font-semibold transition-all {activeSubTab ===
					'list'
						? 'bg-white/20 text-white shadow-inner'
						: 'text-[#D6CBEC] hover:bg-white/10 hover:text-white'}"
					onclick={() => (activeSubTab = 'list')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"></path>
					</svg>
					My Friends
					<span class="rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white">
						{friends.friendCount}
					</span>
				</button>
			</div>

			<!-- Back to Journal Shortcut -->
			<button
				type="button"
				class="inline-flex items-center gap-1.5 font-ui text-xs font-semibold text-gold hover:underline"
				onclick={() => nav.jump(TODAY)}
			>
				<span>Open my journal</span>
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
					<path d="M5 12h14M12 5l7 7-7 7"></path>
				</svg>
			</button>
		</div>
	</header>

	<!-- ── Add Friend Bar ── -->
	<div
		class="mt-6 rounded-2xl border border-[#4D366D] bg-desk-2 p-4 shadow-[0_6px_20px_rgba(0,0,0,.25)]"
	>
		<form
			onsubmit={submitAddFriend}
			class="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center"
		>
			<div class="flex items-center gap-2 text-gold">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
					<circle cx="9" cy="7" r="4"></circle>
					<line x1="20" y1="8" x2="20" y2="14"></line>
					<line x1="23" y1="11" x2="17" y2="11"></line>
				</svg>
				<span class="font-ui text-sm font-bold whitespace-nowrap text-white"
					>Add a friend by code:</span
				>
			</div>

			<div class="relative flex-1">
				<input
					bind:value={addCodeInput}
					type="text"
					placeholder="Enter Friend Code (e.g. VJ-7K9M2P)"
					maxlength="16"
					class="h-11 w-full rounded-xl border border-[#4D366D]/40 bg-[#24143D] px-3.5 font-ui text-sm font-medium text-ink uppercase placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
					disabled={addBusy}
				/>
			</div>

			<button
				type="submit"
				class="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white shadow-sm transition-all hover:bg-[#624690] active:scale-95 disabled:opacity-60"
				disabled={addBusy || !addCodeInput.trim()}
			>
				{#if addBusy}
					<div
						class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"
					></div>
					Sending…
				{:else}
					Send Request
				{/if}
			</button>
		</form>

		{#if addSuccess}
			<p class="mt-2.5 font-ui text-xs font-semibold text-[#8BE2A4]">{addSuccess}</p>
		{/if}
		{#if addError}
			<p class="mt-2.5 font-ui text-xs font-semibold text-[#FF9B9B]">{addError}</p>
		{/if}

		<div class="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="text-gold"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10"></circle>
				<path d="M12 16v-4M12 8h.01"></path>
			</svg>
			<p class="font-ui text-[11px] text-[#C9B8E8]">
				Friend codes are verified by Vidjo. Share yours and send a request with theirs.
			</p>
		</div>
	</div>

	<!-- ── FEED VIEW ── -->
	{#if activeSubTab === 'feed'}
		<!-- Feed Filter Tabs -->
		<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-1.5 rounded-full border border-[#4D366D] bg-desk-2 p-1">
				<button
					type="button"
					class="rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter ===
					'all'
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('all')}
				>
					All Posts ({friends.posts.length})
				</button>
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter ===
					'video'
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('video')}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<polygon points="23 7 16 12 23 17 23 7"></polygon>
						<rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
					</svg>
					Videos Only
				</button>
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter ===
					'written'
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('written')}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path>
					</svg>
					Written VidJos
				</button>
			</div>

			<span class="font-ui text-xs text-[#BBA8E0]">
				Showing {friends.filteredPosts.length} updates
			</span>
		</div>

		<!-- Stories/Highlights Row -->
		{#if friends.stories.length > 0}
			<div class="mt-6">
				<h2 class="mb-3 font-ui text-sm font-bold text-white">Stories</h2>
				<div class="flex gap-3 overflow-x-auto pb-2">
					{#each friends.stories as story (story.id)}
						<button type="button" class="group flex shrink-0 flex-col items-center gap-1.5">
							<div class="relative">
								<div class="rounded-full bg-[linear-gradient(135deg,#D4A24C,#8B6FD0)] p-[2px]">
									<div class="rounded-full bg-[#1C142B] p-[2px]">
										{#if story.avatarUrl && story.avatarUrl.length > 2}
											<img src={story.avatarUrl} alt="" class="size-16 rounded-full object-cover" />
										{:else}
											<span
												class="flex size-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white"
											>
												{story.avatarUrl || story.displayName[0]}
											</span>
										{/if}
									</div>
								</div>
								{#if story.isOnline}
									<span
										class="absolute right-0 bottom-0 size-4 rounded-full bg-[#3F7A4F] ring-2 ring-[#1C142B]"
									></span>
								{/if}
							</div>
							<span class="max-w-[72px] truncate font-ui text-[11px] text-[#D6CBEC]"
								>{story.displayName.split(' ')[0]}</span
							>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Posts Roll -->
		<div class="mt-6 space-y-8">
			{#if friends.filteredPosts.length === 0}
				<div
					class="rounded-3xl border border-[#4D366D] bg-[radial-gradient(ellipse_at_top,#3A275A_0%,#24143D_70%)] p-10 text-center text-white"
				>
					<div
						class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-white/10"
					>
						<svg
							width="28"
							height="28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
							<circle cx="9" cy="7" r="4"></circle>
							<line x1="19" y1="8" x2="19" y2="14"></line>
							<line x1="22" y1="11" x2="16" y2="11"></line>
						</svg>
					</div>
					<p class="font-display text-2xl font-bold">Your feed is waiting</p>
					<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
						Add friends with their friend code to see their video moments and reflections here.
					</p>
					<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
						<button
							type="button"
							class="rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white hover:bg-[#624690]"
							onclick={() => (activeSubTab = 'list')}
						>
							Find Friends
						</button>
						<button
							type="button"
							class="rounded-xl border border-white/20 px-5 py-2.5 font-ui text-sm font-semibold text-white hover:bg-white/10"
							onclick={() => friends.setFilter('all')}
						>
							Show All Updates
						</button>
					</div>
				</div>
			{/if}

			{#each friends.filteredPosts as post (post.id)}
				<article
					class="relative overflow-hidden rounded-[28px] border border-[#4D366D] bg-desk-2 p-6 text-white shadow-[0_20px_50px_rgba(125,88,194,.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_56px_rgba(125,88,194,.45)] min-[720px]:p-9"
				>
					<!-- Scrapbook Washi Tape Strip -->
					<span
						class="absolute -top-3.5 left-12 z-10 h-7 w-28 rotate-[-2deg] bg-lav/[.85] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_3px_rgba(0,0,0,.15)]"
						aria-hidden="true"
					></span>

					<!-- Post Header: Author info, timestamp, mood badge -->
					<div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#4D366D]/40 pb-4">
						<div class="flex items-center gap-3">
							{#if post.authorAvatar && post.authorAvatar.length > 2}
								<img
									src={post.authorAvatar}
									alt=""
									class="size-11 rounded-full object-cover ring-2 ring-gold/50"
								/>
							{:else}
								<span
									class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white shadow-sm ring-2 ring-gold/40"
									aria-hidden="true"
								>
									{post.authorName[0]}
								</span>
							{/if}

							<div>
								<div class="flex items-center gap-2">
									<h2 class="font-display text-lg leading-tight font-bold text-white">
										{post.authorName}
									</h2>
									{#if post.isOwner}
										<span
											class="py-0.2 rounded bg-accent/10 px-1.5 font-ui text-[10px] font-bold text-accent"
										>
											You
										</span>
									{/if}
								</div>
								<div class="flex items-center gap-2 font-ui text-xs text-[#BBA8E0]">
									<span>@{post.authorUsername}</span>
									<span>•</span>
									<time>{post.dateFormatted}</time>
								</div>
							</div>
						</div>

						<div class="flex items-center gap-2">
							{#if post.mood && MOOD_ICONS[post.mood]}
								<span
									class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-bold text-accent"
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
										{#if MOOD_ICONS[post.mood].icon === 'smile'}
											<circle cx="12" cy="12" r="10"></circle>
											<path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
											<line x1="9" y1="9" x2="9.01" y2="9"></line>
											<line x1="15" y1="9" x2="15.01" y2="9"></line>
										{:else if MOOD_ICONS[post.mood].icon === 'cloud'}
											<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
										{:else if MOOD_ICONS[post.mood].icon === 'moon'}
											<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
										{:else if MOOD_ICONS[post.mood].icon === 'frown'}
											<circle cx="12" cy="12" r="10"></circle>
											<path d="M16 16s-1.5-2-4-2-4 2-4 2"></path>
											<line x1="9" y1="9" x2="9.01" y2="9"></line>
											<line x1="15" y1="9" x2="15.01" y2="9"></line>
										{:else if MOOD_ICONS[post.mood].icon === 'zap'}
											<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
										{:else if MOOD_ICONS[post.mood].icon === 'flame'}
											<path
												d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.3 3.5 3.2 5 5.5A8 8 0 0 1 8.5 14.5z"
											></path>
										{:else if MOOD_ICONS[post.mood].icon === 'spark'}
											<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
										{/if}
									</svg>
									{MOOD_ICONS[post.mood].label}
								</span>
							{/if}

							<span
								class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-ui text-[11px] text-white font-semibold text-ink-soft"
								title="Shared with friends"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
									<circle cx="9" cy="7" r="4"></circle>
									<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
									<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
								</svg>
								Friends
							</span>
						</div>
					</div>

					<!-- Post Title -->
					{#if post.title}
						<h3 class="mt-4 font-display text-2xl font-bold tracking-tight text-white">
							{post.title}
						</h3>
					{/if}

					<!-- Video Display Section -->
					{#if post.videoUrl || post.videoName || post.videoPath}
						<div
							class="my-4 overflow-hidden rounded-2xl border-2 border-[#D8C8A2] bg-[#120A20] shadow-md"
						>
							{#if post.videoUrl}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={post.videoUrl}
									controls
									playsinline
									class="max-h-[380px] w-full bg-black object-contain"
								></video>
							{:else}
								<!-- Aesthetic Scrapbook Camcorder Preview Card for Demo/Saved Entries -->
								<div
									class="relative flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#3D255F_0%,#190E2B_80%)] p-8 text-center text-white"
								>
									<span
										class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-xs text-red-400"
									>
										<span class="size-2 animate-pulse rounded-full bg-red-500"></span>
										REC • 00:32
									</span>
									<span class="absolute top-3 right-4 font-mono text-xs text-gold"> VIDJO HD </span>

									<div
										class="flex size-14 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-110"
									>
										<svg
											width="26"
											height="26"
											viewBox="0 0 24 24"
											fill="currentColor"
											aria-hidden="true"
										>
											<path d="M8 5v14l11-7z"></path>
										</svg>
									</div>

									<p class="mt-3 font-display text-lg font-bold text-white">
										{post.videoName || 'Daily Video Memory'}
									</p>
									<p class="mt-0.5 font-hand text-base text-[#D6CBEC]">
										{post.videoCaption || 'Recorded with VidJo Journal'}
									</p>
								</div>
							{/if}

							{#if post.videoCaption}
								<div
									class="border-t border-[#3A2360] bg-[#1E1133] px-4 py-2 font-hand text-base text-[#E5DCF2]"
								>
									“{post.videoCaption}”
								</div>
							{/if}
						</div>
					{/if}

					<!-- Written Journal Content (Gaegu Cursive) -->
					{#if post.mind}
						<div class="my-4 rounded-xl border-l-4 border-accent/40 bg-white/10 p-4">
							<p class="font-hand text-[22px] leading-relaxed whitespace-pre-wrap text-white">
								{post.mind}
							</p>
						</div>
					{/if}

					<!-- Reflection Card -->
					{#if post.refl}
						<div
							class="my-3 flex items-start gap-2.5 rounded-xl border border-[#4D366D]/40 bg-white/10 p-3 shadow-xs"
						>
							<span class="text-base font-bold text-gold">★</span>
							<div>
								<span class="block font-ui text-xs font-bold tracking-wider text-accent uppercase">
									Reflection
								</span>
								<p class="mt-0.5 font-hand text-lg font-semibold text-white">
									{post.refl}
								</p>
							</div>
						</div>
					{/if}

					<!-- Social Stamp Reactions -->
					<div
						class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#4D366D]/40 pt-4"
					>
						<div class="flex flex-wrap items-center gap-1.5">
							<!-- Love Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
									'love'
								)
									? 'border-pink-400 bg-pink-100/20 text-pink-400 shadow-xs'
									: 'border-white/20 text-white/70 hover:bg-white/10'}"
								onclick={() => friends.toggleReaction(post.id, 'love')}
								aria-label="React with love"
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
									<path
										d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
									></path>
								</svg>
								<span>{post.reactions.love}</span>
							</button>

							<!-- Sparkle Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
									'spark'
								)
									? 'border-amber-400 bg-amber-100/20 text-amber-400 shadow-xs'
									: 'border-white/20 text-white/70 hover:bg-white/10'}"
								onclick={() => friends.toggleReaction(post.id, 'spark')}
								aria-label="React with inspiration"
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
									<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
								</svg>
								<span>{post.reactions.spark}</span>
							</button>

							<!-- Warm Hug Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
									'warm'
								)
									? 'border-orange-400 bg-orange-100/20 text-orange-400 shadow-xs'
									: 'border-white/20 text-white/70 hover:bg-white/10'}"
								onclick={() => friends.toggleReaction(post.id, 'warm')}
								aria-label="React with warm vibes"
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
									<path d="M17 8h1a4 4 0 1 1 0 8h-1"></path>
									<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>
									<line x1="6" y1="1" x2="6" y2="4"></line>
									<line x1="10" y1="1" x2="10" y2="4"></line>
									<line x1="14" y1="1" x2="14" y2="4"></line>
								</svg>
								<span>{post.reactions.warm}</span>
							</button>

							<!-- Proud Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
									'proud'
								)
									? 'border-purple-400 bg-purple-100/20 text-purple-400 shadow-xs'
									: 'border-white/20 text-white/70 hover:bg-white/10'}"
								onclick={() => friends.toggleReaction(post.id, 'proud')}
								aria-label="React with proud of you"
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
									<polygon
										points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
									></polygon>
								</svg>
								<span>{post.reactions.proud}</span>
							</button>
						</div>

						<button
							type="button"
							class="flex items-center gap-1.5 rounded-full border border-[#4D366D] bg-white/10 px-3.5 py-1.5 font-ui text-xs font-bold text-gold transition-colors hover:bg-white/10"
							onclick={() => toggleNoteBox(post.id)}
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
								<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
							</svg>
							<span>Notes ({post.comments.length})</span>
						</button>
					</div>

					<!-- Comments / Notes Drawer -->
					{#if openCommentPost === post.id || post.comments.length > 0}
						<div class="mt-4 rounded-xl border border-[#4D366D]/40 bg-white/10 p-3.5">
							<span
								class="mb-2.5 block font-ui text-[11px] font-bold tracking-wider text-[#BBA8E0] uppercase"
							>
								Friend Notes
							</span>

							{#if post.comments.length > 0}
								<div class="mb-3 space-y-2">
									{#each post.comments as comment (comment.id)}
										<div class="flex items-start gap-2.5 rounded-lg bg-white/10 p-2.5 shadow-2xs">
											{#if comment.authorAvatar}
												<img
													src={comment.authorAvatar}
													alt=""
													class="size-7 shrink-0 rounded-full object-cover"
												/>
											{:else}
												<span
													class="flex size-7 shrink-0 items-center justify-center rounded-full bg-lav/40 font-display text-sm font-bold text-accent"
												>
													{comment.authorName[0]}
												</span>
											{/if}
											<div class="min-w-0 flex-1">
												<div class="flex items-baseline justify-between gap-2">
													<button
														type="button"
														class="font-ui text-xs text-white hover:underline"
														onclick={() => {
															viewedUserId = comment.authorId;
															profileModalOpen = true;
														}}
													>
														{comment.authorName}
													</button>
													<time class="font-ui text-[10px] text-[#BBA8E0]">{comment.time}</time>
												</div>
												<p class="mt-0.5 font-hand text-base leading-tight text-white">
													{censor(comment.text)}
												</p>
											</div>
										</div>
									{/each}
								</div>
							{/if}

							<!-- Note Input -->
							<form
								onsubmit={(e) => {
									e.preventDefault();
									sendComment(post.id);
								}}
								class="flex items-center gap-2"
							>
								<input
									bind:value={commentInputs[post.id]}
									type="text"
									placeholder="Write an encouraging note for {post.authorName}…"
									maxlength="140"
									class="h-9 flex-1 rounded-lg border border-[#4D366D]/40 bg-white/10 px-3 font-ui text-xs text-white placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
								/>
								<button
									type="submit"
									class="h-9 rounded-lg bg-accent px-3.5 font-ui text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#624690] disabled:opacity-50"
									disabled={!commentInputs[post.id]?.trim()}
								>
									Send
								</button>
							</form>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{:else if activeSubTab === 'requests'}
		<!-- ── FRIEND REQUESTS VIEW ── -->
		<div class="mt-6 space-y-6">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-2xl font-bold text-white">Friend Requests</h2>
				<span class="font-ui text-xs text-[#D6CBEC]">Manage incoming and outgoing requests</span>
			</div>

			{#if friends.incomingRequests.length > 0}
				<div>
					<h3 class="mb-3 font-ui text-sm font-bold text-gold">
						Incoming ({friends.incomingRequests.length})
					</h3>
					<div class="grid gap-4 min-[640px]:grid-cols-2 min-[880px]:grid-cols-3">
						{#each friends.incomingRequests as request (request.id)}
							<div
								class="flex flex-col justify-between rounded-2xl border border-gold/40 bg-desk-2 p-5 text-white shadow-[0_12px_30px_rgba(212,162,76,.12)]"
							>
								<div>
									<div class="flex items-start gap-3">
										{#if request.fromAvatarUrl && request.fromAvatarUrl.length > 2}
											<img
												src={request.fromAvatarUrl}
												alt=""
												class="size-12 rounded-full object-cover ring-2 ring-gold/50"
											/>
										{:else}
											<span
												class="flex size-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white ring-2 ring-gold/50"
											>
												{request.fromDisplayName[0]}
											</span>
										{/if}
										<div>
											<b class="block font-display text-lg leading-tight text-white"
												>{request.fromDisplayName}</b
											>
											<span class="font-ui text-xs font-semibold text-lav"
												>@{request.fromUsername}</span
											>
											{#if request.fromFriendCode}
												<p class="mt-1 font-mono text-[11px] text-gold">{request.fromFriendCode}</p>
											{/if}
										</div>
									</div>
									{#if request.fromBio}
										<p class="mt-3 font-hand text-base leading-snug text-[#EDE6F7]">
											“{request.fromBio}”
										</p>
									{/if}
								</div>
								<div class="mt-5 flex items-center gap-2">
									<button
										type="button"
										class="flex-1 rounded-xl bg-accent px-4 py-2 font-ui text-sm font-bold text-white shadow hover:bg-[#624690]"
										onclick={() => friends.acceptFriendRequest(request.id)}
									>
										Accept
									</button>
									<button
										type="button"
										class="flex-1 rounded-xl border border-white/20 px-4 py-2 font-ui text-sm font-semibold text-[#D6CBEC] hover:bg-white/10"
										onclick={() => friends.declineFriendRequest(request.id)}
									>
										Decline
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if friends.outgoingRequests.length > 0}
				<div>
					<h3 class="mb-3 font-ui text-sm font-bold text-lav">
						Sent ({friends.outgoingRequests.length})
					</h3>
					<div class="grid gap-4 min-[640px]:grid-cols-2 min-[880px]:grid-cols-3">
						{#each friends.outgoingRequests as request (request.id)}
							<div
								class="flex flex-col justify-between rounded-2xl border border-[#4D366D] bg-desk-2 p-5 text-white shadow-md"
							>
								<div>
									<div class="flex items-start gap-3">
										{#if request.toAvatarUrl && request.toAvatarUrl.length > 2}
											<img
												src={request.toAvatarUrl}
												alt=""
												class="size-12 rounded-full object-cover ring-2 ring-lav/40"
											/>
										{:else}
											<span
												class="flex size-12 items-center justify-center rounded-full bg-white/10 font-display text-xl text-lav"
											>
												{request.toDisplayName?.[0] || '?'}
											</span>
										{/if}
										<div class="min-w-0">
											<b class="block font-display text-lg leading-tight text-white">
												{request.toDisplayName || 'Request sent'}
											</b>
											{#if request.toUsername}
												<span class="font-ui text-xs font-semibold text-lav"
													>@{request.toUsername}</span
												>
											{/if}
											{#if request.toFriendCode}
												<p class="mt-0.5 font-mono text-[11px] text-gold">{request.toFriendCode}</p>
											{/if}
											<p class="mt-1 font-ui text-[11px] text-[#BBA8E0]">Pending acceptance</p>
										</div>
									</div>
								</div>
								<div class="mt-5">
									<button
										type="button"
										class="w-full rounded-xl border border-white/20 px-4 py-2 font-ui text-sm font-semibold text-[#D6CBEC] hover:bg-white/10"
										onclick={() => friends.cancelFriendRequest(request.id)}
									>
										Cancel Request
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if friends.incomingRequests.length === 0 && friends.outgoingRequests.length === 0}
				<div class="rounded-3xl border border-[#4D366D] bg-desk-2 p-12 text-center text-white">
					<p class="font-display text-2xl font-bold">No pending requests</p>
					<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
						Share your friend code or send a request to connect with classmates.
					</p>
					<button
						type="button"
						class="mt-4 rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white hover:bg-[#624690]"
						onclick={() => (activeSubTab = 'list')}
					>
						View Friends
					</button>
				</div>
			{/if}
		</div>
	{:else}
		<!-- ── MY FRIENDS LIST VIEW ── -->
		<div class="mt-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-2xl font-bold text-white">
					Connected Classmates ({friends.friendCount})
				</h2>
				<span class="font-ui text-xs text-[#D6CBEC]"> Share your code to grow your circle </span>
			</div>

			<div class="grid gap-4 min-[640px]:grid-cols-2 min-[880px]:grid-cols-3">
				{#each friends.friends as friend (friend.id)}
					<div
						class="flex flex-col justify-between rounded-2xl border border-[#4D366D] bg-desk-2 p-5 text-white shadow-md"
					>
						<div>
							<div class="flex items-start justify-between gap-3">
								<div class="flex items-center gap-3">
									<div class="relative">
										{#if friend.avatarUrl && friend.avatarUrl.length > 2}
											<img
												src={friend.avatarUrl}
												alt=""
												class="size-12 rounded-full object-cover ring-2 ring-gold/40"
											/>
										{:else}
											<span
												class="flex size-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white ring-2 ring-gold/40"
											>
												{friend.avatarUrl || friend.displayName[0]}
											</span>
										{/if}
										{#if friend.isOnline}
											<span
												class="absolute right-0 bottom-0 size-3 rounded-full bg-[#3F7A4F] ring-2 ring-[#1C142B]"
											></span>
										{/if}
									</div>

									<div>
										<div class="flex items-center gap-2">
											<b class="block font-display text-lg leading-tight text-white"
												>{friend.displayName}</b
											>
											{#if friend.isOnline}
												<span
													class="rounded-full bg-[#3F7A4F]/20 px-1.5 py-0.5 font-ui text-[9px] font-bold text-[#8BE2A4]"
													>Online</span
												>
											{/if}
										</div>
										<span class="font-ui text-xs font-semibold text-lav">@{friend.username}</span>
									</div>
								</div>

								<span
									class="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] font-bold text-gold"
								>
									{friend.friendCode}
								</span>
							</div>

							{#if friend.bio}
								<p class="mt-3 font-hand text-base leading-snug text-[#EDE6F7]">
									“{friend.bio}”
								</p>
							{/if}

							<div class="mt-3 flex items-center gap-3 font-ui text-[11px] text-[#BBA8E0]">
								{#if friend.mutualCount}
									<span>👥 {friend.mutualCount} mutual friends</span>
								{/if}
								{#if friend.lastActive}
									<span>• Active {friend.lastActive}</span>
								{/if}
							</div>
						</div>

						<div class="mt-5 flex items-center justify-between border-t border-white/10 pt-3">
							<button
								type="button"
								class="font-ui text-xs font-bold text-gold hover:underline"
								onclick={() => (activeSubTab = 'feed')}
							>
								View in Feed →
							</button>

							<button
								type="button"
								class="font-ui text-xs text-red-400 hover:underline"
								onclick={() => friends.removeFriend(friend.id)}
							>
								Remove
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<ProfileModal
		open={profileModalOpen}
		onClose={() => {
			profileModalOpen = false;
			viewedUserId = null;
		}}
		userId={viewedUserId}
	/>
</div>
