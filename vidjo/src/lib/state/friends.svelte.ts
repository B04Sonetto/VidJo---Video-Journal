import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import { censor } from '#lib/censor';
import type {
	EntryRow,
	Friend,
	FriendComment,
	FriendPost,
	FriendPostReaction,
	FriendRequest
} from '#lib/types';
import { profile } from '#lib/state/profile.svelte';
import { journal } from '#lib/state/journal.svelte';
import { auth } from '#lib/state/auth.svelte';

const FRIENDS_CACHE_KEY = 'vidjo-friends-cache';
const SIGNED_URL_TTL = 60 * 60 * 2;

type ReactionKey = 'love' | 'spark' | 'warm' | 'proud';

const EMPTY_REACTIONS: FriendPostReaction = { love: 0, spark: 0, warm: 0, proud: 0 };

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

class FriendsState {
	friends = $state<Friend[]>([]);
	friendRequests = $state<FriendRequest[]>([]);
	posts = $state<FriendPost[]>([]);
	loading = $state(false);
	remote = $state(false);
	activeFilter = $state<'all' | 'video' | 'written'>('all');
	currentUserId = $state<string>('');
	stories = $state<Friend[]>([]);

	private reactionMap = $state<Record<string, { counts: FriendPostReaction; mine: ReactionKey[] }>>(
		{}
	);
	private commentMap = $state<Record<string, FriendComment[]>>({});
	private initializedFor = '';

	get myFriendCode() {
		return profile.friendCode;
	}

	get incomingRequests() {
		return this.friendRequests.filter((request) => request.direction === 'incoming');
	}

	get outgoingRequests() {
		return this.friendRequests.filter((request) => request.direction === 'outgoing');
	}

	get pendingCount() {
		return this.incomingRequests.length;
	}

	get filteredPosts() {
		if (this.activeFilter === 'video') {
			return this.posts.filter((post) =>
				Boolean(post.videoUrl || post.videoName || post.videoPath)
			);
		}
		if (this.activeFilter === 'written') {
			return this.posts.filter((post) => !post.videoUrl && !post.videoName && !post.videoPath);
		}
		return this.posts;
	}

	get friendCount() {
		return this.friends.length;
	}

	async init(userId: string) {
		if (!userId) return;
		if (this.initializedFor === userId && this.loading) return;

		this.initializedFor = userId;
		this.currentUserId = userId;
		this.loading = true;
		this.remote = false;
		this.friends = [];
		this.friendRequests = [];
		this.posts = [];
		this.stories = [];
		this.reactionMap = {};
		this.commentMap = {};

		if (isSupabaseConfigured && auth.signedIn) {
			try {
				await this.refreshRemote();
				this.remote = true;
			} catch (error) {
				console.warn('[VidJo] Could not load friends from Supabase.', error);
				this.remote = false;
				this.loadCachedFriends();
				this.posts = this.getMyFriendsEntries();
			}
		} else {
			this.loadCachedFriends();
			this.posts = this.getMyFriendsEntries();
		}

		this.loading = false;

		try {
			const pending = localStorage.getItem('vidjo-pending-friendcode');
			if (pending) {
				localStorage.removeItem('vidjo-pending-friendcode');
				await this.addFriendByCode(pending);
			}
		} catch {
			// Ignore local storage restrictions.
		}
	}

	private async refreshRemote() {
		const userId = auth.user?.id || this.currentUserId;
		if (!userId) throw new Error('You must be signed in.');

		const { data: friendRows, error: friendError } = await supabase
			.from('vidjo_friends')
			.select('friend_id')
			.eq('user_id', userId)
			.eq('status', 'accepted');

		if (friendError) throw friendError;

		const friendIds = [
			...new Set((friendRows ?? []).map((row) => row.friend_id as string).filter(Boolean))
		];

		let friendProfiles: Friend[] = [];
		if (friendIds.length > 0) {
			const { data: profiles, error: profileError } = await supabase
				.from('vidjo_profiles')
				.select('user_id, username, display_name, bio, avatar_url, friend_code')
				.in('user_id', friendIds);

			if (profileError) throw profileError;

			friendProfiles = (profiles ?? []).map((row) => ({
				id: row.user_id as string,
				username: (row.username as string) || 'student',
				displayName: (row.display_name as string) || (row.username as string) || 'VidJo student',
				avatarUrl: (row.avatar_url as string) || null,
				bio: (row.bio as string) || '',
				friendCode: (row.friend_code as string) || '',
				status: 'accepted'
			}));
		}

		this.friends = friendProfiles;
		this.persistFriendsCache();
		this.friendRequests = await this.loadRequests(userId);

		const remotePosts = await this.loadFriendPosts(friendIds);
		const ownPosts = this.getMyFriendsEntries();
		const all = [...ownPosts, ...remotePosts].sort((a, b) => b.date.localeCompare(a.date));

		await this.applySocial(all);
		this.stories = this.friends.slice(0, 8).map((friend) => ({
			...friend,
			hasNewPost: this.posts.some((post) => post.authorId === friend.id)
		}));
	}

