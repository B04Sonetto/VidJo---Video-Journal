import { isSupabaseConfigured, supabase } from '#lib/supabase';
import type { Friend, FriendPost, FriendComment, FriendPostReaction, Entry } from '#lib/types';
import { profile } from '#lib/state/profile.svelte';
import { journal } from '#lib/state/journal.svelte';
import { auth } from '#lib/state/auth.svelte';
import { offsetDate } from '#lib/dates';

const FRIENDS_STORAGE_KEY = 'vidjo-friends';
const REACTIONS_STORAGE_KEY = 'vidjo-feed-reactions';
const COMMENTS_STORAGE_KEY = 'vidjo-feed-comments';

const DEFAULT_FRIENDS: Friend[] = [
	{
		id: 'friend-samira',
		username: 'samirac',
		displayName: 'Samira Chen',
		avatarUrl: '🎨',
		bio: 'Studying digital animation. Coffee addict ☕',
		friendCode: 'VJ-SAMIRA',
		mutualCount: 4,
		lastActive: '12m ago'
	},
	{
		id: 'friend-jordan',
		username: 'jordan_r',
		displayName: 'Jordan Rivera',
		avatarUrl: '🎧',
		bio: 'Beats, tracks, and library study sessions.',
		friendCode: 'VJ-JORDAN',
		mutualCount: 7,
		lastActive: '2h ago'
	},
	{
		id: 'friend-liam',
		username: 'liamv',
		displayName: 'Liam Vance',
		avatarUrl: '🌱',
		bio: 'Plant dad & biology major. Finding calm.',
		friendCode: 'VJ-LIAMV9',
		mutualCount: 2,
		lastActive: 'Yesterday'
	}
];

function seedDefaultPosts(): FriendPost[] {
	const dates = {
		today: offsetDate(0),
		yesterday: offsetDate(-1),
		twoDaysAgo: offsetDate(-2)
	};

	return [
		{
			id: 'post-samira-1',
			authorId: 'friend-samira',
			authorName: 'Samira Chen',
			authorUsername: 'samirac',
			authorAvatar: '🎨',
			friendCode: 'VJ-SAMIRA',
			date: dates.today,
			dateFormatted: 'Today at 3:45 PM',
			mood: 'excited',
			title: 'Late night in the animation lab 🎬',
			mind: 'Had three coffees and completely lost track of time. The lab was totally quiet except for the rain tapping the skylight. Finally got the character walk cycle to feel natural after 4 hours of tweaking keyframes!',
			refl: 'Patience pays off. Small iterations matter.',
			videoName: 'walk_cycle_test.mp4',
			videoCaption: 'Character walk cycle test — render complete ✦',
			stickers: [
				{ id: 'stk-1', type: 'star', page: 'R', x: 80, y: 15, size: 85, rot: 8 },
				{ id: 'stk-2', type: 'yay', page: 'R', x: 85, y: 80, size: 95, rot: -6 }
			],
			reactions: { love: 8, spark: 12, warm: 4, proud: 6 },
			userReactions: ['spark'],
			comments: [
				{
					id: 'c-1',
					authorName: 'Jordan Rivera',
					authorUsername: 'jordan_r',
					authorAvatar: '🎧',
					text: 'The bounce timing on that step is so smooth! 🔥',
					time: '2h ago'
				}
			]
		},
		{
			id: 'post-jordan-1',
			authorId: 'friend-jordan',
			authorName: 'Jordan Rivera',
			authorUsername: 'jordan_r',
			authorAvatar: '🎧',
			friendCode: 'VJ-JORDAN',
			date: dates.yesterday,
			dateFormatted: 'Yesterday at 9:15 PM',
			mood: 'calm',
			title: 'Beats & biology notes 🎧',
			mind: 'Making lo-fi synth loops to keep myself focused while prepping for the cellular bio exam. It is funny how rhythm turns daunting textbook pages into something peaceful.',
			refl: 'Resting is part of the work. Step back when you need to.',
			videoName: 'study_beats_demo.mp4',
			videoCaption: 'Study loop #4 — analog synth & white noise',
			stickers: [
				{ id: 'stk-3', type: 'cloud', page: 'R', x: 78, y: 14, size: 90, rot: -8 },
				{ id: 'stk-4', type: 'tea', page: 'R', x: 86, y: 82, size: 75, rot: 5 }
			],
			reactions: { love: 14, spark: 9, warm: 11, proud: 3 },
			userReactions: ['warm'],
			comments: [
				{
					id: 'c-2',
					authorName: 'Liam Vance',
					authorUsername: 'liamv',
					authorAvatar: '🌱',
					text: 'Share the link to that track! Listening while watering seedlings tomorrow.',
					time: 'Yesterday'
				}
			]
		},
		{
			id: 'post-liam-1',
			authorId: 'friend-liam',
			authorName: 'Liam Vance',
			authorUsername: 'liamv',
			authorAvatar: '🌱',
			friendCode: 'VJ-LIAMV9',
			date: dates.twoDaysAgo,
			dateFormatted: 'Oct 29 at 8:05 AM',
			mood: 'happy',
			title: 'The greenhouse in morning fog 🌱',
			mind: 'Woke up before the first lecture to check on the fern specimens. The mist in the campus greenhouse was completely still, with soft sunlight filtering through the glass. Sometimes just showing up early turns the whole week around.',
			refl: 'Find your quiet corner on campus.',
			stickers: [
				{ id: 'stk-5', type: 'sakura', page: 'R', x: 82, y: 16, size: 80, rot: 12 },
				{ id: 'stk-6', type: 'cat', page: 'R', x: 84, y: 84, size: 88, rot: -4 }
			],
			reactions: { love: 19, spark: 5, warm: 16, proud: 7 },
			userReactions: ['love'],
			comments: [
				{
					id: 'c-3',
					authorName: 'Samira Chen',
					authorUsername: 'samirac',
					authorAvatar: '🎨',
					text: 'That morning light sounds gorgeous 🌿',
					time: 'Oct 29'
				}
			]
		}
	];
}

