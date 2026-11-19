<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { censor } from '#lib/censor';
	import type { DmMessage, SharedJournalEntry } from '#lib/types';

	let {
		message,
		mine,
		showHeader,
		imageSrc,
		onOpenImage,
		onReply,
		onCopy,
		onDelete,
		onEdit,
		onPin,
		onForward,
		onReact,
		onOpenProfile,
		onOpenEntry
	}: {
		message: DmMessage;
		mine: boolean;
		showHeader: boolean;
		imageSrc: string;
		onOpenImage: (src: string) => void;
		onReply: (message: DmMessage) => void;
		onCopy: (message: DmMessage) => void;
		onDelete: (message: DmMessage) => void;
		onEdit: (message: DmMessage, body: string) => void;
		onPin: (message: DmMessage) => void;
		onForward: (message: DmMessage) => void;
		onReact: (message: DmMessage, emoji: string) => void;
		onOpenProfile: (userId: string) => void;
		onOpenEntry: (entry: SharedJournalEntry, senderId: string, senderName: string) => void;
	} = $props();

	const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '🎉'];
	const MOOD_ICONS: Record<string, string> = {
		happy: 'sun',
		calm: 'leaf',
		neutral: 'globe',
		tired: 'spark',
		sad: 'heart',
		stressed: 'flame',
		angry: 'flame',
		excited: 'sparkles'
	};

	let menuOpen = $state(false);
	let editing = $state(false);
	let editValue = $state('');
	let editEl = $state<HTMLTextAreaElement | null>(null);
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let longPressing = $state(false);

	const LONG_PRESS_MS = 450;
	const MOVE_TOLERANCE = 12;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressOrigin: { x: number; y: number } | null = null;
	let suppressClick = false;

	const isGif = $derived(Boolean(message.gifUrl));
	const hasMedia = $derived(Boolean(message.imagePath || message.gifUrl || message.previewUrl));
	const isDeleted = $derived(Boolean(message.deletedAt));
	const label = $derived(mine ? 'You' : message.senderName);

	const time = $derived.by(() => {
		if (message.pending) return 'Sending…';
		const date = new Date(message.createdAt);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	});

	const seenLabel = $derived.by(() => {
		const seen = message.seenBy;
		if (!seen.length) return '';
		const first = seen[0].name.split(/\s+/)[0] || 'Friend';
		const names = seen.length > 1 ? `${first} +${seen.length - 1}` : first;
		const date = new Date(seen[seen.length - 1].at);
		const at = Number.isNaN(date.getTime())
			? ''
			: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		return at ? `Seen by ${names} · ${at}` : `Seen by ${names}`;
	});

	const entryDate = $derived.by(() => {
		if (!message.sharedEntry?.date) return '';
		const date = new Date(`${message.sharedEntry.date}T12:00:00`);
		if (Number.isNaN(date.getTime())) return message.sharedEntry.date;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	});

	$effect(() => {
		if (editing) {
			void tick().then(() => {
				editEl?.focus();
				const end = editEl?.value.length ?? 0;
				editEl?.setSelectionRange(end, end);
			});
		}
	});

	function startEdit() {
		editValue = message.body;
		editing = true;
		menuOpen = false;
	}

	function saveEdit() {
		if (!editValue.trim()) return;
		onEdit(message, editValue);
		editing = false;
	}

	function cancelEdit() {
		editing = false;
		editValue = '';
	}

	function run(action: (message: DmMessage) => void) {
		menuOpen = false;
		action(message);
	}

	function handleEditKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelEdit();
		} else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			saveEdit();
		}
	}

	/** Touch equivalent of the desktop hover toolbar. */
	function clearPress() {
		if (pressTimer) clearTimeout(pressTimer);
		pressTimer = null;
		pressOrigin = null;
		longPressing = false;
	}

	function pointerDown(event: PointerEvent) {
		// Mouse and desktop already get the hover toolbar.
		if (event.pointerType === 'mouse') return;
		if (message.pending || isDeleted || editing) return;

		clearPress();
		suppressClick = false;
		pressOrigin = { x: event.clientX, y: event.clientY };
		longPressing = true;
		pressTimer = setTimeout(() => {
			pressTimer = null;
			longPressing = false;
			pressOrigin = null;
			menuOpen = true;
			suppressClick = true;
			if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(15);
		}, LONG_PRESS_MS);
	}

	function pointerMove(event: PointerEvent) {
		if (!pressOrigin) return;
		const dx = event.clientX - pressOrigin.x;
		const dy = event.clientY - pressOrigin.y;
		// Let the list scroll normally; only treat a still finger as a long press.
		if (Math.hypot(dx, dy) > MOVE_TOLERANCE) clearPress();
	}

	function pointerUp() {
		clearPress();
	}

	function handleContextMenu(event: MouseEvent) {
		// Touch browsers fire this on long press — show our toolbar instead.
		event.preventDefault();
	}

	function handleClickCapture(event: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (!menuOpen) return;
		const target = event.target as Node | null;
		if (target && wrapperEl && !wrapperEl.contains(target)) menuOpen = false;
	}

	onDestroy(clearPress);
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

