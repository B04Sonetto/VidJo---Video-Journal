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
	import { giphyEnabled, type GiphyGif } from '#lib/giphy';
	import type { DmThreadSummary, Friend } from '#lib/types';

	let draft = $state('');
	let composerEl = $state<HTMLTextAreaElement | null>(null);
	let logEl = $state<HTMLDivElement | null>(null);
	let pickerOpen = $state(false);
	let newGroupOpen = $state(false);
	let infoOpen = $state(false);
	let gifOpen = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	const activeThread = $derived(messages.activeThread);
	const messageList = $derived(messages.activeMessages);
	const canReply = $derived(activeThread?.canReply ?? false);

	$effect(() => {
		// While the panel is hidden, incoming messages must count as unread.
		messages.setPanelVisible(true);
		return () => messages.setPanelVisible(false);
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

	function openImagePicker() {
		fileInputEl?.click();
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
	<div
		class="mt-6 grid gap-4 min-[980px]:grid-cols-[300px_minmax(0,1fr)] min-[980px]:items-stretch"
	>
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

			<div class="min-h-0 flex-1 overflow-y-auto p-2">
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
										<span
											class="flex size-11 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
											aria-hidden="true"
										>
											<CommunityIcon name="users" size={19} />
										</span>
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
			class="min-h-0 flex-col overflow-hidden border border-cover-edge note-scrap text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.35)] {messages.activeThreadId
				? 'fixed inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom)+58px)] z-40 flex rounded-b-[22px] pt-[env(safe-area-inset-top)] min-[900px]:bottom-0'
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
						<span
							class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
							aria-hidden="true"
						>
							<CommunityIcon name="users" size={18} />
						</span>
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

					{#if activeThread.kind === 'group'}
						<button
							type="button"
							class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-book-bg text-book-ink/80 transition-colors hover:bg-paper-deep hover:text-book-ink"
							onclick={() => (infoOpen = true)}
							aria-label="Group info"
							title="Group info"
						>
							<CommunityIcon name="settings" size={16} />
						</button>
					{/if}
				</header>

				<div
					class="min-h-0 flex-1 overflow-y-auto px-3 py-3"
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
									imageSrc={message.previewUrl ||
										messages.imageUrls[message.imagePath ?? ''] ||
										message.gifUrl ||
										''}
									onOpenImage={(src) => window.open(src, '_blank', 'noopener,noreferrer')}
								/>
							{/each}
						{/if}
					{/if}
				</div>

				{#if messages.notice}
					<div class="shrink-0 border-t border-line bg-book-accent/10 px-3 py-2">
						<p class="font-ui text-xs font-semibold text-book-ink/80">{messages.notice}</p>
					</div>
				{/if}

				{#if messages.error}
					<div class="shrink-0 border-t border-[#E3B9B9] bg-[#FBEAEA] px-3 py-2">
						<p class="font-ui text-xs font-semibold text-[#8A2F2F]">{messages.error}</p>
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
								Enter sends · Shift + Enter adds a line · Photos up to 5 MB{giphyEnabled
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
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
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

				<div class="min-h-0 flex-1 overflow-y-auto p-2">
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

	<NewGroupModal open={newGroupOpen} onClose={() => (newGroupOpen = false)} />
	<GroupInfoModal open={infoOpen} thread={activeThread} onClose={() => (infoOpen = false)} />
	<GifPicker open={gifOpen} onClose={() => (gifOpen = false)} onPick={pickGif} />
{/if}