class FriendsState {
	friends = $state<Friend[]>([]);
	posts = $state<FriendPost[]>([]);
	loading = $state(false);
	activeFilter = $state<'all' | 'video' | 'written'>('all');
	currentUserId = $state<string>('');

	get myFriendCode() {
		return profile.friendCode;
	}

	get filteredPosts() {
		if (this.activeFilter === 'video') {
			return this.posts.filter((p) => Boolean(p.videoUrl || p.videoName || p.videoPath));
		}
		if (this.activeFilter === 'written') {
			return this.posts.filter((p) => !p.videoUrl && !p.videoName && !p.videoPath);
		}
		return this.posts;
	}

	get friendCount() {
		return this.friends.length;
	}

	init(userId: string) {
		if (!userId) return;
		this.currentUserId = userId;
		this.loading = true;

		// 1. Load friends from storage
		try {
			const saved = localStorage.getItem(`${FRIENDS_STORAGE_KEY}:${userId}`);
			if (saved) {
				this.friends = JSON.parse(saved) as Friend[];
			} else {
				this.friends = [...DEFAULT_FRIENDS];
				this.persistFriends();
			}
		} catch {
			this.friends = [...DEFAULT_FRIENDS];
		}

		// 2. Load reaction & comment overlays
		let userReactionsMap: Record<string, ('love' | 'spark' | 'warm' | 'proud')[]> = {};
		let userCommentsMap: Record<string, FriendComment[]> = {};
		try {
			const r = localStorage.getItem(`${REACTIONS_STORAGE_KEY}:${userId}`);
			if (r) userReactionsMap = JSON.parse(r);
			const c = localStorage.getItem(`${COMMENTS_STORAGE_KEY}:${userId}`);
			if (c) userCommentsMap = JSON.parse(c);
		} catch {
			// Ignore read errors
		}

		// 3. Assemble feed from sample posts + user's own friends-shared entries
		const basePosts = seedDefaultPosts();

		// Merge user's own journal entries that are set to "friends"
		const myEntries = this.getMyFriendsEntries();
		const all = [...myEntries, ...basePosts];

		// Apply stored reactions & comments
		this.posts = all.map((post) => {
			const userReacts = userReactionsMap[post.id] ?? post.userReactions ?? [];
			const extraComments = userCommentsMap[post.id] ?? [];
			return {
				...post,
				userReactions: userReacts,
				comments: [...post.comments, ...extraComments]
			};
		});

		this.loading = false;

		// Check for any pending friend code entered during signup
		try {
			const pending = localStorage.getItem('vidjo-pending-friendcode');
			if (pending) {
				localStorage.removeItem('vidjo-pending-friendcode');
				void this.addFriendByCode(pending);
			}
		} catch {
			// Ignore read issues
		}
	}

