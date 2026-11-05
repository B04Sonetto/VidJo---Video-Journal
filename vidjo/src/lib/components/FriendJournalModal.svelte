<script lang="ts">
	import { friends } from '#lib/state/friends.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { STICKER_BY_KEY } from '#lib/data/stickers';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import ProfileModal from '#lib/components/ProfileModal.svelte';
	import { censor } from '#lib/censor';
	import type { Friend, FriendPost } from '#lib/types';

	let {
		open,
		friend,
		posts,
		onClose
	}: {
		open: boolean;
		friend: Friend | null;
		posts: FriendPost[];
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

	$effect(() => {
		if (open) {
			index = 0;
			noteInput = '';
			noteConfirmId = null;
			unfriendOpen = false;
		}
	});

	$effect(() => {
		if (index >= sorted.length) index = Math.max(0, sorted.length - 1);
		noteConfirmId = null;
	});

	function go(delta: number) {
		if (sorted.length === 0) return;
		index = (index + delta + sorted.length) % sorted.length;
	}

	function submitNote(event: SubmitEvent) {
		event.preventDefault();
		if (!page) return;
		const text = noteInput.trim();
		if (!text) return;
		void friends.addComment(page.id, text);
		noteInput = '';
	}

	function deleteNote(postId: string, commentId: string) {
		void friends.deleteComment(postId, commentId);
		noteConfirmId = null;
		journal.toast('Note deleted');
	}

	function openReport(postId: string, commentId: string) {
		reportTarget = { postId, commentId };
		reportReason = '';
		reportModalOpen = true;
	}

	function submitReport() {
		const reason = reportReason.trim();
		if (!reason || !reportTarget) return;
		const { postId, commentId } = reportTarget;
		reportModalOpen = false;
		reportReason = '';
		reportTarget = null;
		void friends.reportComment(postId, commentId, reason);
		journal.toast('Report sent to moderators. Thank you.');
	}

	async function confirmUnfriend() {
		if (!friend || unfriendBusy) return;
		unfriendBusy = true;
		await friends.removeFriend(friend.id);
		unfriendBusy = false;
		unfriendOpen = false;
		onClose();
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
</script>

<svelte:window onkeydown={handleKey} />

{#if open && friend}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm min-[720px]:p-5"
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
			class="relative z-10 flex max-h-[92vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[26px] border border-[#4E396E] bg-paper text-ink shadow-[0_30px_80px_rgba(0,0,0,.65)]"
		>
			<!-- Cover strip -->
			<div
				class="relative flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-[linear-gradient(135deg,#34214E,#231438)] px-5 py-4 text-white min-[720px]:px-6"
			>
				<span
					class="pointer-events-none absolute -top-10 right-20 size-32 rounded-full bg-gold/10 blur-3xl"
					aria-hidden="true"
				></span>
				<div class="relative flex min-w-0 items-center gap-3">
					<Avatar
						src={friend.avatarUrl}
						name={friend.displayName}
						className="size-12"
						textClass="text-xl"
						ring="ring-2 ring-gold/50"
					/>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="truncate font-display text-2xl font-bold text-white">
								{friend.displayName}'s notebook
							</h2>
							{#if friend.friendCode === friends.myFriendCode}
								<span
									class="rounded-full bg-gold/20 px-2 py-0.5 font-ui text-[10px] font-bold text-gold"
									>You</span
								>
							{/if}
						</div>
						<div
							class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-ui text-xs text-[#C9B8E8]"
						>
							<span>@{friend.username}</span>
							<span aria-hidden="true">•</span>
							<span
								>{sorted.length}
								{sorted.length === 1 ? 'shared page' : 'shared pages'}</span
							>
							{#if friend.friendCode}
								<span aria-hidden="true">•</span>
								<code class="font-mono text-[11px] text-gold">{friend.friendCode}</code>
							{/if}
						</div>
					</div>
				</div>

				<button
					type="button"
					class="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-[#D19A9A]/20 text-lg text-[#E7B9B9] transition-colors hover:bg-[#D19A9A]/40 hover:text-white"
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
					class="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={onClose}
					aria-label="Close notebook"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<!-- Mobile page picker -->
			{#if sorted.length > 1}
				<div
					class="flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-[#FFFDF6] px-4 py-2 min-[860px]:hidden"
				>
					{#each sorted as entry, i (entry.id)}
						<button
							type="button"
							class="shrink-0 rounded-full border px-3 py-1 font-ui text-[11px] font-bold transition-colors {i ===
							index
								? 'border-accent bg-accent text-white'
								: 'border-line bg-paper text-ink-soft hover:border-accent/50'}"
							onclick={() => (index = i)}
						>
							{entry.dateFormatted}
						</button>
					{/each}
				</div>
			{/if}

			<div class="grid min-h-0 flex-1 min-[860px]:grid-cols-[230px_minmax(0,1fr)]">
				<!-- Page index -->
				<aside
					class="hidden min-h-0 flex-col overflow-y-auto border-r border-line bg-[#F7F0DE] p-4 min-[860px]:flex"
				>
					<p class="mb-2 font-ui text-[10px] font-bold tracking-[.16em] text-ink-soft uppercase">
						Pages in this notebook
					</p>
					{#if sorted.length === 0}
						<p class="font-hand text-base text-ink-soft">No shared pages yet.</p>
					{:else}
						<div class="space-y-1.5">
							{#each sorted as entry, i (entry.id)}
								<button
									type="button"
									class="flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors {i ===
									index
										? 'border-accent/40 bg-accent/10'
										: 'border-transparent hover:border-line hover:bg-paper/70'}"
									onclick={() => (index = i)}
								>
									{#if entry.mood && MOOD_BY_KEY[entry.mood]}
										<span class="size-7 shrink-0 [&>svg]:size-full" aria-hidden="true">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
											{@html MOOD_BY_KEY[entry.mood].svg}
										</span>
									{:else}
										<span
											class="flex size-7 shrink-0 items-center justify-center rounded-full bg-lav/40 text-[10px] font-bold text-accent"
										>
											{entry.dateFormatted.slice(0, 3)}
										</span>
									{/if}
									<span class="min-w-0">
										<span class="block truncate font-hand text-lg leading-tight text-ink">
											{entry.title || 'Untitled page'}
										</span>
										<span class="block font-ui text-[10px] text-ink-soft"
											>{entry.dateFormatted}</span
										>
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</aside>

				<!-- Page body -->
				<div class="min-h-0 overflow-y-auto px-4 py-5 min-[720px]:px-7 min-[720px]:py-7">
					{#if page}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="font-ui text-[11px] font-bold tracking-[.16em] text-ink-soft uppercase"
								>
									{page.dateFormatted}
								</span>
								{#if page.mood && MOOD_BY_KEY[page.mood]}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-ui text-[11px] font-bold text-ink"
										style="background: {MOOD_BY_KEY[page.mood].c}70"
									>
										<span class="size-5 [&>svg]:size-full" aria-hidden="true">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
											{@html MOOD_BY_KEY[page.mood].svg}
										</span>
										{MOOD_BY_KEY[page.mood].l}
									</span>
								{/if}
							</div>
							<span
								class="inline-flex items-center gap-1.5 rounded-full bg-lav/25 px-2.5 py-1 font-ui text-[10px] font-bold text-accent"
							>
								<CommunityIcon name="users" size={11} />
								Shared with friends
							</span>
						</div>

						{#if page.title}
							<h3 class="mt-3 font-display text-3xl leading-tight font-bold text-ink">
								{page.title}
							</h3>
						{/if}

						{#if page.videoUrl}
							<div class="mt-4 overflow-hidden rounded-2xl border-2 border-line bg-[#120A20]">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={page.videoUrl}
									controls
									playsinline
									class="max-h-[380px] w-full bg-black object-contain"
								></video>
							</div>
						{:else if page.videoPath || page.videoName}
							<div
								class="relative mt-4 flex aspect-[16/10] flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-line bg-[radial-gradient(ellipse_at_center,#4A2F7A_0%,#190E2B_85%)] text-center text-white"
							>
								<span
									class="absolute top-3 left-4 flex items-center gap-1.5 font-mono text-[11px] text-red-300"
								>
									<span class="size-2 animate-pulse rounded-full bg-red-400"></span>
									REC
								</span>
								<span class="absolute top-3 right-4 font-mono text-[11px] text-gold">VIDJO</span>
								<span
									class="flex size-14 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-md"
								>
									<svg
										width="24"
										height="24"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M8 5v14l11-7z"></path>
									</svg>
								</span>
								<p class="mt-3 font-display text-lg font-bold">
									{page.videoName || 'A small video moment'}
								</p>
								<p class="font-hand text-sm text-[#D6CBEC]">Recorded with VidJo</p>
							</div>
						{/if}

						{#if page.mind}
							<div class="mt-4 rounded-xl border border-line bg-[#FFFDF6] paper-lined px-4 py-3">
								<p class="font-hand text-[22px] leading-[32px] whitespace-pre-wrap text-ink">
									{page.mind}
								</p>
							</div>
						{/if}

						{#if page.refl}
							<div
								class="mt-3 flex items-start gap-2.5 rounded-xl border border-line bg-light/70 p-3"
							>
								<span
									class="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10"
								>
									<CommunityIcon name="star" size={16} />
								</span>
								<div>
									<span
										class="block font-ui text-[10px] font-bold tracking-[.14em] text-accent uppercase"
										>Reflection</span
									>
									<p class="mt-0.5 font-hand text-lg leading-snug text-ink">{page.refl}</p>
								</div>
							</div>
						{/if}

						{#if stickersFor(page).length > 0}
							<div class="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
								{#each stickersFor(page) as sticker, i (i)}
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

						<!-- Reactions + notes -->
						<div class="mt-5 rounded-2xl border border-line bg-[#FFFDF6] p-3.5">
							<div class="flex flex-wrap items-center gap-1.5">
								{#each REACTIONS as reaction (reaction.key)}
									<button
										type="button"
										class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-ui text-[11px] font-bold transition-all active:scale-95 {page.userReactions.includes(
											reaction.key
										)
											? reaction.active
											: 'border-line bg-paper text-ink-soft hover:bg-light'}"
										onclick={() => friends.toggleReaction(page.id, reaction.key)}
										aria-label={reaction.label}
										aria-pressed={page.userReactions.includes(reaction.key)}
									>
										<CommunityIcon name={reaction.icon} size={13} />
										<span>{page.reactions[reaction.key]}</span>
									</button>
								{/each}
							</div>

							<div class="mt-3 border-t border-line/70 pt-3">
								<span
									class="mb-2 block font-ui text-[10px] font-bold tracking-[.14em] text-ink-soft uppercase"
								>
									Friend notes ({page.comments.length})
								</span>

								{#if page.comments.length > 0}
									<div class="mb-3 space-y-2">
										{#each page.comments as comment (comment.id)}
											<div class="flex items-start gap-2.5 rounded-lg bg-light/80 p-2.5">
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
																class="truncate font-ui text-xs font-semibold text-ink hover:underline"
																onclick={() => {
																	viewedUserId = comment.authorId;
																	profileModalOpen = true;
																}}
															>
																{comment.authorName}
															</button>
															{#if comment.authorId === auth.ownerId}
																<span
																	class="rounded-full bg-accent/15 px-1.5 py-0.5 font-ui text-[9px] font-bold text-accent"
																	>You</span
																>
															{/if}
														</div>
														<time class="shrink-0 font-ui text-[10px] text-ink-soft"
															>{comment.time}</time
														>
													</div>
													<p class="mt-0.5 font-hand text-base leading-tight break-words text-ink">
														{censor(comment.text)}
													</p>
													{#if !comment.id.startsWith('local-')}
														<div class="mt-1">
															{#if comment.authorId === auth.ownerId}
																{#if noteConfirmId === comment.id}
																	<div class="flex flex-wrap items-center gap-2">
																		<span class="font-ui text-[10px] font-semibold text-[#9A5B5B]"
																			>Delete this note?</span
																		>
																		<button
																			type="button"
																			class="rounded-md bg-[#9A5B5B] px-1.5 py-0.5 font-ui text-[10px] font-bold text-white hover:bg-[#7E4747]"
																			onclick={() => deleteNote(page.id, comment.id)}
																		>
																			Yes, delete
																		</button>
																		<button
																			type="button"
																			class="rounded-md border border-line px-1.5 py-0.5 font-ui text-[10px] font-semibold text-ink-soft hover:bg-light"
																			onclick={() => (noteConfirmId = null)}
																		>
																			Cancel
																		</button>
																	</div>
																{:else}
																	<button
																		type="button"
																		class="font-ui text-[10px] text-ink-soft hover:text-red-600"
																		onclick={() => (noteConfirmId = comment.id)}
																	>
																		Delete
																	</button>
																{/if}
															{:else}
															<button
																type="button"
																class="font-ui text-[10px] text-ink-soft hover:text-accent"
																onclick={() => openReport(page.id, comment.id)}
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
								{/if}

								<form class="flex items-center gap-2" onsubmit={submitNote}>
									<input
										bind:value={noteInput}
										type="text"
										placeholder="Leave {friend.displayName.split(' ')[0]} a kind note…"
										maxlength="140"
										class="h-9 flex-1 rounded-lg border border-line bg-paper px-3 font-ui text-xs text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
									/>
									<button
										type="submit"
										class="h-9 rounded-lg bg-accent px-3.5 font-ui text-xs font-bold text-white transition-colors hover:bg-[#624690] disabled:opacity-50"
										disabled={!noteInput.trim()}
									>
										Send
									</button>
								</form>
							</div>
						</div>
					{:else}
						<div class="flex h-full flex-col items-center justify-center py-16 text-center">
							<span class="text-4xl" aria-hidden="true">
								<CommunityIcon name="sparkles" size={32} />
							</span>
							<p class="mt-3 font-display text-2xl font-bold text-ink">No shared pages yet</p>
							<p class="mt-1 max-w-[320px] font-hand text-lg text-ink-soft">
								{friend.displayName} has not shared any pages with friends so far.
							</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Page navigation -->
			<div
				class="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-[#F7F0DE] px-4 py-3 min-[720px]:px-6"
			>
				<button
					type="button"
					class="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 font-ui text-xs font-semibold text-ink-soft transition-colors hover:border-accent/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => go(-1)}
					disabled={sorted.length <= 1}
				>
					← Previous
				</button>
				<span class="font-ui text-[11px] font-semibold text-ink-soft">
					{#if sorted.length > 0}
						Page {index + 1} of {sorted.length}
					{:else}
						Empty notebook
					{/if}
				</span>
				<button
					type="button"
					class="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 font-ui text-xs font-semibold text-ink-soft transition-colors hover:border-accent/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => go(1)}
					disabled={sorted.length <= 1}
				>
					Next →
				</button>
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
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
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
			class="relative z-10 w-full max-w-[420px] overflow-hidden rounded-[26px] border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,.6)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,#34214E,#231438)] px-5 py-4 text-white"
			>
				<h2 id="remove-friend-title" class="font-display text-xl font-bold">Remove friend?</h2>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={() => (unfriendOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-5">
				<div class="flex items-center gap-3 rounded-xl border border-line bg-[#FFFDF6] p-3">
					<Avatar
						src={friend.avatarUrl}
						name={friend.displayName}
						className="size-11"
						textClass="text-lg"
						ring=""
					/>
					<div class="min-w-0">
						<p class="truncate font-display text-lg leading-tight font-bold text-ink">
							{friend.displayName}
						</p>
						<p class="truncate font-ui text-xs text-ink-soft">@{friend.username}</p>
					</div>
				</div>

				<p class="mt-4 font-ui text-sm leading-relaxed text-ink-soft">
					You will stop seeing each other's shared pages. Their journal is not deleted, and you can
					add them again later with their friend code.
				</p>

				<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						class="min-h-10 rounded-xl border border-line px-4 font-ui text-sm font-semibold text-ink-soft transition-colors hover:bg-light hover:text-ink"
						onclick={() => (unfriendOpen = false)}
					>
						Keep friend
					</button>
					<button
						type="button"
						class="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#9A5B5B] px-4 font-ui text-sm font-bold text-white transition-colors hover:bg-[#7E4747] disabled:cursor-wait disabled:opacity-60"
						onclick={confirmUnfriend}
						disabled={unfriendBusy}
					>
						{#if unfriendBusy}
							<span
								class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								aria-hidden="true"
							></span>
							Removing…
						{:else}
							Remove friend
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Report reason modal -->
{#if reportModalOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label="Report note"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={() => (reportModalOpen = false)}
			aria-label="Close"
		></button>

		<div
			class="relative z-10 w-full max-w-[400px] overflow-hidden rounded-[26px] border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div
				class="relative flex items-center justify-between gap-3 bg-[linear-gradient(135deg,#34214E,#231438)] px-5 py-4 text-white"
			>
				<h2 class="font-display text-xl font-bold">Report note</h2>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={() => (reportModalOpen = false)}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="p-6">
				<p class="mb-4 font-ui text-sm text-ink-soft">
					Why are you reporting this note?
				</p>
				<textarea
					bind:value={reportReason}
					rows="4"
					class="w-full rounded-xl border border-line bg-[#FFFDF6] px-3.5 py-2.5 font-ui text-sm text-ink focus:border-accent focus:outline-none"
					placeholder="Describe why this note feels unsafe…"
				></textarea>
				<div class="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						class="min-h-10 rounded-xl border border-line px-4 font-ui text-sm font-semibold text-ink-soft transition-colors hover:bg-light"
						onclick={() => (reportModalOpen = false)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="min-h-10 rounded-xl border border-[#D19A9A] px-4 font-ui text-sm font-semibold text-[#9A5B5B] transition-colors hover:bg-[#FBEAEA]"
						onclick={submitReport}
					>
						Send report
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
