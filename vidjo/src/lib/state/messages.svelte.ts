import { tick } from 'svelte';
import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import { auth } from '#lib/state/auth.svelte';
import { profile } from '#lib/state/profile.svelte';
import { cleanDisplayName, normalizeImageUrl } from '#lib/avatar';
import { detectRasterImageMime } from '#lib/imageUpload';
import { detectDocumentMime, documentExtension } from '#lib/fileUpload';
import { isGiphyMediaUrl, type GiphyGif } from '#lib/giphy';
import type {
	ChatSettings,
	DmForwarded,
	DmMessage,
	DmParticipant,
	DmReaction,
	DmSeenBy,
	DmThreadKind,
	DmThreadMember,
	DmThreadSummary,
	Friend,
	LinkPreview,
	SharedJournalEntry
} from '#lib/types';

const PAGE_SIZE = 30;
const INBOX_DEBOUNCE_MS = 250;
/** Realtime inbox reloads wait at least this long after the last successful load. */
const INBOX_FRESH_MS = 5_000;
const DM_IMAGE_BUCKET = 'vidjo-dm-images';
const DM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DM_IMAGE_TTL_SECONDS = 60 * 60 * 12;
const IMAGE_URL_CACHE_MAX = 300;
const IMAGE_URL_REFRESH_BEFORE_MS = 60_000;
const VIDEO_URL_TTL_SECONDS = 60 * 60 * 2;
const VIDEO_URL_REFRESH_BEFORE_MS = 60_000;
/** While a thread is open, coalesce read receipts into one write per second. */
const READ_DEBOUNCE_MS = 1_000;

const DM_IMAGE_TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};
const DM_FILE_BUCKET = 'vidjo-dm-files';
const DM_FILE_MAX_BYTES = 20 * 1024 * 1024;
const DM_FILE_TYPES: Record<string, string> = {
	'application/pdf': 'pdf',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
};

export const CHAT_THEMES = [
	'classic',
	'sunset',
	'midnight',
	'evergreen',
	'rosewood',
	'harbor'
] as const;

type InboxRow = {
	thread_id: string;
	kind: DmThreadKind;
	title: string | null;
	members: unknown;
	last_body: string | null;
	last_image_path: string | null;
	last_gif_url: string | null;
	last_sender: string | null;
	last_sender_name: string | null;
	last_at: string | null;
	unread_count: number;
	can_reply: boolean;
	last_shared_entry: unknown;
	last_deleted: boolean;
	last_deleted_by_name: string | null;
};

type MessageRow = {
	id: string;
	thread_id: string;
	sender_id: string;
	client_id: string;
	sender_name: string | null;
	sender_username: string | null;
	sender_avatar: string | null;
	body: string;
	image_path: string | null;
	gif_url: string | null;
	created_at: string;
	edited_at: string | null;
	deleted_at: string | null;
	deleted_by_name: string | null;
	reply_to: string | null;
	reply_sender: string | null;
	reply_body: string | null;
	reply_deleted: boolean;
	shared_entry: unknown;
	forwarded_from: unknown;
	reactions: unknown;
	pinned: boolean;
	seen_by: unknown;
	file_path: string | null;
	file_name: string | null;
	file_mime: string | null;
	file_size: number | null;
};

type MemberRow = {
	user_id: string;
	name: string | null;
	username: string | null;
	avatar: string | null;
	role: 'owner' | 'member';
	joined_at: string;
	is_me: boolean;
	nickname: string | null;
};

function errorMessage(error: unknown) {
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message.trim();
	}
	return 'Something went wrong. Try again.';
}

function safeName(value: unknown, fallback = 'VidJo student') {
	return cleanDisplayName(typeof value === 'string' ? value : '', fallback);
}

function mapMembers(value: unknown): DmParticipant[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((raw) => {
		if (!raw || typeof raw !== 'object') return [];
		const row = raw as Record<string, unknown>;
		const id = typeof row.id === 'string' ? row.id : '';
		if (!id) return [];
		return [
			{
				id,
				name: safeName(row.name),
				username: typeof row.username === 'string' ? row.username : 'student',
				avatar: normalizeImageUrl(typeof row.avatar === 'string' ? row.avatar : null),
				role: row.role === 'owner' ? 'owner' : 'member'
			} satisfies DmParticipant
		];
	});
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function mapReactions(value: unknown): DmReaction[] {
	return asArray(value).flatMap((raw) => {
		if (!raw || typeof raw !== 'object') return [];
		const row = raw as Record<string, unknown>;
		if (typeof row.emoji !== 'string' || !row.emoji) return [];
		return [
			{
				emoji: row.emoji,
				count: Number(row.count) || 0,
				mine: Boolean(row.mine)
			} satisfies DmReaction
		];
	});
}

function mapSeenBy(value: unknown): DmSeenBy[] {
	return asArray(value).flatMap((raw) => {
		if (!raw || typeof raw !== 'object') return [];
		const row = raw as Record<string, unknown>;
		if (typeof row.name !== 'string' || typeof row.at !== 'string') return [];
		return [{ name: row.name, at: row.at } satisfies DmSeenBy];
	});
}

function mapSharedEntry(value: unknown): SharedJournalEntry | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	const date = typeof row.date === 'string' ? row.date : '';
	if (!date) return null;
	return {
		date,
		title: typeof row.title === 'string' ? row.title : '',
		mind: typeof row.mind === 'string' ? row.mind : '',
		refl: typeof row.refl === 'string' ? row.refl : '',
		mood: typeof row.mood === 'string' ? row.mood : '',
		pageCount: Number(row.pageCount) || 1,
		videoPath: typeof row.videoPath === 'string' ? row.videoPath : null,
		videoThumbPath: typeof row.videoThumbPath === 'string' ? row.videoThumbPath : null,
		videoName: typeof row.videoName === 'string' ? row.videoName : null
	};
}

function mapForwarded(value: unknown): DmForwarded | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	const body = typeof row.body === 'string' ? row.body : '';
	if (!body) return null;
	return {
		name: typeof row.name === 'string' ? row.name : 'Someone',
		body
	};
}

function mapInboxRow(row: InboxRow): DmThreadSummary {
	return {
		threadId: row.thread_id,
		kind: row.kind === 'group' ? 'group' : 'direct',
		title: row.title,
		members: mapMembers(row.members),
		lastBody: row.last_body,
		lastImagePath: row.last_image_path ?? null,
		lastGifUrl: row.last_gif_url ?? null,
		lastSender: row.last_sender,
		lastSenderName: row.last_sender_name,
		lastAt: row.last_at,
		unreadCount: Number(row.unread_count) || 0,
		canReply: Boolean(row.can_reply),
		lastSharedEntry: mapSharedEntry(row.last_shared_entry),
		lastDeleted: Boolean(row.last_deleted),
		lastDeletedByName: row.last_deleted_by_name ?? null
	};
}

type MessageExtras = Pick<
	DmMessage,
	| 'editedAt'
	| 'deletedAt'
	| 'deletedByName'
	| 'replyTo'
	| 'replySender'
	| 'replyBody'
	| 'replyDeleted'
	| 'sharedEntry'
	| 'forwardedFrom'
	| 'reactions'
	| 'pinned'
	| 'seenBy'
	| 'filePath'
	| 'fileName'
	| 'fileMime'
	| 'fileSize'
>;

/** Fills in defaults so a row from an older database still renders safely. */
function messageDefaults(row: Record<string, unknown>): MessageExtras {
	return {
		editedAt: typeof row.edited_at === 'string' ? row.edited_at : null,
		deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
		deletedByName: typeof row.deleted_by_name === 'string' ? row.deleted_by_name : null,
		replyTo: typeof row.reply_to === 'string' ? row.reply_to : null,
		replySender: typeof row.reply_sender === 'string' ? row.reply_sender : null,
		replyBody: typeof row.reply_body === 'string' ? row.reply_body : null,
		replyDeleted: Boolean(row.reply_deleted),
		sharedEntry: mapSharedEntry(row.shared_entry),
		forwardedFrom: mapForwarded(row.forwarded_from),
		reactions: mapReactions(row.reactions),
		pinned: Boolean(row.pinned),
		seenBy: mapSeenBy(row.seen_by),
		filePath: typeof row.file_path === 'string' ? row.file_path : null,
		fileName: typeof row.file_name === 'string' ? row.file_name : null,
		fileMime: typeof row.file_mime === 'string' ? row.file_mime : null,
		fileSize: typeof row.file_size === 'number' ? row.file_size : null
	};
}