	/**
	 * Pull entries from current user's journal that have privacy === 'friends'
	 */
	private getMyFriendsEntries(): FriendPost[] {
		const out: FriendPost[] = [];
		const entries = journal.entries;
		const myName = profile.displayName;
		const myUsername = profile.username;
		const myAvatar = profile.avatarUrl;
		const myCode = profile.friendCode;

		for (const [date, entry] of Object.entries(entries)) {
			if (entry.privacy === 'friends' && (entry.title || entry.mind || entry.videoPath)) {
				out.push({
					id: `my-${date}`,
					authorId: this.currentUserId,
					authorName: `${myName} (You)`,
					authorUsername: myUsername,
					authorAvatar: myAvatar,
					friendCode: myCode,
					date,
					dateFormatted: date === journal.current ? 'Today' : date,
					mood: entry.mood,
					title: entry.title || 'Journal entry',
					mind: entry.mind,
					refl: entry.refl,
					stickers: entry.stickers,
					videoPath: entry.videoPath,
					videoName: entry.videoName,
					videoUrl: journal.sessionVideos[date],
					reactions: { love: 3, spark: 2, warm: 4, proud: 1 },
					userReactions: [],
					comments: [],
					isOwner: true
				});
			}
		}

		return out;
	}

	persistFriends() {
		if (!this.currentUserId) return;
		try {
			localStorage.setItem(`${FRIENDS_STORAGE_KEY}:${this.currentUserId}`, JSON.stringify(this.friends));
		} catch {
			// Ignore storage write issues
		}
	}

	private persistReactions() {
		if (!this.currentUserId) return;
		try {
			const map: Record<string, ('love' | 'spark' | 'warm' | 'proud')[]> = {};
			for (const p of this.posts) {
				if (p.userReactions.length > 0) map[p.id] = p.userReactions;
			}
			localStorage.setItem(`${REACTIONS_STORAGE_KEY}:${this.currentUserId}`, JSON.stringify(map));
		} catch {
			// Ignore storage write issues
		}
	}

	private persistComments() {
		if (!this.currentUserId) return;
		try {
			const map: Record<string, FriendComment[]> = {};
			for (const p of this.posts) {
				// Store comments that were authored by this user
				const userAuthored = p.comments.filter(
					(c) => c.authorUsername === profile.username || c.id.startsWith('uc-')
				);
				if (userAuthored.length > 0) map[p.id] = userAuthored;
			}
			localStorage.setItem(`${COMMENTS_STORAGE_KEY}:${this.currentUserId}`, JSON.stringify(map));
		} catch {
			// Ignore storage write issues
		}
	}

