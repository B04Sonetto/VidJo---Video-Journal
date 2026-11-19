<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { todayKey } from '#lib/dates';
	import { onMount } from 'svelte';
	import { MOODS, MOOD_BY_KEY } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import CommunityPostDetail from '#lib/components/CommunityPostDetail.svelte';
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
	type FeedMode = 'hot' | 'top' | 'week' | 'month' | 'newest';
	type CommentSort = 'newest' | 'top' | 'week' | 'month';

	let feedMode = $state<FeedMode>('hot');
	let commentSort = $state<CommentSort>('newest');
	let commentInput = $state<Record<string, string>>({});
	let openComments = $state<string | null>(null);
	let detailPostId = $state<string | null>(null);
	let profileModalOpen = $state(false);
	let viewedUserId = $state<string | null>(null);
	let showDiscovery = $state(false);
	let focusPostId = $state<string | null>(null);
	let lastCommentTime = $state<Record<string, number>>({});
	let deleteTarget = $state<CommunityPost | null>(null);
	let deleteBusy = $state(false);
	let videoRemoveAck = $state(false);
	let deleteHasVideo = $derived(
		Boolean(deleteTarget?.videoUrl || deleteTarget?.videoPath || deleteTarget?.videoName)
	);
	let commentConfirmId = $state<string | null>(null);
	let editingCommentId = $state<string | null>(null);
	let editCommentText = $state('');

	const COMMENT_MAX = 140;

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
		for (const char of `${todayKey()}-community`) {
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

	const isAdmin = $derived((profile.profile?.user_role ?? '').trim().toLowerCase() === 'admin');

	// Look the detail post up by id so reactions/comments stay live in the modal.
	let detailPost = $derived(
		detailPostId ? (allPosts.find((post) => post.id === detailPostId) ?? null) : null
	);

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

	const DAY_MS = 24 * 60 * 60 * 1000;

	function totalCheers(value: FriendPostReaction) {
		return value.love + value.spark + value.warm + value.proud;
	}

	function scoreFor(post: CommunityPost, days: number) {
		return days > 0 ? community.reactionScoreSince(post, days) : totalCheers(post.reactions);
	}

	function hotScore(post: CommunityPost) {
		const posted = new Date(`${post.date}T00:00:00`).getTime();
		const ageDays = Number.isNaN(posted) ? 0 : Math.max(0, (Date.now() - posted) / DAY_MS);
		return (
			(totalCheers(post.reactions) + post.comments.length * 0.75) / Math.pow(ageDays + 2, 1.35)
		);
	}

	function sortedComments(post: CommunityPost) {
		const list = [...post.comments];
		if (commentSort === 'newest') {
			return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
		}
		const days = commentSort === 'week' ? 7 : commentSort === 'month' ? 30 : 0;
		return list.sort(
			(a, b) =>
				community.commentReactionScoreSince(b, days) -
					community.commentReactionScoreSince(a, days) || (b.createdAt ?? 0) - (a.createdAt ?? 0)
		);
	}

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
			const byDate = b.date.localeCompare(a.date);
			if (feedMode === 'week') return scoreFor(b, 7) - scoreFor(a, 7) || byDate;
			if (feedMode === 'month') return scoreFor(b, 30) - scoreFor(a, 30) || byDate;
			if (feedMode === 'top') return scoreFor(b, 0) - scoreFor(a, 0) || byDate;
			if (feedMode === 'hot') return hotScore(b) - hotScore(a) || byDate;
			return byDate;
		});
	});

	let feedVisible = $derived(community.hasJoined && !showDiscovery);

	function toggleComments(id: string) {
		openComments = openComments === id ? null : id;
	}

	function openDetail(post: CommunityPost) {
		detailPostId = post.id;
	}

	function openDetailProfile(userId: string) {
		detailPostId = null;
		openProfile(userId);
	}

	function requestRemoveFromDetail(post: CommunityPost) {
		detailPostId = null;
		requestDelete(post);
	}

	function submitComment(post: CommunityPost, event: SubmitEvent) {
		event.preventDefault();
		const text = commentInput[post.id] ?? '';
		if (!text.trim()) return;

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

	async function deleteComment(post: CommunityPost, commentId: string, isAuthor: boolean) {
		commentConfirmId = null;
		const ok = isAuthor
			? await community.deleteComment(post, commentId)
			: await community.deleteCommentAsAdmin(post, commentId);
		journal.toast(ok ? 'Note deleted' : 'Could not delete the note. Please try again.');
	}

	function startEditComment(commentId: string, text: string) {
		commentConfirmId = null;
		editingCommentId = commentId;
		editCommentText = text;
	}

	function cancelEditComment() {
		editingCommentId = null;
		editCommentText = '';
	}

	async function saveEditComment(post: CommunityPost, commentId: string) {
		if (!editCommentText.trim()) return;
		const ok = await community.updateComment(post, commentId, editCommentText);
		if (ok) {
			editingCommentId = null;
			editCommentText = '';
			journal.toast('Note updated');
		} else {
			journal.toast('Could not update the note. Please try again.');
		}
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
		videoRemoveAck = false;
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
			<Button icon="pen" onclick={() => nav.jump(todayKey())}>Share a page</Button>
		{/snippet}
	</PageHeader>

	{#if community.loading && community.communities.length === 0}
		<div
			class="mt-7 rounded-[10px] note-scrap px-6 py-14 text-center text-book-ink shadow-[0_16px_34px_rgba(0,0,0,.4)]"
			role="status"
		>
			<Spinner size={36} class="mx-auto text-book-accent" />
			<p class="mt-4 font-ui text-sm font-medium text-book-ink/70">Finding communities…</p>
		</div>
	{:else if !community.hasJoined || showDiscovery}
		<!-- Discovery / join view -->
		<section class="relative mt-7">
			<div
				class="pointer-events-none absolute inset-0 bg-gradient-to-br from-book-accent/10 to-cover/30"
			></div>
			<div class="relative z-10 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 class="font-display text-3xl font-bold text-book-bg min-[720px]:text-4xl">
						Communities to join
					</h2>
					<p class="mt-1 max-w-[640px] font-ui text-sm leading-relaxed text-book-bg/65">
						Pick as many as you like. You can leave any time. Your journal pages stay private until
						you choose to share one with a community.
					</p>
				</div>
				<div class="flex items-center gap-3">
					<span class="font-ui text-xs text-book-bg/60 tabular-nums">
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
						class="group relative flex min-w-0 flex-col overflow-hidden rounded-[8px] note-scrap text-book-ink shadow-[0_12px_26px_rgba(0,0,0,.42)] transition-all duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-[0_18px_34px_rgba(0,0,0,.5)] {tilt}"
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
									class="rounded-full bg-paper-deep px-2.5 py-1 font-ui text-[10px] font-semibold text-book-ink/70 tabular-nums"
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
							<p class="font-ui text-xs font-semibold text-book-ink/70">{item.name}</p>
							<p class="mt-2 flex-1 font-ui text-sm leading-relaxed text-book-ink/70">
								{item.description}
							</p>

							<div
								class="mt-3 flex items-center gap-1.5 font-ui text-sm text-book-ink/70 tabular-nums"
							>
								<CommunityIcon name="video" size={14} class="text-book-ink/45" />
								{slugCounts[item.slug] ?? 0}
								{(slugCounts[item.slug] ?? 0) === 1 ? 'shared page' : 'shared pages'}
								visible to you
							</div>

							{#if item.joined}
								<div class="mt-4 grid grid-cols-2 gap-2">
									<Button size="sm" onclick={() => openCommunity(item.slug)}>Open feed</Button>
									<Button size="sm" variant="note" onclick={() => leaveCommunity(item.slug)}>
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
				class="mx-auto w-full max-w-[470px] rounded-[6px] note-scrap px-6 py-6 text-book-ink shadow-[0_12px_24px_rgba(0,0,0,.4)] min-[940px]:mx-0"
			>
				<p class="font-ui text-xs font-semibold note-accent">Today's prompt</p>
				<p class="mt-2 font-hand text-[28px] leading-[1.2] font-bold text-balance text-book-ink">
					{todaysPrompt}
				</p>
				<Button class="mt-4" trailingIcon="arrow-right" onclick={() => nav.jump(todayKey())}>
					Answer with a VidJo
				</Button>
			</section>

			<section class="min-w-0">
				<div class="flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2
							class="font-display text-2xl leading-tight font-bold text-book-bg min-[720px]:text-[28px]"
						>
							Browse by mood
						</h2>
						<p class="mt-0.5 font-ui text-sm text-book-bg/65">
							Showing {activeMood === 'all' ? 'every mood' : MOOD_BY_KEY[activeMood].l} ·
							{feedMode === 'hot'
								? 'hot first'
								: feedMode === 'top'
									? 'top cheered first'
									: feedMode === 'week'
										? 'most popular this week'
										: feedMode === 'month'
											? 'most popular this month'
											: 'newest first'}
						</p>
					</div>
					{#if activeMood !== 'all'}
						<button
							type="button"
							class="font-ui text-xs font-semibold text-book-accent hover:underline"
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
							? 'border-book-accent bg-book-bg text-book-ink'
							: 'border-cover text-book-bg/75 hover:border-book-accent hover:text-book-bg'}"
						onclick={() => (activeMood = 'all')}
						aria-pressed={activeMood === 'all'}
					>
						<CommunityIcon name="sparkles" size={17} class="text-book-accent" />
						All moods
						<span class="font-ui text-[10px] tabular-nums opacity-60">{basePosts.length}</span>
					</button>

					{#each MOODS as mood (mood.k)}
						<button
							type="button"
							class="flex min-h-11 items-center gap-1.5 rounded-full border-2 py-1 pr-3 pl-2 font-hand text-[18px] leading-none font-bold transition-colors {activeMood ===
							mood.k
								? 'border-book-accent bg-book-bg text-book-ink'
								: 'border-cover text-book-bg/75 hover:border-book-accent hover:text-book-bg'}"
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

		<!-- Joined community rail. Solid background: a sticky backdrop-blur made
		     the whole feed repaint on every scroll frame. -->
		<div
			class="sticky top-2 z-20 -mx-4 mt-6 border-y border-cover-edge bg-desk px-4 py-2 min-[900px]:mx-0 min-[900px]:rounded-[18px] min-[900px]:border min-[900px]:px-2.5"
		>
			<div class="flex items-center gap-2">
				<span
					class="hidden shrink-0 pr-1 font-ui text-[10px] font-semibold text-book-bg/45 min-[900px]:block"
				>
					Your communities
				</span>
				<div class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
					<button
						type="button"
						class="flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 font-ui text-xs font-bold transition-colors {activeSlug ===
						'all'
							? 'border-book-accent bg-book-bg text-book-ink'
							: 'border-cover-edge bg-desk-2 text-book-bg/70 hover:bg-cover/40 hover:text-book-bg'}"
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
								? 'border-book-accent bg-book-bg text-book-ink'
								: 'border-cover-edge bg-desk-2 text-book-bg/70 hover:bg-cover/40 hover:text-book-bg'}"
							onclick={() => (activeSlug = item.slug)}
							aria-pressed={activeSlug === item.slug}
						>
							<CommunityIcon name={item.icon} size={14} />
							{item.tag}
							<span class="text-[10px] tabular-nums opacity-60">{slugCounts[item.slug] ?? 0}</span>
						</button>
					{/each}
				</div>

				<!-- Kept outside the scrolling row so Discover is always visible,
				     even when many communities are joined. -->
				<button
					type="button"
					class="flex shrink-0 items-center gap-1.5 rounded-full bg-cta px-3.5 py-2 font-ui text-xs font-bold text-cta-text shadow-sm transition-colors hover:bg-cta-hover"
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
					class="inline-flex flex-wrap items-center gap-1 rounded-full border border-cover-edge bg-desk-2 p-1"
					role="group"
					aria-label="Sort community pages"
				>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'hot'
							? 'bg-cta text-cta-text shadow-sm'
							: 'text-book-bg/70 hover:text-book-bg'}"
						onclick={() => (feedMode = 'hot')}
						aria-pressed={feedMode === 'hot'}
						title="Hot right now — cheers weighted by recency"
					>
						<CommunityIcon name="flame" size={14} />
						Hot
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'top'
							? 'bg-cta text-cta-text shadow-sm'
							: 'text-book-bg/70 hover:text-book-bg'}"
						onclick={() => (feedMode = 'top')}
						aria-pressed={feedMode === 'top'}
						title="Most popular of all time"
					>
						<CommunityIcon name="star" size={14} />
						Top
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'week'
							? 'bg-cta text-cta-text shadow-sm'
							: 'text-book-bg/70 hover:text-book-bg'}"
						onclick={() => (feedMode = 'week')}
						aria-pressed={feedMode === 'week'}
						title="Most popular this week"
					>
						<CommunityIcon name="calendar" size={14} />
						Week
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'month'
							? 'bg-cta text-cta-text shadow-sm'
							: 'text-book-bg/70 hover:text-book-bg'}"
						onclick={() => (feedMode = 'month')}
						aria-pressed={feedMode === 'month'}
						title="Most popular this month"
					>
						<CommunityIcon name="calendar" size={14} />
						Month
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-xs font-bold transition-colors {feedMode ===
						'newest'
							? 'bg-cta text-cta-text shadow-sm'
							: 'text-book-bg/70 hover:text-book-bg'}"
						onclick={() => (feedMode = 'newest')}
						aria-pressed={feedMode === 'newest'}
						title="Newest pages first"
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
				<span class="font-ui text-xs text-book-bg/60 tabular-nums">
					{filteredPosts.length}
					{filteredPosts.length === 1 ? 'page' : 'pages'}
				</span>
			</div>

			<div class="relative w-full min-[520px]:w-[300px]">
				<svg
					class="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-book-bg/45"
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
					class="h-11 w-full rounded-full border border-cover-edge bg-desk-2 pr-4 pl-10 font-ui text-sm text-book-bg placeholder:text-book-bg/40 focus:border-book-accent/60 focus:outline-none"
				/>
			</div>
		</div>

		<!-- Feed -->
		{#if community.loading && community.posts.length === 0}
			<div
				class="mt-8 grid items-start gap-x-6 gap-y-10 min-[640px]:grid-cols-2 min-[1180px]:grid-cols-3"
			>
				{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
					<div class="rounded-[5px] note-scrap p-3 pb-3.5 shadow-[0_12px_24px_rgba(0,0,0,.45)]">
						<Skeleton class="aspect-[4/3] w-full rounded-[2px]" />
						<Skeleton class="mt-3 h-4 w-3/4" />
						<Skeleton class="mt-2 h-3 w-1/2" />
						<Skeleton class="mt-4 h-9 w-full rounded-lg" />
					</div>
				{/each}
			</div>
		{:else if filteredPosts.length === 0}
			<div
				class="mx-auto mt-8 max-w-[620px] rounded-[10px] note-scrap px-6 py-10 text-center text-book-ink shadow-[0_16px_34px_rgba(0,0,0,.4)]"
			>
				<span
					class="mx-auto flex size-16 items-center justify-center rounded-full bg-paper-deep"
					style={activeMood !== 'all' ? `background: ${MOOD_BY_KEY[activeMood].c}80` : ''}
				>
					{#if activeMood !== 'all'}
						<span class="size-11 [&>svg]:size-full" aria-hidden="true">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
							{@html MOOD_BY_KEY[activeMood].svg}
						</span>
					{:else}
						<CommunityIcon name="globe" size={28} class="text-book-accent" />
					{/if}
				</span>
				<p class="mt-4 font-display text-2xl font-bold">No pages here yet</p>
				<p class="mx-auto mt-2 max-w-[420px] font-ui text-sm leading-relaxed text-book-ink/70">
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
						<Button variant="note" size="sm" onclick={clearFilters}>Clear filters</Button>
					{/if}
					<Button size="sm" trailingIcon="arrow-right" onclick={() => nav.jump(todayKey())}>
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
						class="group relative min-w-0 rounded-[5px] note-scrap p-3 pb-3.5 text-book-ink shadow-[0_12px_24px_rgba(0,0,0,.45)] transition-all duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-[0_18px_34px_rgba(0,0,0,.5)] {tilt} {focusPostId ===
						post.id
							? 'ring-4 ring-book-accent ring-offset-2 ring-offset-desk'
							: ''}"
					>
						<!-- Media / cover -->
						{#if post.videoUrl}
							<div class="relative overflow-hidden rounded-[2px] border border-line bg-desk">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={post.videoUrl}
									poster={post.videoThumbUrl || undefined}
									controls
									playsinline
									preload="metadata"
									class="max-h-[290px] w-full modal-video bg-black object-contain"
								></video>
								<span
									class="pointer-events-none absolute top-2 left-2 rounded-full bg-desk/90 px-2 py-0.5 font-ui text-[9px] font-bold text-book-bg"
								>
									{post.tag}
								</span>
							</div>
						{:else if post.videoPath || post.videoName}
							<div
								class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-[2px] border border-line bg-[radial-gradient(ellipse_at_center,var(--color-cover)_0%,var(--color-desk)_85%)] text-center text-book-bg"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-cover/85 px-2 py-0.5 font-ui text-[9px] font-bold text-book-bg"
								>
									{post.tag}
								</span>
								<span
									class="flex size-12 items-center justify-center rounded-full bg-book-bg/95 text-book-ink shadow-lg"
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
								style="background: radial-gradient(circle at 50% 32%, {mood.c} 0%, var(--color-book-bg) 80%)"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-desk/90 px-2 py-0.5 font-ui text-[9px] font-bold text-book-bg"
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
								<span class="mt-2 font-hand text-xl leading-none font-bold text-book-ink">
									feeling {mood.l.toLowerCase()}
								</span>
							</div>
						{:else}
							<div
								class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-[2px] border border-line bg-[linear-gradient(135deg,var(--color-paper-deep),var(--color-book-edge))]"
							>
								<span
									class="absolute top-2 left-2 rounded-full bg-desk/90 px-2 py-0.5 font-ui text-[9px] font-bold text-book-bg"
								>
									{post.tag}
								</span>
								<span
									class="flex size-16 items-center justify-center rounded-full bg-book-bg/80 text-book-ink shadow-sm"
								>
									<CommunityIcon name={community.iconFor(post.communitySlug)} size={30} />
								</span>
								<span class="mt-2 font-hand text-xl font-bold text-book-ink">
									{community.nameFor(post.communitySlug)}
								</span>
							</div>
						{/if}

						{#if post.title}
							<button
								type="button"
								class="mt-3 block w-full text-left font-hand text-[24px] leading-[1.1] font-bold [overflow-wrap:anywhere] break-words text-book-ink hover:text-book-accent"
								onclick={() => openDetail(post)}
								aria-label="Open {post.title || 'page'} full page"
							>
								<span class="line-clamp-2">{censor(post.title)}</span>
							</button>
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
										class="truncate font-hand text-lg leading-tight font-bold text-book-ink hover:text-book-accent"
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
								<p class="truncate font-ui text-[10px] text-book-ink/70">
									@{post.authorUsername} · {post.dateFormatted}
								</p>
							</div>
							{#if mood}
								<span
									class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 font-ui text-[9px] font-bold text-book-ink"
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
								class="mt-2.5 rounded border border-line/70 bg-book-bg paper-lined [background-position:0_6px] px-2.5 py-1.5"
							>
								<p
									class="font-hand text-[17px] leading-[32px] [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink"
								>
									{censor(post.mind)}
								</p>
							</div>
						{/if}

						{#if post.refl}
							<div
								class="mt-2 flex items-start gap-2 rounded border border-line bg-paper-deep/80 px-2.5 py-2"
							>
								<span class="text-sm font-bold text-book-accent" aria-hidden="true">
									<CommunityIcon name="star" size={14} />
								</span>
								<div class="min-w-0">
									<span class="block font-ui text-[10px] font-semibold text-book-accent"
										>Reflection</span
									>
									<p
										class="mt-0.5 font-hand text-base leading-snug font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink"
									>
										{censor(post.refl)}
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
											: 'border-line bg-book-bg text-book-ink/70 hover:bg-paper-deep'}"
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
								class="inline-flex items-center gap-1.5 rounded-full border border-line bg-book-bg px-2.5 py-1 font-ui text-[10px] font-bold text-book-accent transition-colors hover:bg-paper-deep"
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
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-full border border-line bg-book-bg px-2.5 py-1 font-ui text-[10px] font-bold text-book-ink/80 transition-colors hover:bg-paper-deep"
								onclick={() => openDetail(post)}
								aria-label="Open full page"
							>
								<CommunityIcon name="expand" size={12} />
								Full page
							</button>
							{#if post.isOwner || post.authorId === auth.ownerId || isAdmin}
								<button
									type="button"
									class="inline-flex items-center gap-1.5 rounded-full border border-[#D19A9A] bg-book-bg px-2.5 py-1 font-ui text-[10px] font-bold text-[#9A5B5B] transition-colors hover:bg-[#FBEAEA]"
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
							<div class="mt-2.5 rounded-xl border border-line bg-book-bg">
								<div class="p-2.5">
									<span class="mb-2 block font-ui text-[10px] font-semibold text-book-ink/70">
										Community notes
										<label
											class="ml-2 inline-flex items-center gap-1 font-ui text-[9px] font-normal text-book-ink/60"
										>
											Sort
											<select
												bind:value={commentSort}
												aria-label="Sort community notes"
												class="rounded-md border border-line bg-book-bg px-1.5 py-0.5 font-ui text-[9px] font-semibold text-book-ink focus:border-book-accent focus:outline-none"
											>
												<option value="newest">Newest</option>
												<option value="top">Top</option>
												<option value="week">This week</option>
												<option value="month">This month</option>
											</select>
										</label>
									</span>

									{#if post.comments.length > 0}
										<div class="mb-2.5 max-h-[240px] modal-scroll space-y-2 overflow-y-auto pr-1">
											{#each sortedComments(post) as comment (comment.id)}
												<div class="flex items-start gap-2 rounded-lg bg-paper-deep/80 p-2">
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
																	class="truncate font-ui text-[11px] font-semibold text-book-ink hover:underline"
																	onclick={() => openProfile(comment.authorId)}
																>
																	{comment.authorName}
																</button>
																{#if comment.authorId === auth.ownerId}
																	<span
																		class="rounded-full bg-book-accent/15 px-1.5 py-0.5 font-ui text-[8px] font-bold text-book-accent"
																		>You</span
																	>
																{/if}
															</div>
															<time class="shrink-0 font-ui text-[9px] text-book-ink/70"
																>{comment.time}</time
															>
														</div>
														{#if editingCommentId === comment.id}
															<div class="mt-1">
																<textarea
																	bind:value={editCommentText}
																	rows="2"
																	maxlength={COMMENT_MAX}
																	aria-label="Edit your note"
																	class="w-full resize-none rounded-lg border border-line bg-book-bg px-2 py-1.5 font-ui text-[11px] text-book-ink focus:border-book-accent focus:outline-none"
																></textarea>
																<div class="mt-1 flex items-center justify-between gap-2">
																	<span class="font-ui text-[9px] text-book-ink/60 tabular-nums">
																		{editCommentText.length}/{COMMENT_MAX}
																	</span>
																	<div class="flex items-center gap-2">
																		<button
																			type="button"
																			class="rounded-md bg-book-accent px-1.5 py-0.5 font-ui text-[9px] font-bold text-book-bg hover:opacity-90 disabled:opacity-50"
																			onclick={() => saveEditComment(post, comment.id)}
																			disabled={!editCommentText.trim()}
																		>
																			Save
																		</button>
																		<button
																			type="button"
																			class="rounded-md border border-line px-1.5 py-0.5 font-ui text-[9px] font-semibold text-book-ink/70 hover:bg-paper-deep"
																			onclick={cancelEditComment}
																		>
																			Cancel
																		</button>
																	</div>
																</div>
															</div>
														{/if}
														<p
															class="mt-0.5 font-hand text-base leading-tight [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink {editingCommentId ===
															comment.id
																? 'hidden'
																: ''}"
														>
															{censor(comment.text)}
														</p>
														<div class="mt-1.5 flex flex-wrap items-center gap-1">
															{#each REACTIONS as reaction (reaction.key)}
																<button
																	type="button"
																	class="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-ui text-[9px] font-bold transition-colors {(
																		comment.userReactions ?? []
																	).includes(reaction.key)
																		? reaction.active
																		: 'border-line bg-book-bg text-book-ink/60 hover:bg-paper-deep'}"
																	onclick={() =>
																		community.toggleCommentReaction(post, comment, reaction.key)}
																	aria-label={reaction.label}
																	aria-pressed={(comment.userReactions ?? []).includes(
																		reaction.key
																	)}
																>
																	<CommunityIcon name={reaction.icon} size={10} />
																	<span class="tabular-nums"
																		>{comment.reactions?.[reaction.key] ?? 0}</span
																	>
																</button>
															{/each}
														</div>
														{#if !comment.id.startsWith('local-')}
															<div class="mt-1 {editingCommentId === comment.id ? 'hidden' : ''}">
																{#if comment.authorId === auth.ownerId || isAdmin}
																	{#if commentConfirmId === comment.id}
																		<div class="flex flex-wrap items-center gap-2">
																			<span class="font-ui text-[9px] font-semibold text-[#9A5B5B]"
																				>Delete this note?</span
																			>
																			<button
																				type="button"
																				class="rounded-md bg-[#9A5B5B] px-1.5 py-0.5 font-ui text-[9px] font-bold text-white hover:bg-[#7E4747]"
																				onclick={() =>
																					deleteComment(
																						post,
																						comment.id,
																						comment.authorId === auth.ownerId
																					)}
																			>
																				Yes, delete
																			</button>
																			<button
																				type="button"
																				class="rounded-md border border-line px-1.5 py-0.5 font-ui text-[9px] font-semibold text-book-ink/70 hover:bg-paper-deep"
																				onclick={() => (commentConfirmId = null)}
																			>
																				Cancel
																			</button>
																		</div>
																	{:else}
																		{#if comment.authorId === auth.ownerId}
																			<button
																				type="button"
																				class="font-ui text-[9px] text-book-ink/70 hover:text-book-accent"
																				onclick={() => startEditComment(comment.id, comment.text)}
																			>
																				Edit
																			</button>
																		{/if}
																		<button
																			type="button"
																			class="font-ui text-[9px] text-book-ink/70 hover:text-red-600"
																			onclick={() => (commentConfirmId = comment.id)}
																		>
																			{isAdmin && comment.authorId !== auth.ownerId
																				? 'Remove (admin)'
																				: 'Delete'}
																		</button>
																	{/if}
																{:else}
																	<button
																		type="button"
																		class="font-ui text-[9px] text-book-ink/70 hover:text-book-accent"
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
										<p class="mb-2.5 font-hand text-base leading-snug text-book-ink/70">
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
											maxlength={COMMENT_MAX}
											class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-book-bg px-2.5 font-ui text-[11px] text-book-ink placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
										/>
										<span
											class="shrink-0 font-ui text-[9px] text-book-ink/60 tabular-nums"
											aria-hidden="true"
										>
											{commentInput[post.id]?.length ?? 0}/{COMMENT_MAX}
										</span>
										<button
											type="submit"
											class="h-9 rounded-lg bg-cta px-3 font-ui text-[11px] font-bold text-cta-text transition-colors hover:bg-cta-hover disabled:opacity-50"
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
			class="mx-auto mt-12 max-w-[760px] rounded-[8px] note-scrap px-6 py-7 text-center text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.4)]"
		>
			<h2 class="font-display text-2xl font-bold">Want your page in the feed?</h2>
			<p class="mx-auto mt-2 max-w-[520px] font-ui text-sm leading-relaxed text-book-ink/70">
				Set a journal page to <span class="font-semibold text-book-accent">Community</span>, then
				pick one of your joined communities. You choose what gets shared.
			</p>
			<Button class="mt-4" trailingIcon="arrow-right" onclick={() => nav.jump(todayKey())}>
				Go to today's page
			</Button>
		</div>
	{/if}

	<!-- Safety note -->
	<p
		class="mx-auto mt-10 flex max-w-[760px] items-start gap-2.5 font-ui text-xs leading-relaxed text-book-bg/60"
	>
		<CommunityIcon name="shield" size={18} class="mt-0.5 shrink-0 text-book-accent" />
		<span>
			Be kind. If a note feels unsafe, use its Report link. Community pages are only visible to
			members of the communities they were shared with.
		</span>
	</p>
</div>

<!-- Remove from community confirmation -->
{#if deleteTarget}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
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
			class="relative z-10 w-full max-w-[430px] overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-4 text-book-bg"
			>
				<div>
					<h2 id="remove-page-title" class="font-display text-xl font-bold">Remove this page?</h2>
					<p class="font-ui text-[11px] text-book-bg/65">Only the community copy is removed</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
					onclick={() => (deleteTarget = null)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-5">
				<div class="rounded-xl border border-line bg-book-bg p-3">
					<p class="font-ui text-[10px] font-semibold text-book-ink/70">
						{deleteTarget.dateFormatted}
					</p>
					<p class="mt-1 font-display text-lg leading-tight font-bold text-book-ink">
						{deleteTarget.title || 'Untitled page'}
					</p>
					{#if deleteTarget.communitySlug}
						<p class="mt-1 font-ui text-[11px] text-book-ink/70">{deleteTarget.tag}</p>
					{/if}
				</div>

				<p class="mt-4 font-ui text-sm leading-relaxed text-book-ink/70">
					{#if isAdmin && !deleteTarget.isOwner && deleteTarget.authorId !== auth.ownerId}
						This page will stop appearing in the community feed. The author's journal entry, video,
						and stickers stay exactly where they are.
					{:else}
						This page will stop appearing in the community feed. Your journal entry, video, and
						stickers stay exactly where they are.
					{/if}
				</p>

				{#if deleteHasVideo}
					<div class="mt-4 rounded-xl border border-amber-400/60 bg-amber-50/90 p-3">
						<div class="flex items-start gap-2">
							<CommunityIcon name="alert" size={16} class="mt-0.5 shrink-0 text-amber-700" />
							<div>
								<p class="font-ui text-xs font-bold text-amber-900">This page has a video</p>
								<p class="mt-0.5 font-ui text-[11px] leading-relaxed text-amber-900/80">
									Removing the page will also hide its video from the community feed. The author's
									journal copy stays safe.
								</p>
								<label
									class="mt-2 flex items-center gap-2 font-ui text-[11px] font-semibold text-amber-900"
								>
									<input
										type="checkbox"
										bind:checked={videoRemoveAck}
										class="size-3.5 accent-amber-700"
									/>
									I understand the video will be hidden
								</label>
							</div>
						</div>
					</div>
				{/if}

				<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="note" onclick={() => (deleteTarget = null)}>Keep it posted</Button>
					<Button
						variant="danger"
						icon="trash"
						loading={deleteBusy}
						disabled={deleteBusy || (deleteHasVideo && !videoRemoveAck)}
						onclick={confirmDelete}
					>
						{deleteBusy
							? 'Removing…'
							: isAdmin && !deleteTarget.isOwner && deleteTarget.authorId !== auth.ownerId
								? 'Remove as admin'
								: 'Remove from community'}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if detailPost}
	<CommunityPostDetail
		post={detailPost}
		onClose={() => (detailPostId = null)}
		onProfile={openDetailProfile}
		onRemove={requestRemoveFromDetail}
	/>
{/if}

<ProfileModal
	open={profileModalOpen}
	onClose={() => {
		profileModalOpen = false;
		viewedUserId = null;
	}}
	userId={viewedUserId}
/>
