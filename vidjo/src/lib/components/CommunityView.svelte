<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { TODAY } from '#lib/dates';
	import { onMount } from 'svelte';
	import { MOODS, MOOD_BY_KEY } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import Skeleton from '#lib/components/ui/Skeleton.svelte';
	import { censor } from '#lib/censor';
	import type { CommunityPost, FriendPostReaction, MoodKey } from '#lib/types';

	let searchQuery = $state('');
	let activeSlug = $state('all');
	let activeMood = $state<MoodKey | 'all'>('all');
	let feedMode = $state<'trending' | 'newest'>('trending');
	let commentInput = $state<Record<string, string>>({});
	let openComments = $state<string | null>(null);
	let profileModalOpen = $state(false);
	let viewedUserId = $state<string | null>(null);
	let showDiscovery = $state(false);
	let focusPostId = $state<string | null>(null);
	let lastCommentTime = $state<Record<string, number>>({});
	let deleteTarget = $state<CommunityPost | null>(null);
	let deleteBusy = $state(false);
	let commentConfirmId = $state<string | null>(null);

	onMount(() => {
		void community.refresh();
	});

	const PROMPTS = [
		'Describe today as a weather forecast.',
		'What is one small thing that made today easier?',
		'Write a note to your future self about this week.',
		'What song would play in the background of today?',
		'Name one thing you are proud of this week.',
		'Describe a corner of campus you love in three lines.',
		'What is something you are looking forward to?',
		'Leave a tiny reminder for someone having a hard day.'
	];

	const CARD_TILTS = [
		'rotate-[-1.4deg]',
		'rotate-[1.2deg]',
		'rotate-[-0.7deg]',
		'rotate-[0.9deg]'
	] as const;

	const DISCOVERY_TILTS = [
		'rotate-[-0.6deg]',
		'rotate-[0.5deg]',
		'rotate-[-0.3deg]',
		'rotate-[0.7deg]'
	] as const;

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
			active: 'border-pink-400 bg-pink-100 text-pink-700'
		},
		{
			key: 'spark',
			icon: 'sparkles',
			label: 'Inspired',
			active: 'border-amber-400 bg-amber-100 text-amber-800'
		},
		{
			key: 'warm',
			icon: 'sun',
			label: 'Warm hug',
			active: 'border-orange-400 bg-orange-100 text-orange-800'
		},
		{
			key: 'proud',
			icon: 'star',
			label: 'Proud of you',
			active: 'border-purple-400 bg-purple-100 text-purple-800'
		}
	];

	function formatDate(date: string) {
		if (date === journal.current) return 'Today';
		const parsed = new Date(`${date}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) return date;
		return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function firstName(name: string) {
		return name.trim().split(/\s+/)[0] || 'Friend';
	}

	function stickerTilt(rot: number, index: number) {
		const base = Number.isFinite(rot) ? rot * 0.4 : 0;
		return Math.max(-14, Math.min(14, base + (index % 2 === 0 ? -2 : 2)));
	}

	let promptIndex = $derived.by(() => {
		let hash = 0;
		for (const char of `${TODAY}-community`) {
			hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
		}
		return hash % PROMPTS.length;
	});

	let todaysPrompt = $derived(PROMPTS[promptIndex]);

	let myCommunityPosts = $derived.by<CommunityPost[]>(() => {
		const authorId = profile.profile?.user_id || auth.ownerId;
		const joined = community.joinedSlugs;

		return Object.entries(journal.entries)
			.filter(
				([, entry]) =>
					entry.privacy === 'community' &&
					(entry.title || entry.mind || entry.refl || entry.videoPath || entry.mood) &&
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
				videoThumbUrl: journal.sessionThumbs[date] || '',
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

	let memberPosts = $derived.by(() => {
		const joined = community.joinedSlugs;
		return allPosts.filter((post) => {
			if (!post.communitySlug) return post.isOwner;
			return post.isOwner || joined.has(post.communitySlug);
		});
	});

	let basePosts = $derived(
		activeSlug === 'all'
			? memberPosts
			: memberPosts.filter((post) => post.communitySlug === activeSlug)
	);

	let moodCounts = $derived.by(() => {
		const counts: Partial<Record<MoodKey, number>> = {};
		for (const post of basePosts) {
			if (!post.mood) continue;
			counts[post.mood] = (counts[post.mood] ?? 0) + 1;
		}
		return counts;
	});

	let slugCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const post of memberPosts) {
			if (!post.communitySlug) continue;
			counts[post.communitySlug] = (counts[post.communitySlug] ?? 0) + 1;
		}
		return counts;
	});

	let filteredPosts = $derived.by(() => {
		let posts = basePosts;

		if (activeMood !== 'all') {
			posts = posts.filter((post) => post.mood === activeMood);
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
					post.tag.toLowerCase().includes(query) ||
					community.nameFor(post.communitySlug).toLowerCase().includes(query)
			);
		}

		return [...posts].sort((a, b) => {
			if (feedMode === 'trending') {
				const score = (value: CommunityPost) =>
					value.reactions.love +
					value.reactions.spark +
					value.reactions.warm +
					value.reactions.proud;
				return score(b) - score(a) || b.date.localeCompare(a.date);
			}
			return b.date.localeCompare(a.date);
		});
	});

	let feedVisible = $derived(community.hasJoined && !showDiscovery);

	function toggleComments(id: string) {
		openComments = openComments === id ? null : id;
	}

	function submitComment(post: CommunityPost, event: SubmitEvent) {
		event.preventDefault();
		const text = commentInput[post.id]?.trim();
		if (!text) return;

		const now = Date.now();
		const last = lastCommentTime[post.id] ?? 0;
		if (now - last < 2000) {
			journal.toast('Please wait a moment before sending another note.');
			return;
		}
		lastCommentTime[post.id] = now;

		void community.addComment(post, text);
		commentInput[post.id] = '';
	}

	async function joinAndOpen(slug: string) {
		const succeeded = await community.toggleJoin(slug);
		if (succeeded) {
			await community.refresh();
			activeSlug = slug;
			showDiscovery = false;
		}
	}

	async function leaveCommunity(slug: string) {
		if (activeSlug === slug) activeSlug = 'all';
		const succeeded = await community.toggleJoin(slug);
		if (succeeded) {
			await community.refresh();
		}
	}

	function openCommunity(slug: string) {
		activeSlug = slug;
		showDiscovery = false;
	}

	async function deleteComment(post: CommunityPost, commentId: string) {
		commentConfirmId = null;
		const ok = await community.deleteComment(post, commentId);
		journal.toast(ok ? 'Note deleted' : 'Could not delete the note. Please try again.');
	}

	async function reportComment(post: CommunityPost, commentId: string) {
		const reason = prompt('Why are you reporting this note?')?.trim();
		if (!reason) return;
		const ok = await community.reportComment(post, commentId, reason);
		journal.toast(
			ok ? 'Report sent to moderators. Thank you.' : 'Could not send the report. Please try again.'
		);
	}

	function requestDelete(post: CommunityPost) {
		deleteTarget = post;
	}

	async function confirmDelete() {
		if (!deleteTarget || deleteBusy) return;
		deleteBusy = true;
		const removed = await community.deletePost(deleteTarget.id);
		deleteBusy = false;
		if (removed) {
			if (openComments === deleteTarget.id) openComments = null;
			deleteTarget = null;
		}
	}

	function clearFilters() {
		searchQuery = '';
		activeMood = 'all';
		activeSlug = 'all';
	}

	function openProfile(userId: string) {
		viewedUserId = userId;
		profileModalOpen = true;
	}

	function openRandomPage() {
		if (filteredPosts.length === 0) {
			journal.toast('No pages to open yet. Be the first to share one!');
			return;
		}

		const pick = filteredPosts[Math.floor(Math.random() * filteredPosts.length)];
		focusPostId = pick.id;
		document
			.getElementById(`community-page-${pick.id}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });

		setTimeout(() => {
			if (focusPostId === pick.id) focusPostId = null;
		}, 2400);
	}

	function stickersFor(post: CommunityPost) {
		const list: { svg: string; flat: boolean; rot: number }[] = [];
		for (const sticker of post.stickers ?? []) {
			const def = STICKER_BY_KEY[sticker.type];
			if (!def) continue;
			list.push({ svg: def.svg, flat: Boolean(def.flat), rot: sticker.rot ?? 0 });
			if (list.length >= 6) break;
		}
		return list;
	}
