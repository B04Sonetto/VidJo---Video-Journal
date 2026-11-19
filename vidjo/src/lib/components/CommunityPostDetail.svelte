<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { community } from '#lib/state/community.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import { censor } from '#lib/censor';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import PromptModal from '#lib/components/PromptModal.svelte';
	import type { CommunityPost, FriendPostReaction } from '#lib/types';

	let {
		post,
		onClose,
		onProfile,
		onRemove
	}: {
		post: CommunityPost;
		onClose: () => void;
		onProfile: (userId: string) => void;
		onRemove: (post: CommunityPost) => void;
	} = $props();

	const COMMENT_MAX = 140;
	type CommentSort = 'newest' | 'top' | 'week' | 'month';
	let commentSort = $state<CommentSort>('newest');

	function sortedComments() {
		const list = [...post.comments];
		if (commentSort === 'newest') {
			return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
		}
		const days = commentSort === 'week' ? 7 : commentSort === 'month' ? 30 : 0;
		return list.sort(
			(a, b) =>
				community.commentReactionScoreSince(b, days) -
					community.commentReactionScoreSince(a, days) || (b.createdAt ?? 0) - (a.createdAt ?? 0)
		);
	}

	const REACTIONS: {
		key: keyof FriendPostReaction;
		icon: string;
		label: string;
		active: string;
	}[] = [
		{
			key: 'love',
			icon: 'heart',
			label: 'Love this',
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

	let commentText = $state('');
	let lastCommentTime = 0;
	let editingCommentId = $state<string | null>(null);
	let editCommentText = $state('');
	let commentConfirmId = $state<string | null>(null);
	let commentReportId = $state<string | null>(null);

	const canModerate = $derived(community.canModerate(post.communitySlug ?? ''));
	const canRemove = $derived(post.isOwner || post.authorId === auth.ownerId || canModerate);
	const mood = $derived(post.mood && MOOD_BY_KEY[post.mood] ? MOOD_BY_KEY[post.mood] : null);

	const stickers = $derived.by(() => {
		const list: { svg: string; flat: boolean; rot: number }[] = [];
		for (const sticker of post.stickers ?? []) {
			const def = STICKER_BY_KEY[sticker.type];
			if (!def) continue;
			list.push({ svg: def.svg, flat: Boolean(def.flat), rot: sticker.rot ?? 0 });
			if (list.length >= 6) break;
		}
		return list;
	});

	function stickerTilt(rot: number, index: number) {
		const base = Number.isFinite(rot) ? rot * 0.4 : 0;
		return Math.max(-14, Math.min(14, base + (index % 2 === 0 ? -2 : 2)));
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && !commentReportId) onClose();
	}

	function submitComment(event: SubmitEvent) {
		event.preventDefault();
		const text = commentText.trim();
		if (!text) return;

		const now = Date.now();
		if (now - lastCommentTime < 2000) {
			journal.toast('Please wait a moment before sending another note.');
			return;
		}
		lastCommentTime = now;

		void community.addComment(post, text);
		commentText = '';
	}

	async function deleteComment(commentId: string, isAuthor: boolean) {
		commentConfirmId = null;
		const ok = isAuthor
			? await community.deleteComment(post, commentId)
			: await community.deleteCommentAsAdmin(post, commentId);
		journal.toast(ok ? 'Note deleted' : 'Could not delete the note. Please try again.');
	}

	function startEditComment(commentId: string, text: string) {
		commentConfirmId = null;
		editingCommentId = commentId;
		editCommentText = text;
	}

	function cancelEditComment() {
		editingCommentId = null;
		editCommentText = '';
	}

	async function saveEditComment(commentId: string) {
		if (!editCommentText.trim()) return;
		const ok = await community.updateComment(post, commentId, editCommentText);
		if (ok) {
			editingCommentId = null;
			editCommentText = '';
			journal.toast('Note updated');
		} else {
			journal.toast('Could not update the note. Please try again.');
		}
	}

	function reportComment(commentId: string) {
		commentReportId = commentId;
	}

	async function sendReport(reason: string) {
		const commentId = commentReportId;
		commentReportId = null;
		if (!commentId) return;
		const ok = await community.reportComment(post, commentId, reason);
		journal.toast(
			ok ? 'Report sent to moderators. Thank you.' : 'Could not send the report. Please try again.'
		);
	}
</script>

<svelte:window onkeydown={handleKey} />

<div
	class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-2 min-[720px]:p-5"
	role="dialog"
	aria-modal="true"
	aria-label="{post.title || 'Community page'} full page"
>
	<button
		type="button"
		class="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent"
		onclick={onClose}
		aria-label="Close full page"
	></button>

	<div
		class="relative z-10 flex max-h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_30px_90px_rgba(0,0,0,.7)]"
	>
		<!-- Header -->
		<div
			class="relative flex shrink-0 items-center justify-between gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-3.5 text-book-bg"
		>
			<div class="flex min-w-0 items-center gap-3">
				<button
					type="button"
					class="shrink-0 rounded-full"
					onclick={() => onProfile(post.authorId)}
					aria-label="View {post.authorName}'s profile"
				>
					<Avatar
						src={post.authorAvatar}
						name={post.authorName}
						className="size-10"
						textClass="text-base"
						ring="ring-2 ring-gold/40"
					/>
				</button>
				<div class="min-w-0">
					<button
						type="button"
						class="block max-w-full truncate font-hand text-lg leading-tight font-bold hover:text-white"
						onclick={() => onProfile(post.authorId)}
					>
						{post.authorName}
					</button>
					<p class="truncate font-ui text-[10px] text-book-bg/70">
						@{post.authorUsername} · {post.dateFormatted} · {post.tag}
					</p>
				</div>
			</div>
			<button
				type="button"
				class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20 hover:text-white"
				onclick={onClose}
				aria-label="Close full page"
			>
				<CommunityIcon name="x" size={16} />
			</button>
		</div>

		<!-- Scrollable content -->
		<div
			class="min-h-0 flex-1 modal-scroll overflow-x-hidden overflow-y-auto px-4 py-5 min-[720px]:px-6"
		>
			<!-- Media -->
			{#if post.videoUrl}
				<div class="overflow-hidden rounded-[3px] border border-line bg-black">
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={post.videoUrl}
						poster={post.videoThumbUrl || undefined}
						controls
						playsinline
						preload="metadata"
						class="max-h-[420px] w-full modal-video bg-black object-contain"
					></video>
				</div>
			{:else if post.videoPath || post.videoName}
				<div
					class="flex aspect-[16/9] flex-col items-center justify-center rounded-[3px] border border-line bg-[radial-gradient(ellipse_at_center,var(--color-cover)_0%,var(--color-desk)_85%)] text-center text-book-bg"
				>
					<span
						class="flex size-14 items-center justify-center rounded-full bg-book-bg/95 text-book-ink shadow-lg"
					>
						<CommunityIcon name="play" size={24} />
					</span>
					<p class="mt-3 max-w-[82%] font-ui text-sm leading-tight font-semibold">
						{post.videoName || 'A shared video moment'}
					</p>
				</div>
			{:else if mood}
				<div
					class="flex aspect-[16/9] flex-col items-center justify-center rounded-[3px] border border-line"
					style="background: radial-gradient(circle at 50% 32%, {mood.c} 0%, var(--color-book-bg) 80%)"
				>
					<span
						class="size-28 drop-shadow-[0_6px_10px_rgba(0,0,0,.18)] [&>svg]:size-full"
						aria-hidden="true"
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static mood SVG from app data -->
						{@html mood.svg}
					</span>
					<span class="mt-3 font-hand text-2xl leading-none font-bold text-book-ink">
						feeling {mood.l.toLowerCase()}
					</span>
				</div>
			{/if}

			<!-- Title -->
			{#if post.title}
				<h2
					class="mt-5 font-hand text-[30px] leading-[1.1] font-bold [overflow-wrap:anywhere] text-book-ink"
				>
					{censor(post.title)}
				</h2>
			{/if}

			<!-- Body -->
			{#if post.mind}
				<div
					class="mt-4 rounded border border-line/70 bg-book-bg paper-lined [background-position:0_6px] px-4 py-3"
				>
					<p
						class="font-hand text-[19px] leading-[32px] [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink"
					>
						{censor(post.mind)}
					</p>
				</div>
			{/if}

			{#if post.refl}
				<div
					class="mt-3 flex items-start gap-2 rounded border border-line bg-paper-deep/80 px-3 py-2.5"
				>
					<span class="mt-0.5 text-sm font-bold text-book-accent" aria-hidden="true">
						<CommunityIcon name="star" size={14} />
					</span>
					<div class="min-w-0">
						<span class="block font-ui text-[10px] font-semibold text-book-accent">Reflection</span>
						<p
							class="mt-0.5 font-hand text-base leading-snug font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink"
						>
							{censor(post.refl)}
						</p>
					</div>
				</div>
			{/if}

			{#if stickers.length > 0}
				<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
					{#each stickers as sticker, i (i)}
						<span
							class="inline-block w-10 {sticker.flat
								? 'sticker-flat'
								: 'sticker-shadow'} [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
							style="transform: rotate({stickerTilt(sticker.rot, i)}deg)"
							aria-hidden="true"
						>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static sticker SVG from app data -->
							{@html sticker.svg}
						</span>
					{/each}
				</div>
			{/if}

			<!-- Reactions -->
			<div class="mt-5 border-t border-line/70 pt-4">
				<span class="mb-2 block font-ui text-[10px] font-semibold text-book-ink/70">
					Cheer this page
				</span>
				<div class="flex flex-wrap items-center gap-2">
					{#each REACTIONS as reaction (reaction.key)}
						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-xs font-bold transition-all active:scale-95 {post.userReactions.includes(
								reaction.key
							)
								? reaction.active
								: 'border-line bg-book-bg text-book-ink/70 hover:bg-paper-deep'}"
							onclick={() => community.toggleReaction(post, reaction.key)}
							aria-label={reaction.label}
							aria-pressed={post.userReactions.includes(reaction.key)}
						>
							<CommunityIcon name={reaction.icon} size={14} />
							<span class="tabular-nums">{post.reactions[reaction.key]}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Notes -->
			<div class="mt-5 rounded-xl border border-line bg-book-bg">
				<div class="p-3 min-[720px]:p-4">
					<span class="mb-3 block font-ui text-[11px] font-semibold text-book-ink/70">
						Community notes ({post.comments.length})
						<label
							class="ml-2 inline-flex items-center gap-1 font-ui text-[9px] font-normal text-book-ink/60"
						>
							Sort
							<select
								bind:value={commentSort}
								aria-label="Sort community notes"
								class="rounded-md border border-line bg-book-bg px-1.5 py-0.5 font-ui text-[9px] font-semibold text-book-ink focus:border-book-accent focus:outline-none"
							>
								<option value="newest">Newest</option>
								<option value="top">Top</option>
								<option value="week">This week</option>
								<option value="month">This month</option>
							</select>
						</label>
					</span>

					{#if post.comments.length > 0}
						<div class="mb-3 max-h-[320px] modal-scroll space-y-2 overflow-y-auto pr-1">
							{#each sortedComments() as comment (comment.id)}
								<div class="flex items-start gap-2 rounded-lg bg-paper-deep/80 p-2.5">
									<button
										type="button"
										class="shrink-0 rounded-full"
										onclick={() => onProfile(comment.authorId)}
										aria-label="View {comment.authorName}'s profile"
									>
										<Avatar
											src={comment.authorAvatar}
											name={comment.authorName}
											className="size-7"
											textClass="text-xs"
											ring=""
										/>
									</button>
									<div class="min-w-0 flex-1">
										<div class="flex items-baseline justify-between gap-2">
											<div class="flex min-w-0 items-baseline gap-1.5">
												<button
													type="button"
													class="truncate font-ui text-[11px] font-semibold text-book-ink hover:underline"
													onclick={() => onProfile(comment.authorId)}
												>
													{comment.authorName}
												</button>
												{#if comment.authorId === auth.ownerId}
													<span
														class="rounded-full bg-book-accent/15 px-1.5 py-0.5 font-ui text-[8px] font-bold text-book-accent"
														>You</span
													>
												{/if}
											</div>
											<time class="shrink-0 font-ui text-[9px] text-book-ink/70"
												>{comment.time}</time
											>
										</div>

										{#if editingCommentId === comment.id}
											<div class="mt-1">
												<textarea
													bind:value={editCommentText}
													rows="2"
													maxlength={COMMENT_MAX}
													aria-label="Edit your note"
													class="w-full resize-none rounded-lg border border-line bg-book-bg px-2 py-1.5 font-ui text-[11px] text-book-ink focus:border-book-accent focus:outline-none"
												></textarea>
												<div class="mt-1 flex items-center justify-between gap-2">
													<span class="font-ui text-[9px] text-book-ink/60 tabular-nums">
														{editCommentText.length}/{COMMENT_MAX}
													</span>
													<div class="flex items-center gap-2">
														<button
															type="button"
															class="rounded-md bg-book-accent px-2 py-0.5 font-ui text-[9px] font-bold text-book-bg hover:opacity-90 disabled:opacity-50"
															onclick={() => saveEditComment(comment.id)}
															disabled={!editCommentText.trim()}
														>
															Save
														</button>
														<button
															type="button"
															class="rounded-md border border-line px-2 py-0.5 font-ui text-[9px] font-semibold text-book-ink/70 hover:bg-paper-deep"
															onclick={cancelEditComment}
														>
															Cancel
														</button>
													</div>
												</div>
											</div>
										{/if}

										<p
											class="mt-0.5 font-hand text-base leading-tight [overflow-wrap:anywhere] whitespace-pre-wrap text-book-ink {editingCommentId ===
											comment.id
												? 'hidden'
												: ''}"
										>
											{censor(comment.text)}
										</p>

										<div class="mt-2 flex flex-wrap items-center gap-1">
											{#each REACTIONS as reaction (reaction.key)}
												<button
													type="button"
													class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-ui text-[10px] font-bold transition-colors {(
														comment.userReactions ?? []
													).includes(reaction.key)
														? reaction.active
														: 'border-line bg-book-bg text-book-ink/60 hover:bg-paper-deep'}"
													onclick={() =>
														community.toggleCommentReaction(post, comment, reaction.key)}
													aria-label={reaction.label}
													aria-pressed={(comment.userReactions ?? []).includes(reaction.key)}
												>
													<CommunityIcon name={reaction.icon} size={11} />
													<span class="tabular-nums">{comment.reactions?.[reaction.key] ?? 0}</span>
												</button>
											{/each}
										</div>

										{#if !comment.id.startsWith('local-')}
											<div class="mt-1 {editingCommentId === comment.id ? 'hidden' : ''}">
												{#if comment.authorId === auth.ownerId || canModerate}
													{#if commentConfirmId === comment.id}
														<div class="flex flex-wrap items-center gap-2">
															<span class="font-ui text-[9px] font-semibold text-[#9A5B5B]"
																>Delete this note?</span
															>
															<button
																type="button"
																class="rounded-md bg-[#9A5B5B] px-2 py-0.5 font-ui text-[9px] font-bold text-white hover:bg-[#7E4747]"
																onclick={() =>
																	deleteComment(comment.id, comment.authorId === auth.ownerId)}
															>
																Yes, delete
															</button>
															<button
																type="button"
																class="rounded-md border border-line px-2 py-0.5 font-ui text-[9px] font-semibold text-book-ink/70 hover:bg-paper-deep"
																onclick={() => (commentConfirmId = null)}
															>
																Cancel
															</button>
														</div>
													{:else}
														{#if comment.authorId === auth.ownerId}
															<button
																type="button"
																class="font-ui text-[9px] text-book-ink/70 hover:text-book-accent"
																onclick={() => startEditComment(comment.id, comment.text)}
															>
																Edit
															</button>
														{/if}
														<button
															type="button"
															class="ml-3 font-ui text-[9px] text-book-ink/70 hover:text-red-600"
															onclick={() => (commentConfirmId = comment.id)}
														>
															{canModerate && comment.authorId !== auth.ownerId
																? 'Remove (mod)'
																: 'Delete'}
														</button>
													{/if}
												{:else}
													<button
														type="button"
														class="font-ui text-[9px] text-book-ink/70 hover:text-book-accent"
														onclick={() => reportComment(comment.id)}
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
							No notes yet. Be the first to cheer them on.
						</p>
					{/if}

					<form class="flex items-center gap-2" onsubmit={submitComment}>
						<input
							bind:value={commentText}
							type="text"
							aria-label="Leave a note on this page"
							placeholder="Cheer them on…"
							maxlength={COMMENT_MAX}
							class="h-10 min-w-0 flex-1 rounded-lg border border-line bg-book-bg px-3 font-ui text-xs text-book-ink placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
						/>
						<span
							class="shrink-0 font-ui text-[9px] text-book-ink/60 tabular-nums"
							aria-hidden="true"
						>
							{commentText.length}/{COMMENT_MAX}
						</span>
						<button
							type="submit"
							class="h-10 rounded-lg bg-cta px-4 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover disabled:opacity-50"
							disabled={!commentText.trim()}
						>
							Send
						</button>
					</form>
				</div>
			</div>

			{#if canRemove}
				<div class="mt-5 flex justify-center border-t border-line/60 pt-4">
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full border border-[#D19A9A] bg-book-bg px-3.5 py-1.5 font-ui text-[11px] font-bold text-[#9A5B5B] transition-colors hover:bg-[#FBEAEA]"
						onclick={() => onRemove(post)}
					>
						<CommunityIcon name="user-minus" size={13} />
						{canModerate && !post.isOwner && post.authorId !== auth.ownerId
							? 'Remove as moderator'
							: 'Remove from community'}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<PromptModal
	open={commentReportId !== null}
	title="Report this note"
	message="Tell our moderators what is wrong with this note."
	hint="Only moderators can see your reason."
	placeholder="Unkind, unsafe, or off-topic…"
	confirmLabel="Send report"
	icon="shield"
	maxLength={240}
	onConfirm={(reason) => void sendReport(reason)}
	onCancel={() => (commentReportId = null)}
/>
