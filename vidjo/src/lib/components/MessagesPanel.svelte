<script lang="ts">
	import { tick } from 'svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { censor } from '#lib/censor';
	import Avatar from '#lib/components/Avatar.svelte';
	import MessageBubble from '#lib/components/MessageBubble.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import NewGroupModal from '#lib/components/NewGroupModal.svelte';
	import GroupInfoModal from '#lib/components/GroupInfoModal.svelte';
	import GifPicker from '#lib/components/GifPicker.svelte';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import SharedEntryModal from '#lib/components/SharedEntryModal.svelte';
	import ImageLightbox from '#lib/components/ImageLightbox.svelte';
	import PinnedMessagesModal from '#lib/components/PinnedMessagesModal.svelte';
	import PromptModal from '#lib/components/PromptModal.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { giphyEnabled, type GiphyGif } from '#lib/giphy';
	import type { DmMessage, DmThreadSummary, Friend, SharedJournalEntry } from '#lib/types';

	let draft = $state('');
	let composerEl = $state<HTMLTextAreaElement | null>(null);
	let logEl = $state<HTMLDivElement | null>(null);
	let pickerOpen = $state(false);
	let newGroupOpen = $state(false);
	let infoOpen = $state(false);
	let pinnedOpen = $state(false);
	let gifOpen = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let docInputEl = $state<HTMLInputElement | null>(null);
	let profileOpen = $state(false);
	let profileUserId = $state<string | null>(null);
	let forwardSource = $state<DmMessage | null>(null);
	let reportTarget = $state<DmMessage | null>(null);
	let pagePickerOpen = $state(false);
	let sharedEntryView = $state<{
		entry: SharedJournalEntry;
		senderName: string;
		senderAvatar: string;
		videoUrl: string;
		thumbUrl: string;
	} | null>(null);
	let previewSrc = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	const activeThread = $derived(messages.activeThread);
	const messageList = $derived(messages.activeMessages);
	const canReply = $derived(activeThread?.canReply ?? false);
	const activeGroupPhoto = $derived.by(() => {
		if (activeThread?.kind !== 'group') return '';
		const path = messages.activeChatSettings?.photoPath;
		return path ? (messages.imageUrls[path] ?? '') : '';
	});
	const lastMineIndex = $derived.by(() => {
		const me = messages.currentUserId || auth.ownerId;
		for (let i = messageList.length - 1; i >= 0; i -= 1) {
			if (messageList[i].senderId === me) return i;
		}
		return -1;
	});

	$effect(() => {
		// While the panel is hidden, incoming messages must count as unread.
		messages.setPanelVisible(true);
		return () => messages.setPanelVisible(false);
	});

	$effect(() => {
		// Dialogs belong to one conversation; never carry them into another.
		void messages.activeThreadId;
		pinnedOpen = false;
		infoOpen = false;
		reportTarget = null;
	});

	$effect(() => {
		// Success notices are transient; errors stay until the next action clears them.
		const notice = messages.notice;
		if (!notice) return;

		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			if (messages.notice === notice) messages.notice = '';
			noticeTimer = null;
		}, 4000);

		return () => {
			if (noticeTimer) clearTimeout(noticeTimer);
			noticeTimer = null;
		};
	});

	$effect(() => {
		// Follow the newest message whenever the open thread or its contents change.
		// Loading older messages must not jump the reader back to the bottom.
		void messages.scrollRequest;
		const threadId = messages.activeThreadId;
		void tick().then(() => {
			const el = logEl;
			if (el && threadId === messages.activeThreadId) el.scrollTop = el.scrollHeight;
		});
	});

	$effect(() => {
		// Only pull focus on desktop; on phones it would pop the keyboard open.
		const threadId = messages.activeThreadId;
		void tick().then(() => {
			if (threadId && window.innerWidth >= 980) composerEl?.focus();
		});
	});

	function firstName(name: string) {
		return name.trim().split(/\s+/)[0] || 'Friend';
	}

	function formatTime(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}

	function formatWhen(value: string | null) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';

		const now = new Date();
		const sameDay =
			date.getFullYear() === now.getFullYear() &&
			date.getMonth() === now.getMonth() &&
			date.getDate() === now.getDate();

		if (sameDay) return formatTime(value);

		const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
		if (days >= 0 && days < 7) {
			return date.toLocaleDateString(undefined, { weekday: 'short' });
		}

		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function preview(thread: DmThreadSummary) {
		const hasImage = Boolean(thread.lastImagePath);
		const hasGif = Boolean(thread.lastGifUrl);
		if (!thread.lastBody && !hasImage && !hasGif) {
			return thread.kind === 'group' ? 'Group created' : 'Say hello';
		}
		const mine = thread.lastSender === messages.currentUserId;
		const prefix =
			thread.kind === 'group' && !mine && thread.lastSenderName
				? `${firstName(thread.lastSenderName)}: `
				: mine
					? 'You: '
					: '';
		if (thread.lastDeleted) {
			return `${thread.lastDeletedByName || 'Someone'} deleted this message`;
		}
		if (thread.lastSharedEntry) {
			return `${prefix}Journal page: ${thread.lastSharedEntry.title || 'Untitled'}`;
		}
		const label = thread.lastBody ? censor(thread.lastBody) : hasGif ? 'GIF' : 'Photo';
		return prefix + label;
	}

	function subtitle(thread: DmThreadSummary) {
		if (thread.kind === 'group') {
			return `${thread.members.length} ${thread.members.length === 1 ? 'member' : 'members'}`;
		}
		return `@${messages.peerFor(thread)?.username ?? 'student'}`;
	}

	function showSender(index: number) {
		const current = messageList[index];
		const previous = messageList[index - 1];
		if (!current || !previous) return true;
		if (previous.senderId !== current.senderId) return true;
		const gap = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
		return gap > 5 * 60 * 1000;
	}

	function resize() {
		const el = composerEl;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
	}

	async function submit() {
		if (!draft.trim() || !canReply) return;
		const ok = await messages.send(draft);
		if (ok) {
			draft = '';
			void tick().then(resize);
		}
	}

	async function pickImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		// Reset immediately so choosing the same photo again still fires `change`.
		input.value = '';
		if (!file) return;

		const caption = draft;
		const ok = await messages.sendImage(file, caption);
		if (ok && caption.trim()) {
			draft = '';
			void tick().then(resize);
		}
	}

	async function pickDocument(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';
		if (!file) return;

		const caption = draft;
		const ok = await messages.sendFile(file, caption);
		if (ok && caption.trim()) {
			draft = '';
			void tick().then(resize);
		}
	}

	function openImagePicker() {
		fileInputEl?.click();
	}

	function openDocumentPicker() {
		docInputEl?.click();
	}

	async function pickGif(gif: GiphyGif) {
		const caption = draft;
		gifOpen = false;
		const ok = await messages.sendGif(gif, caption);
		if (ok && caption.trim()) {
			draft = '';
			void tick().then(resize);
		}
	}

	async function loadOlder() {
		const el = logEl;
		const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
		await messages.loadOlder();
		await tick();
		if (el) el.scrollTop = el.scrollHeight - fromBottom;
	}

	function handleComposerKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit();
		}
	}

	async function startDirect(friend: Friend) {
		pickerOpen = false;
		await messages.openDirect(friend);
	}

	async function copyMessage(message: DmMessage) {
		const text = message.sharedEntry
			? `${message.sharedEntry.title || 'Journal page'} — ${message.sharedEntry.mind || message.sharedEntry.refl}`
			: censor(message.body);
		if (!text?.trim()) return;
		try {
			await navigator.clipboard.writeText(text);
			journal.toast('Copied to clipboard');
		} catch {
			journal.toast('Could not copy that message');
		}
	}

	function editMessage(message: DmMessage, body: string) {
		void messages.editMessage(message, body);
	}

	function openProfile(userId: string) {
		profileUserId = userId;
		profileOpen = true;
	}

	function openReport(message: DmMessage) {
		reportTarget = message;
	}

	async function submitReport(reason: string) {
		const target = reportTarget;
		reportTarget = null;
		if (target) await messages.reportMessage(target, reason);
	}

	function openEntry(entry: SharedJournalEntry, senderId: string, senderName: string) {
		const sender = activeThread?.members.find((member) => member.id === senderId);
		sharedEntryView = {
			entry,
			senderName: sender?.name || senderName || 'A friend',
			senderAvatar: sender?.avatar || '',
			videoUrl: entry.videoPath ? (messages.videoUrls[entry.videoPath] ?? '') : '',
			thumbUrl: entry.videoThumbPath ? (messages.videoUrls[entry.videoThumbPath] ?? '') : ''
		};
	}

	function entrySnapshot(date: string): SharedJournalEntry {
		const entry = journal.entries[date];
		return {
			date,
			title: entry?.title ?? '',
			mind: entry?.mind ?? '',
			refl: entry?.refl ?? '',
			mood: entry?.mood ?? '',
			pageCount: 2,
			videoPath: entry?.videoPath ?? null,
			videoThumbPath: entry?.videoThumbPath ?? null,
			videoName: entry?.videoName ?? null,
			song: entry?.song ?? null
		};
	}

	async function sendPage(date: string) {
		pagePickerOpen = false;
		await messages.sendEntry(entrySnapshot(date));
	}

	async function forwardTo(threadId: string) {
		const source = forwardSource;
		forwardSource = null;
		if (!source) return;
		const ok = await messages.forwardTo(source, threadId);
		if (ok) messages.setReply(null);
	}

	function handleWindowKey(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (!messages.activeThreadId) return;
		// Let an open dialog handle Escape first.
		if (document.querySelector('[role="dialog"]')) return;
		if (typeof window !== 'undefined' && window.innerWidth < 980) messages.closeThread();
	}
