<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { TODAY } from '#lib/dates';

	let searchQuery = $state('');
	let activeTag = $state('all');
	let feedMode = $state<'trending' | 'foryou'>('trending');
	let bookmarks = $state<string[]>([]);
	let comments = $state<Record<string, Array<{ id: string; author: string; text: string; time: string }>>>({});
	let commentInput = $state<Record<string, string>>({});
	let openComments = $state<string | null>(null);
	let blockedUsers = $state<string[]>([]);

	const COMMUNITY_POSTS: any[] = [];

	const COMMUNITIES = [
		{ id: 'all', label: 'All', icon: 'globe' },
		{ id: '#SmallWins', label: '#SmallWins', icon: 'spark' },
		{ id: '#CampusSunset', label: '#CampusSunset', icon: 'sun' },
		{ id: '#CreativeFlow', label: '#CreativeFlow', icon: 'music' },
		{ id: '#MidtermSurvivals', label: '#MidtermSurvivals', icon: 'book' },
		{ id: '#MentalHealth', label: '#MentalHealth', icon: 'heart' },
		{ id: '#StudyTogether', label: '#StudyTogether', icon: 'users' },
		{ id: '#GreenCampus', label: '#GreenCampus', icon: 'leaf' }
	];

	const MOOD_ICONS: Record<string, { label: string; icon: string }> = {
		happy: { label: 'Happy', icon: 'smile' },
		calm: { label: 'Calm', icon: 'cloud' },
		tired: { label: 'Tired', icon: 'moon' },
		sad: { label: 'Sad', icon: 'frown' },
		stressed: { label: 'Stressed', icon: 'zap' },
		angry: { label: 'Fired Up', icon: 'flame' },
		excited: { label: 'Excited', icon: 'spark' }
	};

	let myCommunityPosts = $derived(
		Object.entries(journal.entries)
			.filter(([, entry]) => entry.privacy === 'community' && (entry.title || entry.mind || entry.videoPath))
			.map(([date, entry]) => ({
				id: `mine-${date}`,
				authorName: profile.displayName,
				authorUsername: profile.username,
				authorAvatar: profile.avatarUrl || profile.initials,
				tag: '#MyEntry',
				dateFormatted: date === journal.current ? 'Today' : date,
				mood: entry.mood,
				title: entry.title || 'Community entry',
				mind: entry.mind,
				refl: entry.refl,
				reactions: { love: 12, spark: 6, warm: 9, proud: 4 },
				comments: 2,
				hasVideo: Boolean(entry.videoPath),
				isMine: true,
				schoolYear: 'You'
			}))
	);

	let allPosts = $derived([...myCommunityPosts, ...COMMUNITY_POSTS.map((p) => ({ ...p, schoolYear: 'Student' }))]);

	function toggleBookmark(id: string) {
		if (bookmarks.includes(id)) {
			bookmarks = bookmarks.filter((b) => b !== id);
			journal.toast('Removed from bookmarks');
		} else {
			bookmarks = [...bookmarks, id];
			journal.toast('Saved to bookmarks');
		}
	}

	function toggleComments(id: string) {
		openComments = openComments === id ? null : id;
	}

	function addComment(id: string) {
		const text = commentInput[id]?.trim();
		if (!text) return;
		if (!comments[id]) comments[id] = [];
		comments[id] = [
			...comments[id],
			{
				id: `c-${Date.now()}`,
				author: profile.displayName,
				text,
				time: 'Just now'
			}
		];
		commentInput[id] = '';
		journal.toast('Comment added');
	}

	function reportPost(author: string) {
		journal.toast(`Reported ${author}'s post. We'll review it.`);
	}

	function blockUser(username: string) {
		if (!blockedUsers.includes(username)) {
			blockedUsers = [...blockedUsers, username];
			journal.toast(`Blocked @${username}`);
		}
	}

	let filteredPosts = $derived.by(() => {
		let posts = allPosts.filter((p) => !blockedUsers.includes(p.authorUsername));

		if (feedMode === 'foryou') {
			posts = posts.filter((p) => p.tag === '#SmallWins' || p.tag === '#CampusSunset' || p.tag === '#MyEntry');
		} else {
			posts = [...posts].sort((a, b) => {
				const aScore = a.reactions.love + a.reactions.spark + a.reactions.warm + a.reactions.proud;
				const bScore = b.reactions.love + b.reactions.spark + b.reactions.warm + b.reactions.proud;
				return bScore - aScore;
			});
		}

		if (activeTag !== 'all') {
			posts = posts.filter((p) => p.tag === activeTag);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			posts = posts.filter(
				(p) =>
					p.title.toLowerCase().includes(q) ||
					p.mind.toLowerCase().includes(q) ||
					p.authorName.toLowerCase().includes(q) ||
					p.tag.toLowerCase().includes(q)
			);
		}

		return posts;
	});