function mapMessage(row: MessageRow): DmMessage {
	return {
		id: row.id,
		threadId: row.thread_id,
		senderId: row.sender_id,
		clientId: row.client_id,
		senderName: safeName(row.sender_name),
		senderUsername: row.sender_username || 'student',
		senderAvatar: normalizeImageUrl(row.sender_avatar),
		body: row.body,
		imagePath: row.image_path ?? null,
		gifUrl: row.gif_url ?? null,
		createdAt: row.created_at,
		...messageDefaults(row)
	};
}

function mapMember(row: MemberRow): DmThreadMember {
	return {
		userId: row.user_id,
		name: safeName(row.name),
		username: row.username || 'student',
		avatar: normalizeImageUrl(row.avatar),
		role: row.role === 'owner' ? 'owner' : 'member',
		joinedAt: row.joined_at,
		isMe: Boolean(row.is_me),
		nickname: typeof row.nickname === 'string' ? row.nickname : ''
	};
}

/** Dedupes by client id, keeping server rows over optimistic bubbles. */
function mergeMessages(...lists: DmMessage[][]) {
	const byKey: Record<string, DmMessage> = {};

	for (const message of lists.flat()) {
		const key = message.clientId || message.id;
		const current = byKey[key];

		if (
			!current ||
			(current.pending && !message.pending) ||
			(!current.pending && !message.pending)
		) {
			byKey[key] = message;
		}
	}

	return Object.values(byKey).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function newClientId() {
	try {
		return crypto.randomUUID();
	} catch {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
			const value = (Math.random() * 16) | 0;
			const digit = char === 'x' ? value : (value & 0x3) | 0x8;
			return digit.toString(16);
		});
	}
}

class MessagesState {
	threads = $state<DmThreadSummary[]>([]);
	messagesByThread = $state<Record<string, DmMessage[]>>({});
	membersByThread = $state<Record<string, DmThreadMember[]>>({});
	hasMoreByThread = $state<Record<string, boolean>>({});
	/** Signed URLs for photo messages, keyed by storage path. */
	imageUrls = $state<Record<string, string>>({});
	/** Signed URLs for videos on shared journal cards, keyed by storage path. */
	videoUrls = $state<Record<string, string>>({});
	/** Signed URLs for shared documents, keyed by storage path. */
	fileUrls = $state<Record<string, string>>({});
	/** Settings for the open conversation, including its personal theme. */
	chatSettings = $state<Record<string, ChatSettings>>({});
	/** Pinned messages in the open conversation, loaded on demand. */
	pinnedMessages = $state<DmMessage[]>([]);
	loadingPinned = $state(false);
	/** Fetched link previews, keyed by the exact URL found in a message. */
	linkPreviews = $state<Record<string, LinkPreview | null>>({});

	activeThreadId = $state<string | null>(null);
	/** Message being replied to, shown in the composer. */
	replyTo = $state<DmMessage | null>(null);
	currentUserId = $state('');
	/** True while the Messages panel is on screen, so hidden threads still count unread. */
	panelVisible = $state(false);
	loadingInbox = $state(false);
	loadingThread = $state(false);
	loadingOlder = $state(false);
	creatingGroup = $state(false);
	error = $state('');
	notice = $state('');
	/** Bumped whenever the conversation should scroll to the newest message. */
	scrollRequest = $state(0);

	private initializedFor = '';
	private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
	private inboxTimer: ReturnType<typeof setTimeout> | null = null;
	private inboxTimerForce = false;
	private inboxQueued = false;
	private inboxQueuedForce = false;
	private lastInboxAt = 0;
	private imageRequests = new Set<string>();
	private videoRequests = new Set<string>();
	private fileRequests = new Set<string>();
	/** Signed URL expiry per storage path, used to refresh and evict the cache. */
	private imageUrlExpiry: Record<string, number> = {};
	private videoUrlExpiry: Record<string, number> = {};
	private fileUrlExpiry: Record<string, number> = {};
	/** Read receipts waiting to be written, coalesced per thread. */
	private readTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	private readPending = new Set<string>();

	get ready() {
		return isSupabaseConfigured && auth.signedIn;
	}

	get unreadTotal() {
		return this.threads.reduce((total, thread) => total + thread.unreadCount, 0);
	}

	get activeThread() {
		if (!this.activeThreadId) return null;
		return this.threads.find((thread) => thread.threadId === this.activeThreadId) ?? null;
	}

	get activeMessages() {
		if (!this.activeThreadId) return [];
		return this.messagesByThread[this.activeThreadId] ?? [];
	}

	get activeMembers() {
		if (!this.activeThreadId) return [];
		return this.membersByThread[this.activeThreadId] ?? [];
	}

	get activeHasMore() {
		if (!this.activeThreadId) return false;
		return this.hasMoreByThread[this.activeThreadId] ?? false;
	}

	get activeChatSettings(): ChatSettings | null {
		if (!this.activeThreadId) return null;
		return this.chatSettings[this.activeThreadId] ?? null;
	}

	get activeTheme() {
		return this.activeChatSettings?.theme ?? 'classic';
	}

	/** The current user's pinned messages in the open thread, oldest pin first. */
	get activePinned() {
		return this.activeMessages.filter((message) => message.pinned);
	}

	/** The other person in a direct conversation. */
	peerFor(thread: DmThreadSummary): DmParticipant | null {
		if (thread.kind !== 'direct') return null;
		const me = this.currentUserId || auth.ownerId;
		return thread.members.find((member) => member.id !== me) ?? thread.members[0] ?? null;
	}

	threadLabel(thread: DmThreadSummary) {
		if (thread.kind === 'group') return thread.title || 'Group chat';
		return this.peerFor(thread)?.name || 'Friend';
	}

	async init(userId: string) {
		if (!userId) return;
		if (this.initializedFor === userId) return;

		// clearData() resets currentUserId, so set the identity afterwards or the
		// realtime subscription below will think no one is signed in.
		this.clearData();
		this.initializedFor = userId;
		this.currentUserId = userId;

		if (!this.ready) return;

		await this.refreshInbox(true);
		this.subscribeRealtime();
	}