</script>

<svelte:window onkeydown={handleWindowKey} />

{#if !messages.ready}
	<div
		class="mt-6 rounded-[22px] border border-cover-edge note-scrap px-6 py-12 text-center text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.35)]"
	>
		<span
			class="mx-auto flex size-14 items-center justify-center rounded-full bg-book-bg text-book-accent"
		>
			<CommunityIcon name="mail" size={24} />
		</span>
		<h2 class="mt-4 font-display text-2xl font-bold">Messaging needs a signed-in account</h2>
		<p class="mx-auto mt-2 max-w-[420px] font-hand text-lg leading-snug text-book-ink/70">
			Sign in with a VidJo account to send notes to your friends. Messages are never stored on this
			device.
		</p>
	</div>
{:else}
	<div class="grid gap-4 min-[980px]:grid-cols-[300px_minmax(0,1fr)] min-[980px]:items-stretch">
		<!-- Conversation list -->
		<section
			class="min-h-0 flex-col overflow-hidden rounded-[22px] border border-cover-edge note-scrap text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.35)] {messages.activeThreadId
				? 'hidden min-[980px]:flex'
				: 'flex'} max-h-[72vh] min-[980px]:h-[640px] min-[980px]:max-h-none"
		>
			<div class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
				<div class="min-w-0">
					<h2 class="font-display text-xl leading-tight font-bold">Messages</h2>
					<p class="font-ui text-[11px] text-book-ink/60">
						{messages.threads.length}
						{messages.threads.length === 1 ? 'conversation' : 'conversations'}
					</p>
				</div>
				<div class="flex shrink-0 gap-1.5">
					<button
						type="button"
						class="flex size-9 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (pickerOpen = true)}
						aria-label="New message"
						title="New message"
					>
						<CommunityIcon name="pen" size={16} />
					</button>
					<button
						type="button"
						class="flex size-9 items-center justify-center rounded-full bg-cta text-cta-text transition-colors hover:bg-cta-hover"
						onclick={() => (newGroupOpen = true)}
						aria-label="New group chat"
						title="New group chat"
					>
						<CommunityIcon name="users" size={16} />
					</button>
				</div>
			</div>

			<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-2">
				{#if messages.loadingInbox && messages.threads.length === 0}
					<div class="space-y-2 p-1" role="status" aria-label="Loading conversations">
						{#each [0, 1, 2] as slot (slot)}
							<div class="flex items-center gap-3 rounded-xl px-2 py-2.5">
								<span class="size-11 shrink-0 animate-pulse rounded-full bg-line/50"></span>
								<div class="min-w-0 flex-1 space-y-2">
									<span class="block h-3 w-2/3 animate-pulse rounded bg-line/50"></span>
									<span class="block h-2.5 w-full animate-pulse rounded bg-line/40"></span>
								</div>
							</div>
						{/each}
					</div>
				{:else if messages.threads.length === 0}
					<div class="px-5 py-12 text-center">
						<span
							class="mx-auto flex size-14 items-center justify-center rounded-full bg-book-bg text-book-accent"
						>
							<CommunityIcon name="mail" size={24} />
						</span>
						<p class="mt-4 font-display text-lg font-bold">No conversations yet</p>
						<p class="mx-auto mt-1 max-w-[220px] font-hand text-base leading-snug text-book-ink/70">
							Start a note with a friend, or gather a few friends in a group.
						</p>
						<div class="mt-4 flex flex-wrap justify-center gap-2">
							<button
								type="button"
								class="min-h-9 rounded-lg bg-cta px-3.5 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover"
								onclick={() => (pickerOpen = true)}
							>
								New message
							</button>
							<button
								type="button"
								class="min-h-9 rounded-lg border border-line px-3.5 font-ui text-xs font-bold text-book-ink/80 transition-colors hover:bg-paper-deep"
								onclick={() => (newGroupOpen = true)}
							>
								New group
							</button>
						</div>
					</div>
				{:else}
					<ul class="space-y-1">
						{#each messages.threads as thread (thread.threadId)}
							{@const peer = messages.peerFor(thread)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors {messages.activeThreadId ===
									thread.threadId
										? 'bg-book-accent/15'
										: 'hover:bg-paper-deep'}"
									onclick={() => void messages.openThread(thread.threadId)}
									aria-current={messages.activeThreadId === thread.threadId ? 'true' : undefined}
								>
									{#if thread.kind === 'group'}
										{@const photoPath = messages.chatSettings[thread.threadId]?.photoPath}
										{#if photoPath && messages.imageUrls[photoPath]}
											<Avatar
												src={messages.imageUrls[photoPath]}
												name={thread.title || 'Group chat'}
												className="size-11"
												textClass="text-lg"
												ring="ring-2 ring-gold/40"
											/>
										{:else}
											<span
												class="flex size-11 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
												aria-hidden="true"
											>
												<CommunityIcon name="users" size={19} />
											</span>
										{/if}
									{:else}
										<Avatar
											src={peer?.avatar ?? null}
											name={peer?.name ?? 'Friend'}
											className="size-11"
											textClass="text-lg"
											ring="ring-2 ring-gold/40"
										/>
									{/if}

									<span class="min-w-0 flex-1">
										<span class="flex items-baseline gap-2">
											<span class="min-w-0 flex-1 truncate font-display text-[15px] font-bold">
												{messages.threadLabel(thread)}
											</span>
											<span class="shrink-0 font-ui text-[10px] text-book-ink/70 tabular-nums">
												{formatWhen(thread.lastAt)}
											</span>
										</span>
										<span class="mt-0.5 flex items-center gap-2">
											<span
												class="min-w-0 flex-1 truncate font-ui text-xs {thread.unreadCount > 0
													? 'font-semibold text-book-ink'
													: 'text-book-ink/60'}"
											>
												{preview(thread)}
											</span>
											{#if thread.unreadCount > 0}
												<span
													class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cta px-1 font-ui text-[10px] font-bold text-cta-text tabular-nums"
													aria-label="{thread.unreadCount} unread"
												>
													{thread.unreadCount > 9 ? '9+' : thread.unreadCount}
												</span>
											{/if}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<!-- Open conversation -->
		<section
			data-chat-theme={messages.activeTheme}
			class="chat-panel min-h-0 flex-col overflow-hidden border border-cover-edge note-scrap text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.35)] {messages.activeThreadId
				? 'fixed inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom)+58px)] z-30 flex rounded-b-[22px] pt-[env(safe-area-inset-top)] min-[900px]:bottom-0'
				: 'hidden'} min-[980px]:static min-[980px]:z-auto min-[980px]:flex min-[980px]:h-[640px] min-[980px]:rounded-[22px] min-[980px]:pt-0"
		>
			{#if activeThread}
				<header class="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2.5">
					<button
						type="button"
						class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink min-[980px]:hidden"
						onclick={() => messages.closeThread()}
						aria-label="Back to conversations"
					>
						<CommunityIcon name="arrow-left" size={17} />
					</button>

					{#if activeThread.kind === 'group'}
						{#if activeGroupPhoto}
							<Avatar
								src={activeGroupPhoto}
								name={activeThread.title || 'Group chat'}
								className="size-10"
								textClass="text-base"
								ring="ring-2 ring-gold/40"
							/>
						{:else}
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
								aria-hidden="true"
							>
								<CommunityIcon name="users" size={18} />
							</span>
						{/if}
					{:else}
						<Avatar
							src={messages.peerFor(activeThread)?.avatar ?? null}
							name={messages.peerFor(activeThread)?.name ?? 'Friend'}
							className="size-10"
							textClass="text-base"
							ring="ring-2 ring-gold/40"
						/>
					{/if}

					<div class="min-w-0 flex-1">
						<h2 class="truncate font-display text-lg leading-tight font-bold">
							{messages.threadLabel(activeThread)}
						</h2>
						<p class="truncate font-ui text-[11px] text-book-ink/60">
							{subtitle(activeThread)}
						</p>
					</div>

					<button
						type="button"
						class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (pinnedOpen = true)}
						aria-label="View pinned messages"
						title="Pinned messages"
					>
						<CommunityIcon name="pin" size={16} />
					</button>
					<button
						type="button"
						class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (infoOpen = true)}
						aria-label="Customize chat"
						title="Customize chat"
					>
						<CommunityIcon name="settings" size={16} />
					</button>
				</header>

				<div
					class="min-h-0 flex-1 modal-scroll overflow-y-auto px-3 py-3"
					bind:this={logEl}
					role="log"
					aria-live="polite"
					aria-label="Messages"
				>
					{#if messages.loadingThread && messageList.length === 0}
						<div class="flex h-full items-center justify-center">
							<p class="font-hand text-lg text-book-ink/60">Opening the conversation…</p>
						</div>
					{:else}
						{#if messages.activePinned.length}
							<div class="mb-3 rounded-xl border border-gold/45 bg-book-accent/10 p-2">
								<p
									class="mb-1.5 flex items-center gap-1.5 font-ui text-[10px] font-bold text-book-ink/70 uppercase"
								>
									<CommunityIcon name="pin" size={12} /> Pinned by you
								</p>
								<div class="flex flex-col gap-1">
									{#each messages.activePinned as pinned (pinned.clientId)}
										<button
											type="button"
											class="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-paper-deep/70"
											onclick={() => messages.setReply(pinned)}
											title="Reply to pinned message"
										>
											<span class="shrink-0 font-ui text-[10px] font-bold text-accent">
												{pinned.senderName.split(/\s+/)[0]}
											</span>
											<span class="min-w-0 flex-1 truncate font-ui text-[11px] text-book-ink/75">
												{censor(pinned.body || pinned.sharedEntry?.title || 'Attachment')}
											</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
						{#if messages.activeHasMore}
							<div class="mb-3 text-center">
								<button
									type="button"
									class="min-h-8 rounded-full border border-line bg-book-bg px-3 font-ui text-[11px] font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep disabled:opacity-60"
									onclick={() => void loadOlder()}
									disabled={messages.loadingOlder}
								>
									{messages.loadingOlder ? 'Loading…' : 'Load older messages'}
								</button>
							</div>
						{/if}

						{#if messageList.length === 0}
							<div class="flex h-full flex-col items-center justify-center px-6 text-center">
								<span
									class="flex size-12 items-center justify-center rounded-full bg-book-bg text-book-accent"
								>
									<CommunityIcon name="mail" size={22} />
								</span>
								<p class="mt-3 font-display text-lg font-bold">This page is blank</p>
								<p class="mt-1 max-w-[260px] font-hand text-base leading-snug text-book-ink/70">
									Write the first note. Only people in this conversation can read it.
								</p>
							</div>
						{:else}
							{#each messageList as message, index (message.clientId || message.id)}
								<MessageBubble
									{message}
									mine={message.senderId === (messages.currentUserId || auth.ownerId)}
									showHeader={showSender(index)}
									showSeen={lastMineIndex === index}
									entryThumbUrl={message.sharedEntry?.videoThumbPath
										? (messages.videoUrls[message.sharedEntry.videoThumbPath] ?? '')
										: ''}
									imageSrc={message.previewUrl ||
										messages.imageUrls[message.imagePath ?? ''] ||
										message.gifUrl ||
										''}
									fileUrl={message.filePath ? (messages.fileUrls[message.filePath] ?? '') : ''}
									onOpenImage={(src) => (previewSrc = src)}
									onReply={(item) => messages.setReply(item)}
									onCopy={(item) => void copyMessage(item)}
									onDelete={(item) => void messages.deleteMessage(item)}
									onEdit={editMessage}
									onPin={(item) => void messages.togglePin(item)}
									onForward={(item) => (forwardSource = item)}
									onReact={(item, emoji) => void messages.toggleReaction(item, emoji)}
									onOpenProfile={openProfile}
									onOpenEntry={openEntry}
									onReport={openReport}
								/>
							{/each}
						{/if}
					{/if}
				</div>

				{#if messages.notice}
					<div
						class="flex shrink-0 items-center gap-2 border-t border-line bg-book-accent/10 px-3 py-2"
					>
						<p class="min-w-0 flex-1 font-ui text-xs font-semibold text-book-ink/80">
							{messages.notice}
						</p>
						<button
							type="button"
							class="flex size-6 shrink-0 items-center justify-center rounded-full text-book-ink/60 transition-colors hover:bg-book-accent/20 hover:text-book-ink"
							onclick={() => (messages.notice = '')}
							aria-label="Dismiss notice"
							title="Dismiss"
						>
							<CommunityIcon name="x" size={12} />
						</button>
					</div>
				{/if}

				{#if messages.error}
					<div class="shrink-0 border-t border-[#E3B9B9] bg-[#FBEAEA] px-3 py-2">
						<p class="font-ui text-xs font-semibold text-danger">{messages.error}</p>
					</div>
				{/if}

				<div class="shrink-0 border-t border-line bg-paper-deep/60 p-2.5">
					{#if !canReply}
						<p class="px-1 py-2 text-center font-ui text-xs font-semibold text-book-ink/65">
							You can only message friends. This conversation is read-only.
						</p>
					{:else}
						<input
							bind:this={fileInputEl}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							class="sr-only"
							tabindex="-1"
							onchange={pickImage}
							aria-hidden="true"
						/>
						<input
							bind:this={docInputEl}
							type="file"
							accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
							class="sr-only"
							tabindex="-1"
							onchange={pickDocument}
							aria-hidden="true"
						/>
						{#if messages.replyTo}
							<div
								class="mb-2 flex items-center gap-2 rounded-xl border border-gold/50 bg-paper-deep px-2.5 py-1.5"
							>
								<CommunityIcon name="reply" size={14} class="shrink-0 text-accent" />
								<div class="min-w-0 flex-1">
									<p class="font-ui text-[10px] font-bold text-accent">
										Replying to {messages.replyTo.senderName}
									</p>
									<p class="truncate font-ui text-[11px] text-book-ink/70">
										{censor(messages.replyTo.body || 'Attachment')}
									</p>
								</div>
								<button
									type="button"
									class="flex size-7 shrink-0 items-center justify-center rounded-full text-book-ink/70 hover:bg-line/50"
									onclick={() => messages.setReply(null)}
									aria-label="Cancel reply"
								>
									<CommunityIcon name="x" size={13} />
								</button>
							</div>
						{/if}
						<div class="flex items-end gap-2">
							<label class="sr-only" for="dm-composer">Write a message</label>
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
								onclick={openImagePicker}
								aria-label="Attach a photo"
								title="Attach a photo"
							>
								<CommunityIcon name="camera" size={17} />
							</button>
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
								onclick={openDocumentPicker}
								aria-label="Attach a document"
								title="Attach a PDF or Word document"
							>
								<CommunityIcon name="paperclip" size={17} />
							</button>
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
								onclick={() => (pagePickerOpen = true)}
								aria-label="Send a journal page"
								title="Send a journal page"
							>
								<CommunityIcon name="book" size={17} />
							</button>
							{#if giphyEnabled}
								<button
									type="button"
									class="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg font-ui text-[10px] font-bold tracking-wide text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
									onclick={() => (gifOpen = true)}
									aria-label="Send a GIF"
									title="Send a GIF"
								>
									GIF
								</button>
							{/if}
							<textarea
								id="dm-composer"
								bind:this={composerEl}
								bind:value={draft}
								oninput={resize}
								onkeydown={handleComposerKey}
								rows="1"
								maxlength="2000"
								placeholder="Write a note…"
								class="max-h-[132px] min-h-10 w-full min-w-0 flex-1 resize-none rounded-2xl border border-line bg-book-bg px-3.5 py-2.5 font-ui text-sm leading-relaxed text-book-ink placeholder:text-book-ink/70 focus:border-book-accent focus:outline-none"
							></textarea>
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cta text-cta-text transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-50"
								onclick={() => void submit()}
								disabled={!draft.trim()}
								aria-label="Send message"
								title="Send message"
							>
								<CommunityIcon name="send" size={17} />
							</button>
						</div>
						<div class="mt-1.5 flex items-center justify-between gap-2 px-1">
							<p class="font-ui text-[10px] text-book-ink/70">
								Enter sends · Shift + Enter adds a line · Photos 5 MB · PDF/Word 20 MB{giphyEnabled
									? ' · GIFs via GIPHY'
									: ''}
							</p>
							{#if draft.length > 1800}
								<p class="font-ui text-[10px] font-semibold text-book-ink/65 tabular-nums">
									{draft.length}/2000
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center px-6 text-center">
					<span
						class="flex size-16 items-center justify-center rounded-full bg-book-bg text-book-accent"
					>
						<CommunityIcon name="mail" size={28} />
					</span>
					<p class="mt-4 font-display text-xl font-bold">Pick a conversation</p>
					<p class="mt-1.5 max-w-[280px] font-hand text-lg leading-snug text-book-ink/70">
						Open a note from the list, or start a new one with a friend.
					</p>
				</div>
			{/if}
		</section>
	</div>

	<!-- New message friend picker -->
	{#if pickerOpen}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="new-message-title"
		>
			<button
				type="button"
				class="fixed inset-0 h-full w-full cursor-default"
				onclick={() => (pickerOpen = false)}
				aria-label="Close new message dialog"
			></button>

			<div
				class="relative z-10 flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
			>
				<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
					<div>
						<h2 id="new-message-title" class="font-display text-xl font-bold">New message</h2>
						<p class="font-ui text-[11px] text-book-ink/60">Choose a friend</p>
					</div>
					<button
						type="button"
						class="flex size-9 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (pickerOpen = false)}
						aria-label="Close"
					>
						<CommunityIcon name="x" size={16} />
					</button>
				</div>

				<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-2">
					{#if friends.friends.length === 0}
						<p class="px-4 py-8 text-center font-hand text-lg leading-snug text-book-ink/70">
							Add a friend first. Messaging only works between friends.
						</p>
					{:else}
						<ul class="space-y-1">
							{#each friends.friends as friend (friend.id)}
								<li>
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-paper-deep"
										onclick={() => void startDirect(friend)}
									>
										<Avatar
											src={friend.avatarUrl}
											name={friend.displayName}
											className="size-10"
											textClass="text-base"
											ring="ring-2 ring-gold/40"
										/>
										<span class="min-w-0 flex-1">
											<span class="block truncate font-display text-[15px] font-bold">
												{friend.displayName}
											</span>
											<span class="block truncate font-ui text-[11px] text-book-ink/60">
												@{friend.username}
											</span>
										</span>
										<CommunityIcon name="arrow-right" size={15} class="shrink-0 text-book-ink/50" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Forward to a conversation -->
	{#if forwardSource}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="forward-title"
		>
			<button
				type="button"
				class="fixed inset-0 h-full w-full cursor-default"
				onclick={() => (forwardSource = null)}
				aria-label="Close forward dialog"
			></button>
			<div
				class="relative z-10 flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
			>
				<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
					<div>
						<h2 id="forward-title" class="font-display text-xl font-bold">Forward message</h2>
						<p class="mt-0.5 line-clamp-1 font-ui text-[11px] text-book-ink/60">
							{censor(forwardSource.body || forwardSource.sharedEntry?.title || 'Attachment')}
						</p>
					</div>
					<button
						type="button"
						class="flex size-9 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (forwardSource = null)}
						aria-label="Close"
					>
						<CommunityIcon name="x" size={16} />
					</button>
				</div>
				<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-2">
					{#if messages.threads.length === 0}
						<p class="px-4 py-8 text-center font-hand text-lg text-book-ink/70">
							Start a conversation first.
						</p>
					{:else}
						<ul class="space-y-1">
							{#each messages.threads as thread (thread.threadId)}
								{@const peer = messages.peerFor(thread)}
								<li>
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-paper-deep"
										onclick={() => void forwardTo(thread.threadId)}
									>
										{#if thread.kind === 'group'}
											<span
												class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
											>
												<CommunityIcon name="users" size={17} />
											</span>
										{:else}
											<Avatar
												src={peer?.avatar ?? null}
												name={peer?.name ?? 'Friend'}
												className="size-10"
												textClass="text-base"
												ring="ring-2 ring-gold/40"
											/>
										{/if}
										<span class="min-w-0 flex-1 truncate font-display text-[15px] font-bold">
											{messages.threadLabel(thread)}
										</span>
										<CommunityIcon name="forward" size={15} class="shrink-0 text-book-ink/50" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Send a journal page -->
	{#if pagePickerOpen}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="send-page-title"
		>
			<button
				type="button"
				class="fixed inset-0 h-full w-full cursor-default"
				onclick={() => (pagePickerOpen = false)}
				aria-label="Close journal page picker"
			></button>
			<div
				class="relative z-10 flex max-h-[82vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
			>
				<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
					<div>
						<h2 id="send-page-title" class="font-display text-xl font-bold">Send a journal page</h2>
						<p class="font-ui text-[11px] text-book-ink/60">
							Your friend gets a page they can open.
						</p>
					</div>
					<button
						type="button"
						class="flex size-9 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
						onclick={() => (pagePickerOpen = false)}
						aria-label="Close"
					>
						<CommunityIcon name="x" size={16} />
					</button>
				</div>
				<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-2">
					{#if journal.sortedDates.length === 0}
						<p class="px-4 py-8 text-center font-hand text-lg text-book-ink/70">
							Write a page first, then share it here.
						</p>
					{:else}
						<ul class="space-y-1.5">
							{#each journal.sortedDates.slice(0, 30) as date (date)}
								{@const entry = journal.entries[date]}
								{@const when = new Date(`${date}T12:00:00`)}
								<li>
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl border border-line bg-book-bg/70 px-3 py-2.5 text-left transition-colors hover:border-gold/60 hover:bg-paper-deep"
										onclick={() => void sendPage(date)}
									>
										<span
											class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-book-accent/20 text-book-accent"
										>
											<CommunityIcon name="book" size={17} />
										</span>
										<span class="min-w-0 flex-1">
											<span class="block truncate font-display text-[15px] font-bold">
												{entry?.title || 'Untitled page'}
											</span>
											<span class="block truncate font-ui text-[11px] text-book-ink/60">
												{Number.isNaN(when.getTime())
													? date
													: when.toLocaleDateString(undefined, {
															month: 'short',
															day: 'numeric',
															year: 'numeric'
														})}
												{#if entry?.mind}
													· {entry.mind.slice(0, 40)}{/if}
											</span>
										</span>
										<CommunityIcon name="send" size={15} class="shrink-0 text-accent" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<NewGroupModal open={newGroupOpen} onClose={() => (newGroupOpen = false)} />
	<PinnedMessagesModal open={pinnedOpen} onClose={() => (pinnedOpen = false)} />
	<GroupInfoModal
		open={infoOpen}
		thread={activeThread}
		onClose={() => (infoOpen = false)}
		onOpenPinned={() => (pinnedOpen = true)}
	/>
	<GifPicker open={gifOpen} onClose={() => (gifOpen = false)} onPick={pickGif} />
	<ProfileModal
		open={profileOpen}
		userId={profileUserId}
		onClose={() => {
			profileOpen = false;
			profileUserId = null;
		}}
	/>
	<SharedEntryModal
		open={sharedEntryView !== null}
		entry={sharedEntryView?.entry ?? null}
		senderName={sharedEntryView?.senderName ?? 'A friend'}
		senderAvatar={sharedEntryView?.senderAvatar ?? ''}
		videoUrl={sharedEntryView?.videoUrl ?? ''}
		thumbUrl={sharedEntryView?.thumbUrl ?? ''}
		onClose={() => (sharedEntryView = null)}
	/>
	<ImageLightbox open={Boolean(previewSrc)} src={previewSrc} onClose={() => (previewSrc = '')} />
	<PromptModal
		open={reportTarget !== null}
		title="Report message"
		message="Tell the moderators what is wrong with this message."
		hint="Your name is not shown to the person you report."
		placeholder="Harassment, spam, unsafe content…"
		maxLength={240}
		confirmLabel="Send report"
		tone="danger"
		icon="alert"
		onConfirm={(value) => void submitReport(value)}
		onCancel={() => (reportTarget = null)}
	/>
{/if}

<style>
	/* Per-chat themes scope the existing palette tokens to this panel only. */
	.chat-panel[data-chat-theme='sunset'] {
		--color-desk: #241218;
		--color-desk-2: #3a1e22;
		--color-cover: #6e3526;
		--color-cover-edge: #4a2018;
		--color-paper: #fdf1df;
		--color-paper-deep: #f4e0c2;
		--color-paper-edge: #ecd5b6;
		--color-line: #dfc3a0;
		--color-ink: #3d2418;
		--color-ink-soft: #6b4432;
		--color-ink-muted: #8a6248;
		--color-lav: #e9b795;
		--color-accent: #a84a34;
		--color-accent-strong: #8a3826;
		--color-light: #fbe9dc;
		--color-book-bg: #fdf1df;
		--color-book-ink: #3d2418;
		--color-book-accent: #d4a24c;
		--color-book-shadow: #ecd5b6;
		--color-book-edge: #dfc3a0;
		--color-cta: #a84a34;
		--color-cta-hover: #b85c43;
		--color-cta-text: #fff7f2;
		--color-cta-shadow: rgb(168 74 52 / 0.32);
	}

	.chat-panel[data-chat-theme='midnight'] {
		--color-desk: #0c1322;
		--color-desk-2: #152138;
		--color-cover: #1e3358;
		--color-cover-edge: #132241;
		--color-paper: #f4f6fb;
		--color-paper-deep: #e3e9f4;
		--color-paper-edge: #d8e0ef;
		--color-line: #bcc9df;
		--color-ink: #14213a;
		--color-ink-soft: #3d4f6e;
		--color-ink-muted: #6a7c99;
		--color-lav: #a8c0e8;
		--color-accent: #3f6ac4;
		--color-accent-strong: #33569f;
		--color-light: #e8eef9;
		--color-book-bg: #f4f6fb;
		--color-book-ink: #0c1322;
		--color-book-accent: #7d58c2;
		--color-book-shadow: #d8e0ef;
		--color-book-edge: #bcc9df;
		--color-cta: #3f6ac4;
		--color-cta-hover: #4672c9;
		--color-cta-text: #f7faff;
		--color-cta-shadow: rgb(63 106 196 / 0.34);
	}

	.chat-panel[data-chat-theme='evergreen'] {
		--color-desk: #101a15;
		--color-desk-2: #1b2a22;
		--color-cover: #2f4a3a;
		--color-cover-edge: #1c2e25;
		--color-paper: #f4f0df;
		--color-paper-deep: #e7e0c8;
		--color-paper-edge: #ded6bc;
		--color-line: #c9c0a2;
		--color-ink: #22302a;
		--color-ink-soft: #47584c;
		--color-ink-muted: #6d7f70;
		--color-lav: #b6cbb4;
		--color-accent: #3e6b52;
		--color-accent-strong: #325743;
		--color-light: #eaf1e6;
		--color-book-bg: #f6f2e2;
		--color-book-ink: #22302a;
		--color-book-accent: #b8863b;
		--color-book-shadow: #dcd4b8;
		--color-book-edge: #cfc6a8;
		--color-cta: #3e6b52;
		--color-cta-hover: #4a7c60;
		--color-cta-text: #f7fbf6;
		--color-cta-shadow: rgb(62 107 82 / 0.34);
	}

	.chat-panel[data-chat-theme='rosewood'] {
		--color-desk: #1f1116;
		--color-desk-2: #2e1a20;
		--color-cover: #7a3348;
		--color-cover-edge: #4e1f2c;
		--color-paper: #fbf0ec;
		--color-paper-deep: #f0dcd4;
		--color-paper-edge: #e7d0c7;
		--color-line: #d9bdb2;
		--color-ink: #3a1f26;
		--color-ink-soft: #6b4149;
		--color-ink-muted: #8c6069;
		--color-lav: #e7b3bd;
		--color-accent: #a8435c;
		--color-accent-strong: #8a3449;
		--color-light: #fbe6ea;
		--color-book-bg: #fcf1ec;
		--color-book-ink: #3a1f26;
		--color-book-accent: #b25a6e;
		--color-book-shadow: #e5d2c9;
		--color-book-edge: #d8c0b6;
		--color-cta: #a8435c;
		--color-cta-hover: #b8526a;
		--color-cta-text: #fff6f7;
		--color-cta-shadow: rgb(168 67 92 / 0.32);
	}

	.chat-panel[data-chat-theme='harbor'] {
		--color-desk: #0b171c;
		--color-desk-2: #142530;
		--color-cover: #2c4e5e;
		--color-cover-edge: #16303a;
		--color-paper: #eef4f3;
		--color-paper-deep: #dce7e5;
		--color-paper-edge: #d2dfdd;
		--color-line: #b7c9c7;
		--color-ink: #12262c;
		--color-ink-soft: #3b5257;
		--color-ink-muted: #627b80;
		--color-lav: #a9c9cc;
		--color-accent: #2f7c74;
		--color-accent-strong: #26655f;
		--color-light: #e4f1f0;
		--color-book-bg: #f0f5f4;
		--color-book-ink: #12262c;
		--color-book-accent: #3e8e86;
		--color-book-shadow: #d3e0de;
		--color-book-edge: #c3d3d1;
		--color-cta: #2f7c74;
		--color-cta-hover: #368c83;
		--color-cta-text: #f4fcfb;
		--color-cta-shadow: rgb(47 124 116 / 0.32);
	}
</style>
