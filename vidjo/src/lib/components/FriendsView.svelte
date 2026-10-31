<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { TODAY } from '#lib/dates';
	import type { MoodKey } from '#lib/types';

	let activeSubTab = $state<'feed' | 'list'>('feed');
	let addCodeInput = $state('');
	let addBusy = $state(false);
	let addError = $state('');
	let addSuccess = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let commentInputs = $state<Record<string, string>>({});
	let openCommentPost = $state<string | null>(null);

	const MOOD_EMOJIS: Record<MoodKey, string> = {
		happy: '😊 Happy',
		calm: '😌 Calm',
		tired: '😴 Tired',
		sad: '🥺 Sad',
		stressed: '🤯 Stressed',
		angry: '😤 Fired Up',
		excited: '✨ Excited'
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

	function handleAddDemo(code: string) {
		addCodeInput = code;
		void friends.addFriendByCode(code);
	}

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

<div class="mx-auto w-full max-w-[980px] px-4 py-6 min-[900px]:px-6">
	<!-- ── Top Hero Bar ── -->
	<header
		class="relative overflow-hidden rounded-[26px] border border-[#523A7A] bg-[linear-gradient(135deg,#3A2360,#24143D)] p-6 shadow-[0_20px_50px_rgba(0,0,0,.45)] text-white min-[720px]:p-8"
	>
		<!-- Background sparkles -->
		<span class="pointer-events-none absolute top-4 right-8 text-2xl text-gold/60" aria-hidden="true">✦</span>
		<span class="pointer-events-none absolute bottom-4 left-10 text-xl text-lav/40" aria-hidden="true">✦</span>

		<div class="flex flex-col gap-5 min-[800px]:flex-row min-[800px]:items-center min-[800px]:justify-between">
			<div>
				<div class="flex items-center gap-2">
					<span class="inline-flex items-center gap-1.5 rounded-full bg-lav/20 px-3 py-1 font-ui text-xs font-semibold text-lav">
						<span class="size-2 rounded-full bg-gold animate-pulse"></span>
						Social Circle
					</span>
					<span class="font-ui text-xs text-[#BBA8E0]">• VidJo Friends Feed</span>
				</div>
				<h1 class="mt-2 font-display text-3xl font-bold tracking-tight text-white min-[720px]:text-4xl">
					Friends Journal
				</h1>
				<p class="mt-1 font-ui text-sm text-[#D6CBEC]">
					Small video moments & reflections shared by your classmates and friends.
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
						class="flex h-9 items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/20 px-3 font-ui text-xs font-bold text-[#FFF5DE] transition-all hover:bg-gold/30 active:scale-95"
						onclick={copyMyCode}
						title="Copy your friend code to share with friends"
					>
						{#if copied}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M20 6L9 17l-5-5"></path>
							</svg>
							Copied!
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
		<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
			<div class="flex gap-2">
				<button
					type="button"
					class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {activeSubTab === 'feed' ? 'bg-white/20 text-white shadow-inner' : 'text-[#D6CBEC] hover:bg-white/10 hover:text-white'}"
					onclick={() => (activeSubTab = 'feed')}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="3" y="3" width="18" height="18" rx="2"></rect>
						<path d="M3 9h18M9 21V9"></path>
					</svg>
					Feed Roll
					<span class="rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">
						{friends.posts.length}
					</span>
				</button>

				<button
					type="button"
					class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {activeSubTab === 'list' ? 'bg-white/20 text-white shadow-inner' : 'text-[#D6CBEC] hover:bg-white/10 hover:text-white'}"
					onclick={() => (activeSubTab = 'list')}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"></path>
					</svg>
					My Friends
					<span class="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] text-white">
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
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M5 12h14M12 5l7 7-7 7"></path>
				</svg>
			</button>
		</div>
	</header>

	<!-- ── Add Friend Bar ── -->
	<div class="mt-6 rounded-2xl border border-[#4D366D] bg-desk-2 p-4 shadow-[0_6px_20px_rgba(0,0,0,.25)]">
		<form onsubmit={submitAddFriend} class="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center">
			<div class="flex items-center gap-2 text-gold">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
					<circle cx="9" cy="7" r="4"></circle>
					<line x1="20" y1="8" x2="20" y2="14"></line>
					<line x1="23" y1="11" x2="17" y2="11"></line>
				</svg>
				<span class="font-ui text-sm font-bold text-white whitespace-nowrap">Add a friend:</span>
			</div>

			<div class="relative flex-1">
				<input
					bind:value={addCodeInput}
					type="text"
					placeholder="Enter Friend Code (e.g. VJ-7K9M2P)"
					maxlength="16"
					class="h-11 w-full rounded-xl border border-line/40 bg-[#FFFDF6] px-3.5 font-ui text-sm font-medium text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none uppercase"
					disabled={addBusy}
				/>
			</div>

			<button
				type="submit"
				class="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-ui text-sm font-bold text-white shadow-sm transition-all hover:bg-[#624690] active:scale-95 disabled:opacity-60"
				disabled={addBusy || !addCodeInput.trim()}
			>
				{#if addBusy}
					<div class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
					Connecting…
				{:else}
					Add Friend
				{/if}
			</button>
		</form>

		{#if addSuccess}
			<p class="mt-2.5 font-ui text-xs font-semibold text-[#8BE2A4]">{addSuccess}</p>
		{/if}
		{#if addError}
			<p class="mt-2.5 font-ui text-xs font-semibold text-[#FF9B9B]">{addError}</p>
		{/if}

		<!-- Demo quick-add suggestions if friends count is low -->
		{#if friends.friendCount < 3}
			<div class="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3 font-ui text-xs text-[#C9B8E8]">
				<span>Try adding classmates:</span>
				<button
					type="button"
					class="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 transition-colors"
					onclick={() => handleAddDemo('VJ-SAMIRA')}
				>
					+ Samira Chen (VJ-SAMIRA)
				</button>
				<button
					type="button"
					class="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 transition-colors"
					onclick={() => handleAddDemo('VJ-JORDAN')}
				>
					+ Jordan Rivera (VJ-JORDAN)
				</button>
				<button
					type="button"
					class="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 transition-colors"
					onclick={() => handleAddDemo('VJ-LIAMV9')}
				>
					+ Liam Vance (VJ-LIAMV9)
				</button>
			</div>
		{/if}
	</div>

	<!-- ── FEED VIEW ── -->
	{#if activeSubTab === 'feed'}
		<!-- Feed Filter Tabs -->
		<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-1.5 rounded-full border border-[#4D366D] bg-desk-2 p-1">
				<button
					type="button"
					class="rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter === 'all' ? 'bg-accent text-white shadow-sm' : 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('all')}
				>
					All Posts ({friends.posts.length})
				</button>
				<button
					type="button"
					class="rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter === 'video' ? 'bg-accent text-white shadow-sm' : 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('video')}
				>
					🎬 Videos Only
				</button>
				<button
					type="button"
					class="rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-all {friends.activeFilter === 'written' ? 'bg-accent text-white shadow-sm' : 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => friends.setFilter('written')}
				>
					✍️ Written VidJos
				</button>
			</div>

			<span class="font-ui text-xs text-[#BBA8E0]">
				Showing {friends.filteredPosts.length} updates
			</span>
		</div>

		<!-- Posts Roll -->
		<div class="mt-6 space-y-7">
			{#if friends.filteredPosts.length === 0}
				<div class="rounded-3xl border border-[#4D366D] bg-desk-2 p-12 text-center text-white">
					<p class="font-display text-2xl font-bold">No updates yet in this filter</p>
					<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
						Switch to "All Posts" or share your friend code with friends to see their daily entries!
					</p>
					<button
						type="button"
						class="mt-4 rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white hover:bg-[#624690]"
						onclick={() => friends.setFilter('all')}
					>
						Show All Updates
					</button>
				</div>
			{/if}

			{#each friends.filteredPosts as post (post.id)}
				<article
					class="relative overflow-hidden rounded-[24px] border border-[#E6D9B8] bg-paper p-6 text-ink shadow-[0_16px_40px_rgba(0,0,0,.35)] min-[720px]:p-8 transition-transform"
				>
					<!-- Scrapbook Washi Tape Strip -->
					<span
						class="absolute -top-3.5 left-12 z-10 h-7 w-28 rotate-[-2deg] bg-lav/[.85] [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.35)_0_6px,transparent_6px_12px)] shadow-[0_1px_3px_rgba(0,0,0,.15)]"
						aria-hidden="true"
					></span>

					<!-- Post Header: Author info, timestamp, mood badge -->
					<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
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
									{post.authorAvatar || post.authorName[0]}
								</span>
							{/if}

							<div>
								<div class="flex items-center gap-2">
									<h2 class="font-display text-lg font-bold leading-tight text-ink">
										{post.authorName}
									</h2>
									{#if post.isOwner}
										<span class="rounded bg-accent/10 px-1.5 py-0.2 font-ui text-[10px] font-bold text-accent">
											You
										</span>
									{/if}
								</div>
								<div class="flex items-center gap-2 font-ui text-xs text-ink-soft">
									<span>@{post.authorUsername}</span>
									<span>•</span>
									<time>{post.dateFormatted}</time>
								</div>
							</div>
						</div>

						<div class="flex items-center gap-2">
							{#if post.mood}
								<span
									class="inline-flex items-center gap-1 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-hand text-base font-bold text-accent"
								>
									{MOOD_EMOJIS[post.mood] || post.mood}
								</span>
							{/if}

							<span
								class="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-ui text-[11px] font-semibold text-ink-soft"
								title="Shared with friends"
							>
								👥 Friends
							</span>
						</div>
					</div>

					<!-- Post Title -->
					{#if post.title}
						<h3 class="mt-4 font-display text-2xl font-bold tracking-tight text-ink">
							{post.title}
						</h3>
					{/if}

					<!-- Video Display Section -->
					{#if post.videoUrl || post.videoName || post.videoPath}
						<div class="my-4 overflow-hidden rounded-2xl border-2 border-[#D8C8A2] bg-[#120A20] shadow-md">
							{#if post.videoUrl}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={post.videoUrl}
									controls
									playsinline
									class="max-h-[380px] w-full object-contain bg-black"
								></video>
							{:else}
								<!-- Aesthetic Scrapbook Camcorder Preview Card for Demo/Saved Entries -->
								<div class="relative flex flex-col items-center justify-center p-8 text-center text-white bg-[radial-gradient(ellipse_at_center,#3D255F_0%,#190E2B_80%)]">
									<span class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-xs text-red-400">
										<span class="size-2 rounded-full bg-red-500 animate-pulse"></span>
										REC • 00:32
									</span>
									<span class="absolute top-3 right-4 font-mono text-xs text-gold">
										✦ VIDJO HD
									</span>

									<div class="flex size-14 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-md transition-transform hover:scale-110">
										<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
								<div class="border-t border-[#3A2360] bg-[#1E1133] px-4 py-2 font-hand text-base text-[#E5DCF2]">
									“{post.videoCaption}”
								</div>
							{/if}
						</div>
					{/if}

					<!-- Written Journal Content (Gaegu Cursive) -->
					{#if post.mind}
						<div class="my-4 rounded-xl border-l-4 border-accent/40 bg-white/40 p-4">
							<p class="font-hand text-[22px] leading-relaxed text-ink whitespace-pre-wrap">
								{post.mind}
							</p>
						</div>
					{/if}

					<!-- Reflection Card -->
					{#if post.refl}
						<div class="my-3 flex items-start gap-2.5 rounded-xl border border-[#DECFA4] bg-[#FFF8E7] p-3 shadow-xs">
							<span class="text-base text-gold font-bold">★</span>
							<div>
								<span class="font-ui text-xs font-bold text-accent uppercase tracking-wider block">
									Reflection
								</span>
								<p class="font-hand text-lg text-ink font-semibold mt-0.5">
									{post.refl}
								</p>
							</div>
						</div>
					{/if}

					<!-- Social Stamp Reactions -->
					<div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
						<div class="flex flex-wrap items-center gap-1.5">
							<!-- Love Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes('love') ? 'border-pink-400 bg-pink-100/80 text-pink-700 shadow-xs' : 'border-line bg-white/70 text-ink hover:bg-light'}"
								onclick={() => friends.toggleReaction(post.id, 'love')}
								aria-label="React with love"
							>
								<span>💖</span>
								<span>{post.reactions.love}</span>
							</button>

							<!-- Sparkle Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes('spark') ? 'border-amber-400 bg-amber-100/80 text-amber-800 shadow-xs' : 'border-line bg-white/70 text-ink hover:bg-light'}"
								onclick={() => friends.toggleReaction(post.id, 'spark')}
								aria-label="React with inspiration"
							>
								<span>✨</span>
								<span>{post.reactions.spark}</span>
							</button>

							<!-- Warm Hug Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes('warm') ? 'border-orange-400 bg-orange-100/80 text-orange-800 shadow-xs' : 'border-line bg-white/70 text-ink hover:bg-light'}"
								onclick={() => friends.toggleReaction(post.id, 'warm')}
								aria-label="React with warm vibes"
							>
								<span>☕</span>
								<span>{post.reactions.warm}</span>
							</button>

							<!-- Proud Reaction -->
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes('proud') ? 'border-purple-400 bg-purple-100/80 text-purple-800 shadow-xs' : 'border-line bg-white/70 text-ink hover:bg-light'}"
								onclick={() => friends.toggleReaction(post.id, 'proud')}
								aria-label="React with proud of you"
							>
								<span>🌟</span>
								<span>{post.reactions.proud}</span>
							</button>
						</div>

						<button
							type="button"
							class="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3.5 py-1.5 font-ui text-xs font-bold text-accent transition-colors hover:bg-light"
							onclick={() => toggleNoteBox(post.id)}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
							</svg>
							<span>Notes ({post.comments.length})</span>
						</button>
					</div>

					<!-- Comments / Notes Drawer -->
					{#if openCommentPost === post.id || post.comments.length > 0}
						<div class="mt-4 rounded-xl border border-line/60 bg-[#FAF4E6]/60 p-3.5">
							<span class="font-ui text-[11px] font-bold text-ink-soft uppercase tracking-wider block mb-2.5">
								Friend Notes
							</span>

							{#if post.comments.length > 0}
								<div class="space-y-2 mb-3">
									{#each post.comments as comment (comment.id)}
										<div class="flex items-start gap-2.5 rounded-lg bg-white/80 p-2.5 shadow-2xs">
											<span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-lav/40 font-display text-sm font-bold text-accent">
												{comment.authorAvatar || comment.authorName[0]}
											</span>
											<div class="min-w-0 flex-1">
												<div class="flex items-baseline justify-between gap-2">
													<b class="font-ui text-xs text-ink">{comment.authorName}</b>
													<time class="font-ui text-[10px] text-ink-soft">{comment.time}</time>
												</div>
												<p class="font-hand text-base text-ink leading-tight mt-0.5">
													{comment.text}
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
									class="h-9 flex-1 rounded-lg border border-line bg-white px-3 font-ui text-xs text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
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
	{:else}
		<!-- ── MY FRIENDS LIST VIEW ── -->
		<div class="mt-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-2xl font-bold text-white">
					Connected Classmates ({friends.friendCount})
				</h2>
				<span class="font-ui text-xs text-[#D6CBEC]">
					Share your code to grow your circle
				</span>
			</div>

			<div class="grid gap-4 min-[640px]:grid-cols-2 min-[880px]:grid-cols-3">
				{#each friends.friends as friend (friend.id)}
					<div
						class="flex flex-col justify-between rounded-2xl border border-[#4D366D] bg-desk-2 p-5 text-white shadow-md"
					>
						<div>
							<div class="flex items-start justify-between gap-3">
								<div class="flex items-center gap-3">
									{#if friend.avatarUrl && friend.avatarUrl.length > 2}
										<img src={friend.avatarUrl} alt="" class="size-12 rounded-full object-cover ring-2 ring-gold/40" />
									{:else}
										<span class="flex size-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl font-bold text-white ring-2 ring-gold/40">
											{friend.avatarUrl || friend.displayName[0]}
										</span>
									{/if}

									<div>
										<b class="font-display text-lg block leading-tight text-white">{friend.displayName}</b>
										<span class="font-ui text-xs font-semibold text-lav">@{friend.username}</span>
									</div>
								</div>

								<span class="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-gold font-bold">
									{friend.friendCode}
								</span>
							</div>

							{#if friend.bio}
								<p class="mt-3 font-hand text-base text-[#EDE6F7] leading-snug">
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
</div>
