import { auth } from '#lib/state/auth.svelte';
import { journal } from '#lib/state/journal.svelte';
import { profile } from '#lib/state/profile.svelte';
import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import type {
	Community,
	CommunityPost,
	CommunityRow,
	FriendComment,
	FriendPost,
	FriendPostReaction
} from '#lib/types';

const MEMBERSHIP_STORAGE_KEY = 'vidjo-community-memberships';
const SIGNED_URL_TTL = 60 * 60 * 2;

const EMPTY_REACTIONS: FriendPostReaction = { love: 0, spark: 0, warm: 0, proud: 0 };

export const COMMUNITY_CATALOG: Omit<Community, 'memberCount' | 'joined'>[] = [
	{
		slug: 'smallwins',
		name: 'Small Wins',
		tag: '#SmallWins',
		description: 'Tiny victories, proud moments, and reasons to keep going.',
		icon: 'spark',
		color: '#D4A24C'
	},
	{
		slug: 'campussunset',
		name: 'Campus Sunset',
		tag: '#CampusSunset',
		description: 'Golden-hour photos, evening walks, and beautiful corners of campus.',
		icon: 'sun',
		color: '#E88C5D'
	},
	{
		slug: 'creativeflow',
		name: 'Creative Flow',
		tag: '#CreativeFlow',
		description: 'Art, music, writing, and every messy work-in-progress in between.',
		icon: 'music',
		color: '#A77BE8'
	},
	{
		slug: 'midtermsurvivals',
		name: 'Midterm Survivors',
		tag: '#MidtermSurvivals',
		description: 'Study plans, exam memes, and surviving the middle of the semester together.',
		icon: 'book',
		color: '#5D8CE8'
	},
	{
		slug: 'mentalhealth',
		name: 'Mental Health',
		tag: '#MentalHealth',
		description: 'Gentle check-ins, coping tips, and a soft place to land.',
		icon: 'heart',
		color: '#E46A8A'
	},
	{
		slug: 'studytogether',
		name: 'Study Together',
		tag: '#StudyTogether',
		description: 'Find study buddies, share focus playlists, and stay accountable.',
		icon: 'users',
		color: '#3FA37A'
	},
	{
		slug: 'greencampus',
		name: 'Green Campus',
		tag: '#GreenCampus',
		description: 'Sustainability projects, plants, and little ways to care for the planet.',
		icon: 'leaf',
		color: '#5CA84F'
	}
];

