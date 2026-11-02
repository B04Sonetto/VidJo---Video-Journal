<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { TODAY } from '#lib/dates';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { CommunityPost, FriendPostReaction } from '#lib/types';

	let searchQuery = $state('');
	let activeSlug = $state('all');
	let feedMode = $state<'trending' | 'foryou'>('trending');
	let commentInput = $state<Record<string, string>>({});
	let openComments = $state<string | null>(null);
	let showDiscovery = $state(false);

	const MOODS: Record<string, string> = {
		happy: 'Happy',
		calm: 'Calm',
		tired: 'Tired',
		sad: 'Sad',
		stressed: 'Stressed',
		angry: 'Fired Up',
		excited: 'Excited'
	};

	const REACTIONS: {
		key: keyof FriendPostReaction;
		icon: string;
		label: string;
		active: string;
	}[] = [
		{
			key: 'love',
			icon: 'heart',
			label: 'Love this',
			active: 'border-pink-400 bg-pink-100/80 text-pink-700'
		},
		{
			key: 'spark',
			icon: 'sparkles',
			label: 'Inspired',
			active: 'border-amber-400 bg-amber-100/80 text-amber-800'
		},
		{
			key: 'warm',
			icon: 'sun',
			label: 'Warm hug',
			active: 'border-orange-400 bg-orange-100/80 text-orange-800'
		},
		{
			key: 'proud',
			icon: 'star',
			label: 'Proud of you',
			active: 'border-purple-400 bg-purple-100/80 text-purple-800'
		}
	];

	function formatDate(date: string) {
		if (date === journal.current) return 'Today';
		const parsed = new Date(`${date}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) return date;
		return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	let myCommunityPosts = $derived.by<CommunityPost[]>(() => {
		const authorId = profile.profile?.user_id || auth.ownerId;
		const joined = community.joinedSlugs;

		return Object.entries(journal.entries)
			.filter(
				([, entry]) =>
					entry.privacy === 'community' &&
					(entry.title || entry.mind || entry.refl || entry.videoPath) &&
					(!entry.communitySlug || joined.has(entry.communitySlug))
			)
			.map(([date, entry]) => ({
				id: `mine-${date}`,
				authorId,
				authorName: profile.nickname,
				authorUsername: profile.username,
				authorAvatar: profile.avatarUrl,
				friendCode: profile.friendCode,
				date,
				dateFormatted: formatDate(date),
				mood: entry.mood,
				title: entry.title || 'Community entry',
				mind: entry.mind,
				refl: entry.refl,
				stickers: entry.stickers,
				videoPath: entry.videoPath,
				videoName: entry.videoName,
				videoUrl: journal.sessionVideos[date] || '',
				reactions: { love: 0, spark: 0, warm: 0, proud: 0 },
				userReactions: [],
				comments: [],
				communitySlug: entry.communitySlug,
				tag: entry.communitySlug ? community.tagFor(entry.communitySlug) : '#Community',
				isOwner: true
			}));
	});

	function enrich(post: CommunityPost): CommunityPost {
		return {
			...post,
			reactions: community.reactionsFor(post.authorId, post.date),
			userReactions: community.mineFor(post.authorId, post.date),
			comments: community.commentsFor(post.authorId, post.date)
		};
	}

	let allPosts = $derived([...myCommunityPosts, ...community.posts].map(enrich));

	let filteredPosts = $derived.by(() => {
		const joined = community.joinedSlugs;
		let posts = allPosts.filter((post) => {
			if (!post.communitySlug) return post.isOwner;
			return post.isOwner || joined.has(post.communitySlug);
		});

		if (activeSlug !== 'all') {
			posts = posts.filter((post) => post.communitySlug === activeSlug);
		}

		if (feedMode === 'trending') {
			posts = [...posts].sort((a, b) => {
				const score = (value: CommunityPost) =>
					value.reactions.love +
					value.reactions.spark +
					value.reactions.warm +
					value.reactions.proud;
				return score(b) - score(a) || b.date.localeCompare(a.date);
			});
		} else {
			posts = [...posts].sort((a, b) => b.date.localeCompare(a.date));
		}

		const query = searchQuery.trim().toLowerCase();
		if (query) {
			posts = posts.filter(
				(post) =>
					post.title.toLowerCase().includes(query) ||
					post.mind.toLowerCase().includes(query) ||
					post.refl.toLowerCase().includes(query) ||
					post.authorName.toLowerCase().includes(query) ||
					post.authorUsername.toLowerCase().includes(query) ||
					post.tag.toLowerCase().includes(query)
			);
		}

		return posts;
	});

	function toggleComments(id: string) {
		openComments = openComments === id ? null : id;
	}

	function submitComment(post: CommunityPost, event: SubmitEvent) {
		event.preventDefault();
		const text = commentInput[post.id]?.trim();
		if (!text) return;
		void community.addComment(post, text);
		commentInput[post.id] = '';
	}

	function joinAndOpen(slug: string) {
		void community.toggleJoin(slug);
		activeSlug = slug;
		showDiscovery = false;
	}

	function leaveCommunity(slug: string) {
		if (activeSlug === slug) activeSlug = 'all';
		void community.toggleJoin(slug);
	}
</script>

<div class="mx-auto w-full max-w-[1180px] px-4 py-6 min-[900px]:px-6">
	<!-- Hero -->
	<header
		class="relative overflow-hidden rounded-[28px] border border-[#523A7A] bg-[radial-gradient(ellipse_at_top,#4A2F7A_0%,#24143D_70%)] p-6 text-white shadow-[0_24px_60px_rgba(0,0,0,.5)] min-[720px]:p-8"
	>
		<span
			class="pointer-events-none absolute -top-10 right-20 h-40 w-40 rounded-full bg-gold/10 blur-3xl"
		></span>
		<span
			class="pointer-events-none absolute bottom-0 left-10 h-32 w-32 rounded-full bg-lav/10 blur-3xl"
		></span>

		<div
			class="relative flex flex-col gap-5 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between"
		>
			<div>
				<div class="flex items-center gap-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 font-ui text-xs font-semibold text-gold"
					>
						<span class="size-2 animate-pulse rounded-full bg-gold"></span>
						Campus Communities
					</span>
					<span class="font-ui text-xs text-[#BBA8E0]">
						• {community.joinedCommunities.length} joined
					</span>
				</div>
				<h1
					class="mt-2 font-display text-3xl font-bold tracking-tight text-white min-[720px]:text-5xl"
				>
					{community.hasJoined ? 'Your Community Feed' : 'Find Your People'}
				</h1>
				<p class="mt-2 max-w-[620px] font-ui text-sm text-[#D6CBEC] min-[720px]:text-base">
					{#if community.hasJoined}
						Posts from the communities you've joined. Cheer people on, share small wins, and find a
						little inspiration.
					{:else}
						Communities are tiny corners of campus built around a shared feeling. Join one to see
						its feed and share your own pages.
					{/if}
				</p>
			</div>

			<div
				class="flex flex-col items-start gap-2 rounded-2xl border border-gold/40 bg-white/[.08] p-4 backdrop-blur-sm min-[900px]:items-end"
			>
				<span class="font-ui text-[11px] font-bold tracking-wider text-gold uppercase"
					>Your Profile</span
				>
				<div class="flex items-center gap-3">
					{#if profile.avatarUrl}
						<img
							src={profile.avatarUrl}
							alt=""
							class="size-11 rounded-full object-cover ring-2 ring-gold/50"
						/>
					{:else}
						<span
							class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-lg font-bold text-white ring-2 ring-gold/50"
						>
							{profile.initials}
						</span>
					{/if}
					<div class="min-[900px]:text-right">
						<p class="font-display font-bold text-white">{profile.nickname}</p>
						<p class="font-ui text-xs text-lav">@{profile.username}</p>
					</div>
				</div>
				<button
					type="button"
					class="font-ui text-xs font-semibold text-gold hover:underline"
					onclick={() => nav.jump(TODAY)}
				>
					Share a page from your journal →
				</button>
			</div>
		</div>
	</header>

	{#if community.loading && community.communities.length === 0}
		<div class="mt-6 rounded-3xl border border-[#4D366D] bg-desk-2 p-12 text-center text-white">
			<div
				class="mx-auto size-8 animate-spin rounded-full border-2 border-gold border-t-transparent"
			></div>
			<p class="mt-4 font-ui text-sm text-[#D6CBEC]">Finding communities…</p>
		</div>
	{:else if !community.hasJoined || showDiscovery}
		<!-- Discovery / join view -->
		<div class="mt-6">
			<div class="flex flex-wrap items-end justify-between gap-2">
				<div>
					<h2 class="font-display text-2xl font-bold text-white">Communities to join</h2>
					<p class="mt-1 font-ui text-sm text-[#D6CBEC]">
						Pick as many as you like. You can leave any time.
					</p>
				</div>
				<div class="flex items-center gap-3">
					<span class="font-ui text-xs text-[#BBA8E0]"
						>{community.communities.length} available</span
					>
					{#if community.hasJoined}
						<button
							type="button"
							class="rounded-full border border-white/20 px-3 py-1.5 font-ui text-xs font-semibold text-white hover:bg-white/10"
							onclick={() => (showDiscovery = false)}
						>
							Back to feed
						</button>
					{/if}
				</div>
			</div>

			<div class="mt-4 grid gap-4 min-[640px]:grid-cols-2 min-[980px]:grid-cols-3">
				{#each community.communities as item (item.slug)}
					<article
						class="group relative overflow-hidden rounded-[24px] border border-[#4D366D] bg-desk-2 p-5 text-left text-white shadow-[0_14px_36px_rgba(0,0,0,.32)] transition-all hover:-translate-y-1 hover:border-gold/50"
					>
						<span
							class="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full opacity-20 blur-2xl"
							style="background: {item.color}"
							aria-hidden="true"
						></span>
						<div class="relative flex items-start justify-between gap-3">
							<span
								class="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10"
								style="color: {item.color}"
							>
								<CommunityIcon name={item.icon} size={22} />
							</span>
							<span
								class="rounded-full bg-white/10 px-2.5 py-1 font-ui text-[11px] font-semibold text-[#D6CBEC]"
							>
								{item.memberCount}
								{item.memberCount === 1 ? 'member' : 'members'}
							</span>
						</div>
						<h3 class="relative mt-3 font-display text-xl font-bold">{item.tag}</h3>
						<p class="relative mt-1 font-ui text-xs font-semibold text-lav">{item.name}</p>
						<p class="relative mt-2 min-h-[42px] font-ui text-sm text-[#D6CBEC]">
							{item.description}
						</p>
						{#if item.joined}
							<button
								type="button"
								class="relative mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#3F7A4F]/50 bg-[#3F7A4F]/20 px-4 py-2.5 font-ui text-sm font-bold text-[#8BE2A4] transition-colors hover:bg-[#3F7A4F]/30"
								onclick={() => leaveCommunity(item.slug)}
							>
								<CommunityIcon name="check" size={15} />
								Joined · tap to leave
							</button>
						{:else}
							<button
								type="button"
								class="relative mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gold/50 bg-gold/20 px-4 py-2.5 font-ui text-sm font-bold text-[#FFF5DE] transition-colors hover:bg-gold/30"
								onclick={() => joinAndOpen(item.slug)}
							>
								<CommunityIcon name="check" size={15} />
								Join {item.tag}
							</button>
						{/if}
					</article>
				{/each}
			</div>
		</div>
	{:else}
		<!-- Joined feed -->
		<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-1 rounded-full border border-[#4D366D] bg-desk-2 p-1">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {feedMode ===
					'trending'
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => (feedMode = 'trending')}
				>
					<CommunityIcon name="trending" size={15} />
					Trending
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {feedMode ===
					'foryou'
						? 'bg-accent text-white shadow-sm'
						: 'text-[#D6CBEC] hover:text-white'}"
					onclick={() => (feedMode = 'foryou')}
				>
					<CommunityIcon name="sparkles" size={15} />
					For You
				</button>
			</div>
			<span class="font-ui text-xs text-[#BBA8E0]">{filteredPosts.length} posts</span>
		</div>

		<!-- Joined community switcher -->
		<div
			class="sticky top-4 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 overflow-x-auto bg-[#1C142B]/95 px-4 py-2 backdrop-blur-sm min-[900px]:mx-0 min-[900px]:rounded-2xl min-[900px]:border min-[900px]:border-[#4D366D] min-[900px]:px-3"
		>
			<button
				type="button"
				class="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {activeSlug ===
				'all'
					? 'bg-accent text-white shadow-md'
					: 'border border-[#4D366D] bg-desk-2 text-[#D6CBEC] hover:bg-[#3A275A] hover:text-white'}"
				onclick={() => (activeSlug = 'all')}
			>
				<CommunityIcon name="globe" size={14} />
				All joined
			</button>
			{#each community.joinedCommunities as item (item.slug)}
				<button
					type="button"
					class="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {activeSlug ===
					item.slug
						? 'bg-accent text-white shadow-md'
						: 'border border-[#4D366D] bg-desk-2 text-[#D6CBEC] hover:bg-[#3A275A] hover:text-white'}"
					onclick={() => (activeSlug = item.slug)}
				>
					<CommunityIcon name={item.icon} size={14} />
					{item.tag}
				</button>
			{/each}
			<button
				type="button"
				class="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[#6A5490] px-3 py-2 font-ui text-xs font-semibold text-[#C9B8E8] hover:border-gold/60 hover:text-white"
				onclick={() => (showDiscovery = true)}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
				Join more
			</button>
		</div>

		<!-- Search -->
		<div class="relative mt-4">
			<svg
				class="absolute top-1/2 left-4 -translate-y-1/2 text-[#9B8CB5]"
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
				<circle cx="11" cy="11" r="8"></circle>
				<path d="m21 21-4.3-4.3"></path>
			</svg>
			<input
				bind:value={searchQuery}
				type="text"
				placeholder="Search posts in your communities…"
				class="h-12 w-full rounded-2xl border border-[#4D366D] bg-desk-2 pr-4 pl-11 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
			/>
		</div>

		<!-- Posts -->
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			{#if filteredPosts.length === 0}
				<div
					class="rounded-[24px] border border-[#4D366D] bg-desk-2 p-10 text-center text-white lg:col-span-2"
				>
					<span
						class="mx-auto flex size-14 items-center justify-center rounded-full bg-white/10 text-lav"
					>
						<CommunityIcon name="sparkles" size={26} />
					</span>
					<p class="mt-4 font-display text-2xl font-bold">No posts here yet</p>
					<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
						{#if searchQuery.trim()}
							Nothing matched “{searchQuery}”. Try a different search.
						{:else}
							Be the first to share a page in {activeSlug === 'all'
								? 'your communities'
								: community.tagFor(activeSlug)}.
						{/if}
					</p>
					<button
						type="button"
						class="mt-4 rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white hover:bg-[#624690]"
						onclick={() => nav.jump(TODAY)}
					>
						Write today's page
					</button>
				</div>
			{/if}

			{#each filteredPosts as post (post.id)}
				<article
					class="group relative overflow-hidden rounded-[28px] border border-[#E6D9B8] bg-paper text-ink shadow-[0_20px_50px_rgba(0,0,0,.4)] transition-all hover:-translate-y-1 hover:shadow-[0_24px_56px_rgba(0,0,0,.44)]"
				>
					<span
						class="absolute -top-3 left-10 h-7 w-28 rotate-[-3deg] bg-gold/90 [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.4)_0_6px,transparent_6px_12px)] shadow-[0_1px_3px_rgba(0,0,0,.15)]"
						aria-hidden="true"
					></span>

					<div class="p-6 min-[720px]:p-8">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex items-center gap-3">
								{#if post.authorAvatar}
									<img
										src={post.authorAvatar}
										alt=""
										class="size-11 rounded-full object-cover ring-2 ring-gold/50"
									/>
								{:else}
									<span
										class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl text-white ring-2 ring-gold/40"
										aria-hidden="true"
									>
										{post.authorName[0]}
									</span>
								{/if}
								<div>
									<div class="flex flex-wrap items-center gap-2">
										<h2 class="font-display text-lg font-bold text-ink">{post.authorName}</h2>
										<span
											class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[10px] font-bold text-accent"
											>@{post.authorUsername}</span
										>
										{#if post.isOwner}
											<span
												class="rounded-full bg-[#3F7A4F]/15 px-2 py-0.5 font-ui text-[10px] font-bold text-[#3F7A4F]"
												>You</span
											>
										{/if}
										<span
											class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[10px] font-bold text-[#7A5618]"
											>{post.tag}</span
										>
									</div>
									<div class="flex items-center gap-2 font-ui text-xs text-ink-soft">
										<time>{post.dateFormatted}</time>
										<span>•</span>
										<span>{community.nameFor(post.communitySlug)}</span>
									</div>
								</div>
							</div>
							{#if post.mood && MOODS[post.mood]}
								<span
									class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-bold text-accent"
								>
									{MOODS[post.mood]}
								</span>
							{/if}
						</div>

						{#if post.title}
							<h3 class="mt-4 font-display text-2xl font-bold tracking-tight text-ink">
								{post.title}
							</h3>
						{/if}

						{#if post.videoUrl}
							<div class="my-4 overflow-hidden rounded-2xl border-2 border-[#D8C8A2] bg-[#120A20]">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={post.videoUrl}
									controls
									playsinline
									class="max-h-[340px] w-full bg-black object-contain"
								></video>
							</div>
						{:else if post.videoPath || post.videoName}
							<div class="my-4 overflow-hidden rounded-2xl border-2 border-[#D8C8A2] bg-[#120A20]">
								<div
									class="relative flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#4A2F7A_0%,#190E2B_85%)] p-8 text-center text-white"
								>
									<span
										class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-xs text-red-400"
									>
										<span class="size-2 animate-pulse rounded-full bg-red-500"></span>
										VIDJO • REC
									</span>
									<span class="absolute top-3 right-4 font-mono text-xs text-gold">COMMUNITY</span>
									<span
										class="flex size-14 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-md"
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
									</span>
									<p class="mt-3 font-display text-lg font-bold">
										{post.videoName || 'Community video moment'}
									</p>
									<p class="mt-0.5 font-hand text-base text-[#D6CBEC]">
										Shared with {community.tagFor(post.communitySlug)}
									</p>
								</div>
							</div>
						{/if}

						{#if post.mind}
							<div class="my-4 rounded-xl border-l-4 border-gold/60 bg-white/50 p-4">
								<p class="font-hand text-[22px] leading-relaxed whitespace-pre-wrap text-ink">
									{post.mind}
								</p>
							</div>
						{/if}

						{#if post.refl}
							<div
								class="my-3 flex items-start gap-2.5 rounded-xl border border-[#DECFA4] bg-[#FFF8E7] p-3"
							>
								<span class="text-base font-bold text-gold">★</span>
								<div>
									<span class="block font-ui text-xs font-bold tracking-wider text-accent uppercase"
										>Reflection</span
									>
									<p class="mt-0.5 font-hand text-lg font-semibold text-ink">{post.refl}</p>
								</div>
							</div>
						{/if}

						<div
							class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
						>
							<div class="flex flex-wrap items-center gap-1.5">
								{#each REACTIONS as reaction (reaction.key)}
									<button
										type="button"
										class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
											reaction.key
										)
											? reaction.active
											: 'border-line bg-white/70 text-ink hover:bg-light'}"
										onclick={() => community.toggleReaction(post, reaction.key)}
										aria-label={reaction.label}
										aria-pressed={post.userReactions.includes(reaction.key)}
									>
										<CommunityIcon name={reaction.icon} size={14} />
										<span>{post.reactions[reaction.key]}</span>
									</button>
								{/each}
							</div>
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-2 font-ui text-xs font-bold text-accent transition-all hover:bg-accent/20"
								onclick={() => toggleComments(post.id)}
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
								Notes ({post.comments.length})
							</button>
						</div>

						{#if openComments === post.id}
							<div class="mt-4 rounded-xl border border-line/60 bg-[#FAF4E6]/60 p-3.5">
								<span
									class="mb-2.5 block font-ui text-[11px] font-bold tracking-wider text-ink-soft uppercase"
									>Community notes</span
								>
								{#if post.comments.length > 0}
									<div class="mb-3 space-y-2">
										{#each post.comments as comment (comment.id)}
											<div class="flex items-start gap-2.5 rounded-lg bg-white/80 p-2.5">
												<span
													class="flex size-7 shrink-0 items-center justify-center rounded-full bg-lav/40 font-display text-sm font-bold text-accent"
												>
													{comment.authorName[0]}
												</span>
												<div class="min-w-0 flex-1">
													<div class="flex items-baseline justify-between gap-2">
														<b class="font-ui text-xs text-ink">{comment.authorName}</b>
														<time class="font-ui text-[10px] text-ink-soft">{comment.time}</time>
													</div>
													<p class="mt-0.5 font-hand text-base leading-tight text-ink">
														{comment.text}
													</p>
												</div>
											</div>
										{/each}
									</div>
								{/if}
								<form
									class="flex items-center gap-2"
									onsubmit={(event) => submitComment(post, event)}
								>
									<input
										bind:value={commentInput[post.id]}
										type="text"
										placeholder="Cheer them on…"
										maxlength="140"
										class="h-9 flex-1 rounded-lg border border-line bg-white px-3 font-ui text-xs text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
									/>
									<button
										type="submit"
										class="h-9 rounded-lg bg-accent px-3.5 font-ui text-xs font-bold text-white hover:bg-[#624690] disabled:opacity-50"
										disabled={!commentInput[post.id]?.trim()}
									>
										Send
									</button>
								</form>
							</div>
						{/if}
					</div>
				</article>
			{/each}
		</div>

		<div
			class="mt-10 rounded-[24px] border border-[#4D366D] bg-desk-2 p-6 text-center text-white shadow-[0_16px_40px_rgba(0,0,0,.35)]"
		>
			<h2 class="font-display text-2xl font-bold">Want your page in the feed?</h2>
			<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
				Set a journal page to <span class="font-semibold text-gold">Community</span>, then pick one
				of your joined communities.
			</p>
			<button
				type="button"
				class="mt-4 rounded-xl bg-accent px-6 py-2.5 font-ui text-sm font-bold text-white shadow hover:bg-[#624690]"
				onclick={() => nav.jump(TODAY)}
			>
				Go to today's page
			</button>
		</div>
	{/if}
</div>