</script>

<div class="mx-auto w-full max-w-[1240px] px-4 py-6 min-[900px]:px-6">
	<PageHeader
		title="Community"
		description="Small corners of campus built around a shared feeling. Read what people chose to share, cheer them on, and leave a kind note."
	>
		{#snippet meta()}
			{community.joinedCommunities.length}
			{community.joinedCommunities.length === 1 ? 'community' : 'communities'} joined
		{/snippet}
		{#snippet actions()}
			{#if feedVisible}
				<Button variant="outline" icon="grid" onclick={openRandomPage}>Open a random page</Button>
			{/if}
			<Button icon="pen" onclick={() => nav.jump(TODAY)}>Share a page</Button>
		{/snippet}
	</PageHeader>

	{#if community.loading && community.communities.length === 0}
		<div
			class="mt-7 rounded-[10px] bg-paper px-6 py-14 text-center text-ink shadow-[0_16px_34px_rgba(0,0,0,.4)]"
			role="status"
		>
			<Spinner size={36} class="mx-auto text-accent" />
			<p class="mt-4 font-ui text-sm font-medium text-ink-soft">Finding communities…</p>
		</div>
	{:else if !community.hasJoined || showDiscovery}
		<!-- Discovery / join view -->
		<section class="relative mt-7">
			<div
				class="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#D4A24C]/10 to-[#51397A]/20"
			></div>
			<div class="relative z-10 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="font-display text-3xl font-bold text-white min-[720px]:text-4xl">
						Communities to join
					</h2>
					<p class="mt-1 max-w-[640px] font-ui text-sm leading-relaxed text-[#CFC3E6]">
						Pick as many as you like. You can leave any time. Your journal pages stay private until
						you choose to share one with a community.
					</p>
				</div>
				<div class="flex items-center gap-3">
					<span class="font-ui text-xs text-[#BBA8E0] tabular-nums">
						{community.communities.length} available
					</span>
					{#if community.hasJoined}
						<Button
							variant="outline"
							size="sm"
							icon="arrow-left"
							onclick={() => (showDiscovery = false)}
						>
							Back to feed
						</Button>
					{/if}
				</div>
			</div>

			<div class="mt-6 grid gap-x-5 gap-y-8 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3">
				{#each community.communities as item, index (item.slug)}
					{@const tilt = DISCOVERY_TILTS[index % DISCOVERY_TILTS.length]}
					<article
						class="group relative flex min-w-0 flex-col overflow-hidden rounded-[8px] bg-paper text-ink shadow-[0_12px_26px_rgba(0,0,0,.42)] transition-all duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-[0_18px_34px_rgba(0,0,0,.5)] {tilt}"
					>
						<div class="h-2 w-full" style="background: {item.color}" aria-hidden="true"></div>
						<div class="flex flex-1 flex-col p-5">
							<div class="flex items-start justify-between gap-3">
								<span
									class="flex size-12 shrink-0 items-center justify-center rounded-2xl border"
									style="background: {item.color}1f; color: {item.color}; border-color: {item.color}55"
								>
									<CommunityIcon name={item.icon} size={24} />
								</span>
								<span
									class="rounded-full bg-light px-2.5 py-1 font-ui text-[10px] font-semibold text-ink-soft tabular-nums"
								>
									{item.memberCount}
									{item.memberCount === 1 ? 'member' : 'members'}
								</span>
							</div>

							<div class="mt-3 flex flex-wrap items-center gap-2">
								<h3 class="font-display text-xl leading-tight font-bold">{item.tag}</h3>
								{#if item.joined}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-[#E3F1E5] px-2 py-0.5 font-ui text-[9px] font-bold text-[#2F6B45]"
									>
										<CommunityIcon name="check" size={10} />
										Joined
									</span>
								{/if}
							</div>
							<p class="font-ui text-xs font-semibold text-ink-soft">{item.name}</p>
							<p class="mt-2 flex-1 font-ui text-sm leading-relaxed text-ink-soft">
								{item.description}
							</p>

							<div
								class="mt-3 flex items-center gap-1.5 font-ui text-sm text-ink-soft tabular-nums"
							>
								<CommunityIcon name="video" size={14} class="text-ink-muted" />
								{slugCounts[item.slug] ?? 0}
								{(slugCounts[item.slug] ?? 0) === 1 ? 'shared page' : 'shared pages'}
								visible to you
							</div>

							{#if item.joined}
								<div class="mt-4 grid grid-cols-2 gap-2">
									<Button size="sm" onclick={() => openCommunity(item.slug)}>Open feed</Button>
									<Button size="sm" variant="paper" onclick={() => leaveCommunity(item.slug)}>
										Leave
									</Button>
								</div>
							{:else}
								<Button
									class="mt-4 w-full"
									size="sm"
									icon="check"
									onclick={() => joinAndOpen(item.slug)}
								>
									Join {item.tag}
								</Button>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		</section>
	{:else}
		<!-- Prompt + mood browser -->
		<div class="mt-7 grid gap-6 min-[940px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
			<section
				class="mx-auto w-full max-w-[470px] rounded-[6px] bg-paper px-6 py-6 text-ink shadow-[0_12px_24px_rgba(0,0,0,.4)] min-[940px]:mx-0"
			>
				<p class="font-ui text-xs font-semibold text-[#8A5A12]">Today's prompt</p>
				<p class="mt-2 font-hand text-[28px] leading-[1.2] font-bold text-balance text-ink">
					{todaysPrompt}
				</p>
				<Button class="mt-4" trailingIcon="arrow-right" onclick={() => nav.jump(TODAY)}>
					Answer with a VidJo
				</Button>
			</section>

			<section class="min-w-0">
				<div class="flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2
							class="font-display text-2xl leading-tight font-bold text-white min-[720px]:text-[28px]"
						>
							Browse by mood
						</h2>
						<p class="mt-0.5 font-ui text-sm text-[#CFC3E6]">
							Showing {activeMood === 'all' ? 'every mood' : MOOD_BY_KEY[activeMood].l} ·
							{feedMode === 'trending' ? 'trending first' : 'newest first'}
						</p>
					</div>
					{#if activeMood !== 'all'}
						<button
							type="button"
							class="font-ui text-xs font-semibold text-gold hover:underline"
							onclick={() => (activeMood = 'all')}
						>
							Clear mood
						</button>
					{/if}
				</div>

				<div class="mt-4 flex flex-wrap gap-2.5">
					<button
						type="button"
						class="flex min-h-11 items-center gap-2 rounded-full border-2 px-3.5 font-hand text-[18px] leading-none font-bold transition-colors {activeMood ===
						'all'
							? 'border-gold bg-paper text-ink'
							: 'border-[#5A4580] text-[#EDE6F7] hover:border-lav hover:text-white'}"
						onclick={() => (activeMood = 'all')}
						aria-pressed={activeMood === 'all'}
					>
						<CommunityIcon name="sparkles" size={17} class="text-gold" />
						All moods
						<span class="font-ui text-[10px] tabular-nums opacity-60">{basePosts.length}</span>
					</button>

					{#each MOODS as mood (mood.k)}
						<button
							type="button"
							class="flex min-h-11 items-center gap-1.5 rounded-full border-2 py-1 pr-3 pl-2 font-hand text-[18px] leading-none font-bold transition-colors {activeMood ===
							mood.k
								? 'border-gold bg-paper text-ink'
								: 'border-[#5A4580] text-[#EDE6F7] hover:border-lav hover:text-white'}"
							onclick={() => (activeMood = activeMood === mood.k ? 'all' : mood.k)}
							aria-pressed={activeMood === mood.k}
						>
							<span class="size-[26px] shrink-0 [&>svg]:size-full" aria-hidden="true">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
								{@html mood.svg}
							</span>
							{mood.l}
							<span class="font-ui text-[10px] tabular-nums opacity-60"
								>{moodCounts[mood.k] ?? 0}</span
							>
						</button>
					{/each}
				</div>
			</section>
		</div>

		<!-- Joined community rail -->
		<div
			class="sticky top-2 z-20 -mx-4 mt-6 overflow-x-auto border-y border-[#4A3670] bg-desk/90 px-4 py-2 backdrop-blur-sm min-[900px]:mx-0 min-[900px]:rounded-[18px] min-[900px]:border min-[900px]:px-2.5"
		>
			<div class="flex items-center gap-2">
				<span
					class="hidden shrink-0 pr-1 font-ui text-[10px] font-semibold text-[#9B8CB5] min-[900px]:block"
				>
					Your communities
				</span>
				<button
					type="button"
					class="flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 font-ui text-xs font-bold transition-colors {activeSlug ===
					'all'
						? 'border-gold bg-paper text-ink'
						: 'border-[#4D366D] bg-desk-2 text-[#D6CBEC] hover:bg-[#3A275A] hover:text-white'}"
					onclick={() => (activeSlug = 'all')}
					aria-pressed={activeSlug === 'all'}
				>
					<CommunityIcon name="globe" size={14} />
					All joined
					<span class="text-[10px] tabular-nums opacity-60">{memberPosts.length}</span>
				</button>

				{#each community.joinedCommunities as item (item.slug)}
					<button
						type="button"
						class="flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 font-ui text-xs font-bold transition-colors {activeSlug ===
						item.slug
							? 'border-gold bg-paper text-ink'
							: 'border-[#4D366D] bg-desk-2 text-[#D6CBEC] hover:bg-[#3A275A] hover:text-white'}"
						onclick={() => (activeSlug = item.slug)}
						aria-pressed={activeSlug === item.slug}
					>
						<CommunityIcon name={item.icon} size={14} />
						{item.tag}
						<span class="text-[10px] tabular-nums opacity-60">{slugCounts[item.slug] ?? 0}</span>
					</button>
				{/each}

				<button
					type="button"
					class="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-[#6A5490] px-3 py-2 font-ui text-xs font-semibold text-[#C9B8E8] transition-colors hover:border-gold/60 hover:text-white"
					onclick={() => (showDiscovery = true)}
				>
					<CommunityIcon name="plus" size={13} />
					Discover
				</button>
			</div>
		</div>

		<!-- Sort + search -->
		<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap items-center gap-3">
				<div
					class="inline-flex items-center gap-1 rounded-full border border-[#4D366D] bg-desk-2 p-1"
					role="group"
					aria-label="Sort community pages"
				>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'trending'
							? 'bg-accent text-white shadow-sm'
							: 'text-[#D6CBEC] hover:text-white'}"
						onclick={() => (feedMode = 'trending')}
						aria-pressed={feedMode === 'trending'}
					>
						<CommunityIcon name="trending" size={14} />
						Trending
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'newest'
							? 'bg-accent text-white shadow-sm'
							: 'text-[#D6CBEC] hover:text-white'}"
						onclick={() => (feedMode = 'newest')}
						aria-pressed={feedMode === 'newest'}
					>
						<svg
							class="size-[14px]"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9"></circle>
							<path d="M12 7v5l3 2"></path>
						</svg>
						Newest
					</button>
				</div>
				<span class="font-ui text-xs text-[#BBA8E0] tabular-nums">
					{filteredPosts.length}
					{filteredPosts.length === 1 ? 'page' : 'pages'}
				</span>
			</div>

			<div class="relative w-full min-[520px]:w-[300px]">
				<svg
					class="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-[#9B8CB5]"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
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
					aria-label="Search shared community pages"
					placeholder="Search shared pages…"
					class="h-11 w-full rounded-full border border-[#4D366D] bg-desk-2 pr-4 pl-10 font-ui text-sm text-white placeholder:text-[#9B8CB5] focus:border-gold/60 focus:outline-none"
				/>
			</div>
		</div>

		<!-- Feed -->
		{#if community.loading && community.posts.length === 0}
			<div
				class="mt-8 grid items-start gap-x-6 gap-y-10 min-[640px]:grid-cols-2 min-[1180px]:grid-cols-3"
			>
				{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
					<div class="rounded-[5px] bg-paper p-3 pb-3.5 shadow-[0_12px_24px_rgba(0,0,0,.45)]">
						<Skeleton class="aspect-[4/3] w-full rounded-[2px]" />
						<Skeleton class="mt-3 h-4 w-3/4" />
						<Skeleton class="mt-2 h-3 w-1/2" />
						<Skeleton class="mt-4 h-9 w-full rounded-lg" />
					</div>
				{/each}
			</div>
		{:else if filteredPosts.length === 0}
			<div
				class="mx-auto mt-8 max-w-[620px] rounded-[10px] bg-paper px-6 py-10 text-center text-ink shadow-[0_16px_34px_rgba(0,0,0,.4)]"
			>
				<span
					class="mx-auto flex size-16 items-center justify-center rounded-full bg-light"
					style={activeMood !== 'all' ? `background: ${MOOD_BY_KEY[activeMood].c}80` : ''}
				>
					{#if activeMood !== 'all'}
						<span class="size-11 [&>svg]:size-full" aria-hidden="true">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
							{@html MOOD_BY_KEY[activeMood].svg}
						</span>
					{:else}
						<CommunityIcon name="globe" size={28} class="text-accent" />
					{/if}
				</span>
				<p class="mt-4 font-display text-2xl font-bold">No pages here yet</p>
				<p class="mx-auto mt-2 max-w-[420px] font-ui text-sm leading-relaxed text-ink-soft">
					{#if searchQuery.trim()}
						Nothing matched “{searchQuery}”. Try a different search or clear your filters.
					{:else if activeMood !== 'all'}
						No one has shared a {MOOD_BY_KEY[activeMood].l.toLowerCase()} page here yet. Try another mood.
					{:else}
						Be the first to share a page in {activeSlug === 'all'
							? 'your communities'
							: community.tagFor(activeSlug)}.
					{/if}
				</p>
				<div class="mt-5 flex flex-wrap justify-center gap-2.5">
					{#if searchQuery.trim() || activeMood !== 'all' || activeSlug !== 'all'}
						<Button variant="paper" size="sm" onclick={clearFilters}>Clear filters</Button>
					{/if}
					<Button size="sm" trailingIcon="arrow-right" onclick={() => nav.jump(TODAY)}>
						Write today's page
					</Button>
				</div>
			</div>
		{:else}
			<div
				class="mt-8 grid items-start gap-x-6 gap-y-10 min-[640px]:grid-cols-2 min-[1180px]:grid-cols-3"
			>
				{#each filteredPosts as post, index (post.id)}
					{@const tilt = CARD_TILTS[index % CARD_TILTS.length]}
					{@const mood = post.mood && MOOD_BY_KEY[post.mood] ? MOOD_BY_KEY[post.mood] : null}
					{@const stickers = stickersFor(post)}
					<article
						id="community-page-{post.id}"
						class="group relative min-w-0 rounded-[5px] bg-paper p-3 pb-3.5 text-ink shadow-[0_12px_24px_rgba(0,0,0,.45)] transition-all duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-[0_18px_34px_rgba(0,0,0,.5)] {tilt} {focusPostId ===
						post.id
							? 'ring-4 ring-gold ring-offset-2 ring-offset-desk'
							: ''}"
					>
						<!-- Media / cover -->
						{#if post.videoUrl}
							<div class="relative overflow-hidden rounded-[2px] border border-line bg-[#120A20]">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={post.videoUrl}
									poster={post.videoThumbUrl || undefined}
									controls
									playsinline
									class="max-h-[290px] w-full bg-black object-contain"
								></video>
								<span
									class="pointer-events-none absolute top-2 left-2 rounded-full bg-[#2A1B3D]/80 px-2 py-0.5 font-ui text-[9px] font-bold text-white backdrop-blur-sm"
								>
									{post.tag}
								</span>
							</div>
						{:else if post.videoPath || post.videoName}
							<div
								class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-[2px] border border-line bg-[radial-gradient(ellipse_at_center,#4A2F7A_0%,#190E2B_85%)] text-center text-white"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-white/15 px-2 py-0.5 font-ui text-[9px] font-bold text-white backdrop-blur-sm"
								>
									{post.tag}
								</span>
								<span
									class="flex size-12 items-center justify-center rounded-full bg-white/95 text-accent shadow-lg"
								>
									<CommunityIcon name="play" size={22} />
								</span>
								<p class="mt-2.5 max-w-[82%] font-ui text-sm leading-tight font-semibold">
									{post.videoName || 'A shared video moment'}
								</p>
							</div>
						{:else if mood}
							<div
								class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-[2px] border border-line"
								style="background: radial-gradient(circle at 50% 32%, {mood.c} 0%, #FBF4E4 80%)"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-[#2A1B3D]/75 px-2 py-0.5 font-ui text-[9px] font-bold text-white backdrop-blur-sm"
								>
									{post.tag}
								</span>
								<span
									class="size-24 drop-shadow-[0_6px_10px_rgba(0,0,0,.18)] [&>svg]:size-full"
									aria-hidden="true"
								>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
									{@html mood.svg}
								</span>
								<span class="mt-2 font-hand text-xl leading-none font-bold text-ink">
									feeling {mood.l.toLowerCase()}
								</span>
							</div>
						{:else}
							<div
								class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-[2px] border border-line bg-[linear-gradient(135deg,#F3ECFA,#E4D8F2)]"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-[#2A1B3D]/75 px-2 py-0.5 font-ui text-[9px] font-bold text-white backdrop-blur-sm"
								>
									{post.tag}
								</span>
								<span
									class="flex size-16 items-center justify-center rounded-full bg-paper/80 text-accent shadow-sm"
								>
									<CommunityIcon name={community.iconFor(post.communitySlug)} size={30} />
								</span>
								<span class="mt-2 font-hand text-xl font-bold text-ink">
									{community.nameFor(post.communitySlug)}
								</span>
							</div>
						{/if}

						{#if post.title}
							<h3 class="mt-3 font-hand text-[24px] leading-[1.1] font-bold text-ink">
								{post.title}
							</h3>
						{/if}

						<!-- Author -->
						<div class="mt-2 flex items-center gap-2.5">
							<button
								type="button"
								class="shrink-0 rounded-full"
								onclick={() => openProfile(post.authorId)}
								aria-label="View {post.authorName}'s profile"
							>
								<Avatar
									src={post.authorAvatar}
									name={post.authorName}
									className="size-9"
									textClass="text-base"
									ring="ring-2 ring-gold/40"
								/>
							</button>
							<div class="min-w-0 flex-1">
								<div class="flex min-w-0 items-center gap-1.5">
									<button
										type="button"
										class="truncate font-hand text-lg leading-tight font-bold text-ink hover:text-accent"
										onclick={() => openProfile(post.authorId)}
									>
										{post.authorName}
									</button>
									{#if post.isOwner}
										<span
											class="shrink-0 rounded-full bg-[#3F7A4F]/15 px-1.5 py-0.5 font-ui text-[9px] font-bold text-[#2F6B45]"
										>
											You
										</span>
									{/if}
								</div>
								<p class="truncate font-ui text-[10px] text-ink-soft">
									@{post.authorUsername} · {post.dateFormatted}
								</p>
							</div>
							{#if mood}
								<span
									class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 font-ui text-[9px] font-bold text-ink"
									style="background: {mood.c}66; border-color: {mood.c}"
								>
									<span class="size-4 [&>svg]:size-full" aria-hidden="true">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
										{@html mood.svg}
									</span>
									{mood.l}
								</span>
							{/if}
						</div>

						{#if post.mind}
							<div
								class="mt-2.5 rounded border border-line/70 bg-[#FFFDF6] paper-lined [background-position:0_6px] px-2.5 py-1.5"
							>
								<p class="font-hand text-[17px] leading-[32px] whitespace-pre-wrap text-ink">
									{post.mind}
								</p>
							</div>
						{/if}

						{#if post.refl}
							<div
								class="mt-2 flex items-start gap-2 rounded border border-line bg-light/80 px-2.5 py-2"
							>
								<span class="text-sm font-bold text-gold" aria-hidden="true">
									<CommunityIcon name="star" size={14} />
								</span>
								<div class="min-w-0">
									<span class="block font-ui text-[10px] font-semibold text-accent">Reflection</span
									>
									<p class="mt-0.5 font-hand text-base leading-snug font-semibold text-ink">
										{post.refl}
									</p>
								</div>
							</div>
						{/if}

						{#if stickers.length > 0}
							<div class="mt-2.5 flex items-center gap-1 border-t border-line/60 pt-2.5">
								{#each stickers as sticker, i (i)}
									<span
										class="inline-block w-8 {sticker.flat
											? 'sticker-flat'
											: 'sticker-shadow'} [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
										style="transform: rotate({stickerTilt(sticker.rot, i)}deg)"
										aria-hidden="true"
									>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static sticker SVG from app data -->
										{@html sticker.svg}
									</span>
								{/each}
							</div>
						{/if}

						<!-- Reactions + notes -->
						<div
							class="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2.5"
						>
							<div class="flex flex-wrap items-center gap-1">
								{#each REACTIONS as reaction (reaction.key)}
									<button
										type="button"
										class="inline-flex items-center gap-1 rounded-full border px-2 py-1 font-ui text-[10px] font-bold transition-all active:scale-95 {post.userReactions.includes(
											reaction.key
										)
											? reaction.active
											: 'border-line bg-[#FFFDF6] text-ink-soft hover:bg-light'}"
										onclick={() => community.toggleReaction(post, reaction.key)}
										aria-label={reaction.label}
										aria-pressed={post.userReactions.includes(reaction.key)}
									>
										<CommunityIcon name={reaction.icon} size={12} />
										<span class="tabular-nums">{post.reactions[reaction.key]}</span>
									</button>
								{/each}
							</div>
							<button
								type="button"
								class="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#FFFDF6] px-2.5 py-1 font-ui text-[10px] font-bold text-accent transition-colors hover:bg-light"
								onclick={() => toggleComments(post.id)}
								aria-expanded={openComments === post.id}
							>
								<svg
									class="size-3.5"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
								</svg>
								Notes <span class="tabular-nums">({post.comments.length})</span>
							</button>
							{#if post.isOwner || post.authorId === auth.ownerId}
								<button
									type="button"
									class="inline-flex items-center gap-1.5 rounded-full border border-[#D19A9A] bg-[#FFFDF6] px-2.5 py-1 font-ui text-[10px] font-bold text-[#9A5B5B] transition-colors hover:bg-[#FBEAEA]"
									onclick={() => requestDelete(post)}
									aria-label="Remove page from this community"
									title="Remove page from this community"
								>
									<CommunityIcon name="user-minus" size={12} />
									Remove
								</button>
							{/if}
						</div>

						{#if openComments === post.id}
							<div class="mt-2.5 rounded-xl border border-line bg-[#FFFDF6]">
								<div class="p-2.5">
									<span class="mb-2 block font-ui text-[10px] font-semibold text-ink-soft">
										Community notes
									</span>

									{#if post.comments.length > 0}
										<div class="mb-2.5 max-h-[240px] space-y-2 overflow-y-auto pr-1">
											{#each post.comments as comment (comment.id)}
												<div class="flex items-start gap-2 rounded-lg bg-light/80 p-2">
													<Avatar
														src={comment.authorAvatar}
														name={comment.authorName}
														className="size-6"
														textClass="text-xs"
														ring=""
													/>
													<div class="min-w-0 flex-1">
														<div class="flex items-baseline justify-between gap-2">
															<div class="flex min-w-0 items-baseline gap-1.5">
																<button
																	type="button"
																	class="truncate font-ui text-[11px] font-semibold text-ink hover:underline"
																	onclick={() => openProfile(comment.authorId)}
																>
																	{comment.authorName}
																</button>
																{#if comment.authorId === auth.ownerId}
																	<span
																		class="rounded-full bg-accent/15 px-1.5 py-0.5 font-ui text-[8px] font-bold text-accent"
																		>You</span
																	>
																{/if}
															</div>
															<time class="shrink-0 font-ui text-[9px] text-ink-soft"
																>{comment.time}</time
															>
														</div>
														<p
															class="mt-0.5 font-hand text-base leading-tight break-words text-ink"
														>
															{censor(comment.text)}
														</p>
														{#if !comment.id.startsWith('local-')}
															<div class="mt-1">
																{#if comment.authorId === auth.ownerId}
																	{#if commentConfirmId === comment.id}
																		<div class="flex flex-wrap items-center gap-2">
																			<span class="font-ui text-[9px] font-semibold text-[#9A5B5B]"
																				>Delete this note?</span
																			>
																			<button
																				type="button"
																				class="rounded-md bg-[#9A5B5B] px-1.5 py-0.5 font-ui text-[9px] font-bold text-white hover:bg-[#7E4747]"
																				onclick={() => deleteComment(post, comment.id)}
																			>
																				Yes, delete
																			</button>
																			<button
																				type="button"
																				class="rounded-md border border-line px-1.5 py-0.5 font-ui text-[9px] font-semibold text-ink-soft hover:bg-light"
																				onclick={() => (commentConfirmId = null)}
																			>
																				Cancel
																			</button>
																		</div>
																	{:else}
																		<button
																			type="button"
																			class="font-ui text-[9px] text-ink-soft hover:text-red-600"
																			onclick={() => (commentConfirmId = comment.id)}
																		>
																			Delete
																		</button>
																	{/if}
																{:else}
																	<button
																		type="button"
																		class="font-ui text-[9px] text-ink-soft hover:text-accent"
																		onclick={() => reportComment(post, comment.id)}
																	>
																		Report
																	</button>
																{/if}
															</div>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="mb-2.5 font-hand text-base leading-snug text-ink-soft">
											No notes yet. Be the first to cheer them on.
										</p>
									{/if}

									<form
										class="flex items-center gap-2"
										onsubmit={(event) => submitComment(post, event)}
									>
										<input
											bind:value={commentInput[post.id]}
											type="text"
											aria-label="Leave a note on {firstName(post.authorName)}'s page"
											placeholder="Cheer them on…"
											maxlength="140"
											class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 font-ui text-[11px] text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
										/>
										<button
											type="submit"
											class="h-9 rounded-lg bg-accent px-3 font-ui text-[11px] font-bold text-white transition-colors hover:bg-[#624690] disabled:opacity-50"
											disabled={!commentInput[post.id]?.trim()}
										>
											Send
										</button>
									</form>
								</div>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		{/if}

		<!-- Share callout -->
		<div
			class="mx-auto mt-12 max-w-[760px] rounded-[8px] bg-paper px-6 py-7 text-center text-ink shadow-[0_14px_30px_rgba(0,0,0,.4)]"
		>
			<h2 class="font-display text-2xl font-bold">Want your page in the feed?</h2>
			<p class="mx-auto mt-2 max-w-[520px] font-ui text-sm leading-relaxed text-ink-soft">
				Set a journal page to <span class="font-semibold text-accent">Community</span>, then pick
				one of your joined communities. You choose what gets shared.
			</p>
			<Button class="mt-4" trailingIcon="arrow-right" onclick={() => nav.jump(TODAY)}>
				Go to today's page
			</Button>
		</div>
	{/if}

	<!-- Safety note -->
	<p
		class="mx-auto mt-10 flex max-w-[760px] items-start gap-2.5 font-ui text-xs leading-relaxed text-[#CFC3E6]"
	>
		<CommunityIcon name="shield" size={18} class="mt-0.5 shrink-0 text-gold" />
		<span>
			Be kind. If a note feels unsafe, use its Report link. Community pages are only visible to
			members of the communities they were shared with.
		</span>
	</p>
</div>

<!-- Remove from community confirmation -->
{#if deleteTarget}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="remove-page-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={() => (deleteTarget = null)}
			aria-label="Close remove page dialog"
		></button>

		<div
			class="relative z-10 w-full max-w-[430px] overflow-hidden rounded-[26px] border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,#34214E,#231438)] px-5 py-4 text-white"
			>
				<div>
					<h2 id="remove-page-title" class="font-display text-xl font-bold">Remove this page?</h2>
					<p class="font-ui text-[11px] text-[#C9B8E8]">Only the community copy is removed</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={() => (deleteTarget = null)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-5">
				<div class="rounded-xl border border-line bg-[#FFFDF6] p-3">
					<p class="font-ui text-[10px] font-semibold text-ink-soft">
						{deleteTarget.dateFormatted}
					</p>
					<p class="mt-1 font-display text-lg leading-tight font-bold text-ink">
						{deleteTarget.title || 'Untitled page'}
					</p>
					{#if deleteTarget.communitySlug}
						<p class="mt-1 font-ui text-[11px] text-ink-soft">{deleteTarget.tag}</p>
					{/if}
				</div>

				<p class="mt-4 font-ui text-sm leading-relaxed text-ink-soft">
					This page will stop appearing in the community feed. Your journal entry, video, and
					stickers stay exactly where they are.
				</p>

				<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="paper" onclick={() => (deleteTarget = null)}>Keep it posted</Button>
					<Button
						variant="danger"
						icon="trash"
						loading={deleteBusy}
						disabled={deleteBusy}
						onclick={confirmDelete}
					>
						{deleteBusy ? 'Removing…' : 'Remove from community'}
					</Button>
				</div>
			</div>
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
