import { track } from '#lib/analytics';
import { auth } from '#lib/state/auth.svelte';
import { journal } from '#lib/state/journal.svelte';
import { moderation } from '#lib/state/moderation.svelte';
import { profile } from '#lib/state/profile.svelte';
import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import { censor } from '#lib/censor';
import { cleanDisplayName, normalizeImageUrl } from '#lib/avatar';
import type {
	Community,
	CommunityMember,
	CommunityPost,
	CommunityRole,
	CommunityRow,
	EntrySong,
	FriendComment,
	FriendPost,
	FriendPostReaction
} from '#lib/types';

const MEMBERSHIP_STORAGE_KEY = 'vidjo-community-memberships';
const SIGNED_URL_TTL = 60 * 60 * 2;

const EMPTY_REACTIONS: FriendPostReaction = { love: 0, spark: 0, warm: 0, proud: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;

type ReactionKey = keyof FriendPostReaction;

type ReactionEntry = {
	counts: FriendPostReaction;
	mine: ReactionKey[];
	/** Epoch ms per cheer, so "this week/month" can count recent reactions. */
	times: Partial<Record<ReactionKey, number[]>>;
};

function emptyReactionEntry(): ReactionEntry {
	return { counts: { ...EMPTY_REACTIONS }, mine: [], times: {} };
}

function reactionTime(time: string | null | undefined): number {
	if (!time) return Date.now();
	const parsed = new Date(time).getTime();
	return Number.isNaN(parsed) ? Date.now() : parsed;
}

type MemberRow = {
	community_slug: string;
	user_id: string;
	role: string;
	created_at: string;
};

const ROLES: CommunityRole[] = ['none', 'member', 'moderator', 'admin', 'owner'];

function safeRole(value: unknown): CommunityRole {
	return ROLES.includes(value as CommunityRole) ? (value as CommunityRole) : 'member';
}

export const COMMUNITY_CATALOG: Omit<
	Community,
	'memberCount' | 'joined' | 'ownerId' | 'rules' | 'myRole'
>[] = [
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
	},
	{
		slug: 'lspustudents',
		name: 'LSPU Students',
		tag: '#LSPUStudents',
		description: 'Students at Laguna State Polytechnic University sharing campus life.',
		icon: 'users',
		color: '#5D8CE8'
	},
	{
		slug: 'musiclovers',
		name: 'Music Lovers',
		tag: '#MusicLovers',
		description: 'Share tracks, playlists, and jam sessions with fellow musicians.',
		icon: 'music',
		color: '#A77BE8'
	},
	{
		slug: 'animelovers',
		name: 'Anime Lovers',
		tag: '#AnimeLovers',
		description: 'Discuss your favorite shows, movies, and manga.',
		icon: 'spark',
		color: '#E46A8A'
	},
	{
		slug: 'bookclub',
		name: 'Book Club',
		tag: '#BookClub',
		description: 'Reading lists, literary discussions, and book recommendations.',
		icon: 'book',
		color: '#3FA37A'
	},
	{
		slug: 'gaming',
		name: 'Gamers Guild',
		tag: '#GamersGuild',
		description: 'Co-op sessions, high scores, and gaming hangouts.',
		icon: 'spark',
		color: '#D4A24C'
	}
];

