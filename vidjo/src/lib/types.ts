export type Side = 'L' | 'R';

export type Privacy = 'private' | 'friends' | 'community';

export type PaperStyle = 'lined' | 'dotted' | 'grid' | 'plain';

export type MoodKey = 'happy' | 'calm' | 'tired' | 'sad' | 'stressed' | 'angry' | 'excited';

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
	stickers: Sticker[];
	saved: boolean;
	sample: boolean;
	/**
	 * Object path inside the private `vidjo-videos` bucket. Never store a signed
	 * URL here: signed URLs are short-lived and must stay in memory only.
	 */
	videoPath: string;
	videoName: string;
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
	/** Legacy public URL, read only so old rows can be migrated to `video_path`. */
	video_url: string | null;
	video_name: string | null;
}

export interface Profile {
	user_id: string;
	username: string;
	/** Nickname shown around the app. Stored as `display_name` in Postgres. */
	display_name: string;
	bio: string;
	avatar_url: string | null;
	friend_code?: string;
	accent_color?: string;
	theme?: 'classic' | 'sunset' | 'midnight';
	default_privacy?: Privacy;
	allow_friend_requests?: boolean;
	created_at: string;
	updated_at: string;
}

export interface Community {
	slug: string;
	name: string;
	tag: string;
	description: string;
	icon: string;
	color: string;
	memberCount: number;
	joined: boolean;
}

export interface CommunityRow {
	slug: string;
	name: string;
	tag: string;
	description: string;
	icon: string;
	color: string;
	sort_order: number;
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
	authorName: string;
	authorUsername: string;
	authorAvatar: string | null;
	text: string;
	time: string;
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
	videoPath?: string;
	videoName?: string;
	videoCaption?: string;
	reactions: FriendPostReaction;
	userReactions: ('love' | 'spark' | 'warm' | 'proud')[];
	comments: FriendComment[];
	isOwner?: boolean;
}