<div
	bind:this={wrapperEl}
	class="flex w-full items-start gap-2 {mine ? 'flex-row-reverse' : ''} {showHeader
		? 'mt-3'
		: 'mt-0.5'}"
>
	<div class="w-8 shrink-0">
		{#if showHeader}
			<button
				type="button"
				class="block rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:outline-none"
				onclick={() => onOpenProfile(message.senderId)}
				aria-label={`View ${label}'s profile`}
				title={`View ${label}'s profile`}
			>
				<Avatar
					src={message.senderAvatar}
					name={message.senderName}
					className="size-8"
					textClass="text-xs"
					ring="ring-1 ring-line/60"
				/>
			</button>
		{/if}
	</div>

	<div class="flex max-w-[78%] min-w-0 flex-col {mine ? 'items-end' : 'items-start'}">
		{#if showHeader}
			<button
				type="button"
				class="mb-1 max-w-full truncate font-ui text-[11px] font-semibold text-book-ink/70 transition-colors hover:text-book-ink hover:underline"
				title={`View ${label}'s profile`}
				onclick={() => onOpenProfile(message.senderId)}
			>
				{label}
			</button>
		{/if}

		<div class="group/message relative w-fit max-w-full">
			<!-- Hover / focus action bar -->
			{#if !message.pending && !isDeleted}
				<div
					class="pointer-events-none absolute -top-[76px] z-20 flex max-w-[min(420px,86vw)] flex-wrap items-center justify-center gap-0.5 rounded-[22px] border border-cover-edge bg-book-bg/95 p-1 opacity-0 shadow-[0_8px_20px_rgba(0,0,0,.28)] backdrop-blur transition-opacity group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 sm:-top-10 sm:flex-nowrap sm:rounded-full {mine
						? 'right-0'
						: 'left-0'} {menuOpen ? 'pointer-events-auto opacity-100' : ''}"
					role="toolbar"
					aria-label="Message actions"
				>
					{#each QUICK_REACTIONS as emoji (emoji)}
						<button
							type="button"
							class="flex size-7 items-center justify-center rounded-full text-sm leading-none transition-transform hover:scale-125 hover:bg-line/40"
							onclick={() => onReact(message, emoji)}
							aria-label={`React ${emoji}`}
							title={`React ${emoji}`}
						>
							{emoji}
						</button>
					{/each}
					<span class="mx-1 h-4 w-px bg-line" aria-hidden="true"></span>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-full text-book-ink/75 transition-colors hover:bg-line/40 hover:text-book-ink"
						onclick={() => run(onReply)}
						aria-label="Reply"
						title="Reply"><CommunityIcon name="reply" size={14} /></button
					>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-full text-book-ink/75 transition-colors hover:bg-line/40 hover:text-book-ink"
						onclick={() => run(onCopy)}
						aria-label="Copy text"
						title="Copy text"><CommunityIcon name="copy" size={14} /></button
					>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-full text-book-ink/75 transition-colors hover:bg-line/40 hover:text-book-ink"
						onclick={() => run(onForward)}
						aria-label="Forward"
						title="Forward"><CommunityIcon name="forward" size={14} /></button
					>
					<button
						type="button"
						class="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-line/40 {message.pinned
							? 'text-book-accent'
							: 'text-book-ink/75 hover:text-book-ink'}"
						onclick={() => run(onPin)}
						aria-label={message.pinned ? 'Unpin' : 'Pin'}
						title={message.pinned ? 'Unpin' : 'Pin'}><CommunityIcon name="pin" size={14} /></button
					>
					{#if mine}
						<button
							type="button"
							class="flex size-7 items-center justify-center rounded-full text-book-ink/75 transition-colors hover:bg-line/40 hover:text-book-ink"
							onclick={startEdit}
							aria-label="Edit"
							title="Edit"><CommunityIcon name="pen" size={14} /></button
						>
						<button
							type="button"
							class="flex size-7 items-center justify-center rounded-full text-danger transition-colors hover:bg-danger/10"
							onclick={() => run(onDelete)}
							aria-label="Delete"
							title="Delete"><CommunityIcon name="trash" size={14} /></button
						>
					{/if}
				</div>
			{/if}

			<div
				role="presentation"
				tabindex="-1"
				class="rounded-2xl font-ui text-sm leading-relaxed [overflow-wrap:anywhere] {message.body ||
				hasMedia ||
				message.sharedEntry ||
				message.forwardedFrom ||
				isDeleted
					? 'px-3.5 py-2'
					: 'p-1.5'} {mine
					? 'rounded-br-md bg-cta text-cta-text'
					: 'rounded-bl-md border border-line bg-book-bg text-book-ink'} {message.pending
					? 'opacity-70'
					: ''} {longPressing ? 'select-none [-webkit-touch-callout:none]' : ''}"
				onpointerdown={pointerDown}
				onpointermove={pointerMove}
				onpointerup={pointerUp}
				onpointercancel={pointerUp}
				oncontextmenu={handleContextMenu}
				onclickcapture={handleClickCapture}
			>
				{#if isDeleted}
					<p class="flex items-center gap-1.5 italic opacity-75">
						<CommunityIcon name="trash" size={13} />
						{message.deletedByName || 'Someone'} deleted this message
					</p>
				{:else}
					{#if message.replyTo}
						<div
							class="mb-1.5 rounded-r-md border-l-2 border-gold/80 bg-black/5 px-2 py-1 dark:bg-white/5"
						>
							<p class="font-ui text-[10px] font-bold opacity-80">
								{message.replySender || 'Someone'}
							</p>
							<p class="line-clamp-2 font-ui text-[11px] opacity-70">
								{message.replyDeleted
									? 'Original message was deleted'
									: message.replyBody
										? censor(message.replyBody)
										: 'Attachment'}
							</p>
						</div>
					{/if}

					{#if message.forwardedFrom}
						<div class="mb-1.5 rounded-r-md border-l-2 border-dashed border-lav px-2 py-1">
							<p class="font-ui text-[10px] font-bold opacity-80">
								Forwarded from {message.forwardedFrom.name}
							</p>
							<p class="line-clamp-3 font-ui text-[11px] opacity-70">
								{censor(message.forwardedFrom.body)}
							</p>
						</div>
					{/if}

					{#if hasMedia}
						{#if imageSrc}
							<button
								type="button"
								class="block cursor-zoom-in"
								onclick={() => onOpenImage(imageSrc)}
								aria-label={isGif ? 'Open GIF in a new tab' : 'Open photo in a new tab'}
							>
								<img
									src={imageSrc}
									alt={message.body
										? censor(message.body)
										: isGif
											? `GIF from ${message.senderName}`
											: `Photo from ${message.senderName}`}
									class="block max-h-64 w-auto max-w-full rounded-xl object-cover"
									loading="lazy"
									decoding="async"
								/>
							</button>
						{:else}
							<div class="flex h-28 w-44 items-center justify-center rounded-xl bg-line/30">
								<span class="font-ui text-[11px] text-book-ink/70">
									Loading {isGif ? 'GIF' : 'photo'}…
								</span>
							</div>
						{/if}
					{/if}

					{#if message.sharedEntry}
						<button
							type="button"
							class="mt-1 block w-full overflow-hidden rounded-xl border border-gold/50 bg-book-bg text-left text-book-ink shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:outline-none {hasMedia
								? 'max-w-[260px]'
								: 'max-w-[300px] min-w-[220px]'}"
							onclick={() =>
								onOpenEntry(message.sharedEntry!, message.senderId, message.senderName)}
							aria-label={`Open journal page from ${entryDate}`}
						>
							<span class="block bg-gradient-to-r from-book-accent/25 to-cover/25 px-3 py-2">
								<span class="flex items-center gap-1.5">
									<span
										class="flex size-6 items-center justify-center rounded-full bg-paper text-book-accent"
									>
										<CommunityIcon
											name={MOOD_ICONS[message.sharedEntry.mood] || 'book'}
											size={13}
										/>
									</span>
									<span class="font-ui text-[10px] font-bold tracking-wide text-ink-soft uppercase">
										Journal page
									</span>
									<span class="ml-auto font-ui text-[10px] text-ink-soft">{entryDate}</span>
								</span>
							</span>
							<span class="block px-3 py-2.5">
								<span class="block truncate font-display text-[15px] font-bold">
									{message.sharedEntry.title || 'Untitled page'}
								</span>
								<span
									class="mt-0.5 line-clamp-2 block font-hand text-[13px] leading-snug text-ink-soft"
								>
									{censor(
										message.sharedEntry.mind ||
											message.sharedEntry.refl ||
											'A page from my journal.'
									)}
								</span>
								<span
									class="mt-2 flex items-center gap-1 font-ui text-[10px] font-bold text-accent"
								>
									Open page <CommunityIcon name="arrow-right" size={12} />
								</span>
							</span>
						</button>
					{/if}

					{#if editing}
						<div class="min-w-[220px]">
							<textarea
								bind:this={editEl}
								bind:value={editValue}
								onkeydown={handleEditKey}
								rows="3"
								maxlength="2000"
								class="w-full resize-none rounded-lg border border-line bg-book-bg px-2 py-1.5 font-ui text-sm text-book-ink focus:border-book-accent focus:outline-none"
								aria-label="Edit message"></textarea>
							<div class="mt-1 flex justify-end gap-1.5">
								<button
									type="button"
									class="rounded-full px-2 py-1 font-ui text-[11px] font-semibold opacity-75 hover:opacity-100"
									onclick={cancelEdit}
								>
									Cancel
								</button>
								<button
									type="button"
									class="rounded-full bg-cta px-2.5 py-1 font-ui text-[11px] font-bold text-cta-text disabled:opacity-50"
									onclick={saveEdit}
									disabled={!editValue.trim()}
								>
									Save
								</button>
							</div>
						</div>
					{:else if message.body}
						<p class="whitespace-pre-wrap {hasMedia || message.sharedEntry ? 'mt-1.5' : ''}">
							{censor(message.body)}
						</p>
					{/if}
				{/if}
			</div>

			{#if message.reactions.length && !isDeleted}
				<div class="mt-1 flex flex-wrap {mine ? 'justify-end' : 'justify-start'} gap-1">
					{#each message.reactions as reaction (reaction.emoji)}
						<button
							type="button"
							class="flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-ui text-[11px] transition-colors {reaction.mine
								? 'border-gold/70 bg-book-accent/25 text-book-ink'
								: 'border-line bg-book-bg/80 text-book-ink/80 hover:border-gold/50'}"
							onclick={() => onReact(message, reaction.emoji)}
							aria-label={`${reaction.mine ? 'Remove' : 'Add'} ${reaction.emoji} reaction, ${reaction.count}`}
							aria-pressed={reaction.mine}
						>
							<span>{reaction.emoji}</span>
							<span class="tabular-nums">{reaction.count}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<p
			class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-ui text-[10px] text-book-ink/70"
		>
			{#if message.pinned}
				<CommunityIcon name="pin" size={10} class="text-book-accent" />
			{/if}
			<span>{time}</span>
			{#if message.editedAt && !isDeleted}
				<span class="italic opacity-70">(edited)</span>
			{/if}
			{#if seenLabel}
				<span class="text-book-accent">· {seenLabel}</span>
			{/if}
			{#if !message.pending && !isDeleted}
				<button
					type="button"
					class="rounded-full px-1 leading-none opacity-50 transition-opacity hover:opacity-100 sm:hidden"
					onclick={() => (menuOpen = !menuOpen)}
					aria-label="Message actions"
					aria-expanded={menuOpen}
				>
					•••
				</button>
			{/if}
		</p>
	</div>
</div>