	private async loadRequests(userId: string): Promise<FriendRequest[]> {
		const { data, error } = await supabase
			.from('vidjo_friend_requests')
			.select('*')
			.eq('status', 'pending');

		if (error) throw error;

		const rows = data ?? [];
		const otherIds = [
			...new Set(
				rows
					.map((row) =>
						(row.from_user as string) === userId
							? (row.to_user as string)
							: (row.from_user as string)
					)
					.filter(Boolean)
			)
		];

		const profileMap: Record<string, Record<string, unknown>> = {};
		if (otherIds.length > 0) {
			const { data: profiles } = await supabase
				.from('vidjo_profiles')
				.select('user_id, username, display_name, bio, avatar_url, friend_code')
				.in('user_id', otherIds);

			for (const item of profiles ?? []) {
				profileMap[item.user_id as string] = item as Record<string, unknown>;
			}
		}

		return rows.map((row) => {
			const incoming = (row.to_user as string) === userId;
			const otherId = incoming ? (row.from_user as string) : (row.to_user as string);
			const other = profileMap[otherId];
			const otherName =
				(other?.display_name as string) || (other?.username as string) || 'VidJo student';

			return {
				id: row.id as string,
				fromUserId: row.from_user as string,
				toUserId: row.to_user as string,
				fromUsername: (other?.username as string) || '',
				fromDisplayName: otherName,
				fromAvatarUrl: (other?.avatar_url as string) || null,
				fromBio: (other?.bio as string) || '',
				fromFriendCode: (other?.friend_code as string) || undefined,
				toFriendCode: incoming
					? profile.profile?.friend_code || profile.friendCode
					: (other?.friend_code as string) || undefined,
				toUsername: (other?.username as string) || '',
				toDisplayName: otherName,
				toAvatarUrl: (other?.avatar_url as string) || null,
				status: 'pending' as const,
				direction: incoming ? ('incoming' as const) : ('outgoing' as const),
				createdAt: row.created_at as string
			};
		});
	}