function isUuid(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function postKey(ownerId: string, pageId: string) {
	return `${ownerId}:${pageId}`;
}

function formatPostDate(date: string) {
	if (date === journal.currentDate) return 'Today';
	const parsed = new Date(`${date}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return date;
	return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function normalizeSong(raw: unknown): EntrySong | null {
	if (!raw || typeof raw !== 'object') return null;
	const song = raw as Record<string, unknown>;
	const uri = typeof song.uri === 'string' ? song.uri : '';
	const name = typeof song.name === 'string' ? song.name.trim() : '';
	if (!uri || !name) return null;
	const artists = typeof song.artists === 'string' ? song.artists.trim() : '';
	const album = typeof song.album === 'string' ? song.album.trim() : '';
	const image = typeof song.image === 'string' ? song.image : '';
	const url = typeof song.url === 'string' ? song.url : '';
	return {
		uri,
		name,
		artists,
		...(album ? { album } : {}),
		...(image ? { image } : {}),
		...(url ? { url } : {})
	};
}

class CommunityState {
	communities = $state<Community[]>([]);
	posts = $state<CommunityPost[]>([]);
	membersBySlug = $state<Record<string, CommunityMember[]>>({});
	pinnedKeys = $state<Record<string, boolean>>({});
	loading = $state(false);
	remote = $state(false);

	private currentUserId = '';
	private reactionMap = $state<Record<string, ReactionEntry>>({});
	private commentMap = $state<Record<string, FriendComment[]>>({});
	private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	get joinedCommunities() {
		return this.communities.filter((community) => community.joined);
	}

	get hasJoined() {
		return this.communities.some((community) => community.joined);
	}

	get joinedSlugs() {
		return new Set(this.joinedCommunities.map((community) => community.slug));
	}

	private isGlobalAdmin() {
		return (profile.profile?.user_role ?? '').trim().toLowerCase() === 'admin';
	}

	roleFor(slug: string): CommunityRole {
		return this.communities.find((community) => community.slug === slug)?.myRole ?? 'none';
	}

	canModerate(slug: string) {
		return ['owner', 'admin', 'moderator'].includes(this.roleFor(slug));
	}

	canManageRoles(slug: string) {
		return ['owner', 'admin'].includes(this.roleFor(slug));
	}

	membersFor(slug: string): CommunityMember[] {
		return this.membersBySlug[slug] ?? [];
	}

	ownerFor(slug: string): CommunityMember | null {
		const ownerId = this.communities.find((community) => community.slug === slug)?.ownerId;
		if (!ownerId) return null;
		return this.membersFor(slug).find((member) => member.userId === ownerId) ?? null;
	}

	moderatorsFor(slug: string): CommunityMember[] {
		return this.membersFor(slug).filter((member) =>
			['owner', 'admin', 'moderator'].includes(member.role)
		);
	}

	pinKey(slug: string, ownerId: string, pageId: string) {
		return `${slug}:${ownerId}:${pageId}`;
	}

	isPostPinned(post: CommunityPost) {
		if (!post.communitySlug) return false;
		return Boolean(
			this.pinnedKeys[this.pinKey(post.communitySlug, post.authorId, post.entryId || post.date)]
		);
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

	reactionsFor(ownerId: string, pageId: string): FriendPostReaction {
		return this.reactionMap[postKey(ownerId, pageId)]?.counts ?? { ...EMPTY_REACTIONS };
	}

	mineFor(ownerId: string, pageId: string): (keyof FriendPostReaction)[] {
		return this.reactionMap[postKey(ownerId, pageId)]?.mine ?? [];
	}

	commentsFor(ownerId: string, pageId: string): FriendComment[] {
		return this.commentMap[postKey(ownerId, pageId)] ?? [];
	}

	/** Total cheers on a page within the last `days` days (0 = all time). */
	reactionScoreSince(post: FriendPost, days = 0): number {
		return this.scoreTimes(
			this.reactionMap[postKey(post.authorId, post.entryId || post.date)]?.times,
			days
		);
	}

	/** Total cheers on a comment within the last `days` days (0 = all time). */
	commentReactionScoreSince(comment: FriendComment, days = 0): number {
		return this.scoreTimes(comment.reactionTimes, days);
	}

	private scoreTimes(times: Partial<Record<ReactionKey, number[]>> | undefined, days: number) {
		if (!times) return 0;
		const cutoff = days > 0 ? Date.now() - days * DAY_MS : 0;
		let total = 0;
		for (const values of Object.values(times)) {
			for (const value of values ?? []) {
				if (value >= cutoff) total += 1;
			}
		}
		return total;
	}

	async init(userId: string) {
		if (!userId) return;
		this.currentUserId = userId;
		this.communities = COMMUNITY_CATALOG.map((community) => ({
			...community,
			memberCount: 0,
			joined: this.readLocalMemberships(userId).includes(community.slug),
			ownerId: null,
			rules: '',
			myRole: 'none'
		}));
		await this.refresh();
		this.subscribeRealtime();
	}

	async refresh() {
		if (this.loading) return;
		this.loading = true;

		if (isSupabaseConfigured && auth.signedIn) {
			try {
				const [{ data: rows, error: communityError }, richMembers] = await Promise.all([
					supabase.from('vidjo_communities').select('*').order('sort_order'),
					supabase
						.from('vidjo_community_members')
						.select('community_slug, user_id, role, created_at')
				]);

				if (communityError) throw communityError;

				let members: MemberRow[] = [];
				if (richMembers.error) {
					// Older projects can still join communities until the migration runs.
					const basic = await supabase
						.from('vidjo_community_members')
						.select('community_slug, user_id');
					if (basic.error) throw basic.error;
					members = (basic.data ?? []).map((row) => ({
						community_slug: row.community_slug as string,
						user_id: row.user_id as string,
						role: 'member',
						created_at: ''
					}));
				} else {
					members = (richMembers.data ?? []) as MemberRow[];
				}

				const counts: Record<string, number> = {};
				const mine: string[] = [];
				for (const member of members) {
					counts[member.community_slug] = (counts[member.community_slug] || 0) + 1;
					if (member.user_id === this.currentUserId) mine.push(member.community_slug);
				}

				const catalog = (rows as CommunityRow[] | null) ?? [];
				this.communities = catalog.length
					? catalog.map((community) => {
							const mineRow = members.find(
								(member) =>
									member.community_slug === community.slug && member.user_id === this.currentUserId
							);
							return {
								slug: community.slug,
								name: community.name,
								tag: community.tag,
								description: community.description,
								icon: community.icon,
								color: community.color,
								memberCount: counts[community.slug] || 0,
								joined: mine.includes(community.slug),
								ownerId: community.owner_id ?? null,
								rules: community.rules ?? '',
								myRole: this.isGlobalAdmin() ? 'admin' : mineRow ? safeRole(mineRow.role) : 'none'
							};
						})
					: this.communities;
				this.remote = true;
				await Promise.all([this.loadCommunityMembers(members), this.loadPins()]);
				await this.loadRemotePosts();
			} catch (error) {
				console.warn('[VidJo] Could not load communities from Supabase.', error);
				this.remote = false;
				this.posts = [];
				this.reactionMap = {};
				this.commentMap = {};
				this.membersBySlug = {};
				this.pinnedKeys = {};
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

	private async loadCommunityMembers(members: MemberRow[]) {
		const ids = [...new Set(members.map((member) => member.user_id))].filter(Boolean);
		const { data } = ids.length
			? await supabase
					.from('vidjo_profiles')
					.select('user_id, username, display_name, avatar_url')
					.in('user_id', ids)
			: { data: [] };

		const profiles = new Map(
			(data ?? []).map((item) => [item.user_id as string, item as Record<string, string | null>])
		);

		const grouped: Record<string, CommunityMember[]> = {};
		for (const row of members) {
			const person = profiles.get(row.user_id);
			const member: CommunityMember = {
				userId: row.user_id,
				name: cleanDisplayName(
					(person?.display_name as string) || (person?.username as string) || 'Member'
				),
				username: (person?.username as string) || 'student',
				avatarUrl: normalizeImageUrl((person?.avatar_url as string) || null),
				role:
					this.isGlobalAdmin() && row.user_id === this.currentUserId ? 'admin' : safeRole(row.role),
				joinedAt: row.created_at || ''
			};
			(grouped[row.community_slug] ??= []).push(member);
		}

		for (const list of Object.values(grouped)) {
			list.sort((a, b) => {
				const weight: Record<CommunityRole, number> = {
					owner: 0,
					admin: 1,
					moderator: 2,
					member: 3,
					none: 4
				};
				return weight[a.role] - weight[b.role] || a.name.localeCompare(b.name);
			});
		}

		this.membersBySlug = grouped;
	}

	private async loadPins() {
		try {
			const { data, error } = await supabase
				.from('vidjo_community_pinned_posts')
				.select('community_slug, post_owner_id, post_date, post_entry_id');
			if (error) throw error;

			const keys: Record<string, boolean> = {};
			for (const row of data ?? []) {
				keys[
					this.pinKey(
						row.community_slug as string,
						row.post_owner_id as string,
						(row.post_entry_id as string) || (row.post_date as string)
					)
				] = true;
			}
			this.pinnedKeys = keys;
		} catch {
			// Pins are optional until the community migration is applied.
			this.pinnedKeys = {};
		}
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

	async toggleJoin(slug: string): Promise<boolean> {
		const community = this.communities.find((item) => item.slug === slug);
		if (!community) return false;

		const nextJoined = !community.joined;
		community.joined = nextJoined;
		community.memberCount = Math.max(0, community.memberCount + (nextJoined ? 1 : -1));
		this.communities = [...this.communities];
		this.persistLocalMemberships();

		if (isSupabaseConfigured && auth.signedIn) {
			try {
				const { error } = nextJoined
					? await supabase.from('vidjo_community_members').upsert(
							{
								community_slug: slug,
								user_id: this.currentUserId,
								role: 'member'
							},
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
				return false;
			}
		}

		track(nextJoined ? 'community_joined' : 'community_left');
		journal.toast(nextJoined ? `Joined ${community.tag}` : `Left ${community.tag}`);
		return true;
	}

	/**
	 * Remove a page from the community feed without destroying the journal
	 * entry. Owners keep their private copy; admins can unshare anyone's page
	 * through a SECURITY DEFINER RPC (RLS blocks direct cross-user updates).
	 */
	async deletePost(postId: string): Promise<boolean> {
		const post = this.posts.find((item) => item.id === postId);
		const ownEntryId = postId.startsWith('mine-') ? postId.slice('mine-'.length) : '';
		const ownEntry = ownEntryId ? journal.entries[ownEntryId] : undefined;
		const legacyMineMatch = postId.match(/^mine-(\d{4}-\d{2}-\d{2})$/);
		const legacyCommunityMatch = postId.match(/^community-(.+)-(\d{4}-\d{2}-\d{2})$/);
		const ownerId =
			post?.authorId ||
			(ownEntry || legacyMineMatch ? this.currentUserId : legacyCommunityMatch?.[1]);
		const entryId =
			post?.entryId || ownEntryId || legacyMineMatch?.[1] || legacyCommunityMatch?.[2];
		const entryDate =
			post?.date || ownEntry?.date || legacyMineMatch?.[1] || legacyCommunityMatch?.[2];
		if (!ownerId || !entryId || !entryDate) return false;

		const isMine = ownerId === this.currentUserId;
		const slug =
			post?.communitySlug ||
			ownEntry?.communitySlug ||
			journal.entries[entryId]?.communitySlug ||
			'';
		const isModerator = this.canModerate(slug);

		if (!isMine && !isModerator) {
			journal.toast('You can only remove your own pages.');
			return false;
		}

		// A moderator removing someone else's page uses the community RPC.
		if (!isMine) {
			if (!isSupabaseConfigured || !auth.signedIn || !slug) {
				journal.toast('Community posts need a connection to VidJo.');
				return false;
			}

			try {
				const { data, error } = await supabase.rpc('vidjo_community_unshare_entry', {
					p_slug: slug,
					p_post_owner_id: ownerId,
					p_post_entry_id: entryId
				});
				if (error) throw error;
				if (!data) {
					journal.toast('That page is no longer shared with the community.');
					return false;
				}

				this.posts = this.posts.filter((post) => post.id !== postId);
				journal.toast('Page removed from the community.');
				return true;
			} catch (error) {
				journal.toast('Could not remove that page. Try again.');
				console.warn('[VidJo] Community post removal failed.', error);
				return false;
			}
		}

		const entry = journal.entries[entryId];
		if (entry) {
			// Keep the page shared with friends if it was shared both ways;
			// otherwise it becomes private again.
			entry.privacy = entry.shareWithFriends ? 'friends' : 'private';
			entry.shareWithFriends = false;
			entry.communitySlug = '';
			entry.sample = false;
			journal.queueSave(entryId);

			if (isSupabaseConfigured && auth.signedIn) {
				await journal.flush();
			}

			this.posts = this.posts.filter((post) => post.id !== postId);
			journal.toast('Page removed from the community. Your journal copy is safe.');
			return true;
		}

		if (!isSupabaseConfigured || !auth.signedIn) {
			journal.toast('Community posts need a connection to VidJo.');
			return false;
		}

		try {
			const { error } = await supabase
				.from('vidjo_entries')
				.update({
					privacy: 'private',
					community_slug: null,
					share_with_friends: false
				})
				.eq('owner_id', ownerId)
				.eq('id', entryId);

			if (error) throw error;

			this.posts = this.posts.filter((post) => post.id !== postId);
			journal.toast('Page removed from the community.');
			return true;
		} catch (error) {
			journal.toast('Could not remove that page. Try again.');
			console.warn('[VidJo] Community post removal failed.', error);
			return false;
		}
	}

	private subscribeRealtime() {
		if (!isSupabaseConfigured || !auth.signedIn) return;
		this.unsubscribeRealtime();

		try {
			this.realtimeChannel = supabase
				.channel('vidjo-community-live')
				.on(
					'postgres_changes',
					{ event: '*', schema: 'public', table: 'vidjo_entries' },
					(payload) => {
						const row = (payload.new ?? payload.old) as {
							privacy?: string | null;
							owner_id?: string;
							entry_date?: string;
							id?: string;
						} | null;
						if (row?.owner_id === this.currentUserId) return;
						if (row?.privacy === 'community') {
							this.scheduleRefresh();
							return;
						}

						// Unsharing (community -> friends/private) or deleting a
						// page still has to disappear from every other viewer's feed.
						const owner = row?.owner_id;
						const wasInFeed =
							Boolean(owner && row?.id) &&
							this.posts.some((post) => post.authorId === owner && post.entryId === row?.id);
						if (wasInFeed) this.scheduleRefresh();
					}
				)
				.on(
					'postgres_changes',
					{ event: '*', schema: 'public', table: 'vidjo_community_members' },
					() => this.scheduleRefresh()
				)
				.on(
					'postgres_changes',
					{ event: '*', schema: 'public', table: 'vidjo_community_pinned_posts' },
					() => this.scheduleRefresh()
				)
				.on(
					'postgres_changes',
					{ event: 'UPDATE', schema: 'public', table: 'vidjo_communities' },
					() => this.scheduleRefresh()
				)
				.subscribe();
		} catch {
			// Real-time community updates are non-critical.
		}
	}

	private scheduleRefresh() {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 900);
	}

	private unsubscribeRealtime() {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.realtimeChannel) {
			try {
				supabase.removeChannel(this.realtimeChannel);
			} catch {
				// Ignore cleanup errors.
			}
			this.realtimeChannel = null;
		}
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
				let videoPath = (row.video_path as string | null) ?? '';
				let videoUrl = '';
				let videoThumbPath = (row.video_thumb_path as string | null) ?? '';
				let videoThumbUrl = '';

				if (videoPath) {
					try {
						const { data: signed, error } = await supabase.storage
							.from(VIDEO_BUCKET)
							.createSignedUrl(videoPath, SIGNED_URL_TTL);
						if (error || !signed?.signedUrl) {
							console.warn('[VidJo] Could not sign a community video URL.', {
								path: videoPath,
								status: error?.statusCode ?? null,
								message: error?.message ?? 'No signed URL returned'
							});
							// The file was deleted or is no longer accessible. Treat the
							// post as video-less so the feed stops asking for it.
							videoPath = '';
							videoThumbPath = '';
						} else {
							videoUrl = signed.signedUrl;
						}
					} catch (error) {
						console.warn('[VidJo] Could not sign a community video URL.', error);
						videoPath = '';
						videoThumbPath = '';
					}
				}

				if (videoThumbPath) {
					try {
						const { data: signed, error } = await supabase.storage
							.from(VIDEO_BUCKET)
							.createSignedUrl(videoThumbPath, SIGNED_URL_TTL);
						if (!error && signed?.signedUrl) {
							videoThumbUrl = signed.signedUrl;
						}
					} catch {
						// Posters are optional; fall back to the video's first frame.
					}
				}

				return {
					id: `community-${row.owner_id}-${row.id}`,
					entryId: row.id as string,
					authorId: row.owner_id as string,
					authorName: cleanDisplayName(
						(author?.display_name as string) || (author?.username as string)
					),
					authorUsername: (author?.username as string) || 'student',
					authorAvatar: normalizeImageUrl((author?.avatar_url as string) || null),
					friendCode: (author?.friend_code as string) || undefined,
					date: row.entry_date as string,
					dateFormatted: formatPostDate(row.entry_date as string),
					mood: (row.mood as CommunityPost['mood']) || '',
					title: (row.title as string) || 'Community entry',
					mind: (row.mind as string) || '',
					refl: (row.refl as string) || '',
					stickers: Array.isArray(row.stickers) ? row.stickers : [],
					videoPath,
					videoName: videoPath ? (row.video_name as string) || '' : '',
					videoUrl,
					videoThumbUrl,
					song: normalizeSong((row as { song?: unknown }).song),
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
			supabase
				.from('vidjo_comments')
				.select('*')
				.in('post_owner_id', ids)
				.eq('context', 'community')
				.order('created_at')
		]);

		const reactions: Record<string, ReactionEntry> = {};
		for (const row of reactionRows ?? []) {
			const key = postKey(
				row.post_owner_id as string,
				(row.post_entry_id as string) || (row.post_date as string)
			);
			const entry = reactions[key] ?? emptyReactionEntry();
			const reaction = row.reaction as ReactionKey;
			if (reaction in entry.counts) {
				entry.counts[reaction] += 1;
				if (row.user_id === this.currentUserId) entry.mine.push(reaction);
				(entry.times[reaction] ??= []).push(reactionTime(row.created_at as string));
			}
			reactions[key] = entry;
		}

		const authorIds = [
			...new Set((commentRows ?? []).map((row) => row.author_id as string))
		].filter(Boolean);
		const commentIds = (commentRows ?? []).map((row) => row.id as string).filter(Boolean);

		const [authorResult, commentReactionResult] = await Promise.all([
			authorIds.length > 0
				? supabase
						.from('vidjo_profiles')
						.select('user_id, username, display_name, avatar_url')
						.in('user_id', authorIds)
				: Promise.resolve({ data: null }),
			commentIds.length > 0
				? supabase.from('vidjo_comment_reactions').select('*').in('comment_id', commentIds)
				: Promise.resolve({ data: null })
		]);

		const authorMap = new Map(
			(authorResult.data ?? []).map((author) => [
				author.user_id as string,
				author as Record<string, string | null>
			])
		);

		const commentReactions: Record<string, ReactionEntry> = {};
		for (const row of commentReactionResult.data ?? []) {
			const entry = commentReactions[row.comment_id as string] ?? emptyReactionEntry();
			const reaction = row.reaction as ReactionKey;
			if (reaction in entry.counts) {
				entry.counts[reaction] += 1;
				if (row.user_id === this.currentUserId) entry.mine.push(reaction);
				(entry.times[reaction] ??= []).push(reactionTime(row.created_at as string));
			}
			commentReactions[row.comment_id as string] = entry;
		}

		const comments: Record<string, FriendComment[]> = {};
		for (const row of commentRows ?? []) {
			const key = postKey(
				row.post_owner_id as string,
				(row.post_entry_id as string) || (row.post_date as string)
			);
			const author = authorMap.get(row.author_id as string);
			const created = new Date(row.created_at as string);
			const createdMs = created.getTime();
			const own = (row.author_id as string) === this.currentUserId;
			const cheers = commentReactions[row.id as string] ?? emptyReactionEntry();
			if (!comments[key]) comments[key] = [];
			comments[key].push({
				id: row.id as string,
				authorId: row.author_id as string,
				authorName: own
					? profile.nickname || profile.username || 'You'
					: cleanDisplayName((author?.display_name as string) || (author?.username as string)),
				authorUsername: own ? profile.username : (author?.username as string) || 'student',
				authorAvatar: own
					? normalizeImageUrl(profile.avatarUrl)
					: normalizeImageUrl((author?.avatar_url as string) || null),
				text: row.body as string,
				time: Number.isNaN(createdMs)
					? 'Recently'
					: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
				createdAt: Number.isNaN(createdMs) ? Date.now() : createdMs,
				reactions: cheers.counts,
				userReactions: cheers.mine,
				reactionTimes: cheers.times
			});
		}

		this.reactionMap = reactions;
		this.commentMap = comments;
	}

	async toggleReaction(post: FriendPost, reaction: ReactionKey) {
		const pageId = post.entryId || post.date;
		const key = postKey(post.authorId, pageId);
		const current = this.reactionMap[key] ?? emptyReactionEntry();
		const hasReacted = current.mine.includes(reaction);
		const counts = { ...current.counts };
		const mine = [...current.mine];
		const times = { ...current.times };

		if (hasReacted) {
			counts[reaction] = Math.max(0, counts[reaction] - 1);
			mine.splice(mine.indexOf(reaction), 1);
			times[reaction] = (times[reaction] ?? []).slice(0, -1);
		} else {
			counts[reaction] += 1;
			mine.push(reaction);
			times[reaction] = [...(times[reaction] ?? []), Date.now()];
		}

		this.reactionMap = { ...this.reactionMap, [key]: { counts, mine, times } };

		if (isSupabaseConfigured && auth.user && isUuid(post.authorId)) {
			try {
				if (hasReacted) {
					await supabase
						.from('vidjo_reactions')
						.delete()
						.eq('post_owner_id', post.authorId)
						.eq('post_entry_id', pageId)
						.eq('user_id', auth.user.id)
						.eq('reaction', reaction);
				} else {
					const { error } = await supabase.from('vidjo_reactions').insert({
						post_owner_id: post.authorId,
						post_date: post.date,
						post_entry_id: pageId,
						user_id: auth.user.id,
						reaction
					});
					if (error) throw error;
					track('reaction_added', { surface: 'community' });
				}
			} catch (error) {
				console.warn('[VidJo] Could not save the reaction.', error);
			}
		}
	}

	async addComment(post: FriendPost, text: string) {
		// Keep the text exactly as typed (including repeated spaces and line
		// breaks); only use trim() to decide whether it is empty.
		const raw = text;
		if (!raw.trim()) return;
		const clean = censor(raw);

		const pageId = post.entryId || post.date;
		const key = postKey(post.authorId, pageId);
		const temp: FriendComment = {
			id: `local-${Date.now()}`,
			authorId: auth.ownerId,
			authorName: profile.nickname || profile.username || 'You',
			authorUsername: profile.username || 'student',
			authorAvatar: normalizeImageUrl(profile.avatarUrl),
			text: clean,
			time: 'Just now',
			createdAt: Date.now(),
			reactions: { ...EMPTY_REACTIONS },
			userReactions: [],
			reactionTimes: {}
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
						post_entry_id: pageId,
						context: 'community',
						author_id: auth.user.id,
						// Send the raw text so the database trigger can detect direct
						// abuse and issue a warning, then mask it before storage.
						body: raw
					})
					.select('id')
					.single();

				if (error) throw error;
				track('comment_posted', { surface: 'community' });
				// The trigger may have issued a warning. Surface it right away.
				void moderation.refresh();
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

	async updateComment(post: FriendPost, commentId: string, text: string): Promise<boolean> {
		if (!text.trim()) return false;
		const clean = censor(text);
		const key = postKey(post.authorId, post.entryId || post.date);
		const previous =
			(this.commentMap[key] ?? []).find((c) => c.id === commentId) ??
			post.comments.find((c) => c.id === commentId);
		const previousPostComment = this.posts
			.find((p) => p.id === post.id)
			?.comments.find((c) => c.id === commentId);
		if (!previous) return false;

		this.commentMap = {
			...this.commentMap,
			[key]: (this.commentMap[key] ?? []).map((comment) =>
				comment.id === commentId ? { ...comment, text: clean } : comment
			)
		};
		this.posts = this.posts.map((p) =>
			p.id === post.id
				? {
						...p,
						comments: p.comments.map((comment) =>
							comment.id === commentId ? { ...comment, text: clean } : comment
						)
					}
				: p
		);

		if (
			!isSupabaseConfigured ||
			!auth.user ||
			!isUuid(post.authorId) ||
			commentId.startsWith('local-')
		) {
			return true;
		}

		const { error } = await supabase
			.from('vidjo_comments')
			.update({ body: text })
			.eq('id', commentId)
			.eq('author_id', auth.user.id)
			.eq('context', 'community');

		if (error) {
			console.warn('[VidJo] Could not edit the comment.', error);
			// Roll the optimistic edit back so the UI matches the server.
			const restore = previousPostComment ?? previous;
			this.commentMap = {
				...this.commentMap,
				[key]: (this.commentMap[key] ?? []).map((comment) =>
					comment.id === commentId ? { ...comment, text: restore.text } : comment
				)
			};
			this.posts = this.posts.map((p) =>
				p.id === post.id
					? {
							...p,
							comments: p.comments.map((comment) =>
								comment.id === commentId ? { ...comment, text: restore.text } : comment
							)
						}
					: p
			);
			return false;
		}

		return true;
	}

	async deleteComment(post: FriendPost, commentId: string): Promise<boolean> {
		const key = postKey(post.authorId, post.entryId || post.date);
		const removed =
			(this.commentMap[key] ?? []).find((c) => c.id === commentId) ??
			post.comments.find((c) => c.id === commentId);

		this.commentMap = {
			...this.commentMap,
			[key]: (this.commentMap[key] ?? []).filter((c) => c.id !== commentId)
		};
		this.posts = this.posts.map((p) =>
			p.id === post.id ? { ...p, comments: p.comments.filter((c) => c.id !== commentId) } : p
		);

		if (!isSupabaseConfigured || !auth.user || !isUuid(post.authorId)) return true;

		const { error } = await supabase
			.from('vidjo_comments')
			.delete()
			.eq('id', commentId)
			.eq('context', 'community');

		if (error) {
			console.warn('[VidJo] Could not delete the comment.', error);
			// Roll the optimistic removal back so the UI matches the server.
			if (removed) {
				this.commentMap = {
					...this.commentMap,
					[key]: [...(this.commentMap[key] ?? []), removed]
				};
				this.posts = this.posts.map((p) =>
					p.id === post.id && !p.comments.some((c) => c.id === commentId)
						? { ...p, comments: [...p.comments, removed] }
						: p
				);
			}
			return false;
		}

		return true;
	}

	async reportComment(post: FriendPost, commentId: string, reason: string): Promise<boolean> {
		if (!isSupabaseConfigured || !auth.user || !isUuid(post.authorId)) return false;

		const { error } = await supabase.from('vidjo_comment_reports').insert({
			comment_id: commentId,
			reporter_id: auth.user.id,
			reason
		});

		if (error) {
			console.warn('[VidJo] Could not report the comment.', error);
			return false;
		}

		return true;
	}

	/** Cheer a single note. Counts, "my cheers", and timestamps stay in sync. */
	async toggleCommentReaction(post: FriendPost, comment: FriendComment, reaction: ReactionKey) {
		const key = postKey(post.authorId, post.entryId || post.date);
		const hasReacted = (comment.userReactions ?? []).includes(reaction);
		const counts = { ...(comment.reactions ?? EMPTY_REACTIONS) };
		const mine = [...(comment.userReactions ?? [])];
		const times = { ...(comment.reactionTimes ?? {}) };

		if (hasReacted) {
			counts[reaction] = Math.max(0, counts[reaction] - 1);
			mine.splice(mine.indexOf(reaction), 1);
			times[reaction] = (times[reaction] ?? []).slice(0, -1);
		} else {
			counts[reaction] += 1;
			mine.push(reaction);
			times[reaction] = [...(times[reaction] ?? []), Date.now()];
		}

		const update = (value: FriendComment) =>
			value.id === comment.id
				? { ...value, reactions: counts, userReactions: mine, reactionTimes: times }
				: value;

		this.commentMap = { ...this.commentMap, [key]: (this.commentMap[key] ?? []).map(update) };
		this.posts = this.posts.map((item) =>
			item.id === post.id ? { ...item, comments: item.comments.map(update) } : item
		);

		if (!isSupabaseConfigured || !auth.user || comment.id.startsWith('local-')) return;

		try {
			if (hasReacted) {
				await supabase
					.from('vidjo_comment_reactions')
					.delete()
					.eq('comment_id', comment.id)
					.eq('user_id', auth.user.id)
					.eq('reaction', reaction);
			} else {
				const { error } = await supabase.from('vidjo_comment_reactions').insert({
					comment_id: comment.id,
					user_id: auth.user.id,
					reaction
				});
				if (error) throw error;
			}
		} catch (error) {
			console.warn('[VidJo] Could not save the comment reaction.', error);
		}
	}

	/** Moderator moderation: remove any note, even one authored by someone else. */
	async deleteCommentAsAdmin(post: FriendPost, commentId: string): Promise<boolean> {
		const slug = 'communitySlug' in post ? String(post.communitySlug ?? '') : '';
		const key = postKey(post.authorId, post.entryId || post.date);
		const removed =
			(this.commentMap[key] ?? []).find((comment) => comment.id === commentId) ??
			post.comments.find((comment) => comment.id === commentId);

		this.commentMap = {
			...this.commentMap,
			[key]: (this.commentMap[key] ?? []).filter((comment) => comment.id !== commentId)
		};
		this.posts = this.posts.map((item) =>
			item.id === post.id
				? { ...item, comments: item.comments.filter((comment) => comment.id !== commentId) }
				: item
		);

		if (!isSupabaseConfigured || commentId.startsWith('local-')) return true;

		const communityResult = slug
			? await supabase.rpc('vidjo_community_delete_comment', {
					p_slug: slug,
					p_comment_id: commentId
				})
			: null;
		if (communityResult && !communityResult.error && communityResult.data) return true;

		// Fallback for global admins on projects that have not applied the
		// community migration yet.
		const { data, error } = await supabase.rpc('vidjo_admin_delete_comment', {
			p_comment_id: commentId
		});
		if (!error && data) return true;

		console.warn('[VidJo] Community comment removal failed.', communityResult?.error ?? error);
		if (removed) {
			this.commentMap = {
				...this.commentMap,
				[key]: [...(this.commentMap[key] ?? []), removed]
			};
			this.posts = this.posts.map((item) =>
				item.id === post.id && !item.comments.some((comment) => comment.id === commentId)
					? { ...item, comments: [...item.comments, removed] }
					: item
			);
		}
		return false;
	}

	async setMemberRole(slug: string, userId: string, role: CommunityRole): Promise<boolean> {
		if (!this.canManageRoles(slug) || role === 'none') return false;
		try {
			const { error } = await supabase.rpc('vidjo_community_set_role', {
				p_slug: slug,
				p_user: userId,
				p_role: role
			});
			if (error) throw error;
			journal.toast(role === 'owner' ? 'Community owner updated.' : `Member set to ${role}.`);
			await this.refresh();
			return true;
		} catch (error) {
			journal.toast('Could not change that role.');
			console.warn('[VidJo] Community role update failed.', error);
			return false;
		}
	}

	async removeMember(slug: string, userId: string): Promise<boolean> {
		if (!this.canModerate(slug)) return false;
		try {
			const { error } = await supabase.rpc('vidjo_community_kick_member', {
				p_slug: slug,
				p_user: userId
			});
			if (error) throw error;
			journal.toast('Member removed from this community.');
			await this.refresh();
			return true;
		} catch (error) {
			journal.toast('Could not remove that member.');
			console.warn('[VidJo] Community member removal failed.', error);
			return false;
		}
	}

	async updateRules(slug: string, rules: string): Promise<boolean> {
		if (!['owner', 'admin'].includes(this.roleFor(slug))) return false;
		try {
			const { error } = await supabase.rpc('vidjo_community_update_details', {
				p_slug: slug,
				p_rules: rules.slice(0, 4000)
			});
			if (error) throw error;
			journal.toast('Community rules updated.');
			await this.refresh();
			return true;
		} catch (error) {
			journal.toast('Could not update the rules.');
			console.warn('[VidJo] Community rules update failed.', error);
			return false;
		}
	}

	async togglePin(post: CommunityPost): Promise<boolean> {
		if (!post.communitySlug || !this.canModerate(post.communitySlug)) return false;
		const pageId = post.entryId || post.date;
		const key = this.pinKey(post.communitySlug, post.authorId, pageId);
		const before = Boolean(this.pinnedKeys[key]);
		this.pinnedKeys = { ...this.pinnedKeys, [key]: !before };

		try {
			const { data, error } = await supabase.rpc('vidjo_community_toggle_pin_entry', {
				p_slug: post.communitySlug,
				p_post_owner_id: post.authorId,
				p_post_entry_id: pageId
			});
			if (error) throw error;
			const pinned = typeof data === 'boolean' ? data : !before;
			this.pinnedKeys = { ...this.pinnedKeys, [key]: pinned };
			journal.toast(pinned ? 'Page pinned to the community.' : 'Page unpinned.');
			return true;
		} catch (error) {
			this.pinnedKeys = { ...this.pinnedKeys, [key]: before };
			journal.toast('Could not pin that page.');
			console.warn('[VidJo] Community pin update failed.', error);
			return false;
		}
	}

	async reportPost(post: CommunityPost, reason: string): Promise<boolean> {
		if (!post.communitySlug || !isSupabaseConfigured || !auth.signedIn) return false;
		try {
			const { error } = await supabase.rpc('vidjo_community_report_entry', {
				p_slug: post.communitySlug,
				p_post_owner_id: post.authorId,
				p_post_entry_id: post.entryId || post.date,
				p_reason: reason.slice(0, 240)
			});
			if (error) throw error;
			return true;
		} catch (error) {
			console.warn('[VidJo] Community post report failed.', error);
			return false;
		}
	}

	reset() {
		this.unsubscribeRealtime();
		this.currentUserId = '';
		this.communities = [];
		this.posts = [];
		this.membersBySlug = {};
		this.pinnedKeys = {};
		this.reactionMap = {};
		this.commentMap = {};
		this.remote = false;
		this.loading = false;
	}
}

export const community = new CommunityState();
