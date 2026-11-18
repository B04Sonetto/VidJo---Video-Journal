import { isSupabaseConfigured, supabase } from '#lib/supabase';
import { auth } from '#lib/state/auth.svelte';
import { profile } from '#lib/state/profile.svelte';
import { cleanDisplayName, normalizeImageUrl } from '#lib/avatar';
import type {
	DmMessage,
	DmParticipant,
	DmThreadKind,
	DmThreadMember,
	DmThreadSummary,
	Friend
} from '#lib/types';

const PAGE_SIZE = 30;
const INBOX_DEBOUNCE_MS = 250;

type InboxRow = {
	thread_id: string;
	kind: DmThreadKind;
	title: string | null;
	members: unknown;
	last_body: string | null;
	last_sender: string | null;
	last_sender_name: string | null;
	last_at: string | null;
	unread_count: number;
	can_reply: boolean;
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
	created_at: string;
};

type MemberRow = {
	user_id: string;
	name: string | null;
	username: string | null;
	avatar: string | null;
	role: 'owner' | 'member';
	joined_at: string;
	is_me: boolean;
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

function mapInboxRow(row: InboxRow): DmThreadSummary {
	return {
		threadId: row.thread_id,
		kind: row.kind === 'group' ? 'group' : 'direct',
		title: row.title,
		members: mapMembers(row.members),
		lastBody: row.last_body,
		lastSender: row.last_sender,
		lastSenderName: row.last_sender_name,
		lastAt: row.last_at,
		unreadCount: Number(row.unread_count) || 0,
		canReply: Boolean(row.can_reply)
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
		createdAt: row.created_at
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
		isMe: Boolean(row.is_me)
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

	activeThreadId = $state<string | null>(null);
	currentUserId = $state('');
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
	private inboxQueued = false;

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

		this.initializedFor = userId;
		this.currentUserId = userId;
		this.clearData();

		if (!this.ready) return;

		await this.refreshInbox();
		this.subscribeRealtime();
	}

	async refreshInbox() {
		if (!this.ready) return;
		if (this.loadingInbox) {
			this.inboxQueued = true;
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
		} catch (error) {
			console.warn('[VidJo] Could not load conversations.', error);
		} finally {
			this.loadingInbox = false;
			if (this.inboxQueued) {
				this.inboxQueued = false;
				void this.refreshInbox();
			}
		}
	}

	async openThread(threadId: string) {
		if (!threadId) return;

		this.error = '';
		this.notice = '';
		this.activeThreadId = threadId;

		const thread = this.activeThread;
		if (thread && !thread.canReply) {
			this.error = 'You can only message friends.';
		}

		if (!this.messagesByThread[threadId]) {
			await this.loadThread(threadId);
		} else {
			this.scrollRequest += 1;
		}

		void this.markRead(threadId);

		if (thread?.kind === 'group' && !this.membersByThread[threadId]) {
			void this.loadMembers(threadId);
		}
	}

	closeThread() {
		this.activeThreadId = null;
		this.error = '';
		this.notice = '';
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

	async loadThread(threadId: string, older = false) {
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
				p_limit: PAGE_SIZE
			});
			if (error) throw error;

			const rows = ((data ?? []) as MessageRow[]).map(mapMessage);
			this.setMessages(threadId, mergeMessages(rows, existing));
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

	async send(body: string): Promise<boolean> {
		const threadId = this.activeThreadId;
		const trimmed = body.trim();

		if (!threadId || !trimmed) return false;

		const thread = this.activeThread;
		if (!thread?.canReply) {
			this.error = 'You can only message friends.';
			return false;
		}

		const clientId = newClientId();
		const optimistic: DmMessage = {
			id: `pending:${clientId}`,
			threadId,
			senderId: this.currentUserId || auth.ownerId,
			clientId,
			senderName: profile.displayName,
			senderUsername: profile.username || 'student',
			senderAvatar: profile.avatarUrl,
			body: trimmed,
			createdAt: new Date().toISOString(),
			pending: true
		};

		this.error = '';
		this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [optimistic]));
		this.scrollRequest += 1;

		try {
			const { data, error } = await supabase.rpc('vidjo_dm_send', {
				p_thread: threadId,
				p_body: trimmed,
				p_client_id: clientId
			});
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
					body: typeof record.body === 'string' ? record.body : trimmed,
					createdAt:
						typeof record.created_at === 'string' ? record.created_at : optimistic.createdAt
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

	async markRead(threadId: string) {
		if (!threadId) return;

		const thread = this.threads.find((item) => item.threadId === threadId);
		if (thread && thread.unreadCount > 0) {
			this.threads = this.threads.map((item) =>
				item.threadId === threadId ? { ...item, unreadCount: 0 } : item
			);
		}

		if (!this.ready) return;

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
			await this.refreshInbox();
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
			await this.refreshInbox();
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
			await this.refreshInbox();
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
			await this.refreshInbox();
			return true;
		} catch (error) {
			this.error = errorMessage(error);
			return false;
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
			await this.refreshInbox();
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
		this.activeThreadId = null;
		this.currentUserId = '';
		this.loadingInbox = false;
		this.loadingThread = false;
		this.loadingOlder = false;
		this.creatingGroup = false;
		this.error = '';
		this.notice = '';
		this.scrollRequest = 0;
		this.inboxQueued = false;
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
			lastSender: message.senderId,
			lastSenderName: message.senderName,
			lastAt: message.createdAt
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
			lastSender: null,
			lastSenderName: null,
			lastAt: null,
			unreadCount: 0,
			canReply: true
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
					() => this.scheduleInboxRefresh()
				)
				.on('postgres_changes', { event: '*', schema: 'public', table: 'vidjo_dm_threads' }, () =>
					this.scheduleInboxRefresh()
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
			createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString()
		};

		if (this.messagesByThread[threadId]) {
			this.setMessages(threadId, mergeMessages(this.messagesByThread[threadId] ?? [], [message]));
		}

		if (threadId === this.activeThreadId && senderId !== this.currentUserId) {
			this.scrollRequest += 1;
			void this.markRead(threadId);
		}

		this.scheduleInboxRefresh();
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
		}

		this.scheduleInboxRefresh();
	}

	private scheduleInboxRefresh() {
		if (this.inboxTimer) clearTimeout(this.inboxTimer);
		this.inboxTimer = setTimeout(() => {
			this.inboxTimer = null;
			void this.refreshInbox();
		}, INBOX_DEBOUNCE_MS);
	}

	private unsubscribeRealtime() {
		if (this.inboxTimer) {
			clearTimeout(this.inboxTimer);
			this.inboxTimer = null;
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
}

export const messages = new MessagesState();
