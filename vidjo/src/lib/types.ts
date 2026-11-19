export type Side = 'L' | 'R';

export type Privacy = 'private' | 'friends' | 'community';

export type PaperStyle = 'lined' | 'dotted' | 'grid' | 'plain';

export type MoodKey =
	'happy' | 'calm' | 'neutral' | 'tired' | 'sad' | 'stressed' | 'angry' | 'excited';

export interface Sticker {
	id: string;
	type: string;
	page: Side;
	x: number;
	y: number;
	size: number;
	rot: number;
	src?: string;
}

export interface Entry {
	date: string;
	mood: MoodKey | '';
	title: string;
	mind: string;
	refl: string;
	privacy: Privacy;
	/** Community slug (e.g. `creativeflow`) when privacy is `community`. */
	communitySlug: string;
	/**
	 * When privacy is `community`, also surface this post in the friends feed so
	 * it reaches both audiences instead of only one.
	 */
	shareWithFriends: boolean;
	stickers: Sticker[];
	saved: boolean;
	sample: boolean;
	/**
	 * Object path inside the private `vidjo-videos` bucket. Never store a signed
	 * URL here: signed URLs are short-lived and must stay in memory only.
	 */
	videoPath: string;
	/** Object path for the JPEG poster generated when the video was added. */
	videoThumbPath: string;
	videoName: string;
	/**
	 * Friend IDs excluded from seeing this post, even when privacy allows friends.
	 */
	excludedFriendIds: string[];
	/**
	 * Friend IDs granted an exception to see this post, even when privacy is more
	 * restrictive (e.g. a friend listed here can view a 'private' page).
	 */
	includedFriendIds: string[];
	/** Spotify song attached to this journal page (playable in-app for connected listeners). */
	song: EntrySong | null;
}

/** Song attached to a journal page, shared in feeds/messages and playable via Spotify. */
export interface EntrySong {
	uri: string;
	name: string;
	artists: string;
	album?: string;
	image?: string;
	url?: string;
}

/** Streak counts for a journal. Aggregate only, so it is safe to share with friends. */
export interface StreakInfo {
	current: number;
	longest: number;
	totalDays: number;
	todayCounted: boolean;
}

export interface EntryRow {
	owner_id: string;
	entry_date: string;
	mood: MoodKey | null;
	title: string | null;
	mind: string | null;
	refl: string | null;
	privacy: Privacy | null;
	community_slug: string | null;
	stickers: Sticker[] | null;
	saved: boolean | null;
	sample: boolean | null;
	video_path: string | null;
	video_thumb_path: string | null;
	excluded_friend_ids: string[] | null;
	included_friend_ids: string[] | null;
	share_with_friends: boolean | null;
	/** Legacy public URL, read only so old rows can be migrated to `video_path`. */
	video_url: string | null;
	video_name: string | null;
	song: EntrySong | null;
}

export interface Profile {
	user_id: string;
	username: string;
	/** Nickname shown around the app. Stored as `display_name` in Postgres. */
	display_name: string;
	bio: string;
	avatar_url: string | null;
	banner_url: string | null;
	user_role: 'user' | 'admin' | 'banned';
	friend_code?: string;
	accent_color?: string;
	theme?: 'classic' | 'sunset' | 'midnight' | 'evergreen' | 'rosewood' | 'harbor';
	default_privacy?: Privacy;
	allow_friend_requests?: boolean;
	created_at: string;
	updated_at: string;
}

export type CommunityRole = 'none' | 'member' | 'moderator' | 'admin' | 'owner';

export interface Community {
	slug: string;
	name: string;
	tag: string;
	description: string;
	icon: string;
	color: string;
	memberCount: number;
	joined: boolean;
	/** Null when the project has no assigned owner yet. */
	ownerId: string | null;
	rules: string;
	myRole: CommunityRole;
}

export interface CommunityRow {
	slug: string;
	name: string;
	tag: string;
	description: string;
	icon: string;
	color: string;
	sort_order: number;
	owner_id: string | null;
	rules: string | null;
}

export interface CommunityMember {
	userId: string;
	name: string;
	username: string;
	avatarUrl: string | null;
	role: CommunityRole;
	joinedAt: string;
}

export interface CommunityPost extends FriendPost {
	communitySlug: string;
	tag: string;
}

export type FriendRequestStatus = 'pending' | 'incoming' | 'outgoing' | 'accepted' | 'declined';

export interface Friend {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
	bio: string;
	friendCode: string;
	mutualCount?: number;
	lastActive?: string;
	status?: 'accepted';
	isOnline?: boolean;
	hasNewPost?: boolean;
}

export interface FriendRequest {
	id: string;
	fromUserId: string;
	toUserId: string;
	fromUsername: string;
	fromDisplayName: string;
	fromAvatarUrl: string | null;
	fromBio?: string;
	fromFriendCode?: string;
	toFriendCode?: string;
	toUsername?: string;
	toDisplayName?: string;
	toAvatarUrl?: string | null;
	status: 'pending';
	direction: 'incoming' | 'outgoing';
	createdAt: string;
}

