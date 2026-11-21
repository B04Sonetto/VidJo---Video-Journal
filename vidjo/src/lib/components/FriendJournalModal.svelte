<script lang="ts">
	import { untrack } from 'svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { messages } from '#lib/state/messages.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import { censor } from '#lib/censor';
	import AttachedSongCard from '#lib/components/AttachedSongCard.svelte';
	import type { Friend, FriendPost } from '#lib/types';

	let {
		open,
		friend,
		posts,
		initialDate = null,
		onClose
	}: {
		open: boolean;
		friend: Friend | null;
		posts: FriendPost[];
		/** Page date to show when the reader opens (used by notifications). */
		initialDate?: string | null;
		onClose: () => void;
	} = $props();

	let index = $state(0);
	let noteInput = $state('');
	let profileModalOpen = $state(false);
	let viewedUserId = $state<string | null>(null);
	let reportModalOpen = $state(false);
	let reportReason = $state('');
	let reportTarget: { postId: string; commentId: string } | null = null;
	let unfriendOpen = $state(false);
	let unfriendBusy = $state(false);
	let noteConfirmId = $state<string | null>(null);
	let editingNoteId = $state<string | null>(null);
	let editNoteText = $state('');
	let openedFor: string | null = null;
	/** Pages that were still unread when this notebook was opened. */
	let newAtOpen = $state<Set<string>>(new Set());
	let mindExpanded = $state(false);
	let reflExpanded = $state(false);

	const NOTE_MAX = 140;
	/** Feed/reader previews stay compact until the reader asks to see the rest. */
	const MIND_PREVIEW = 240;
	const REFL_PREVIEW = 140;

	const REACTIONS: {
		key: 'love' | 'spark' | 'warm' | 'proud';
		icon: string;
		label: string;
		active: string;
	}[] = [
		{
			key: 'love',
			icon: 'heart',
			label: 'Love this page',
			active: 'border-pink-400 bg-pink-100 text-pink-700'
		},
		{
			key: 'spark',
			icon: 'sparkles',
			label: 'Inspired',
			active: 'border-amber-400 bg-amber-100 text-amber-800'
		},
		{
			key: 'warm',
			icon: 'sun',
			label: 'Warm hug',
			active: 'border-orange-400 bg-orange-100 text-orange-800'
		},
		{
			key: 'proud',
			icon: 'star',
			label: 'Proud of you',
			active: 'border-purple-400 bg-purple-100 text-purple-800'
		}
	];

	const sorted = $derived([...posts].sort((a, b) => b.date.localeCompare(a.date)));
	const page = $derived(sorted[index] ?? null);
	const notebookStyle = $derived(profile.notebookStyle);
	const firstName = $derived(friend ? friend.displayName.trim().split(/\s+/)[0] || 'them' : 'them');

	$effect(() => {
		if (!open) {
			openedFor = null;
			newAtOpen = new Set();
			return;
		}

		// Read `posts.length` so the effect runs again once the friend's shelf
		// has loaded, then jump to the requested date exactly once.
		void posts.length;
		const key = initialDate ?? '';
		if (openedFor === key) return;

		const at = initialDate
			? untrack(() => sorted.findIndex((post) => post.date === initialDate))
			: -1;
		if (initialDate && at < 0 && posts.length === 0) return;

		openedFor = key;
		index = at >= 0 ? at : 0;
		// Snapshot the unread pages before viewing marks them as read, so the
		// reader can still point out which one was new.
		newAtOpen = new Set(
			untrack(() =>
				sorted
					.filter((post) => !friends.isPostSeen(post))
					.map((post) => `${post.authorId}:${post.date}`)
			)
		);
		noteInput = '';
		noteConfirmId = null;
		unfriendOpen = false;
		mindExpanded = false;
		reflExpanded = false;
	});

	// Opening a page (or flipping to it) is what clears its "new" notification.
	$effect(() => {
		if (!open || !page) return;
		friends.markPageSeen(page.authorId, page.date);
	});

	$effect(() => {
		void index;
		if (index >= sorted.length) index = Math.max(0, sorted.length - 1);
		noteConfirmId = null;
		mindExpanded = false;
		reflExpanded = false;
	});

	$effect(() => {
		if (!open || sorted.length === 0) return;

		// The reader shows one page at a time, so only that page's video is
		// signed. Prefetching the neighbours keeps page flipping instant.
		const neighbours = [
			sorted[index],
			sorted[(index + 1) % sorted.length],
			sorted[(index - 1 + sorted.length) % sorted.length]
		];
		const wanted = [...new Map(neighbours.map((post) => [post?.id, post])).values()].filter(
			(post): post is FriendPost => Boolean(post?.videoPath && !post.videoUrl)
		);

		if (wanted.length > 0) void friends.ensureMedia(wanted);
	});

	function go(delta: number) {
		if (sorted.length === 0) return;
		index = (index + delta + sorted.length) % sorted.length;
	}

	function submitNote(event: SubmitEvent) {
		event.preventDefault();
		if (!page) return;
		const text = noteInput;
		if (!text.trim()) return;
		void friends.addComment(page.id, text);
		noteInput = '';
	}

	async function deleteNote(postId: string, commentId: string) {
		noteConfirmId = null;
		const ok = await friends.deleteComment(postId, commentId);
		journal.toast(ok ? 'Note deleted' : 'Could not delete the note. Please try again.');
	}

	function startEditNote(commentId: string, text: string) {
		noteConfirmId = null;
		editingNoteId = commentId;
		editNoteText = text;
	}

	function cancelEditNote() {
		editingNoteId = null;
		editNoteText = '';
	}

	async function saveEditNote(postId: string, commentId: string) {
		if (!editNoteText.trim()) return;
		const ok = await friends.updateComment(postId, commentId, editNoteText);
		if (ok) {
			editingNoteId = null;
			editNoteText = '';
			journal.toast('Note updated');
		} else {
			journal.toast('Could not update the note. Please try again.');
		}
	}

	function openReport(postId: string, commentId: string) {
		reportTarget = { postId, commentId };
		reportReason = '';
		reportModalOpen = true;
	}

	async function submitReport() {
		const reason = reportReason.trim();
		if (!reason || !reportTarget) return;
		const { postId, commentId } = reportTarget;
		reportModalOpen = false;
		reportReason = '';
		reportTarget = null;
		const ok = await friends.reportComment(postId, commentId, reason);
		journal.toast(
			ok ? 'Report sent to moderators. Thank you.' : 'Could not send the report. Please try again.'
		);
	}

	async function confirmUnfriend() {
		if (!friend || unfriendBusy) return;
		unfriendBusy = true;
		await friends.removeFriend(friend.id);
		unfriendBusy = false;
		unfriendOpen = false;
		onClose();
	}

	function openProfile(userId: string) {
		viewedUserId = userId;
		profileModalOpen = true;
	}

	function copyFriendCode() {
		const code = friend?.friendCode;
		if (!code) return;
		void navigator.clipboard?.writeText(code);
		journal.toast(`Friend code ${code} copied!`);
	}

	function openMessages() {
		if (!friend) return;
		const target = friend;
		onClose();
		nav.openMessages();
		void messages.openDirect(target);
	}

	function handleKey(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			onClose();
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
		if (event.key === 'ArrowLeft') go(-1);
		if (event.key === 'ArrowRight') go(1);
	}

	function stickersFor(entry: FriendPost | null) {
		const list: { svg: string; flat: boolean }[] = [];
		for (const sticker of entry?.stickers ?? []) {
			const def = STICKER_BY_KEY[sticker.type];
			if (def) list.push({ svg: def.svg, flat: Boolean(def.flat) });
			if (list.length >= 5) break;
		}
		return list;
	}

	function moodOf(entry: FriendPost) {
		return entry.mood && MOOD_BY_KEY[entry.mood] ? MOOD_BY_KEY[entry.mood] : null;
	}

	function hasMedia(entry: FriendPost) {
		return Boolean(entry.videoUrl || entry.videoPath || entry.videoName);
	}
