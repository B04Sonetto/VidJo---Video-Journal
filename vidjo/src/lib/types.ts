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
	display_name: string;
	bio: string;
	avatar_url: string | null;
	friend_code?: string;
	created_at: string;
	updated_at: string;
}

export interface Friend {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
	bio: string;
	friendCode: string;
	mutualCount?: number;
	lastActive?: string;
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