function isUuid(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function postKey(ownerId: string, date: string) {
	return `${ownerId}:${date}`;
}

function formatPostDate(date: string) {
	if (date === journal.current) return 'Today';
	const parsed = new Date(`${date}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return date;
	return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

class CommunityState {
	communities = $state<Community[]>([]);
	posts = $state<CommunityPost[]>([]);
	loading = $state(false);
	remote = $state(false);

	private currentUserId = '';
	private reactionMap = $state<
		Record<string, { counts: FriendPostReaction; mine: (keyof FriendPostReaction)[] }>
	>({});
	private commentMap = $state<Record<string, FriendComment[]>>({});

	get joinedCommunities() {
		return this.communities.filter((community) => community.joined);
	}

	get hasJoined() {
		return this.communities.some((community) => community.joined);
	}

	get joinedSlugs() {
		return new Set(this.joinedCommunities.map((community) => community.slug));
	}

	tagFor(slug: string) {
		return this.communities.find((community) => community.slug === slug)?.tag || '#General';
	}

	nameFor(slug: string) {
		return this.communities.find((community) => community.slug === slug)?.name || 'General';
	}

	iconFor(slug: string) {
		return this.communities.find((community) => community.slug === slug)?.icon || 'globe';
	}

	reactionsFor(ownerId: string, date: string): FriendPostReaction {
		return this.reactionMap[postKey(ownerId, date)]?.counts ?? { ...EMPTY_REACTIONS };
	}

	mineFor(ownerId: string, date: string): (keyof FriendPostReaction)[] {
		return this.reactionMap[postKey(ownerId, date)]?.mine ?? [];
	}

	commentsFor(ownerId: string, date: string): FriendComment[] {
		return this.commentMap[postKey(ownerId, date)] ?? [];
	}

	async init(userId: string) {
		if (!userId) return;
		this.currentUserId = userId;
		this.communities = COMMUNITY_CATALOG.map((community) => ({
			...community,
			memberCount: 0,
			joined: this.readLocalMemberships(userId).includes(community.slug)
		}));
		await this.refresh();
	}

	async refresh() {
		this.loading = true;

		if (isSupabaseConfigured && auth.signedIn) {
			try {
				const [{ data: rows, error: communityError }, { data: members, error: memberError }] =
					await Promise.all([
						supabase.from('vidjo_communities').select('*').order('sort_order'),
						supabase.from('vidjo_community_members').select('community_slug, user_id')
					]);

				if (communityError) throw communityError;
				if (memberError) throw memberError;

				const counts: Record<string, number> = {};
				const mine: string[] = [];
				for (const member of members ?? []) {
					counts[member.community_slug] = (counts[member.community_slug] || 0) + 1;
					if (member.user_id === this.currentUserId) mine.push(member.community_slug);
				}

				const catalog = (rows as CommunityRow[] | null) ?? [];
				this.communities = catalog.length
					? catalog.map((community) => ({
							slug: community.slug,
							name: community.name,
							tag: community.tag,
							description: community.description,
							icon: community.icon,
							color: community.color,
							memberCount: counts[community.slug] || 0,
							joined: mine.includes(community.slug)
						}))
					: this.communities;
				this.remote = true;
				await this.loadRemotePosts();
			} catch (error) {
				console.warn('[VidJo] Could not load communities from Supabase.', error);
				this.remote = false;
				this.posts = [];
				this.reactionMap = {};
				this.commentMap = {};
				this.applyLocalMemberships();
			}
		} else {
			this.remote = false;
			this.applyLocalMemberships();
		}

		this.loading = false;
	}

	private applyLocalMemberships() {
		const joined = this.readLocalMemberships(this.currentUserId);
		this.communities = this.communities.map((community) => ({
			...community,
			joined: joined.includes(community.slug)
		}));
	}

	private readLocalMemberships(userId: string): string[] {
		try {
			const raw = localStorage.getItem(`${MEMBERSHIP_STORAGE_KEY}:${userId}`);
			if (!raw) return [];
			const parsed = JSON.parse(raw) as unknown;
			return Array.isArray(parsed)
				? parsed.filter((value): value is string => typeof value === 'string')
				: [];
		} catch {
			return [];
		}
	}

	private persistLocalMemberships() {
		if (!this.currentUserId) return;
		try {
			const joined = this.communities.filter((community) => community.joined).map((c) => c.slug);
			localStorage.setItem(
				`${MEMBERSHIP_STORAGE_KEY}:${this.currentUserId}`,
				JSON.stringify(joined)
			);
		} catch {
			// Ignore storage errors
		}
	}

	async toggleJoin(slug: string) {
		const community = this.communities.find((item) => item.slug === slug);
		if (!community) return;

		const nextJoined = !community.joined;
		community.joined = nextJoined;
		community.memberCount = Math.max(0, community.memberCount + (nextJoined ? 1 : -1));
		this.communities = [...this.communities];
		this.persistLocalMemberships();

		if (isSupabaseConfigured && auth.signedIn) {
			try {
				const { error } = nextJoined
					? await supabase
							.from('vidjo_community_members')
							.upsert(
								{ community_slug: slug, user_id: this.currentUserId },
								{ onConflict: 'community_slug,user_id' }
							)
					: await supabase
							.from('vidjo_community_members')
							.delete()
							.eq('community_slug', slug)
							.eq('user_id', this.currentUserId);

				if (error) throw error;
			} catch (error) {
				community.joined = !nextJoined;
				community.memberCount = Math.max(0, community.memberCount + (nextJoined ? -1 : 1));
				this.communities = [...this.communities];
				this.persistLocalMemberships();
				journal.toast('Could not update this community. Try again.');
				console.warn('[VidJo] Community membership update failed.', error);
				return;
			}
		}

		journal.toast(nextJoined ? `Joined ${community.tag}` : `Left ${community.tag}`);
	}

	private async loadRemotePosts() {
		const { data, error } = await supabase
			.from('vidjo_entries')
			.select('*')
			.eq('privacy', 'community')
			.order('entry_date', { ascending: false })
			.limit(100);

		if (error) throw error;

		const rows = (data ?? []).filter((row) => row.owner_id !== this.currentUserId);
		const ownerIds = [...new Set(rows.map((row) => row.owner_id as string))];

		if (ownerIds.length === 0) {
			this.posts = [];
			await this.loadSocial(ownerIds);
			return;
		}

		const { data: profiles, error: profileError } = await supabase
			.from('vidjo_profiles')
			.select('user_id, username, display_name, avatar_url, friend_code')
			.in('user_id', ownerIds);

		if (profileError) throw profileError;

		const profileMap = new Map(
			(profiles ?? []).map((item) => [
				item.user_id as string,
				item as Record<string, string | null>
			])
		);

		const posts: CommunityPost[] = await Promise.all(
			rows.map(async (row) => {
				const author = profileMap.get(row.owner_id as string);
				const videoPath = (row.video_path as string | null) ?? '';
				let videoUrl = '';

				if (videoPath) {
					try {
						const { data: signed } = await supabase.storage
							.from(VIDEO_BUCKET)
							.createSignedUrl(videoPath, SIGNED_URL_TTL);
						videoUrl = signed?.signedUrl || '';
					} catch {
						// Videos are optional.
					}
				}

				return {
					id: `community-${row.owner_id}-${row.entry_date}`,
					authorId: row.owner_id as string,
					authorName:
						(author?.display_name as string) || (author?.username as string) || 'VidJo student',
					authorUsername: (author?.username as string) || 'student',
					authorAvatar: (author?.avatar_url as string) || null,
					friendCode: (author?.friend_code as string) || undefined,
					date: row.entry_date as string,
					dateFormatted: formatPostDate(row.entry_date as string),
					mood: (row.mood as CommunityPost['mood']) || '',
					title: (row.title as string) || 'Community entry',
					mind: (row.mind as string) || '',
					refl: (row.refl as string) || '',
					stickers: Array.isArray(row.stickers) ? row.stickers : [],
					videoPath,
					videoName: (row.video_name as string) || '',
					videoUrl,
					reactions: { ...EMPTY_REACTIONS },
					userReactions: [],
					comments: [],
					communitySlug: (row.community_slug as string) || '',
					tag: this.tagFor((row.community_slug as string) || ''),
					isOwner: false
				};
			})
		);

		this.posts = posts;
		await this.loadSocial(ownerIds);
	}

	private async loadSocial(ownerIds: string[]) {
		const ids = [...new Set([...ownerIds, this.currentUserId].filter(Boolean))];
		if (ids.length === 0 || !isSupabaseConfigured || !auth.signedIn) return;

		const [{ data: reactionRows }, { data: commentRows }] = await Promise.all([
			supabase.from('vidjo_reactions').select('*').in('post_owner_id', ids),
			supabase.from('vidjo_comments').select('*').in('post_owner_id', ids).order('created_at')
		]);

		const reactions: Record<
			string,
			{ counts: FriendPostReaction; mine: (keyof FriendPostReaction)[] }
		> = {};
		for (const row of reactionRows ?? []) {
			const key = postKey(row.post_owner_id as string, row.post_date as string);
			const entry = reactions[key] ?? { counts: { ...EMPTY_REACTIONS }, mine: [] };
			const reaction = row.reaction as keyof FriendPostReaction;
			if (reaction in entry.counts) {
				entry.counts[reaction] += 1;
				if (row.user_id === this.currentUserId) entry.mine.push(reaction);
			}
			reactions[key] = entry;
		}

		const authorIds = [
			...new Set((commentRows ?? []).map((row) => row.author_id as string))
		].filter((id) => id && !ids.includes(id));

		let authorMap = new Map<string, Record<string, string | null>>();
		if (authorIds.length > 0) {
			const { data: authors } = await supabase
				.from('vidjo_profiles')
				.select('user_id, username, display_name, avatar_url')
				.in('user_id', authorIds);
			authorMap = new Map(
				(authors ?? []).map((author) => [
					author.user_id as string,
					author as Record<string, string | null>
				])
			);
		}

		const comments: Record<string, FriendComment[]> = {};
		for (const row of commentRows ?? []) {
			const key = postKey(row.post_owner_id as string, row.post_date as string);
			const author = authorMap.get(row.author_id as string);
			const created = new Date(row.created_at as string);
			if (!comments[key]) comments[key] = [];
			comments[key].push({
				id: row.id as string,
				authorName:
					(row.author_id as string) === this.currentUserId
						? 'You'
						: (author?.display_name as string) || (author?.username as string) || 'VidJo student',
				authorUsername: (author?.username as string) || 'student',
				authorAvatar: (author?.avatar_url as string) || null,
				text: row.body as string,
				time: Number.isNaN(created.getTime())
					? 'Recently'
					: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
			});
		}

		this.reactionMap = reactions;
		this.commentMap = comments;
	}

	async toggleReaction(post: FriendPost, reaction: 'love' | 'spark' | 'warm' | 'proud') {
		const key = postKey(post.authorId, post.date);
		const current = this.reactionMap[key] ?? { counts: { ...EMPTY_REACTIONS }, mine: [] };
		const hasReacted = current.mine.includes(reaction);
		const counts = { ...current.counts };
		const mine = [...current.mine];

		if (hasReacted) {
			counts[reaction] = Math.max(0, counts[reaction] - 1);
			mine.splice(mine.indexOf(reaction), 1);
		} else {
			counts[reaction] += 1;
			mine.push(reaction);
		}

		this.reactionMap = { ...this.reactionMap, [key]: { counts, mine } };

		if (isSupabaseConfigured && auth.user && isUuid(post.authorId)) {
			try {
				if (hasReacted) {
					await supabase
						.from('vidjo_reactions')
						.delete()
						.eq('post_owner_id', post.authorId)
						.eq('post_date', post.date)
						.eq('user_id', auth.user.id)
						.eq('reaction', reaction);
				} else {
					await supabase.from('vidjo_reactions').insert({
						post_owner_id: post.authorId,
						post_date: post.date,
						user_id: auth.user.id,
						reaction
					});
				}
			} catch (error) {
				console.warn('[VidJo] Could not save the reaction.', error);
			}
		}
	}

	async addComment(post: FriendPost, text: string) {
		const clean = text.trim();
		if (!clean) return;

		const key = postKey(post.authorId, post.date);
		const temp: FriendComment = {
			id: `local-${Date.now()}`,
			authorName: 'You',
			authorUsername: profile.username || 'student',
			authorAvatar: profile.avatarUrl,
			text: clean,
			time: 'Just now'
		};

		this.commentMap = {
			...this.commentMap,
			[key]: [...(this.commentMap[key] ?? []), temp]
		};

		if (isSupabaseConfigured && auth.user && isUuid(post.authorId)) {
			try {
				const { data, error } = await supabase
					.from('vidjo_comments')
					.insert({
						post_owner_id: post.authorId,
						post_date: post.date,
						author_id: auth.user.id,
						body: clean
					})
					.select('id')
					.single();

				if (error) throw error;
				this.commentMap = {
					...this.commentMap,
					[key]: (this.commentMap[key] ?? []).map((comment) =>
						comment.id === temp.id
							? { ...comment, id: (data?.id as string) || comment.id }
							: comment
					)
				};
			} catch (error) {
				console.warn('[VidJo] Could not save the comment.', error);
			}
		}
	}

	reset() {
		this.currentUserId = '';
		this.communities = [];
		this.posts = [];
		this.reactionMap = {};
		this.commentMap = {};
		this.remote = false;
		this.loading = false;
	}
}

export const community = new CommunityState();