	async refreshInbox(force = false) {
		if (!this.ready) return;
		if (this.loadingInbox) {
			this.inboxQueued = true;
			this.inboxQueuedForce = this.inboxQueuedForce || force;
			return;
		}

		const now = Date.now();
		if (!force && this.lastInboxAt && now - this.lastInboxAt < INBOX_FRESH_MS) {
			// Re-run once the cached inbox goes stale rather than dropping the
			// update outright.
			this.scheduleInboxRefresh(this.lastInboxAt + INBOX_FRESH_MS - now);
			return;
		}

		this.loadingInbox = true;

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_inbox');
			if (error) throw error;

			const next = ((data ?? []) as InboxRow[]).map(mapInboxRow);
			const active = this.activeThread;

			// An empty direct thread is intentionally hidden from the inbox, so
			// keep the open one visible until its first message lands.
			if (active && !next.some((thread) => thread.threadId === active.threadId)) {
				next.unshift(active);
			}

			this.threads = next;
			this.lastInboxAt = Date.now();
		} catch (error) {
			console.warn('[VidJo] Could not load conversations.', error);
		} finally {
			this.loadingInbox = false;
			if (this.inboxQueued) {
				const queuedForce = this.inboxQueuedForce;
				this.inboxQueued = false;
				this.inboxQueuedForce = false;
				void this.refreshInbox(queuedForce);
			}
		}
	}

	async openThread(threadId: string) {
		if (!threadId) return;

		this.error = '';
		this.notice = '';
		this.activeThreadId = threadId;
		this.replyTo = null;

		const thread = this.activeThread;
		if (thread && !thread.canReply) {
			this.error = 'You can only message friends.';
		}

		const jobs: Promise<void>[] = [this.markRead(threadId), this.loadChatSettings(threadId)];

		if (!this.messagesByThread[threadId]) {
			jobs.push(this.loadThread(threadId));
		} else {
			this.scrollRequest += 1;
		}

		if (thread?.kind === 'group' && !this.membersByThread[threadId]) {
			jobs.push(this.loadMembers(threadId));
		}

		// Messages, read state, and group members are independent requests.
		await Promise.all(jobs);
	}

	closeThread() {
		this.activeThreadId = null;
		this.replyTo = null;
		this.error = '';
		this.notice = '';
	}

	setReply(message: DmMessage | null) {
		this.replyTo = message;
		if (message) this.focusComposer();
	}

	private focusComposer() {
		if (typeof document === 'undefined') return;
		void tick().then(() => {
			const el = document.getElementById('dm-composer') as HTMLTextAreaElement | null;
			el?.focus();
		});
	}

	/** Called by the panel so background messages are not auto-marked read. */
	setPanelVisible(visible: boolean) {
		this.panelVisible = visible;
		if (visible && this.activeThreadId) void this.markRead(this.activeThreadId);
	}

	async openDirect(friend: Friend): Promise<boolean> {
		if (!this.ready) {
			this.error = 'Messaging needs a signed-in account.';
			return false;
		}

		if (!friend?.id) return false;

		this.error = '';
		this.notice = '';

		const existing = this.threads.find(
			(thread) =>
				thread.kind === 'direct' && thread.members.some((member) => member.id === friend.id)
		);

		if (existing) {
			await this.openThread(existing.threadId);
			return true;
		}

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_open_direct', { p_friend: friend.id });
			if (error) throw error;

			const threadId = typeof data === 'string' ? data : '';
			if (!threadId) throw new Error('Could not open that conversation.');

			const summary = this.summaryForFriend(threadId, friend);
			this.threads = [summary, ...this.threads.filter((thread) => thread.threadId !== threadId)];
			await this.openThread(threadId);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async loadThread(threadId: string, older = false, pinnedOnly = false) {
		if (!this.ready || !threadId) return;

		if (older) {
			this.loadingOlder = true;
		} else {
			this.loadingThread = true;
			this.error = '';
		}

		try {
			const existing = this.messagesByThread[threadId] ?? [];
			const before = older && existing.length > 0 ? existing[0].createdAt : null;

			const { data, error } = await supabase.rpc('vidjo_dm_thread', {
				p_thread: threadId,
				p_before: before,
				p_limit: pinnedOnly ? 100 : PAGE_SIZE,
				p_pinned_only: pinnedOnly
			});
			if (error) throw error;

			const rows = ((data ?? []) as MessageRow[]).map(mapMessage);
			// Fresh server rows win over cached copies so edits, deletes and
			// reactions are reflected when a thread is reloaded.
			this.setMessages(threadId, mergeMessages(existing, rows));
			void this.ensureImageUrls(rows.map((message) => message.imagePath));
			void this.ensureFileUrls(rows.map((message) => message.filePath));
			void this.ensureVideoUrls(rows.map((message) => message.sharedEntry?.videoPath));
			this.hasMoreByThread = {
				...this.hasMoreByThread,
				[threadId]: rows.length >= PAGE_SIZE
			};

			if (!older) this.scrollRequest += 1;
		} catch (error) {
			this.error = errorMessage(error);
		} finally {
			this.loadingOlder = false;
			this.loadingThread = false;
		}
	}

	async loadOlder() {
		if (!this.activeThreadId) return;
		await this.loadThread(this.activeThreadId, true);
	}

	async loadMembers(threadId: string) {
		if (!this.ready || !threadId) return;

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_thread_members', { p_thread: threadId });
			if (error) throw error;

			this.membersByThread = {
				...this.membersByThread,
				[threadId]: ((data ?? []) as MemberRow[]).map(mapMember)
			};
		} catch (error) {
			console.warn('[VidJo] Could not load group members.', error);
		}
	}

	async loadChatSettings(threadId: string) {
		if (!this.ready || !threadId) return;
		try {
			const { data, error } = await supabase.rpc('vidjo_dm_chat_settings', {
				p_thread: threadId
			});
			if (error) throw error;
			const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
			if (!row) return;
			this.chatSettings = {
				...this.chatSettings,
				[threadId]: {
					threadId,
					kind: row.kind === 'group' ? 'group' : 'direct',
					title: typeof row.title === 'string' ? row.title : null,
					photoPath: typeof row.photo_path === 'string' ? row.photo_path : null,
					theme: typeof row.theme === 'string' ? row.theme : 'classic',
					createdAt: typeof row.created_at === 'string' ? row.created_at : '',
					memberCount: typeof row.member_count === 'number' ? row.member_count : 0
				}
			};
			void this.ensureImageUrls([row.photo_path as string | null]);
		} catch (error) {
			console.warn('[VidJo] Could not load chat settings.', error);
		}
	}

	/** Reloads every pinned message in the open thread, not just the loaded page. */
	async loadPinnedMessages() {
		const threadId = this.activeThreadId;
		if (!this.ready || !threadId) return;

		this.loadingPinned = true;
		try {
			const { data, error } = await supabase.rpc('vidjo_dm_thread', {
				p_thread: threadId,
				p_limit: 100,
				p_pinned_only: true
			});
			if (error) throw error;
			const rows = ((data ?? []) as MessageRow[]).map(mapMessage);
			this.pinnedMessages = rows;
			void this.ensureImageUrls(rows.map((message) => message.imagePath));
			void this.ensureFileUrls(rows.map((message) => message.filePath));
		} catch (error) {
			this.error = errorMessage(error);
			this.pinnedMessages = [];
		} finally {
			this.loadingPinned = false;
		}
	}

	async send(body: string): Promise<boolean> {
		const threadId = this.activeThreadId;
		const trimmed = body.trim();

		if (!threadId || !trimmed) return false;

		const thread = this.activeThread;
		if (!thread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		this.error = '';
		const clientId = newClientId();
		const optimistic = this.optimisticMessage(threadId, clientId, trimmed, null);
		const reply = this.replyTo;
		if (reply) {
			optimistic.replyTo = reply.id;
			optimistic.replySender = reply.senderName;
			optimistic.replyBody = reply.deletedAt ? '' : reply.body;
			optimistic.replyDeleted = Boolean(reply.deletedAt);
		}

		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;

		const ok = await this.transmit(
			threadId,
			clientId,
			trimmed,
			null,
			null,
			optimistic,
			reply?.id ?? null
		);
		if (ok && reply && this.replyTo?.clientId === reply.clientId) this.replyTo = null;
		return ok;
	}

	async editMessage(message: DmMessage, body: string): Promise<boolean> {
		const clean = body.trim().slice(0, 2000);
		if (!clean || message.pending || message.deletedAt) return false;

		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_edit_message', {
				p_message: message.id,
				p_body: clean
			});
			if (error) throw error;

			this.patchMessage(message.threadId, message.clientId, {
				body: clean,
				editedAt: new Date().toISOString()
			});
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async deleteMessage(message: DmMessage): Promise<boolean> {
		if (message.pending || message.deletedAt) return false;

		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_delete_message', {
				p_message: message.id
			});
			if (error) throw error;

			this.patchMessage(message.threadId, message.clientId, {
				body: '',
				imagePath: null,
				gifUrl: null,
				sharedEntry: null,
				forwardedFrom: null,
				replyTo: null,
				deletedAt: new Date().toISOString(),
				deletedByName: this.senderInfo(message.senderId).name
			});
			void this.scheduleInboxRefresh(0, true);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async toggleReaction(message: DmMessage, emoji: string): Promise<boolean> {
		if (message.pending || message.deletedAt) return false;

		const before = message.reactions;
		const existing = before.find((reaction) => reaction.emoji === emoji);
		const after = existing
			? before
					.map((reaction) =>
						reaction.emoji === emoji
							? { ...reaction, count: reaction.count - 1, mine: !reaction.mine }
							: reaction
					)
					.filter((reaction) => reaction.count > 0)
			: [...before, { emoji, count: 1, mine: true }];

		this.patchMessage(message.threadId, message.clientId, { reactions: after });

		try {
			const { error } = await supabase.rpc('vidjo_dm_toggle_reaction', {
				p_message: message.id,
				p_emoji: emoji
			});
			if (error) throw error;
			return true;
		} catch (error) {
			this.patchMessage(message.threadId, message.clientId, { reactions: before });
			this.error = errorMessage(error);
			return false;
		}
	}

	async togglePin(message: DmMessage): Promise<boolean> {
		if (message.pending || message.deletedAt) return false;

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_toggle_pin', {
				p_message: message.id
			});
			if (error) throw error;

			const pinned = typeof data === 'boolean' ? data : !message.pinned;
			this.patchMessage(message.threadId, message.clientId, { pinned });
			this.notice = pinned ? 'Pinned in this conversation.' : 'Removed from your pins.';
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	/** Sends a snapshot of a journal page as a rich card. */
	async sendEntry(entry: SharedJournalEntry): Promise<boolean> {
		const threadId = this.activeThreadId;
		if (!threadId || !this.activeThread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		this.error = '';
		const clientId = newClientId();
		const optimistic = this.optimisticMessage(threadId, clientId, '', null);
		optimistic.sharedEntry = entry;
		const reply = this.replyTo;
		if (reply) {
			optimistic.replyTo = reply.id;
			optimistic.replySender = reply.senderName;
			optimistic.replyBody = reply.deletedAt ? '' : reply.body;
		}

		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;
		if (entry.videoPath) void this.ensureVideoUrls([entry.videoPath]);

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_send_entry', {
				p_thread: threadId,
				p_entry: entry,
				p_client_id: clientId,
				p_reply_to: reply?.id ?? null
			});
			if (error) throw error;

			const row = Array.isArray(data) ? data[0] : data;
			if (row && typeof row === 'object') {
				const record = row as Record<string, unknown>;
				const sender = this.senderInfo(this.currentUserId || auth.ownerId);
				const message: DmMessage = {
					id: typeof record.id === 'string' ? record.id : optimistic.id,
					threadId,
					senderId: typeof record.sender_id === 'string' ? record.sender_id : optimistic.senderId,
					clientId: typeof record.client_id === 'string' ? record.client_id : clientId,
					senderName: sender.name,
					senderUsername: sender.username,
					senderAvatar: sender.avatar,
					body: typeof record.body === 'string' ? record.body : '',
					imagePath: typeof record.image_path === 'string' ? record.image_path : null,
					gifUrl: typeof record.gif_url === 'string' ? record.gif_url : null,
					createdAt:
						typeof record.created_at === 'string' ? record.created_at : optimistic.createdAt,
					...messageDefaults(record),
					sharedEntry: entry,
					replyTo: optimistic.replyTo,
					replySender: optimistic.replySender,
					replyBody: optimistic.replyBody
				};
				this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [message]));
				this.applyPreview(threadId, message);
			}

			if (reply && this.replyTo?.clientId === reply.clientId) this.replyTo = null;
			return true;
		} catch (error) {
			this.setMessages(
				threadId,
				(this.messagesByThread[threadId] ?? []).filter((item) => item.clientId !== clientId)
			);
			this.error = errorMessage(error);
			return false;
		}
	}

	async forwardTo(message: DmMessage, threadId: string): Promise<boolean> {
		if (!threadId || message.pending || message.deletedAt) return false;

		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_forward', {
				p_thread: threadId,
				p_source: message.id,
				p_client_id: newClientId()
			});
			if (error) throw error;

			this.notice = 'Message forwarded.';
			if (threadId === this.activeThreadId) {
				await this.loadThread(threadId);
			} else {
				void this.scheduleInboxRefresh(0, true);
			}
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	private patchMessage(threadId: string, clientId: string, patch: Partial<DmMessage>) {
		this.setMessages(
			threadId,
			(this.messagesByThread[threadId] ?? []).map((item) =>
				item.clientId === clientId ? { ...item, ...patch } : item
			)
		);
	}

	private applyReplyMeta(message: DmMessage, reply: DmMessage | null) {
		if (!reply) return;
		message.replyTo = reply.id;
		message.replySender = reply.senderName;
		message.replyBody = reply.deletedAt ? '' : reply.body;
	}

	async sendGif(gif: GiphyGif, caption = ''): Promise<boolean> {
		const threadId = this.activeThreadId;
		if (!threadId || !gif?.fullUrl) return false;

		const thread = this.activeThread;
		if (!thread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		if (!isGiphyMediaUrl(gif.fullUrl)) {
			this.error = 'That GIF could not be sent.';
			return false;
		}

		const cleanCaption = caption.trim().slice(0, 2000);
		const clientId = newClientId();
		const reply = this.replyTo;
		const optimistic = this.optimisticMessage(threadId, clientId, cleanCaption, null, gif.fullUrl);
		this.applyReplyMeta(optimistic, reply);

		this.error = '';
		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;

		const ok = await this.transmit(
			threadId,
			clientId,
			cleanCaption,
			null,
			gif.fullUrl,
			optimistic,
			reply?.id ?? null
		);
		if (ok && reply && this.replyTo?.clientId === reply.clientId) this.replyTo = null;
		return ok;
	}

	async sendImage(file: File, caption = ''): Promise<boolean> {
		const threadId = this.activeThreadId;
		if (!threadId || !file) return false;

		const thread = this.activeThread;
		if (!thread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		if (file.size > DM_IMAGE_MAX_BYTES) {
			this.error = 'Photos must be 5 MB or smaller.';
			return false;
		}

		// Trust the bytes, not the browser-supplied MIME type.
		const detected = await detectRasterImageMime(file);
		if (!detected || !DM_IMAGE_TYPES[detected]) {
			this.error = 'Choose a PNG, JPG, GIF, or WebP photo.';
			return false;
		}

		const userId = this.currentUserId || auth.ownerId;
		if (!userId) {
			this.error = 'Messaging needs a signed-in account.';
			return false;
		}

		const cleanCaption = caption.trim().slice(0, 2000);
		const clientId = newClientId();
		const reply = this.replyTo;
		const previewUrl = URL.createObjectURL(file);
		const optimistic = this.optimisticMessage(
			threadId,
			clientId,
			cleanCaption,
			null,
			null,
			previewUrl
		);
		this.applyReplyMeta(optimistic, reply);

		this.error = '';
		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;

		const path = `${threadId}/${userId}/${clientId}.${DM_IMAGE_TYPES[detected]}`;
		let uploaded = false;

		try {
			const { error: uploadError } = await supabase.storage
				.from(DM_IMAGE_BUCKET)
				.upload(path, file, {
					cacheControl: '3600',
					contentType: detected,
					upsert: false
				});
			if (uploadError) throw uploadError;
			uploaded = true;

			const { data: signed, error: signError } = await supabase.storage
				.from(DM_IMAGE_BUCKET)
				.createSignedUrl(path, DM_IMAGE_TTL_SECONDS);
			if (signError) throw signError;
			if (signed?.signedUrl) this.rememberImageUrl(path, signed.signedUrl);

			const ok = await this.transmit(
				threadId,
				clientId,
				cleanCaption,
				path,
				null,
				optimistic,
				reply?.id ?? null
			);
			if (ok && reply && this.replyTo?.clientId === reply.clientId) this.replyTo = null;

			if (!ok) {
				// The message row was never created, so do not leave an orphan file.
				await this.removeImage(path);
				uploaded = false;
			}

			return ok;
		} catch (error) {
			if (uploaded) await this.removeImage(path);
			this.setMessages(
				threadId,
				(this.messagesByThread[threadId] ?? []).filter((message) => message.clientId !== clientId)
			);
			this.error = errorMessage(error);
			return false;
		} finally {
			URL.revokeObjectURL(previewUrl);
		}
	}

	/**
	 * Sends a PDF or Word document. Executables and other file types are
	 * rejected from the bytes, not just the filename or browser MIME type.
	 */
	async sendFile(file: File, caption = ''): Promise<boolean> {
		const threadId = this.activeThreadId;
		if (!threadId || !file) return false;

		const thread = this.activeThread;
		if (!thread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		if (file.size > DM_FILE_MAX_BYTES) {
			this.error = 'Files must be 20 MB or smaller.';
			return false;
		}

		const detected = await detectDocumentMime(file);
		if (!detected || !DM_FILE_TYPES[detected]) {
			this.error = 'Only PDF and Word documents are allowed.';
			return false;
		}

		const userId = this.currentUserId || auth.ownerId;
		if (!userId) {
			this.error = 'Messaging needs a signed-in account.';
			return false;
		}

		const cleanCaption = caption.trim().slice(0, 2000);
		const clientId = newClientId();
		const reply = this.replyTo;
		const fileMeta = {
			path: `${threadId}/${userId}/${clientId}.${documentExtension(detected)}`,
			name: file.name.slice(0, 180),
			mime: detected,
			size: file.size
		};

		const optimistic = this.optimisticMessage(
			threadId,
			clientId,
			cleanCaption,
			null,
			null,
			undefined,
			fileMeta
		);
		this.applyReplyMeta(optimistic, reply);

		this.error = '';
		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;

		let uploaded = false;
		try {
			const { error: uploadError } = await supabase.storage
				.from(DM_FILE_BUCKET)
				.upload(fileMeta.path, file, {
					cacheControl: '3600',
					contentType: detected,
					upsert: false
				});
			if (uploadError) throw uploadError;
			uploaded = true;

			const ok = await this.transmit(
				threadId,
				clientId,
				cleanCaption,
				null,
				null,
				optimistic,
				reply?.id ?? null,
				fileMeta
			);
			if (ok && reply && this.replyTo?.clientId === reply.clientId) this.replyTo = null;
			if (ok) void this.ensureFileUrls([fileMeta.path]);
			if (!ok) {
				await this.removeFile(fileMeta.path);
				uploaded = false;
			}
			return ok;
		} catch (error) {
			if (uploaded) await this.removeFile(fileMeta.path);
			this.setMessages(
				threadId,
				(this.messagesByThread[threadId] ?? []).filter((message) => message.clientId !== clientId)
			);
			this.error = errorMessage(error);
			return false;
		}
	}

	private async removeFile(path: string) {
		const next = { ...this.fileUrls };
		delete next[path];
		this.fileUrls = next;
		delete this.fileUrlExpiry[path];

		try {
			await supabase.storage.from(DM_FILE_BUCKET).remove([path]);
		} catch {
			// Best effort cleanup.
		}
	}

	private async removeImage(path: string) {
		const next = { ...this.imageUrls };
		delete next[path];
		this.imageUrls = next;
		delete this.imageUrlExpiry[path];

		try {
			await supabase.storage.from(DM_IMAGE_BUCKET).remove([path]);
		} catch {
			// Best effort cleanup.
		}
	}

	private optimisticMessage(
		threadId: string,
		clientId: string,
		body: string,
		imagePath: string | null,
		gifUrl: string | null = null,
		previewUrl?: string,
		file?: { path: string; name: string; mime: string; size: number }
	): DmMessage {
		return {
			id: `pending:${clientId}`,
			threadId,
			senderId: this.currentUserId || auth.ownerId,
			clientId,
			senderName: profile.displayName,
			senderUsername: profile.username || 'student',
			senderAvatar: profile.avatarUrl,
			body,
			imagePath,
			gifUrl,
			filePath: file?.path ?? null,
			fileName: file?.name ?? null,
			fileMime: file?.mime ?? null,
			fileSize: file?.size ?? null,
			previewUrl,
			createdAt: new Date().toISOString(),
			pending: true,
			editedAt: null,
			deletedAt: null,
			deletedByName: null,
			replyTo: null,
			replySender: null,
			replyBody: null,
			replyDeleted: false,
			sharedEntry: null,
			forwardedFrom: null,
			reactions: [],
			pinned: false,
			seenBy: []
		};
	}

	private async transmit(
		threadId: string,
		clientId: string,
		body: string,
		imagePath: string | null,
		gifUrl: string | null,
		optimistic: DmMessage,
		replyTo: string | null = null,
		file?: { path: string; name: string; mime: string; size: number }
	): Promise<boolean> {
		try {
			// Older databases only know the 3-argument function. Text messages
			// therefore omit attachment arguments so they keep working until the
			// photo/GIF schema is applied. Photos need the 4-argument version and
			// GIFs need the 5-argument version.
			const params: Record<string, string | null> = {
				p_thread: threadId,
				p_body: body,
				p_client_id: clientId
			};
			if (imagePath) params.p_image_path = imagePath;
			if (gifUrl) params.p_gif_url = gifUrl;
			if (replyTo) params.p_reply_to = replyTo;
			if (file) {
				params.p_file_path = file.path;
				params.p_file_name = file.name;
				params.p_file_mime = file.mime;
				params.p_file_size = String(file.size);
			}

			const { data, error } = await supabase.rpc('vidjo_dm_send', params);
			if (error) throw error;

			const row = Array.isArray(data) ? data[0] : data;

			if (row && typeof row === 'object') {
				const record = row as Record<string, unknown>;
				const sender = this.senderInfo(this.currentUserId || auth.ownerId);
				const message: DmMessage = {
					id: typeof record.id === 'string' ? record.id : `pending:${clientId}`,
					threadId: typeof record.thread_id === 'string' ? record.thread_id : threadId,
					senderId: typeof record.sender_id === 'string' ? record.sender_id : optimistic.senderId,
					clientId: typeof record.client_id === 'string' ? record.client_id : clientId,
					senderName: sender.name,
					senderUsername: sender.username,
					senderAvatar: sender.avatar,
					body: typeof record.body === 'string' ? record.body : body,
					imagePath: typeof record.image_path === 'string' ? record.image_path : imagePath,
					gifUrl: typeof record.gif_url === 'string' ? record.gif_url : gifUrl,
					createdAt:
						typeof record.created_at === 'string' ? record.created_at : optimistic.createdAt,
					...messageDefaults(record),
					// Keep optimistic-only reply metadata when the database does not
					// echo it back on the send response.
					replyTo: optimistic.replyTo,
					replySender: optimistic.replySender,
					replyBody: optimistic.replyBody,
					replyDeleted: optimistic.replyDeleted
				};

				this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [message]));
				this.applyPreview(threadId, message);
			}

			return true;
		} catch (error) {
			this.setMessages(
				threadId,
				(this.messagesByThread[threadId] ?? []).filter((message) => message.clientId !== clientId)
			);
			this.error = errorMessage(error);
			return false;
		}
	}

	private rememberImageUrl(path: string, url: string) {
		this.imageUrls = { ...this.imageUrls, [path]: url };
		this.imageUrlExpiry[path] = Date.now() + DM_IMAGE_TTL_SECONDS * 1000;

		const keys = Object.keys(this.imageUrls);
		if (keys.length <= IMAGE_URL_CACHE_MAX) return;

		// Evict the soonest-to-expire URLs so a long session cannot grow forever.
		const stale = keys
			.sort((a, b) => (this.imageUrlExpiry[a] ?? 0) - (this.imageUrlExpiry[b] ?? 0))
			.slice(0, keys.length - IMAGE_URL_CACHE_MAX);
		const next = { ...this.imageUrls };
		for (const key of stale) {
			delete next[key];
			delete this.imageUrlExpiry[key];
		}
		this.imageUrls = next;
	}

	private async ensureImageUrls(paths: (string | null | undefined)[]) {
		const now = Date.now();
		const wanted = [
			...new Set(
				paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
			)
		];

		const missing = wanted.filter((path) => {
			if (this.imageRequests.has(path)) return false;
			const url = this.imageUrls[path];
			if (!url) return true;
			const expires = this.imageUrlExpiry[path] ?? 0;
			return expires - now < IMAGE_URL_REFRESH_BEFORE_MS;
		});

		if (missing.length === 0) return;

		missing.forEach((path) => this.imageRequests.add(path));

		try {
			// One request signs a whole page of photos.
			const { data, error } = await supabase.storage
				.from(DM_IMAGE_BUCKET)
				.createSignedUrls(missing, DM_IMAGE_TTL_SECONDS);
			if (error) throw error;

			for (const item of data ?? []) {
				if (item?.path && item.signedUrl) this.rememberImageUrl(item.path, item.signedUrl);
			}
		} catch (error) {
			// A single bad path should not blank every photo, so fall back to
			// signing one at a time.
			await Promise.all(
				missing.map(async (path) => {
					if (this.imageUrls[path]) return;
					try {
						const { data, error } = await supabase.storage
							.from(DM_IMAGE_BUCKET)
							.createSignedUrl(path, DM_IMAGE_TTL_SECONDS);
						if (error) throw error;
						if (data?.signedUrl) this.rememberImageUrl(path, data.signedUrl);
					} catch (inner) {
						console.warn('[VidJo] Could not open a message photo.', inner);
					}
				})
			);
			if (!this.imageUrls[missing[0]]) {
				console.warn('[VidJo] Could not open message photos.', error);
			}
		} finally {
			missing.forEach((path) => this.imageRequests.delete(path));
		}
	}

	private async ensureFileUrls(paths: (string | null | undefined)[]) {
		const now = Date.now();
		const wanted = [
			...new Set(
				paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
			)
		];
		const missing = wanted.filter((path) => {
			if (this.fileRequests.has(path)) return false;
			if (
				this.fileUrls[path] &&
				(this.fileUrlExpiry[path] ?? 0) - now > IMAGE_URL_REFRESH_BEFORE_MS
			) {
				return false;
			}
			return true;
		});
		if (missing.length === 0) return;

		missing.forEach((path) => this.fileRequests.add(path));
		try {
			const { data, error } = await supabase.storage
				.from(DM_FILE_BUCKET)
				.createSignedUrls(missing, DM_IMAGE_TTL_SECONDS);
			if (error) throw error;
			for (const item of data ?? []) {
				if (item?.path && item.signedUrl) {
					this.fileUrls = { ...this.fileUrls, [item.path]: item.signedUrl };
					this.fileUrlExpiry[item.path] = Date.now() + DM_IMAGE_TTL_SECONDS * 1000;
				}
			}
		} catch (error) {
			await Promise.all(
				missing.map(async (path) => {
					if (this.fileUrls[path]) return;
					try {
						const { data, error: singleError } = await supabase.storage
							.from(DM_FILE_BUCKET)
							.createSignedUrl(path, DM_IMAGE_TTL_SECONDS);
						if (singleError) throw singleError;
						if (data?.signedUrl) {
							this.fileUrls = { ...this.fileUrls, [path]: data.signedUrl };
							this.fileUrlExpiry[path] = Date.now() + DM_IMAGE_TTL_SECONDS * 1000;
						}
					} catch (inner) {
						console.warn('[VidJo] Could not open a shared file.', inner);
					}
				})
			);
			if (!this.fileUrls[missing[0]]) console.warn('[VidJo] Could not open shared files.', error);
		} finally {
			missing.forEach((path) => this.fileRequests.delete(path));
		}
	}

	private async ensureVideoUrls(paths: (string | null | undefined)[]) {
		const now = Date.now();
		const wanted = [
			...new Set(
				paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
			)
		];
		const missing = wanted.filter((path) => {
			if (this.videoRequests.has(path)) return false;
			const url = this.videoUrls[path];
			if (!url) return true;
			return (this.videoUrlExpiry[path] ?? 0) - now < VIDEO_URL_REFRESH_BEFORE_MS;
		});
		if (missing.length === 0) return;

		missing.forEach((path) => this.videoRequests.add(path));
		try {
			const { data, error } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrls(missing, VIDEO_URL_TTL_SECONDS);
			if (error) throw error;
			for (const item of data ?? []) {
				if (item?.path && item.signedUrl) {
					this.videoUrls = { ...this.videoUrls, [item.path]: item.signedUrl };
					this.videoUrlExpiry[item.path] = Date.now() + VIDEO_URL_TTL_SECONDS * 1000;
				}
			}
		} catch {
			await Promise.all(
				missing.map(async (path) => {
					if (this.videoUrls[path]) return;
					try {
						const { data, error: signError } = await supabase.storage
							.from(VIDEO_BUCKET)
							.createSignedUrl(path, VIDEO_URL_TTL_SECONDS);
						if (signError) throw signError;
						if (data?.signedUrl) {
							this.videoUrls = { ...this.videoUrls, [path]: data.signedUrl };
							this.videoUrlExpiry[path] = Date.now() + VIDEO_URL_TTL_SECONDS * 1000;
						}
					} catch {
						// A page may be private; the card still shows its writing.
					}
				})
			);
		} finally {
			missing.forEach((path) => this.videoRequests.delete(path));
		}
	}

	async markRead(threadId: string) {
		if (!threadId) return;

		const thread = this.threads.find((item) => item.threadId === threadId);
		const hadUnread = Boolean(thread && thread.unreadCount > 0);

		if (hadUnread) {
			this.threads = this.threads.map((item) =>
				item.threadId === threadId ? { ...item, unreadCount: 0 } : item
			);
		}

		if (!this.ready) return;
		// The inbox already said nothing is unread, so there is nothing to write.
		if (!hadUnread && !this.readPending.has(threadId)) return;

		// Opening a thread clears its badge right away; only live messages wait.
		this.queueRead(threadId, 0);
	}

	/** Writes a read receipt at most once per second per thread. */
	private queueRead(threadId: string, delay = READ_DEBOUNCE_MS) {
		if (!this.ready || !threadId) return;

		this.readPending.add(threadId);
		const existing = this.readTimers[threadId];
		if (existing && delay > 0) return;
		if (existing) clearTimeout(existing);

		this.readTimers[threadId] = setTimeout(
			() => {
				delete this.readTimers[threadId];
				void this.flushRead(threadId);
			},
			Math.max(0, delay)
		);
	}

	private async flushRead(threadId: string) {
		this.readPending.delete(threadId);

		try {
			const { error } = await supabase.rpc('vidjo_dm_mark_read', { p_thread: threadId });
			if (error) throw error;
		} catch {
			// Read state is best effort; the next inbox refresh will correct it.
		}
	}

	async createGroup(title: string, memberIds: string[]): Promise<boolean> {
		if (!this.ready) {
			this.error = 'Messaging needs a signed-in account.';
			return false;
		}

		const cleanTitle = title.trim();
		if (!cleanTitle) {
			this.error = 'Give your group a name.';
			return false;
		}

		if (memberIds.length === 0) {
			this.error = 'Choose at least one friend.';
			return false;
		}

		this.creatingGroup = true;
		this.error = '';

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_create_group', {
				p_title: cleanTitle,
				p_member_ids: memberIds
			});
			if (error) throw error;

			const threadId = typeof data === 'string' ? data : '';
			await this.refreshInbox(true);
			if (threadId) await this.openThread(threadId);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		} finally {
			this.creatingGroup = false;
		}
	}

	async addMembers(threadId: string, memberIds: string[]) {
		if (!this.ready || !threadId || memberIds.length === 0) return false;

		this.error = '';

		try {
			const { error } = await supabase.rpc('vidjo_dm_add_members', {
				p_thread: threadId,
				p_member_ids: memberIds
			});
			if (error) throw error;

			await this.loadMembers(threadId);
			await this.refreshInbox(true);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async removeMember(threadId: string, userId: string) {
		if (!this.ready || !threadId || !userId) return false;

		this.error = '';

		try {
			const { error } = await supabase.rpc('vidjo_dm_remove_member', {
				p_thread: threadId,
				p_user: userId
			});
			if (error) throw error;

			await this.loadMembers(threadId);
			await this.refreshInbox(true);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async renameGroup(threadId: string, title: string) {
		if (!this.ready || !threadId) return false;

		const cleanTitle = title.trim();
		if (!cleanTitle) {
			this.error = 'Give your group a name.';
			return false;
		}

		this.error = '';

		try {
			const { error } = await supabase.rpc('vidjo_dm_rename_group', {
				p_thread: threadId,
				p_title: cleanTitle
			});
			if (error) throw error;

			this.threads = this.threads.map((thread) =>
				thread.threadId === threadId ? { ...thread, title: cleanTitle } : thread
			);
			await this.refreshInbox(true);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async setChatTheme(threadId: string, theme: string) {
		if (!this.ready || !threadId) return false;
		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_set_chat_theme', {
				p_thread: threadId,
				p_theme: theme
			});
			if (error) throw error;
			const current = this.chatSettings[threadId];
			if (current) {
				this.chatSettings = { ...this.chatSettings, [threadId]: { ...current, theme } };
			}
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async setChatPhoto(threadId: string, file: File): Promise<boolean> {
		if (!this.ready || !threadId) return false;

		const userId = this.currentUserId || auth.ownerId;
		if (!userId) {
			this.error = 'Messaging needs a signed-in account.';
			return false;
		}
		if (file.size > DM_IMAGE_MAX_BYTES) {
			this.error = 'Photos must be 5 MB or smaller.';
			return false;
		}
		const detected = await detectRasterImageMime(file);
		if (!detected || !DM_IMAGE_TYPES[detected]) {
			this.error = 'Choose a PNG, JPG, GIF, or WebP photo.';
			return false;
		}

		const path = `${threadId}/${userId}/photo-${newClientId()}.${DM_IMAGE_TYPES[detected]}`;
		let uploaded = false;
		this.error = '';

		try {
			const { error: uploadError } = await supabase.storage
				.from(DM_IMAGE_BUCKET)
				.upload(path, file, { cacheControl: '3600', contentType: detected, upsert: false });
			if (uploadError) throw uploadError;
			uploaded = true;

			const { error } = await supabase.rpc('vidjo_dm_set_chat_photo', {
				p_thread: threadId,
				p_path: path
			});
			if (error) throw error;

			const current = this.chatSettings[threadId];
			if (current) {
				this.chatSettings = { ...this.chatSettings, [threadId]: { ...current, photoPath: path } };
			}
			void this.ensureImageUrls([path]);
			return true;
		} catch (error) {
			if (uploaded) await this.removeImage(path);
			this.error = errorMessage(error);
			return false;
		}
	}

	async setNickname(threadId: string, userId: string, nickname: string) {
		if (!this.ready || !threadId) return false;
		const clean = nickname.trim();
		if (!clean) {
			this.error = 'Enter a nickname.';
			return false;
		}

		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_set_nickname', {
				p_thread: threadId,
				p_target: userId,
				p_nickname: clean
			});
			if (error) throw error;
			await this.loadMembers(threadId);
			await this.reloadActiveThread();
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	async reportMessage(message: DmMessage, reason: string) {
		if (!this.ready || !message.id || message.pending) return false;
		const clean = reason.trim();
		if (clean.length < 3) {
			this.error = 'Add a short reason (at least 3 characters).';
			return false;
		}

		this.error = '';
		try {
			const { error } = await supabase.rpc('vidjo_dm_report_message', {
				p_message: message.id,
				p_reason: clean.slice(0, 240)
			});
			if (error) throw error;
			this.notice = 'Thanks — your report was sent to the moderators.';
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	/** Fetch Open Graph metadata once per URL, then reuse it for every bubble. */
	async fetchLinkPreview(url: string) {
		if (!url || Object.prototype.hasOwnProperty.call(this.linkPreviews, url)) return;
		this.linkPreviews = { ...this.linkPreviews, [url]: null };
		try {
			const response = await fetch('/api/link-preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const data = (await response.json()) as LinkPreview & { error?: string };
			this.linkPreviews = {
				...this.linkPreviews,
				[url]: response.ok && data.title ? data : null
			};
		} catch {
			this.linkPreviews = { ...this.linkPreviews, [url]: null };
		}
	}

	async leaveGroup(threadId: string) {
		if (!this.ready || !threadId) return false;

		this.error = '';

		try {
			const { error } = await supabase.rpc('vidjo_dm_leave_group', { p_thread: threadId });
			if (error) throw error;

			if (this.activeThreadId === threadId) this.closeThread();
			this.threads = this.threads.filter((thread) => thread.threadId !== threadId);
			await this.refreshInbox(true);
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
		}
	}

	reset() {
		this.clearData();
		this.initializedFor = '';
		this.unsubscribeRealtime();
	}

	private clearData() {
		this.threads = [];
		this.messagesByThread = {};
		this.membersByThread = {};
		this.hasMoreByThread = {};
		this.imageUrls = {};
		this.videoUrls = {};
		this.fileUrls = {};
		this.chatSettings = {};
		this.pinnedMessages = [];
		this.loadingPinned = false;
		this.linkPreviews = {};
		this.activeThreadId = null;
		this.replyTo = null;
		this.currentUserId = '';
		this.loadingInbox = false;
		this.loadingThread = false;
		this.loadingOlder = false;
		this.creatingGroup = false;
		this.error = '';
		this.notice = '';
		this.scrollRequest = 0;
		this.inboxQueued = false;
		this.inboxQueuedForce = false;
		this.inboxTimerForce = false;
		this.lastInboxAt = 0;
		this.imageRequests.clear();
		this.imageUrlExpiry = {};
		this.videoRequests.clear();
		this.videoUrlExpiry = {};
		this.fileRequests.clear();
		this.fileUrlExpiry = {};
		this.readPending.clear();
		for (const timer of Object.values(this.readTimers)) clearTimeout(timer);
		this.readTimers = {};
		if (this.inboxTimer) {
			clearTimeout(this.inboxTimer);
			this.inboxTimer = null;
		}
	}

	private setMessages(threadId: string, messages: DmMessage[]) {
		this.messagesByThread = { ...this.messagesByThread, [threadId]: messages };
	}

	private applyPreview(threadId: string, message: DmMessage) {
		const current = this.threads.find((thread) => thread.threadId === threadId);
		if (!current) return;

		const updated: DmThreadSummary = {
			...current,
			lastBody: message.body,
			lastImagePath: message.imagePath,
			lastGifUrl: message.gifUrl,
			lastSender: message.senderId,
			lastSenderName: message.senderName,
			lastAt: message.createdAt,
			lastSharedEntry: message.sharedEntry,
			lastDeleted: Boolean(message.deletedAt),
			lastDeletedByName: message.deletedByName
		};

		this.threads = [updated, ...this.threads.filter((thread) => thread.threadId !== threadId)];
	}

	private summaryForFriend(threadId: string, friend: Friend): DmThreadSummary {
		const me: DmParticipant = {
			id: this.currentUserId || auth.ownerId,
			name: profile.displayName,
			username: profile.username || 'student',
			avatar: profile.avatarUrl,
			role: 'member'
		};

		const peer: DmParticipant = {
			id: friend.id,
			name: safeName(friend.displayName),
			username: friend.username || 'student',
			avatar: normalizeImageUrl(friend.avatarUrl),
			role: 'member'
		};

		return {
			threadId,
			kind: 'direct',
			title: null,
			members: [me, peer],
			lastBody: null,
			lastImagePath: null,
			lastGifUrl: null,
			lastSender: null,
			lastSenderName: null,
			lastAt: null,
			unreadCount: 0,
			canReply: true,
			lastSharedEntry: null,
			lastDeleted: false,
			lastDeletedByName: null
		};
	}

	private senderInfo(senderId: string) {
		if (senderId === (this.currentUserId || auth.ownerId)) {
			return {
				name: profile.displayName,
				username: profile.username || 'student',
				avatar: profile.avatarUrl
			};
		}

		for (const thread of this.threads) {
			const member = thread.members.find((item) => item.id === senderId);
			if (member) {
				return { name: member.name, username: member.username, avatar: member.avatar };
			}
		}

		return { name: 'VidJo student', username: 'student', avatar: null };
	}

	private subscribeRealtime() {
		if (!isSupabaseConfigured || !auth.user || !this.currentUserId) return;

		this.unsubscribeRealtime();

		try {
			this.realtimeChannel = supabase
				.channel('vidjo-dm-live')
				.on(
					'postgres_changes',
					{ event: 'INSERT', schema: 'public', table: 'vidjo_dm_messages' },
					(payload) => this.handleMessageInsert(payload.new)
				)
				.on(
					'postgres_changes',
					{ event: 'UPDATE', schema: 'public', table: 'vidjo_dm_messages' },
					(payload) => this.handleMessageUpdate(payload.new)
				)
				.on('postgres_changes', { event: '*', schema: 'public', table: 'vidjo_dm_reactions' }, () =>
					this.reloadActiveThread()
				)
				.on('postgres_changes', { event: '*', schema: 'public', table: 'vidjo_dm_pins' }, () =>
					this.reloadActiveThread()
				)
				.on(
					'postgres_changes',
					{ event: 'UPDATE', schema: 'public', table: 'vidjo_dm_participants' },
					(payload) => this.handleParticipantUpdate(payload.new)
				)
				.on(
					'postgres_changes',
					{ event: '*', schema: 'public', table: 'vidjo_dm_threads' },
					(payload) => this.handleThreadChange(payload)
				)
				.on(
					'postgres_changes',
					{ event: 'INSERT', schema: 'public', table: 'vidjo_dm_participants' },
					() => this.scheduleInboxRefresh()
				)
				.on(
					'postgres_changes',
					{ event: 'DELETE', schema: 'public', table: 'vidjo_dm_participants' },
					(payload) => this.handleParticipantDelete(payload.old)
				)
				.subscribe();
		} catch {
			// Realtime is non-critical; the inbox still loads on demand.
		}
	}

	private handleMessageInsert(raw: unknown) {
		if (!raw || typeof raw !== 'object') return;

		const row = raw as Record<string, unknown>;
		const threadId = typeof row.thread_id === 'string' ? row.thread_id : '';
		const id = typeof row.id === 'string' ? row.id : '';
		const senderId = typeof row.sender_id === 'string' ? row.sender_id : '';
		if (!threadId || !id || !senderId) return;

		const sender = this.senderInfo(senderId);
		const message: DmMessage = {
			id,
			threadId,
			senderId,
			clientId: typeof row.client_id === 'string' ? row.client_id : id,
			senderName: sender.name,
			senderUsername: sender.username,
			senderAvatar: sender.avatar,
			body: typeof row.body === 'string' ? row.body : '',
			imagePath: typeof row.image_path === 'string' ? row.image_path : null,
			gifUrl: typeof row.gif_url === 'string' ? row.gif_url : null,
			createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
			...messageDefaults(row)
		};

		if (message.imagePath) void this.ensureImageUrls([message.imagePath]);
		if (message.filePath) void this.ensureFileUrls([message.filePath]);
		if (message.sharedEntry?.videoPath) void this.ensureVideoUrls([message.sharedEntry.videoPath]);

		const existing = this.threads.find((thread) => thread.threadId === threadId);
		const active = this.panelVisible && threadId === this.activeThreadId;
		const mine = senderId === this.currentUserId;

		if (this.messagesByThread[threadId]) {
			this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [message]));
		}

		if (existing) {
			// Update the inbox row in place instead of refetching the whole inbox
			// for every message.
			const updated: DmThreadSummary = {
				...existing,
				lastBody: message.body,
				lastImagePath: message.imagePath,
				lastGifUrl: message.gifUrl,
				lastSender: senderId,
				lastSenderName: message.senderName,
				lastAt: message.createdAt,
				lastSharedEntry: message.sharedEntry,
				lastDeleted: Boolean(message.deletedAt),
				lastDeletedByName: message.deletedByName,
				unreadCount: mine || active ? 0 : existing.unreadCount + 1
			};
			this.threads = [updated, ...this.threads.filter((thread) => thread.threadId !== threadId)];
		} else {
			// A conversation we have not seen yet: ask the server for its row.
			// Force this one so a first message is not held back by the cache.
			this.scheduleInboxRefresh(INBOX_DEBOUNCE_MS, true);
		}

		if (active && !mine) {
			this.scrollRequest += 1;
			this.queueRead(threadId);
		}
	}

	/** Applies edits, deletes and new reactions to an already-open bubble. */
	private handleMessageUpdate(raw: unknown) {
		if (!raw || typeof raw !== 'object') return;
		const row = raw as Record<string, unknown>;
		const threadId = typeof row.thread_id === 'string' ? row.thread_id : '';
		const clientId = typeof row.client_id === 'string' ? row.client_id : '';
		if (!threadId || !clientId) return;

		const current = (this.messagesByThread[threadId] ?? []).find(
			(item) => item.clientId === clientId
		);
		if (current) {
			const sender = this.senderInfo(current.senderId);
			const updated: DmMessage = {
				...current,
				...messageDefaults(row),
				body: typeof row.body === 'string' ? row.body : current.body,
				imagePath: typeof row.image_path === 'string' ? row.image_path : null,
				gifUrl: typeof row.gif_url === 'string' ? row.gif_url : null,
				senderName: sender.name
			};
			this.patchMessage(threadId, clientId, {
				body: updated.body,
				imagePath: updated.imagePath,
				gifUrl: updated.gifUrl,
				editedAt: updated.editedAt,
				deletedAt: updated.deletedAt,
				deletedByName: updated.deletedByName,
				sharedEntry: updated.sharedEntry,
				forwardedFrom: updated.forwardedFrom,
				pinned: updated.pinned
			});
		}

		void this.scheduleInboxRefresh(0, true);
	}

	/** Reactions and pins live in their own tables, so refresh the open page. */
	private reloadActiveThread() {
		const threadId = this.activeThreadId;
		if (!threadId || this.loadingThread || this.loadingOlder) return;
		void this.loadThread(threadId);
	}

	/** A peer opening the thread changes our seen receipts. */
	private handleParticipantUpdate(raw: unknown) {
		if (!raw || typeof raw !== 'object') return;
		const row = raw as Record<string, unknown>;
		if (typeof row.last_read_at !== 'string') return;
		this.reloadActiveThread();
	}

	private handleThreadChange(payload: { eventType?: string; new?: unknown }) {
		if (payload.eventType !== 'UPDATE') {
			this.scheduleInboxRefresh();
			return;
		}

		const row = (payload.new ?? {}) as Record<string, unknown>;
		const threadId = typeof row.id === 'string' ? row.id : '';
		const existing = this.threads.find((thread) => thread.threadId === threadId);

		if (!existing) {
			this.scheduleInboxRefresh();
			return;
		}

		const title = typeof row.title === 'string' ? row.title : null;
		if (title !== existing.title) {
			this.threads = this.threads.map((thread) =>
				thread.threadId === threadId ? { ...thread, title } : thread
			);
		}
		// last_message_at changes on every send, and the message insert already
		// updated the preview, so this update needs no inbox refetch.
	}

	private handleParticipantDelete(raw: unknown) {
		if (!raw || typeof raw !== 'object') return;

		const row = raw as Record<string, unknown>;
		const threadId = typeof row.thread_id === 'string' ? row.thread_id : '';
		const userId = typeof row.user_id === 'string' ? row.user_id : '';

		if (threadId && userId && userId === this.currentUserId) {
			if (this.activeThreadId === threadId) {
				this.activeThreadId = null;
				this.notice = 'You are no longer in this group.';
			}

			this.threads = this.threads.filter((thread) => thread.threadId !== threadId);
			const nextMessages = { ...this.messagesByThread };
			const nextMembers = { ...this.membersByThread };
			delete nextMessages[threadId];
			delete nextMembers[threadId];
			this.messagesByThread = nextMessages;
			this.membersByThread = nextMembers;
			// We already removed the thread locally, so no inbox refetch is needed.
			return;
		}

		this.scheduleInboxRefresh();
	}

	private scheduleInboxRefresh(delay = INBOX_DEBOUNCE_MS, force = false) {
		this.inboxTimerForce = this.inboxTimerForce || force;
		if (this.inboxTimer) clearTimeout(this.inboxTimer);
		this.inboxTimer = setTimeout(
			() => {
				this.inboxTimer = null;
				const runForce = this.inboxTimerForce;
				this.inboxTimerForce = false;
				void this.refreshInbox(runForce);
			},
			Math.max(0, delay)
		);
	}

	private unsubscribeRealtime() {
		if (this.inboxTimer) {
			clearTimeout(this.inboxTimer);
			this.inboxTimer = null;
		}
		this.inboxTimerForce = false;

		if (this.realtimeChannel) {
			try {
				supabase.removeChannel(this.realtimeChannel);
			} catch {
				// Ignore cleanup errors.
			}
			this.realtimeChannel = null;
		}
	}
}

export const messages = new MessagesState();