	private async loadFriendPosts(friendIds: string[]): Promise<FriendPost[]> {
		if (friendIds.length === 0) return [];
		const viewerId = this.currentUserId || auth.ownerId;

		const { data, error } = await supabase
			.from('vidjo_entries')
			.select('*')
			.in('privacy', ['friends', 'community'])
			.in('owner_id', friendIds)
			.order('entry_date', { ascending: false })
			.limit(100);

		if (error) throw error;

		const rows = ((data ?? []) as EntryRow[]).filter((row) => {
			const excluded = Array.isArray(row.excluded_friend_ids) ? row.excluded_friend_ids : [];
			const included = Array.isArray(row.included_friend_ids) ? row.included_friend_ids : [];
			if (excluded.includes(viewerId)) return false;
			if (row.privacy === 'private' && !included.includes(viewerId)) return false;
			// Community posts only cross into the friends feed when share_with_friends is set.
			if (row.privacy === 'community' && !(row.share_with_friends ?? false)) return false;
			return row.title || row.mind || row.refl || row.video_path;
		});
		const friendMap = new Map(this.friends.map((friend) => [friend.id, friend]));

		return Promise.all(
			rows.map(async (row) => {
				const author = friendMap.get(row.owner_id);
				const videoPath = row.video_path || '';
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
					id: `friend-${row.owner_id}-${row.entry_date}`,
					authorId: row.owner_id,
					authorName: author?.displayName || author?.username || 'VidJo student',
					authorUsername: author?.username || 'student',
					authorAvatar: author?.avatarUrl || null,
					friendCode: author?.friendCode || undefined,
					date: row.entry_date,
					dateFormatted: formatPostDate(row.entry_date),
					mood: row.mood || '',
					title: row.title || 'Journal entry',
					mind: row.mind || '',
					refl: row.refl || '',
					stickers: row.stickers || [],
					videoPath,
					videoName: row.video_name || '',
					videoUrl,
					reactions: { ...EMPTY_REACTIONS },
					userReactions: [],
					comments: [],
					isOwner: false
				};
			})
		);
	}

	private getMyFriendsEntries(): FriendPost[] {
		const out: FriendPost[] = [];
		const myName = profile.displayName;
		const myUsername = profile.username;
		const myAvatar = profile.avatarUrl;
		const myCode = profile.friendCode;
		const authorId = this.currentUserId || auth.ownerId;

		for (const [date, entry] of Object.entries(journal.entries)) {
			if (entry.privacy === 'friends' && (entry.title || entry.mind || entry.videoPath)) {
				out.push({
					id: `my-${date}`,
					authorId,
					authorName: myName,
					authorUsername: myUsername,
					authorAvatar: myAvatar,
					friendCode: myCode,
					date,
					dateFormatted: formatPostDate(date),
					mood: entry.mood,
					title: entry.title || 'Journal entry',
					mind: entry.mind,
					refl: entry.refl,
					stickers: entry.stickers,
					videoPath: entry.videoPath,
					videoName: entry.videoName,
					videoUrl: journal.sessionVideos[date],
					reactions: { ...EMPTY_REACTIONS },
					userReactions: [],
					comments: [],
					isOwner: true
				});
			}
		}

		return out;
	}

	/** Rebuild the current user's side of the feed without another network round-trip. */
	syncOwnPosts() {
		if (!this.currentUserId) return;

		const remote = this.posts.filter((post) => !post.isOwner);
		const own = this.getMyFriendsEntries().map((post) => this.enrich(post));
		this.posts = [...own, ...remote].sort((a, b) => b.date.localeCompare(a.date));
	}

	private enrich(post: FriendPost): FriendPost {
		const key = postKey(post.authorId, post.date);
		return {
			...post,
			reactions: this.reactionMap[key]?.counts ?? post.reactions,
			userReactions: this.reactionMap[key]?.mine ?? post.userReactions,
			comments: this.commentMap[key] ?? post.comments
		};
	}

	private async applySocial(posts: FriendPost[]) {
		const ownerIds = [...new Set(posts.map((post) => post.authorId).filter(isUuid))];
		const ids = [
			...new Set(
				[...ownerIds, isUuid(this.currentUserId) ? this.currentUserId : ''].filter(Boolean)
			)
		];

		if (!auth.user || ids.length === 0) {
			this.posts = posts;
			return;
		}

		const [{ data: reactionRows }, { data: commentRows }] = await Promise.all([
			supabase.from('vidjo_reactions').select('*').in('post_owner_id', ids),
			supabase
				.from('vidjo_comments')
				.select('*')
				.in('post_owner_id', ids)
				.eq('context', 'friends')
				.order('created_at')
		]);

		const reactions: Record<string, { counts: FriendPostReaction; mine: ReactionKey[] }> = {};
		for (const row of reactionRows ?? []) {
			const key = postKey(row.post_owner_id as string, row.post_date as string);
			const entry = reactions[key] ?? { counts: { ...EMPTY_REACTIONS }, mine: [] };
			const reaction = row.reaction as ReactionKey;

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
				authorId: row.author_id as string,
				authorName:
					(row.author_id as string) === this.currentUserId
						? profile.displayName || 'You'
						: (author?.display_name as string) || (author?.username as string) || 'VidJo student',
				authorUsername: (author?.username as string) || 'student',
				authorAvatar:
					(row.author_id as string) === this.currentUserId
						? profile.avatarUrl
						: (author?.avatar_url as string) || null,
				text: (row.body as string) || '',
				time: Number.isNaN(created.getTime())
					? 'Recently'
					: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
			});
		}

		this.reactionMap = reactions;
		this.commentMap = comments;
		this.posts = posts.map((post) => this.enrich(post));
	}

	private loadCachedFriends() {
		if (!this.currentUserId) return;
		try {
			const raw = localStorage.getItem(`${FRIENDS_CACHE_KEY}:${this.currentUserId}`);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Friend[];
			this.friends = Array.isArray(parsed)
				? parsed.filter((friend) => friend.id && friend.username && friend.displayName)
				: [];
		} catch {
			this.friends = [];
		}
	}

	private persistFriendsCache() {
		if (!this.currentUserId) return;
		try {
			localStorage.setItem(
				`${FRIENDS_CACHE_KEY}:${this.currentUserId}`,
				JSON.stringify(this.friends)
			);
		} catch {
			// Ignore storage restrictions.
		}
	}

	async addFriendByCode(
		rawCode: string
	): Promise<{ success: boolean; message: string; friend?: Friend; requestSent?: boolean }> {
		const clean = rawCode.trim().toUpperCase();
		const formattedCode = clean.startsWith('VJ-') ? clean : `VJ-${clean}`;

		if (!/^VJ-[A-Z0-9]{4,12}$/.test(formattedCode)) {
			return { success: false, message: 'Enter a valid friend code, like VJ-DBA6A2.' };
		}

		if (formattedCode === this.myFriendCode) {
			return {
				success: false,
				message: 'That is your own friend code. Share it with a friend instead!'
			};
		}

		const existing = this.friends.find((friend) => friend.friendCode === formattedCode);
		if (existing) {
			return {
				success: false,
				message: `${existing.displayName} is already on your friends list.`
			};
		}

		const outgoing = this.friendRequests.find(
			(request) => request.direction === 'outgoing' && request.toFriendCode === formattedCode
		);
		if (outgoing) {
			return {
				success: false,
				message: 'Friend request already sent. Waiting for them to accept.'
			};
		}

		const incoming = this.friendRequests.find(
			(request) => request.direction === 'incoming' && request.fromFriendCode === formattedCode
		);
		if (incoming) {
			return {
				success: false,
				message: 'They already sent you a request! Check your Requests tab to accept it.'
			};
		}

		if (!isSupabaseConfigured || !auth.user) {
			return {
				success: false,
				message: 'Friend codes need a connection to VidJo. Try again when you are online.'
			};
		}

		const { data, error } = await supabase.rpc('send_friend_request_by_code', {
			code: formattedCode
		});

		if (error) {
			console.warn('[VidJo] send_friend_request_by_code failed.', error);
			return {
				success: false,
				message: `Could not send the request: ${error.message}`
			};
		}

		const result = data as {
			success?: boolean;
			message?: string;
			friend?: {
				id: string;
				username: string;
				displayName: string;
				avatarUrl: string | null;
				bio: string;
				friendCode: string;
			};
			alreadyFriends?: boolean;
		};

		if (!result?.success) {
			return { success: false, message: result?.message || 'Friend code not found.' };
		}

		await this.refreshRemote();
		const message = result.message || 'Friend request sent!';
		journal.toast(message);
		return {
			success: true,
			message,
			requestSent: true
		};
	}

	async acceptFriendRequest(requestId: string) {
		if (!isSupabaseConfigured || !auth.user) {
			journal.toast('Friend requests need a connection to VidJo.');
			return;
		}

		const { data, error } = await supabase.rpc('accept_friend_request', {
			request_id: requestId
		});

		if (error) {
			journal.toast(`Could not accept the request: ${error.message}`);
			return;
		}

		const result = data as { success?: boolean; message?: string };
		if (!result?.success) {
			journal.toast(result?.message || 'Could not accept that request.');
			return;
		}

		await this.refreshRemote();
		journal.toast(result.message || 'You are now friends!');
	}

	async declineFriendRequest(requestId: string) {
		if (!isSupabaseConfigured || !auth.user) {
			journal.toast('Friend requests need a connection to VidJo.');
			return;
		}

		const { data, error } = await supabase.rpc('decline_friend_request', {
			request_id: requestId
		});

		if (error) {
			journal.toast(`Could not decline the request: ${error.message}`);
			return;
		}

		const result = data as { success?: boolean; message?: string };
		if (!result?.success) {
			journal.toast(result?.message || 'Could not decline that request.');
			return;
		}

		await this.refreshRemote();
		journal.toast('Friend request declined.');
	}

	async cancelFriendRequest(requestId: string) {
		if (!isSupabaseConfigured || !auth.user) {
			journal.toast('Friend requests need a connection to VidJo.');
			return;
		}

		const { data, error } = await supabase.rpc('cancel_friend_request', {
			request_id: requestId
		});

		if (error) {
			journal.toast(`Could not cancel the request: ${error.message}`);
			return;
		}

		const result = data as { success?: boolean; message?: string };
		if (!result?.success) {
			journal.toast(result?.message || 'Could not cancel that request.');
			return;
		}

		await this.refreshRemote();
		journal.toast('Friend request canceled.');
	}

	async removeFriend(friendId: string) {
		const target = this.friends.find((friend) => friend.id === friendId);

		if (isSupabaseConfigured && auth.user) {
			const { data, error } = await supabase.rpc('remove_friend', { friend_id: friendId });
			const result = data as { success?: boolean; message?: string };

			if (error || !result?.success) {
				journal.toast(result?.message || error?.message || 'Could not remove that friend.');
				return;
			}

			await this.refreshRemote();
		} else {
			this.friends = this.friends.filter((friend) => friend.id !== friendId);
			this.persistFriendsCache();
		}

		if (target) journal.toast(`Removed ${target.displayName} from friends.`);
	}

	toggleReaction(postId: string, reaction: ReactionKey) {
		const post = this.posts.find((item) => item.id === postId);
		if (!post) return;

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
		this.posts = this.posts.map((item) =>
			item.id === postId ? { ...item, reactions: counts, userReactions: mine } : item
		);

		if (isSupabaseConfigured && auth.user && isUuid(post.authorId)) {
			void (async () => {
				const request = hasReacted
					? supabase
							.from('vidjo_reactions')
							.delete()
							.eq('post_owner_id', post.authorId)
							.eq('post_date', post.date)
							.eq('user_id', auth.user!.id)
							.eq('reaction', reaction)
					: supabase.from('vidjo_reactions').insert({
							post_owner_id: post.authorId,
							post_date: post.date,
							user_id: auth.user!.id,
							reaction
						});

				const { error } = await request;
				if (error) console.warn('[VidJo] Could not save the reaction.', error);
			})();
		}
	}

	async addComment(postId: string, text: string) {
		const clean = censor(text.trim());
		if (!clean) return;

		const post = this.posts.find((item) => item.id === postId);
		if (!post) return;

		const key = postKey(post.authorId, post.date);
		const temp: FriendComment = {
			id: `local-${Date.now()}`,
			authorId: auth.ownerId,
			authorName: 'You',
			authorUsername: profile.username,
			authorAvatar: profile.avatarUrl,
			text: clean,
			time: 'Just now'
		};

		this.commentMap = { ...this.commentMap, [key]: [...(this.commentMap[key] ?? []), temp] };
		this.posts = this.posts.map((item) =>
			item.id === postId ? { ...item, comments: [...item.comments, temp] } : item
		);

		if (!isSupabaseConfigured || !auth.user || !isUuid(post.authorId)) return;

		const { data, error } = await supabase
			.from('vidjo_comments')
			.insert({
				post_owner_id: post.authorId,
				post_date: post.date,
				context: 'friends',
				author_id: auth.user.id,
				body: clean
			})
			.select('id')
			.single();

		if (error) {
			console.warn('[VidJo] Could not save the comment.', error);
			journal.toast('Comment added for this session, but it could not be saved.');
			return;
		}

		const savedId = (data?.id as string) || temp.id;
		this.commentMap = {
			...this.commentMap,
			[key]: (this.commentMap[key] ?? []).map((comment) =>
				comment.id === temp.id ? { ...comment, id: savedId } : comment
			)
		};
		this.posts = this.posts.map((item) =>
			item.id === postId
				? {
						...item,
						comments: item.comments.map((comment) =>
							comment.id === temp.id ? { ...comment, id: savedId } : comment
						)
					}
				: item
		);
	}

	async deleteComment(postId: string, commentId: string) {
		const post = this.posts.find((item) => item.id === postId);
		if (!post) return;

		const key = postKey(post.authorId, post.date);
		this.commentMap = {
			...this.commentMap,
			[key]: (this.commentMap[key] ?? []).filter((c) => c.id !== commentId)
		};
		this.posts = this.posts.map((item) =>
			item.id === postId
				? { ...item, comments: item.comments.filter((c) => c.id !== commentId) }
				: item
		);

		if (isSupabaseConfigured && auth.user && isUuid(post.authorId)) {
			try {
				await supabase.from('vidjo_comments').delete().eq('id', commentId).eq('context', 'friends');
			} catch {
				// Optimistic update already applied; server failure is non-fatal for UI.
			}
		}
	}

	async reportComment(postId: string, commentId: string, reason: string) {
		if (!isSupabaseConfigured || !auth.user) return;

		try {
			const { error } = await supabase.from('vidjo_comment_reports').insert({
				comment_id: commentId,
				reporter_id: auth.user.id,
				reason
			});
			if (error) throw error;
		} catch {
			// Report failure is non-fatal for UI.
		}
	}

	setFilter(filter: 'all' | 'video' | 'written') {
		this.activeFilter = filter;
	}

	reset() {
		this.friends = [];
		this.friendRequests = [];
		this.posts = [];
		this.stories = [];
		this.reactionMap = {};
		this.commentMap = {};
		this.currentUserId = '';
		this.initializedFor = '';
		this.loading = false;
		this.remote = false;
	}
}

export const friends = new FriendsState();