	async addFriendByCode(rawCode: string): Promise<{ success: boolean; message: string; friend?: Friend }> {
		const clean = rawCode.trim().toUpperCase();
		const formattedCode = clean.startsWith('VJ-') ? clean : `VJ-${clean}`;

		if (!formattedCode || formattedCode.length < 5) {
			return { success: false, message: 'Please enter a valid Friend Code (e.g. VJ-7K9M2P).' };
		}

		// Prevent adding yourself
		if (formattedCode === this.myFriendCode) {
			return { success: false, message: 'That is your own Friend Code! Share it with a friend instead.' };
		}

		// Check if already in friends list
		const exists = this.friends.find((f) => f.friendCode === formattedCode);
		if (exists) {
			return { success: false, message: `${exists.displayName} is already on your friends list!` };
		}

		// 1. Try Supabase if configured
		if (isSupabaseConfigured) {
			try {
				const { data, error } = await supabase.rpc('add_friend_by_code', { code: formattedCode });
				if (!error && data && data.success && data.friend) {
					const f = data.friend;
					const newFriend: Friend = {
						id: f.id,
						username: f.username,
						displayName: f.displayName || f.username,
						avatarUrl: f.avatarUrl || '✦',
						bio: f.bio || 'VidJo classmate',
						friendCode: formattedCode,
						mutualCount: 1,
						lastActive: 'Just now'
					};
					this.friends.unshift(newFriend);
					this.persistFriends();
					journal.toast(`Added ${newFriend.displayName} to friends!`);
					return { success: true, message: `Added ${newFriend.displayName}!`, friend: newFriend };
				}
			} catch (err) {
				console.warn('[VidJo] Supabase add_friend_by_code fallback', err);
			}
		}

		// 2. Default/Local Fallback: Match against demo catalog or generate a friend
		let newFriend: Friend;
		if (formattedCode === 'VJ-SAMIRA') {
			newFriend = { ...DEFAULT_FRIENDS[0] };
		} else if (formattedCode === 'VJ-JORDAN') {
			newFriend = { ...DEFAULT_FRIENDS[1] };
		} else if (formattedCode === 'VJ-LIAMV9') {
			newFriend = { ...DEFAULT_FRIENDS[2] };
		} else {
			// Generate a realistic student friend from the code
			const codeSuffix = formattedCode.replace('VJ-', '');
			const studentNames = ['Alex Morgan', 'Taylor Swift', 'Riley Harper', 'Maya Lin', 'Chris Patel', 'Noah Kim'];
			const seedIdx = (codeSuffix.charCodeAt(0) || 0) % studentNames.length;
			const name = studentNames[seedIdx];
			const uname = name.toLowerCase().replace(/\s+/g, '_');
			const avatars = ['🎒', '☕', '📚', '✨', '🎧', '🌿'];
			const avatar = avatars[seedIdx % avatars.length];

			newFriend = {
				id: `friend-${codeSuffix.toLowerCase()}`,
				username: uname,
				displayName: name,
				avatarUrl: avatar,
				bio: 'Campus classmate & journaling partner ✨',
				friendCode: formattedCode,
				mutualCount: 1,
				lastActive: 'Just now'
			};
		}

		this.friends.unshift(newFriend);
		this.persistFriends();
		journal.toast(`✦ Added ${newFriend.displayName} as a friend!`);
		return { success: true, message: `Connected with ${newFriend.displayName}!`, friend: newFriend };
	}

	removeFriend(friendId: string) {
		const target = this.friends.find((f) => f.id === friendId);
		this.friends = this.friends.filter((f) => f.id !== friendId);
		this.persistFriends();
		if (target) {
			journal.toast(`Removed ${target.displayName} from friends.`);
		}
	}

	toggleReaction(postId: string, reaction: 'love' | 'spark' | 'warm' | 'proud') {
		const post = this.posts.find((p) => p.id === postId);
		if (!post) return;

		const hasReacted = post.userReactions.includes(reaction);
		if (hasReacted) {
			post.userReactions = post.userReactions.filter((r) => r !== reaction);
			post.reactions[reaction] = Math.max(0, post.reactions[reaction] - 1);
		} else {
			post.userReactions.push(reaction);
			post.reactions[reaction] = (post.reactions[reaction] || 0) + 1;
		}

		this.persistReactions();
	}

	addComment(postId: string, text: string) {
		const clean = text.trim();
		if (!clean) return;

		const post = this.posts.find((p) => p.id === postId);
		if (!post) return;

		const newComment: FriendComment = {
			id: `uc-${Date.now()}`,
			authorName: profile.displayName,
			authorUsername: profile.username,
			authorAvatar: profile.avatarUrl,
			text: clean,
			time: 'Just now'
		};

		post.comments.push(newComment);
		this.persistComments();
		journal.toast('Note left for friend ✦');
	}

	setFilter(filter: 'all' | 'video' | 'written') {
		this.activeFilter = filter;
	}
}

export const friends = new FriendsState();