</script>

<div class="mx-auto w-full max-w-[1180px] px-4 py-6 min-[900px]:px-6">
	<!-- Hero Header -->
	<header
		class="relative overflow-hidden rounded-[28px] border border-[#523A7A] bg-[radial-gradient(ellipse_at_top,#4A2F7A_0%,#24143D_70%)] p-6 shadow-[0_24px_60px_rgba(0,0,0,.5)] text-white min-[720px]:p-8"
	>
		<span class="pointer-events-none absolute -top-10 right-20 h-40 w-40 rounded-full bg-gold/10 blur-3xl"></span>
		<span class="pointer-events-none absolute bottom-0 left-10 h-32 w-32 rounded-full bg-lav/10 blur-3xl"></span>

		<div class="relative flex flex-col gap-5 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
			<div>
				<div class="flex items-center gap-2">
					<span class="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 font-ui text-xs font-semibold text-gold">
						<span class="size-2 rounded-full bg-gold animate-pulse"></span>
						Campus Community
					</span>
					<span class="font-ui text-xs text-[#BBA8E0]">• Public reel</span>
				</div>
				<h1 class="mt-2 font-display text-3xl font-bold tracking-tight text-white min-[720px]:text-5xl">
					Community Feed
				</h1>
				<p class="mt-2 max-w-[600px] font-ui text-sm text-[#D6CBEC] min-[720px]:text-base">
					Cheer each other on, share your small wins, and find inspiration from students across campus.
					Entries marked <span class="font-semibold text-gold">Community</span> appear here.
				</p>
			</div>

			<div class="flex flex-col items-start gap-2 rounded-2xl border border-gold/40 bg-white/[.08] p-4 backdrop-blur-sm min-[900px]:items-end">
				<span class="font-ui text-[11px] font-bold tracking-wider text-gold uppercase">Your Profile</span>
				<div class="flex items-center gap-3">
					{#if profile.avatarUrl}
						<img src={profile.avatarUrl} alt="" class="size-11 rounded-full object-cover ring-2 ring-gold/50" />
					{:else}
						<span class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-lg font-bold text-white ring-2 ring-gold/50">
							{profile.initials}
						</span>
					{/if}
					<div class="min-[900px]:text-right">
						<p class="font-display font-bold text-white">{profile.displayName}</p>
						<p class="font-ui text-xs text-lav">@{profile.username}</p>
					</div>
				</div>
				<button
					type="button"
					class="font-ui text-xs font-semibold text-gold hover:underline"
					onclick={() => nav.jump(TODAY)}
				>
					Share to community from your journal →
				</button>
			</div>
		</div>
	</header>

	<!-- Feed Mode Toggle -->
	<div class="mt-6 flex items-center justify-between gap-3">
		<div class="flex items-center gap-1 rounded-full border border-[#4D366D] bg-desk-2 p-1">
			<button
				type="button"
				class="rounded-full px-5 py-2 font-ui text-sm font-semibold transition-all {feedMode === 'trending'
					? 'bg-accent text-white shadow-sm'
					: 'text-[#D6CBEC] hover:text-white'}"
				onclick={() => (feedMode = 'trending')}
			>
				🔥 Trending
			</button>
			<button
				type="button"
				class="rounded-full px-5 py-2 font-ui text-sm font-semibold transition-all {feedMode === 'foryou'
					? 'bg-accent text-white shadow-sm'
					: 'text-[#D6CBEC] hover:text-white'}"
				onclick={() => (feedMode = 'foryou')}
			>
				✨ For You
			</button>
		</div>
		<span class="font-ui text-xs text-[#BBA8E0]">{filteredPosts.length} posts</span>
	</div>

	<!-- Tags Filter -->
	<div class="sticky top-4 z-10 mt-4 -mx-4 flex flex-wrap items-center gap-2 overflow-x-auto bg-[#1C142B]/95 px-4 py-2 backdrop-blur-sm min-[900px]:mx-0 min-[900px]:rounded-2xl min-[900px]:border min-[900px]:border-[#4D366D] min-[900px]:px-3">
		{#each COMMUNITIES as community}
			<button
				type="button"
				class="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {activeTag === community.id
					? 'bg-accent text-white shadow-md'
					: 'border border-[#4D366D] bg-desk-2 text-[#D6CBEC] hover:bg-[#3A275A] hover:text-white'}"
				onclick={() => (activeTag = community.id)}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					{#if community.icon === 'globe'}
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
						<path d="M2 12h20"></path>
					{:else if community.icon === 'spark'}
						<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
					{:else if community.icon === 'sun'}
						<circle cx="12" cy="12" r="4"></circle>
						<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
					{:else if community.icon === 'music'}
						<path d="M9 18V5l12-2v13"></path>
						<circle cx="6" cy="18" r="3"></circle>
						<circle cx="18" cy="16" r="3"></circle>
					{:else if community.icon === 'book'}
						<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"></path>
					{:else if community.icon === 'heart'}
						<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
					{:else if community.icon === 'users'}
						<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
						<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
					{:else if community.icon === 'leaf'}
						<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path>
						<path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>
					{/if}
				</svg>
				<span>{community.label}</span>
			</button>
		{/each}
		{#if myCommunityPosts.length > 0}
			<button
				type="button"
				class="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 font-ui text-sm font-semibold transition-all {activeTag === '#MyEntry'
					? 'bg-accent text-white shadow-md'
					: 'border border-gold/40 bg-desk-2 text-gold hover:bg-[#3A275A]'}"
				onclick={() => (activeTag = '#MyEntry')}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path>
				</svg>
				<span>#MyEntry</span>
				<span class="rounded-full bg-gold/30 px-1.5 py-0.5 text-[10px]">{myCommunityPosts.length}</span>
			</button>
		{/if}
	</div>

	<!-- Search -->
	<div class="relative mt-4">
		<svg
			class="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8CB5]"
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
			placeholder="Search community posts by topic, mood, or keyword..."
			class="h-12 w-full rounded-2xl border border-[#4D366D] bg-desk-2 pl-11 pr-4 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
		/>
	</div>

	<!-- Posts Grid -->
	<div class="mt-6 grid gap-6 lg:grid-cols-2">
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
							{#if typeof post.authorAvatar === 'string' && post.authorAvatar.length > 2 && post.authorAvatar.startsWith('http')}
								<img src={post.authorAvatar} alt="" class="size-11 rounded-full object-cover ring-2 ring-gold/50" />
							{:else}
								<span
									class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#8B6FD0)] font-display text-xl text-white ring-2 ring-gold/40"
									aria-hidden="true"
								>
									{typeof post.authorAvatar === 'string' && post.authorAvatar.length <= 2 ? post.authorAvatar : post.authorName[0]}
								</span>
							{/if}
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="font-display text-lg font-bold text-ink">{post.authorName}</h2>
									<span class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[10px] font-bold text-accent">
										@{post.authorUsername}
									</span>
									{#if post.schoolYear}
										<span class="rounded-full bg-paper px-2 py-0.5 font-ui text-[10px] text-ink-soft">{post.schoolYear}</span>
									{/if}
									<span class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[10px] font-bold text-[#7A5618]">
										{post.tag}
									</span>
								</div>
								<div class="flex items-center gap-2 font-ui text-xs text-ink-soft">
									<time>{post.dateFormatted}</time>
									<span>•</span>
									<span>Campus Community</span>
								</div>
							</div>
						</div>
						{#if post.mood && MOOD_ICONS[post.mood]}
							<span class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-bold text-accent">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
										<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.3 3.5 3.2 5 5.5A8 8 0 0 1 8.5 14.5z"></path>
									{:else if MOOD_ICONS[post.mood].icon === 'spark'}
										<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
									{/if}
								</svg>
								{MOOD_ICONS[post.mood].label}
							</span>
						{/if}
					</div>

					{#if post.title}
						<h3 class="mt-4 font-display text-2xl font-bold tracking-tight text-ink">{post.title}</h3>
					{/if}

					{#if post.hasVideo}
						<div class="my-4 overflow-hidden rounded-2xl border-2 border-[#D8C8A2] bg-[#120A20]">
							<div class="relative flex flex-col items-center justify-center p-8 text-center text-white bg-[radial-gradient(ellipse_at_center,#4A2F7A_0%,#190E2B_85%)]">
								<span class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-xs text-red-400">
									<span class="size-2 rounded-full bg-red-500 animate-pulse"></span>
									COMMUNITY • REC
								</span>
								<span class="absolute top-3 right-4 font-mono text-xs text-gold">VIDJO</span>
								<div class="flex size-14 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-md">
									<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
										<path d="M8 5v14l11-7z"></path>
									</svg>
								</div>
								<p class="mt-3 font-display text-lg font-bold">Community Video Moment</p>
								<p class="mt-0.5 font-hand text-base text-[#D6CBEC]">Shared with the campus community</p>
							</div>
						</div>
					{/if}

					{#if post.mind}
						<div class="my-4 rounded-xl border-l-4 border-gold/60 bg-white/50 p-4">
							<p class="font-hand text-[22px] leading-relaxed text-ink whitespace-pre-wrap">{post.mind}</p>
						</div>
					{/if}

					{#if post.refl}
						<div class="my-3 flex items-start gap-2.5 rounded-xl border border-[#DECFA4] bg-[#FFF8E7] p-3">
							<span class="text-base text-gold font-bold">★</span>
							<div>
								<span class="font-ui text-xs font-bold text-accent uppercase tracking-wider block">Reflection</span>
								<p class="font-hand text-lg text-ink font-semibold mt-0.5">{post.refl}</p>
							</div>
						</div>
					{/if}

					<div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
						<div class="flex flex-wrap items-center gap-2">
							<button type="button" class="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5 font-ui text-xs font-bold text-ink hover:bg-light">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
								</svg>
								<span>{post.reactions.love}</span>
							</button>
							<button type="button" class="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5 font-ui text-xs font-bold text-ink hover:bg-light">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
								</svg>
								<span>{post.reactions.spark}</span>
							</button>
							<button type="button" class="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5 font-ui text-xs font-bold text-ink hover:bg-light">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M17 8h1a4 4 0 1 1 0 8h-1"></path>
									<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>
									<line x1="6" y1="1" x2="6" y2="4"></line>
									<line x1="10" y1="1" x2="10" y2="4"></line>
									<line x1="14" y1="1" x2="14" y2="4"></line>
								</svg>
								<span>{post.reactions.warm}</span>
							</button>
							<button type="button" class="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1.5 font-ui text-xs font-bold text-ink hover:bg-light">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
								</svg>
								<span>{post.reactions.proud}</span>
							</button>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-semibold transition-all {bookmarks.includes(post.id) ? 'bg-gold/20 text-[#7A5618]' : 'bg-white/80 text-ink hover:bg-light'}"
								onclick={() => toggleBookmark(post.id)}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill={bookmarks.includes(post.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
								</svg>
								{bookmarks.includes(post.id) ? 'Saved' : 'Save'}
							</button>
							<button
								type="button"
								class="flex items-center gap-2 rounded-full bg-accent/10 px-4 py-2 font-ui text-xs font-bold text-accent transition-all hover:bg-accent/20 hover:shadow-sm"
								onclick={() => toggleComments(post.id)}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
								</svg>
								Cheer them on ({(comments[post.id]?.length || 0) + post.comments}) →
							</button>
							<details class="relative">
								<summary class="list-none flex cursor-pointer items-center justify-center rounded-full bg-white/80 p-2 hover:bg-light">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<circle cx="12" cy="12" r="1"></circle>
										<circle cx="19" cy="12" r="1"></circle>
										<circle cx="5" cy="12" r="1"></circle>
									</svg>
								</summary>
								<div class="absolute right-0 bottom-full mb-2 w-40 rounded-xl border border-line bg-paper p-2 shadow-lg">
									<button type="button" class="w-full rounded-lg px-2 py-1 text-left font-ui text-xs hover:bg-light" onclick={() => reportPost(post.authorName)}>Report post</button>
									<button type="button" class="w-full rounded-lg px-2 py-1 text-left font-ui text-xs text-red-600 hover:bg-red-50" onclick={() => blockUser(post.authorUsername)}>Block @{post.authorUsername}</button>
								</div>
							</details>
						</div>
					</div>

					{#if openComments === post.id}
						<div class="mt-4 rounded-xl border border-line/60 bg-[#FAF4E6]/60 p-3.5">
							<span class="font-ui text-[11px] font-bold text-ink-soft uppercase tracking-wider block mb-2.5">Community Notes</span>
							<div class="space-y-2 mb-3">
								{#each comments[post.id] || [] as c (c.id)}
									<div class="flex items-start gap-2.5 rounded-lg bg-white/80 p-2.5">
										<span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-lav/40 font-display text-sm font-bold text-accent">{c.author[0]}</span>
										<div class="min-w-0 flex-1">
											<div class="flex items-baseline justify-between gap-2">
												<b class="font-ui text-xs text-ink">{c.author}</b>
												<time class="font-ui text-[10px] text-ink-soft">{c.time}</time>
											</div>
											<p class="font-hand text-base text-ink leading-tight mt-0.5">{c.text}</p>
										</div>
									</div>
								{/each}
							</div>
							<form
								onsubmit={(e) => {
									e.preventDefault();
									addComment(post.id);
								}}
								class="flex items-center gap-2"
							>
								<input
									bind:value={commentInput[post.id]}
									type="text"
									placeholder="Cheer them on..."
									maxlength="140"
									class="h-9 flex-1 rounded-lg border border-line bg-white px-3 font-ui text-xs text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:outline-none"
								/>
								<button type="submit" class="h-9 rounded-lg bg-accent px-3.5 font-ui text-xs font-bold text-white hover:bg-[#624690]" disabled={!commentInput[post.id]?.trim()}>Send</button>
							</form>
						</div>
					{/if}
				</div>
			</article>
		{/each}
	</div>

	<div class="mt-10 rounded-[24px] border border-[#4D366D] bg-desk-2 p-6 text-center text-white shadow-[0_16px_40px_rgba(0,0,0,.35)]">
		<h2 class="font-display text-2xl font-bold">Want your post to appear here?</h2>
		<p class="mt-2 font-ui text-sm text-[#D6CBEC]">
			Set any of your journal pages to <span class="font-semibold text-gold">Community</span> in the privacy picker,
			and it'll be shared with the campus community.
		</p>
		<button
			type="button"
			class="mt-4 rounded-xl bg-accent px-6 py-2.5 font-ui text-sm font-bold text-white shadow hover:bg-[#624690]"
			onclick={() => nav.jump(TODAY)}
		>
			Go to today's page
		</button>
	</div>
</div>