</script>

<svelte:window onkeydown={handleKey} />

<!-- ─────────── Shared page pieces (laid out differently per notebook style) ─────────── -->

{#snippet dateRow(p: FriendPost, dark: boolean)}
	{@const mood = moodOf(p)}
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex flex-wrap items-center gap-2">
			<span class="font-ui text-xs font-semibold {dark ? 'text-book-bg/70' : 'text-book-ink/70'}">
				{p.dateFormatted}
			</span>
			{#if mood}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-ui text-[11px] font-bold text-book-ink"
					style="background: {mood.c}66; border-color: {mood.c}"
				>
					<span class="size-5 [&>svg]:size-full" aria-hidden="true">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
						{@html mood.svg}
					</span>
					{mood.l}
				</span>
			{/if}
		</div>
		<span
			class="inline-flex items-center gap-1.5 rounded-full bg-book-accent/15 px-2.5 py-1 font-ui text-[10px] font-bold {dark
				? 'text-book-accent'
				: 'note-accent'}"
		>
			<CommunityIcon name="users" size={11} />
			Shared with friends
		</span>
	</div>
{/snippet}

{#snippet titleBlock(p: FriendPost, dark: boolean)}
	{#if p.title}
		<h3
			class="mt-2 line-clamp-2 font-hand text-[24px] leading-[1.1] font-bold [overflow-wrap:anywhere] min-[720px]:mt-3 min-[720px]:text-[32px] {dark
				? 'text-book-bg'
				: 'text-book-ink'}"
		>
			{censor(p.title)}
		</h3>
	{/if}
{/snippet}

{#snippet mediaBlock(p: FriendPost)}
	{#if p.videoUrl}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			src={p.videoUrl}
			poster={p.videoThumbUrl || undefined}
			controls
			playsinline
			preload="metadata"
			class="reader-video max-h-[260px] w-full bg-black object-contain min-[720px]:max-h-[380px]"
		></video>
	{:else if p.videoPath}
		<!-- The signed URL for this page is still being created. -->
		<div
			class="flex aspect-[16/10] flex-col items-center justify-center gap-3 bg-desk text-book-bg"
		>
			<span
				class="flex size-12 items-center justify-center rounded-full bg-book-bg/10 text-book-accent"
			>
				<Spinner size={22} />
			</span>
			<p class="font-ui text-xs font-semibold text-book-bg/70">Loading video…</p>
		</div>
	{:else if p.videoName}
		<div
			class="relative flex aspect-[16/10] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-cover)_0%,var(--color-desk)_85%)] text-center text-book-bg"
		>
			<span
				class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-[11px] text-red-300"
			>
				<span class="size-2 animate-pulse rounded-full bg-red-400"></span>
				REC
			</span>
			<span class="absolute top-3 right-4 font-mono text-[11px] text-book-accent">VIDJO</span>
			<span
				class="flex size-14 items-center justify-center rounded-full bg-book-bg/95 text-book-ink shadow-lg"
			>
				<CommunityIcon name="play" size={24} />
			</span>
			<p class="mt-3 max-w-[85%] font-display text-lg font-bold [overflow-wrap:anywhere]">
				{p.videoName || 'A small video moment'}
			</p>
			<p class="font-hand text-sm text-book-bg/70">Recorded with VidJo</p>
		</div>
	{/if}
{/snippet}

{#snippet moodArt(p: FriendPost)}
	{@const mood = moodOf(p)}
	<div
		class="relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden"
		style={mood
			? `background: radial-gradient(circle at 50% 32%, ${mood.c} 0%, var(--color-book-bg) 85%)`
			: 'background: linear-gradient(135deg, var(--color-paper-deep), var(--color-book-edge))'}
	>
		{#if mood}
			<span
				class="size-24 drop-shadow-[0_6px_10px_rgba(0,0,0,.18)] [&>svg]:size-full"
				aria-hidden="true"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
				{@html mood.svg}
			</span>
			<span class="mt-2 font-hand text-xl leading-none font-bold text-book-ink">
				feeling {mood.l.toLowerCase()}
			</span>
		{:else}
			<span
				class="flex size-16 items-center justify-center rounded-full bg-book-bg/80 text-book-accent shadow-sm"
			>
				<CommunityIcon name="book" size={30} />
			</span>
		{/if}
	</div>
{/snippet}

{#snippet mindBlock(p: FriendPost, dark: boolean)}
	{#if p.mind}
		<div
			class="mt-4 rounded [background-position:0_12px] px-4 py-3 {dark
				? 'nb-dark-lines rounded-xl border border-book-accent/25 bg-desk/55'
				: 'border border-line/70 bg-book-bg paper-lined'}"
		>
			<p
				class="[overflow-wrap:anywhere] whitespace-pre-wrap {mindExpanded
					? ''
					: 'line-clamp-[8]'} font-hand text-[22px] leading-[32px] {dark
					? 'text-book-bg'
					: 'text-book-ink'}"
			>
				{censor(p.mind)}
			</p>
			{#if p.mind.length > MIND_PREVIEW}
				<button
					type="button"
					class="mt-2 font-ui text-[11px] font-bold text-book-accent hover:underline"
					onclick={() => (mindExpanded = !mindExpanded)}
				>
					{mindExpanded ? 'Show less' : 'Read the rest'}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet reflBlock(p: FriendPost, dark: boolean)}
	{#if p.refl}
		<div
			class="mt-3 flex items-start gap-2.5 rounded px-3 py-2.5 {dark
				? 'rounded-xl border border-book-accent/25 bg-cover/35'
				: 'border border-line bg-paper-deep/80'}"
		>
			<span class="mt-0.5 shrink-0 text-book-accent" aria-hidden="true">
				<CommunityIcon name="star" size={16} />
			</span>
			<div class="min-w-0">
				<span class="block font-ui text-[10px] font-semibold text-book-accent">Reflection</span>
				<p
					class="mt-0.5 [overflow-wrap:anywhere] whitespace-pre-wrap {reflExpanded
						? ''
						: 'line-clamp-[4]'} font-hand text-lg leading-snug font-semibold {dark
						? 'text-book-bg'
						: 'text-book-ink'}"
				>
					{censor(p.refl)}
				</p>
				{#if p.refl.length > REFL_PREVIEW}
					<button
						type="button"
						class="mt-1 font-ui text-[10px] font-bold text-book-accent hover:underline"
						onclick={() => (reflExpanded = !reflExpanded)}
					>
						{reflExpanded ? 'Show less' : 'Read the rest'}
					</button>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet stickerRow(p: FriendPost, dark: boolean)}
	{@const list = stickersFor(p)}
	{#if list.length > 0}
		<div
			class="mt-4 flex flex-wrap items-center gap-3 border-t pt-3.5 {dark
				? 'border-cover-edge'
				: 'border-line/60'}"
		>
			{#each list as sticker, i (i)}
				<span
					class="inline-block w-11 {sticker.flat
						? 'sticker-flat'
						: 'sticker-shadow'} [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
					style="transform: rotate({(i % 2 === 0 ? -1 : 1) * (3 + i * 2)}deg)"
					aria-hidden="true"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/stickers.ts -->
					{@html sticker.svg}
				</span>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet socialBlock(p: FriendPost)}
	<div class="rounded-2xl border border-line bg-book-bg p-3.5 text-book-ink">
		<div class="flex flex-wrap items-center gap-1.5">
			{#each REACTIONS as reaction (reaction.key)}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-[11px] font-bold transition-all active:scale-95 {p.userReactions.includes(
						reaction.key
					)
						? reaction.active
						: 'border-line bg-book-bg text-book-ink/70 hover:bg-paper-deep'}"
					onclick={() => friends.toggleReaction(p.id, reaction.key)}
					aria-label={reaction.label}
					aria-pressed={p.userReactions.includes(reaction.key)}
				>
					<CommunityIcon name={reaction.icon} size={13} />
					<span class="tabular-nums">{p.reactions[reaction.key]}</span>
				</button>
			{/each}
		</div>

		<div class="mt-3 border-t border-line/70 pt-3">
			<span class="mb-2 block font-ui text-[10px] font-semibold text-book-ink/70">
				Friend notes <span class="tabular-nums">({p.comments.length})</span>
			</span>

			{#if p.comments.length > 0}
				<div class="mb-3 space-y-2">
					{#each p.comments as comment (comment.id)}
						<div class="flex items-start gap-2.5 rounded-lg bg-paper-deep/80 p-2.5">
							<Avatar
								src={comment.authorAvatar}
								name={comment.authorName}
								className="size-7"
								textClass="text-sm"
								ring=""
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline justify-between gap-2">
									<div class="flex min-w-0 items-baseline gap-1.5">
										<button
											type="button"
											class="truncate font-ui text-xs font-semibold text-book-ink hover:underline"
											onclick={() => openProfile(comment.authorId)}
										>
											{comment.authorName}
										</button>
										{#if comment.authorId === auth.ownerId}
											<span
												class="rounded-full bg-book-accent/15 px-1.5 py-0.5 font-ui text-[9px] font-bold note-accent"
												>You</span
											>
										{/if}
									</div>
									<time class="shrink-0 font-ui text-[10px] text-book-ink/70">{comment.time}</time>
								</div>
								{#if editingNoteId === comment.id}
									<div class="mt-1">
										<textarea
											bind:value={editNoteText}
											rows="2"
											maxlength={NOTE_MAX}
											aria-label="Edit your note"
											class="w-full resize-none rounded-lg border border-line bg-book-bg px-2 py-1.5 font-ui text-[11px] text-book-ink focus:border-book-accent focus:outline-none"
										></textarea>
										<div class="mt-1 flex items-center justify-between gap-2">
											<span class="font-ui text-[9px] text-book-ink/60 tabular-nums">
												{editNoteText.length}/{NOTE_MAX}
											</span>
											<div class="flex items-center gap-2">
												<button
													type="button"
													class="rounded-md bg-cta px-2 py-0.5 font-ui text-[10px] font-bold text-cta-text hover:bg-cta-hover disabled:opacity-50"
													onclick={() => saveEditNote(p.id, comment.id)}
													disabled={!editNoteText.trim()}
												>
													Save
												</button>
												<button
													type="button"
													class="rounded-md border border-line px-2 py-0.5 font-ui text-[10px] font-semibold text-book-ink/70 hover:bg-paper-deep"
													onclick={cancelEditNote}
												>
													Cancel
												</button>
											</div>
										</div>
									</div>
								{/if}
								<p
									class="mt-0.5 font-hand text-base leading-tight [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink {editingNoteId ===
									comment.id
										? 'hidden'
										: ''}"
								>
									{censor(comment.text)}
								</p>
								{#if !comment.id.startsWith('local-')}
									<div class="mt-1 {editingNoteId === comment.id ? 'hidden' : ''}">
										{#if comment.authorId === auth.ownerId}
											{#if noteConfirmId === comment.id}
												<div class="flex flex-wrap items-center gap-2">
													<span class="font-ui text-[10px] font-semibold text-[#9A5B5B]"
														>Delete this note?</span
													>
													<button
														type="button"
														class="rounded-md bg-[#9A5B5B] px-1.5 py-0.5 font-ui text-[10px] font-bold text-white hover:bg-[#7E4747]"
														onclick={() => deleteNote(p.id, comment.id)}
													>
														Yes, delete
													</button>
													<button
														type="button"
														class="rounded-md border border-line px-1.5 py-0.5 font-ui text-[10px] font-semibold text-book-ink/70 hover:bg-paper-deep"
														onclick={() => (noteConfirmId = null)}
													>
														Cancel
													</button>
												</div>
											{:else}
												<button
													type="button"
													class="font-ui text-[10px] text-book-ink/70 hover:text-book-accent"
													onclick={() => startEditNote(comment.id, comment.text)}
												>
													Edit
												</button>
												<button
													type="button"
													class="font-ui text-[10px] text-book-ink/70 hover:text-red-600"
													onclick={() => (noteConfirmId = comment.id)}
												>
													Delete
												</button>
											{/if}
										{:else}
											<button
												type="button"
												class="font-ui text-[10px] text-book-ink/70 hover:text-book-accent"
												onclick={() => openReport(p.id, comment.id)}
											>
												Report
											</button>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="mb-3 font-hand text-base leading-snug text-book-ink/70">
					No notes yet. Leave a kind one.
				</p>
			{/if}

			<form class="flex items-center gap-2" onsubmit={submitNote}>
				<input
					bind:value={noteInput}
					type="text"
					aria-label="Leave a note for {firstName}"
					placeholder="Leave {firstName} a kind note…"
					maxlength={NOTE_MAX}
					class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-book-bg px-3 font-ui text-xs text-book-ink placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
				/>
				<span class="shrink-0 font-ui text-[9px] text-book-ink/60 tabular-nums" aria-hidden="true">
					{noteInput.length}/{NOTE_MAX}
				</span>
				<button
					type="submit"
					class="h-9 rounded-lg bg-cta px-3.5 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover disabled:opacity-50"
					disabled={!noteInput.trim()}
				>
					Send
				</button>
			</form>
		</div>
	</div>
{/snippet}

{#if open && friend}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 min-[720px]:p-5"
		role="dialog"
		aria-modal="true"
		aria-label="{friend.displayName}'s shared journal"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close notebook"
		></button>

		<div
			class="relative z-10 flex max-h-[92dvh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[22px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.65)] min-[720px]:rounded-[32px]"
		>
			<!-- Notebook cover / header -->
			<div
				class="relative shrink-0 overflow-hidden border-b border-cover-edge bg-[radial-gradient(ellipse_at_top,var(--color-cover)_0%,var(--color-cover-edge)_65%,var(--color-desk)_100%)] px-3 py-3 min-[480px]:px-4 min-[720px]:px-8 min-[720px]:py-6"
			>
				<div
					class="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_15%_25%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_85%_15%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
					aria-hidden="true"
				></div>

				<div class="relative flex flex-wrap items-center justify-between gap-4">
					<div class="flex min-w-0 items-center gap-4">
						<button
							type="button"
							class="shrink-0 rounded-full transition-transform hover:scale-[1.03]"
							onclick={() => friend && openProfile(friend.id)}
							aria-label="View {friend.displayName}'s profile"
						>
							<Avatar
								src={friend.avatarUrl}
								name={friend.displayName}
								className="size-12 min-[720px]:size-20"
								textClass="text-2xl min-[720px]:text-3xl"
								ring="border-4 border-book-accent/60 shadow-[0_14px_28px_rgba(0,0,0,.45)]"
							/>
						</button>
						<div class="min-w-0">
							<p class="font-ui text-[11px] font-semibold text-book-bg/65">Shared notebook</p>
							<h2
								class="line-clamp-2 font-display text-xl leading-tight font-bold [overflow-wrap:anywhere] text-book-bg min-[720px]:text-3xl"
							>
								{friend.displayName}'s notebook
							</h2>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<span
									class="max-w-full truncate rounded-full bg-cover/45 px-2.5 py-1 font-ui text-xs font-semibold text-book-bg/85"
								>
									@{friend.username}
								</span>
								<span
									class="inline-flex items-center gap-1.5 rounded-full border border-book-accent/40 bg-book-accent/15 px-2.5 py-1 font-ui text-xs font-semibold text-book-accent tabular-nums"
								>
									<CommunityIcon name="book" size={12} />
									{sorted.length}
									{sorted.length === 1 ? 'shared page' : 'shared pages'}
								</span>
								{#if friend.friendCode}
									<button
										type="button"
										class="inline-flex items-center gap-1.5 rounded-full bg-cover/45 px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider text-book-accent transition-colors hover:bg-cover/65"
										onclick={copyFriendCode}
										title="Copy friend code"
										aria-label="Copy friend code {friend.friendCode}"
									>
										{friend.friendCode}
										<CommunityIcon name="copy" size={11} />
									</button>
								{/if}
							</div>
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-2">
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20 hover:text-book-bg"
							onclick={() => friend && openProfile(friend.id)}
							aria-label="View {friend.displayName}'s profile"
							title="View profile"
						>
							<CommunityIcon name="user" size={16} />
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20 hover:text-book-bg"
							onclick={openMessages}
							aria-label="Message {friend.displayName}"
							title="Message"
						>
							<CommunityIcon name="mail" size={16} />
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full bg-[#D19A9A]/20 text-[#F0BDBD] transition-colors hover:bg-[#D19A9A]/40 hover:text-white"
							onclick={(event) => {
								event.stopPropagation();
								if (friend) unfriendOpen = true;
							}}
							aria-label={`Remove ${friend.displayName} from friends`}
							title={`Remove ${friend.displayName} from friends`}
						>
							<CommunityIcon name="user-minus" size={16} />
						</button>
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20 hover:text-book-bg"
							onclick={onClose}
							aria-label="Close notebook"
						>
							<CommunityIcon name="x" size={16} />
						</button>
					</div>
				</div>
			</div>

			<!-- Mobile page picker -->
			{#if sorted.length > 1}
				<div
					class="flex shrink-0 gap-2 overflow-x-auto border-b border-cover-edge bg-desk/60 px-4 py-2.5 min-[860px]:hidden"
				>
					{#each sorted as entry, i (entry.id)}
						<button
							type="button"
							class="shrink-0 rounded-full border px-3.5 py-1.5 font-ui text-xs font-bold transition-colors {i ===
							index
								? 'border-transparent bg-cta text-cta-text shadow-sm'
								: 'border-cover-edge bg-desk-2 text-book-bg/70 hover:border-book-accent/50 hover:text-book-bg'}"
							onclick={() => (index = i)}
							aria-pressed={i === index}
						>
							{entry.dateFormatted}
						</button>
					{/each}
				</div>
			{/if}

			<div
				class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] min-[860px]:grid-cols-[250px_minmax(0,1fr)]"
			>
				<!-- Page index -->
				<aside
					class="reader-scroll hidden min-h-0 flex-col overflow-y-auto border-r border-cover-edge bg-desk/60 p-4 min-[860px]:flex"
				>
					<div class="mb-3 flex items-center justify-between gap-2">
						<p class="font-display text-lg font-bold text-book-bg">Pages</p>
						<span class="font-ui text-[11px] text-book-bg/60 tabular-nums">{sorted.length}</span>
					</div>
					{#if sorted.length === 0}
						<p class="font-hand text-base text-book-bg/65">No shared pages yet.</p>
					{:else}
						<div class="space-y-1.5">
							{#each sorted as entry, i (entry.id)}
								<button
									type="button"
									class="flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-all {i ===
									index
										? 'border-book-accent/50 bg-book-accent/10 shadow-[0_6px_16px_rgba(0,0,0,.25)]'
										: 'border-transparent hover:border-cover-edge hover:bg-cover/20'}"
									onclick={() => (index = i)}
									aria-current={i === index ? 'page' : undefined}
								>
									{#if entry.mood && MOOD_BY_KEY[entry.mood]}
										<span
											class="flex size-10 shrink-0 items-center justify-center rounded-full"
											style="background: {MOOD_BY_KEY[entry.mood].c}88"
											aria-hidden="true"
										>
											<span class="size-7 [&>svg]:size-full">
												<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
												{@html MOOD_BY_KEY[entry.mood].svg}
											</span>
										</span>
									{:else}
										<span
											class="flex size-10 shrink-0 items-center justify-center rounded-full bg-cover/45 font-ui text-[10px] font-bold text-book-accent"
											aria-hidden="true"
										>
											{entry.dateFormatted.slice(0, 3)}
										</span>
									{/if}
									<span class="min-w-0 flex-1">
										<span
											class="block truncate font-hand text-lg leading-tight font-bold {i === index
												? 'text-book-bg'
												: 'text-book-bg/85'}"
										>
											{censor(entry.title || 'Untitled page')}
										</span>
										<span class="block font-ui text-[11px] text-book-bg/60"
											>{entry.dateFormatted}</span
										>
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</aside>

				<!-- Page body (style chosen in Profile → Settings) -->
				<div
					class="reader-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-3 py-3 min-[720px]:px-7 min-[720px]:py-6"
				>
					{#if page}
						{#if notebookStyle === 'dark'}
							<!-- Dark journal: purple page with a gold edge -->
							<article
								class="relative mx-auto max-w-[720px] min-w-0 overflow-hidden rounded-[18px] border border-book-accent/35 bg-[linear-gradient(160deg,var(--color-cover)_0%,var(--color-desk)_90%)] p-3 text-book-bg shadow-[0_18px_44px_rgba(0,0,0,.5)] min-[720px]:rounded-[26px] min-[720px]:p-6"
							>
								<span
									class="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-book-accent to-transparent"
									aria-hidden="true"
								></span>
								{@render dateRow(page, true)}
								{@render titleBlock(page, true)}
								{#if hasMedia(page)}
									<div class="mt-4 overflow-hidden rounded-xl border border-cover-edge bg-desk">
										{@render mediaBlock(page)}
									</div>
								{/if}
								{@render mindBlock(page, true)}
								{@render reflBlock(page, true)}
								{#if page.song}
									<div class="mt-4">
										<AttachedSongCard song={page.song} label="Song on this page" />
									</div>
								{/if}
								{@render stickerRow(page, true)}
								<div class="mt-4">{@render socialBlock(page)}</div>
							</article>
						{:else if notebookStyle === 'spread'}
							<!-- Book spread: left page = media, right page = writing -->
							<div class="mx-auto max-w-[860px] min-w-0">
								<div
									class="relative grid overflow-hidden rounded-[14px] border-[5px] border-cover-edge bg-cover-edge shadow-[0_18px_44px_rgba(0,0,0,.5)] min-[1000px]:grid-cols-2"
								>
									<span
										class="pointer-events-none absolute inset-y-0 left-1/2 z-10 hidden w-8 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(0,0,0,.22),transparent)] min-[1000px]:block"
										aria-hidden="true"
									></span>
									<section class="min-w-0 note-scrap p-4 text-book-ink min-[720px]:p-6">
										{@render dateRow(page, false)}
										{@render titleBlock(page, false)}
										<div class="mt-4 overflow-hidden rounded-[4px] border border-line bg-desk">
											{#if hasMedia(page)}
												{@render mediaBlock(page)}
											{:else}
												{@render moodArt(page)}
											{/if}
										</div>
										{@render stickerRow(page, false)}
									</section>
									<section class="min-w-0 bg-book-bg p-4 text-book-ink min-[720px]:p-6">
										{#if page.mind || page.refl}
											{@render mindBlock(page, false)}
											{@render reflBlock(page, false)}
										{:else}
											<p class="mt-4 font-hand text-xl text-book-ink/60">
												{firstName} did not write anything on this page.
											</p>
										{/if}
										{#if page.song}
											<div class="mt-4">
												<AttachedSongCard song={page.song} compact label="Song on this page" />
											</div>
										{/if}
									</section>
								</div>
								<div class="mt-5 rounded-2xl shadow-[0_10px_24px_rgba(0,0,0,.35)]">
									{@render socialBlock(page)}
								</div>
							</div>
						{:else if notebookStyle === 'polaroid'}
							<!-- Polaroid: taped photo plus a small note -->
							<div class="mx-auto max-w-[800px] min-w-0">
								<div
									class="grid items-start gap-7 min-[1100px]:grid-cols-[300px_minmax(0,1fr)] min-[1100px]:gap-8"
								>
									<div
										class="relative mx-auto mt-3 w-full max-w-[340px] rotate-[-1.6deg] rounded-[3px] note-scrap p-3 pb-4 text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.5)]"
									>
										<span
											class="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-[3deg] bg-book-accent/55 shadow-sm"
											aria-hidden="true"
										></span>
										<div class="overflow-hidden bg-desk">
											{#if hasMedia(page)}
												{@render mediaBlock(page)}
											{:else}
												{@render moodArt(page)}
											{/if}
										</div>
										<p
											class="mt-3 line-clamp-2 text-center font-hand text-2xl leading-tight font-bold [overflow-wrap:anywhere]"
										>
											{page.title ? censor(page.title) : page.dateFormatted}
										</p>
									</div>

									<div
										class="relative min-w-0 rotate-[.5deg] rounded-[4px] note-scrap p-4 text-book-ink shadow-[0_12px_26px_rgba(0,0,0,.45)] min-[720px]:p-5"
									>
										{@render dateRow(page, false)}
										{#if page.mind || page.refl}
											{@render mindBlock(page, false)}
											{@render reflBlock(page, false)}
										{:else}
											<p class="mt-4 font-hand text-xl text-book-ink/60">
												A quiet page. The picture says it all.
											</p>
										{/if}
										{#if page.song}
											<div class="mt-4">
												<AttachedSongCard song={page.song} compact label="Song on this page" />
											</div>
										{/if}
										{@render stickerRow(page, false)}
									</div>
								</div>
								<div class="mt-6 rounded-2xl shadow-[0_10px_24px_rgba(0,0,0,.35)]">
									{@render socialBlock(page)}
								</div>
							</div>
						{:else}
							<!-- Scrapbook: cream note card -->
							<article
								class="relative mx-auto max-w-[720px] min-w-0 rounded-[8px] note-scrap p-4 text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.45)] min-[720px]:p-6"
							>
								{@render dateRow(page, false)}
								{@render titleBlock(page, false)}
								{#if hasMedia(page)}
									<div class="mt-4 overflow-hidden rounded-[4px] border border-line bg-desk">
										{@render mediaBlock(page)}
									</div>
								{/if}
								{@render mindBlock(page, false)}
								{@render reflBlock(page, false)}
								{#if page.song}
									<div class="mt-4">
										<AttachedSongCard song={page.song} label="Song on this page" />
									</div>
								{/if}
								{@render stickerRow(page, false)}
								<div class="mt-4">{@render socialBlock(page)}</div>
							</article>
						{/if}
					{:else}
						<div
							class="mx-auto my-6 max-w-[460px] rounded-[10px] note-scrap px-6 py-10 text-center text-book-ink shadow-[0_14px_30px_rgba(0,0,0,.4)]"
						>
							<span
								class="mx-auto flex size-16 items-center justify-center rounded-full bg-paper-deep text-book-accent"
							>
								<CommunityIcon name="sparkles" size={28} />
							</span>
							<p class="mt-4 font-display text-2xl font-bold">No shared pages yet</p>
							<p
								class="mx-auto mt-2 max-w-[320px] font-ui text-sm leading-relaxed [overflow-wrap:anywhere] text-book-ink/70"
							>
								{friend.displayName} has not shared any pages with friends so far. Check back soon.
							</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Page navigation -->
			<div
				class="flex shrink-0 items-center justify-between gap-3 border-t border-cover-edge bg-desk/60 px-4 py-3 min-[720px]:px-6"
			>
				<Button variant="outline" size="sm" onclick={() => go(-1)} disabled={sorted.length <= 1}>
					← Previous
				</Button>
				<span class="flex items-center gap-2">
					{#if page && newAtOpen.has(`${page.authorId}:${page.date}`)}
						<span class="rounded-full bg-gold px-2 py-0.5 font-ui text-[10px] font-bold text-desk">
							New
						</span>
					{/if}
					<span class="font-ui text-xs font-semibold text-book-bg/70 tabular-nums">
						{#if sorted.length > 0}
							Page {index + 1} of {sorted.length}
						{:else}
							Empty notebook
						{/if}
					</span>
				</span>
				<Button variant="outline" size="sm" onclick={() => go(1)} disabled={sorted.length <= 1}>
					Next →
				</Button>
			</div>
		</div>
	</div>
{/if}

<ProfileModal
	open={profileModalOpen}
	onClose={() => {
		profileModalOpen = false;
		viewedUserId = null;
	}}
	userId={viewedUserId}
/>

<!-- Remove friend confirmation -->
{#if unfriendOpen && friend}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="remove-friend-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={() => (unfriendOpen = false)}
			aria-label="Close remove friend dialog"
		></button>

		<div
			class="relative z-10 w-full max-w-[430px] overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.6)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-4 text-book-bg"
			>
				<div>
					<h2 id="remove-friend-title" class="font-display text-xl font-bold">Remove friend?</h2>
					<p class="font-ui text-[11px] text-book-bg/65">You can add them again any time</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
					onclick={() => (unfriendOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-5">
				<div class="flex items-center gap-3 rounded-xl border border-line bg-book-bg p-3">
					<Avatar
						src={friend.avatarUrl}
						name={friend.displayName}
						className="size-11"
						textClass="text-lg"
						ring=""
					/>
					<div class="min-w-0">
						<p class="truncate font-display text-lg leading-tight font-bold text-book-ink">
							{friend.displayName}
						</p>
						<p class="truncate font-ui text-xs text-book-ink/70">@{friend.username}</p>
					</div>
				</div>

				<p class="mt-4 font-ui text-sm leading-relaxed text-book-ink/70">
					You will stop seeing each other's shared pages. Their journal is not deleted, and you can
					add them again later with their friend code.
				</p>

				<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="note" onclick={() => (unfriendOpen = false)}>Keep friend</Button>
					<Button
						variant="danger"
						icon="user-minus"
						loading={unfriendBusy}
						disabled={unfriendBusy}
						onclick={confirmUnfriend}
					>
						{unfriendBusy ? 'Removing…' : 'Remove friend'}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Report reason modal -->
{#if reportModalOpen}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="report-note-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={() => (reportModalOpen = false)}
			aria-label="Close"
		></button>

		<div
			class="relative z-10 w-full max-w-[430px] overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-4 text-book-bg"
			>
				<div>
					<h2 id="report-note-title" class="font-display text-xl font-bold">Report note</h2>
					<p class="font-ui text-[11px] text-book-bg/65">Only moderators will see this</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
					onclick={() => (reportModalOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-5">
				<label for="report-reason" class="mb-2 block font-ui text-sm text-book-ink/70">
					Why are you reporting this note?
				</label>
				<textarea
					id="report-reason"
					bind:value={reportReason}
					rows="4"
					class="w-full rounded-xl border border-line bg-book-bg px-3.5 py-2.5 font-ui text-sm text-book-ink placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
					placeholder="Describe why this note feels unsafe…"></textarea>
				<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="note" onclick={() => (reportModalOpen = false)}>Cancel</Button>
					<Button variant="danger" disabled={!reportReason.trim()} onclick={submitReport}>
						Send report
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Scrolling and video frames should stay on their own compositing layers.
	   Without this, every scroll/video frame repaints the whole modal stack. */
	.reader-scroll {
		overscroll-behavior: contain;
		transform: translateZ(0);
	}

	.reader-video {
		transform: translateZ(0);
	}

	/* Gold-tinted ruled lines for the dark journal page. */
	.nb-dark-lines {
		background-image: repeating-linear-gradient(
			to bottom,
			transparent 0 31px,
			color-mix(in srgb, var(--color-book-accent) 32%, transparent) 31px 32px
		);
		background-attachment: local;
	}
</style>