export interface FriendComment {
	id: string;
	authorId: string;
	authorName: string;
	authorUsername: string;
	authorAvatar: string | null;
	text: string;
	time: string;
	/** Epoch milliseconds, used for "newest"/"top" sorting. */
	createdAt?: number;
	reactions?: FriendPostReaction;
	userReactions?: (keyof FriendPostReaction)[];
	/** Reaction timestamps (epoch ms) used for this week/month sorting. */
	reactionTimes?: Partial<Record<keyof FriendPostReaction, number[]>>;
}

export interface FriendPostReaction {
	love: number;
	spark: number;
	warm: number;
	proud: number;
}

export interface FriendPost {
	id: string;
	authorId: string;
	authorName: string;
	authorUsername: string;
	authorAvatar: string | null;
	friendCode?: string;
	date: string;
	dateFormatted: string;
	mood: MoodKey | '';
	title: string;
	mind: string;
	refl: string;
	stickers?: Sticker[];
	videoUrl?: string;
	videoThumbUrl?: string;
	videoPath?: string;
	/** Object path for the poster; signed together with the video on demand. */
	videoThumbPath?: string;
	videoName?: string;
	videoCaption?: string;
	song?: EntrySong | null;
	reactions: FriendPostReaction;
	userReactions: ('love' | 'spark' | 'warm' | 'proud')[];
	comments: FriendComment[];
	isOwner?: boolean;
}

export interface NotificationItem {
	id: string;
	type: 'friend_request' | 'comment';
	/** Supabase row id for friend requests, used by accept/decline actions. */
	requestId?: string;
	fromUserId: string;
	fromUserName: string;
	fromUserAvatar: string | null;
	/** Owner of the page the notification refers to (defaults to the current user). */
	postOwnerId?: string;
	postId?: string;
	postTitle?: string;
	postDate?: string;
	text?: string;
	createdAt: string;
	read: boolean;
}

export type DmThreadKind = 'direct' | 'group';

export type DmRole = 'owner' | 'member';

export interface DmParticipant {
	id: string;
	name: string;
	username: string;
	avatar: string | null;
	role: DmRole;
}

export interface DmReaction {
	emoji: string;
	count: number;
	mine: boolean;
}

export interface DmSeenBy {
	name: string;
	at: string;
}

/** A snapshot of a journal page, sent as a rich message card. */
export interface SharedJournalEntry {
	date: string;
	title: string;
	mind: string;
	refl: string;
	mood: string;
	pageCount: number;
	videoPath?: string | null;
	videoThumbPath?: string | null;
	videoName?: string | null;
	song?: EntrySong | null;
}

export interface DmForwarded {
	name: string;
	body: string;
}

export interface DmThreadSummary {
	threadId: string;
	kind: DmThreadKind;
	title: string | null;
	members: DmParticipant[];
	lastBody: string | null;
	lastImagePath: string | null;
	/** Giphy-hosted GIF URL shown in the inbox preview. */
	lastGifUrl: string | null;
	lastSender: string | null;
	lastSenderName: string | null;
	lastAt: string | null;
	unreadCount: number;
	canReply: boolean;
	lastSharedEntry: SharedJournalEntry | null;
	lastDeleted: boolean;
	lastDeletedByName: string | null;
}

export interface DmMessage {
	id: string;
	threadId: string;
	senderId: string;
	clientId: string;
	senderName: string;
	senderUsername: string;
	senderAvatar: string | null;
	body: string;
	/** Storage path inside the private `vidjo-dm-images` bucket. */
	imagePath: string | null;
	/** Giphy-hosted GIF URL, stored as a link rather than uploaded. */
	gifUrl: string | null;
	/** Storage path inside the private `vidjo-dm-files` bucket. */
	filePath: string | null;
	fileName: string | null;
	fileMime: string | null;
	fileSize: number | null;
	/** Local object URL used only while a photo uploads. */
	previewUrl?: string;
	createdAt: string;
	/** True while the optimistic bubble waits for the server. */
	pending?: boolean;
	editedAt: string | null;
	deletedAt: string | null;
	deletedByName: string | null;
	replyTo: string | null;
	replySender: string | null;
	replyBody: string | null;
	replyDeleted: boolean;
	sharedEntry: SharedJournalEntry | null;
	forwardedFrom: DmForwarded | null;
	reactions: DmReaction[];
	pinned: boolean;
	seenBy: DmSeenBy[];
}

export interface DmThreadMember {
	userId: string;
	name: string;
	username: string;
	avatar: string | null;
	role: DmRole;
	joinedAt: string;
	isMe: boolean;
	/** Nickname set for this conversation, empty when using the global name. */
	nickname: string;
}

/** Per-conversation settings returned by `vidjo_dm_chat_settings`. */
export interface ChatSettings {
	threadId: string;
	kind: DmThreadKind;
	title: string | null;
	photoPath: string | null;
	theme: string;
	createdAt: string;
	memberCount: number;
}

/** Metadata returned by the server-side link preview endpoint. */
export interface LinkPreview {
	url: string;
	title: string;
	description: string;
	image: string;
	siteName: string;
}
