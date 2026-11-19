<script lang="ts">
	import PrivacyPicker from '#lib/components/PrivacyPicker.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
	import { PROMPTS } from '#lib/data/prompts';
	import { journal, TITLE_MAX } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import WritingModal from '#lib/components/WritingModal.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { Entry } from '#lib/types';

	let {
		entry,
		pageNumber,
		preview = false,
		enter = false
	}: {
		entry: Entry;
		pageNumber: number;
		preview?: boolean;
		enter?: boolean;
	} = $props();

	const id = $props.id();
	let mindEl = $state<HTMLTextAreaElement | null>(null);
	let prompt = $state('');
	let promptIndex = 0;
	let previousDate: string | undefined;
	let saving = $state(false);
	let editor = $state<'mind' | 'refl' | null>(null);

	const sharingWithFriends = $derived(
		entry.privacy === 'friends' || (entry.privacy === 'community' && entry.shareWithFriends)
	);
	const sharingWithCommunity = $derived(entry.privacy === 'community');
	const selectedCommunity = $derived(
		community.joinedCommunities.find((item) => item.slug === entry.communitySlug) ?? null
	);

	$effect(() => {
		// A fresh page starts with the prompt line tucked away.
		if (previousDate !== undefined && previousDate !== entry.date) {
			prompt = '';
		}
		previousDate = entry.date;
	});

	$effect(() => {
		// Preview is read-only, so never leave an editable full screen page open.
		if (preview) editor = null;
	});

	function update(patch: Partial<Entry>) {
		if (!preview) journal.updateCurrent(patch);
	}

	function needPrompt() {
		if (preview) return;
		prompt = PROMPTS[promptIndex++ % PROMPTS.length];
		requestAnimationFrame(() => mindEl?.focus());
	}

	function selectPrivate() {
		if (!preview) journal.setPrivate();
	}

	function toggleFriendsSharing(enabled: boolean) {
		if (!preview) journal.setFriendsSharing(enabled);
	}

	function toggleCommunitySharing(enabled: boolean) {
		if (preview) return;

		journal.setCommunitySharing(enabled);

		// Pick a sensible default so the page is never posted to an empty slug.
		if (enabled && !entry.communitySlug && community.joinedCommunities.length > 0) {
			journal.setCommunity(community.joinedCommunities[0].slug);
		}
	}

	function isExcluded(friendId: string) {
		return entry.excludedFriendIds.includes(friendId);
	}

	async function toggleFriend(friendId: string) {
		if (preview) return;
		const excluded = [...entry.excludedFriendIds];
		const at = excluded.indexOf(friendId);
		if (at >= 0) excluded.splice(at, 1);
		else excluded.push(friendId);

		// Private pages are owner-only in RLS, so included/excluded lists only
		// control the friends/community audience shown here.
		journal.updateCurrent({ excludedFriendIds: excluded, includedFriendIds: [] });
		await journal.flush();
	}

	async function save() {
		if (preview || saving) return;
		saving = true;
		try {
			journal.markSaved();
			await journal.flush();
		} finally {
			saving = false;
		}
	}
</script>

<section
	class="page right z-[1] flex flex-col gap-2.5 font-hand {viewport.single
		? 'relative min-h-[680px] w-full rounded-[14px] px-4 pt-6 pb-12 min-[480px]:px-6 min-[640px]:px-8'
		: 'absolute h-[700px] w-[560px] overflow-y-auto overscroll-contain rounded-l-[3px] rounded-r-[14px] px-10 pt-[34px] pb-11'}"
	style:background-color="var(--color-book-bg)"
	style:color="var(--color-book-ink)"
	class:left-[580px]={!viewport.single && !preview}
	class:left-0={preview}
	class:top-5={!preview && !viewport.single}
	class:top-0={preview}
	class:shadow-[3px_2px_0_-1px_var(--color-book-edge),6px_4px_0_-2px_var(--color-book-shadow)]={!preview &&
		!viewport.single}
	class:shadow-none={preview || viewport.single}
	class:right-page={!preview && !viewport.single}
	class:enter
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-label="Right page: writing"
>
	<label class="sr-only" for={`${id}-title`}>Title</label>
	<input
		id={`${id}-title`}
		class="h-12 w-full shrink-0 border-0 border-b-2 border-line bg-transparent px-1 pb-1 font-hand text-[1.625rem] font-bold text-ink placeholder:text-ink-muted focus:border-line focus:ring-0 focus:outline-offset-4 min-[900px]:h-[54px] min-[900px]:text-[2rem]"
		type="text"
		maxlength={TITLE_MAX}
		placeholder="Title (optional): just a random day…"
		autocomplete="off"
		value={entry.title}
		readonly={preview}
		tabindex={preview ? -1 : 0}
		oninput={(event) => update({ title: event.currentTarget.value })}
	/>

	<div class="mt-1.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
		<label
			class="m-0 flex min-w-0 items-center gap-2 font-display text-[1.1875rem] font-bold text-ink min-[900px]:text-[1.375rem]"
			for={`${id}-mind`}
		>
			What's on your mind?
		</label>
		<div class="flex min-w-0 flex-none items-center gap-1.5">
			{#if !preview}
				<button
					type="button"
					class="flex size-10 flex-none items-center justify-center rounded-lg border border-line bg-light text-accent transition-colors hover:bg-paper-deep"
					aria-label="Write What's on your mind? in full screen"
					title="Full screen writing"
					onclick={() => (editor = 'mind')}
				>
					<CommunityIcon name="expand" size={16} />
				</button>
				{#if prompt}
					<div
						class="flex min-h-10 max-w-[min(320px,52vw)] min-w-0 items-center gap-1.5 rounded-full border border-gold/60 bg-paper-deep px-2.5 py-1 font-hand text-[13px] leading-tight text-ink"
						role="status"
						title={prompt}
					>
						<span class="line-clamp-2 min-w-0">{prompt}</span>
						<button
							type="button"
							class="flex size-6 flex-none items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-line/50 hover:text-ink"
							aria-label="Another prompt"
							title="Another prompt"
							onclick={needPrompt}
						>
							<CommunityIcon name="refresh" size={13} />
						</button>
						<button
							type="button"
							class="flex size-6 flex-none items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-line/50 hover:text-ink"
							aria-label="Dismiss prompt"
							onclick={() => (prompt = '')}
						>
							<CommunityIcon name="x" size={13} />
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-light px-3.5 font-ui text-xs font-semibold text-accent transition-colors hover:bg-paper-deep"
						onclick={needPrompt}
					>
						Need a prompt?
					</button>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Each writing area scrolls on its own so the sharing + save row always
	     stays on the same line as the journal, no matter how much is written. -->
	<div class="relative mt-3 h-[132px] shrink-0 min-[640px]:h-[148px]">
		<textarea
			bind:this={mindEl}
			id={`${id}-mind`}
			class="block h-full w-full resize-none overflow-y-auto overscroll-contain border-0 bg-transparent px-1 pr-3.5 pb-6 font-hand text-[1.375rem] leading-[2rem] text-ink placeholder:text-ink-muted focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="500"
			placeholder="Talk about anything: your thoughts, feelings, experiences, or just what's happening in your day."
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.mind}
			oninput={(event) => update({ mind: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-3.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft tabular-nums"
		>
			{entry.mind.length}/500
		</span>
	</div>

	<div class="flex shrink-0 items-center justify-between gap-3">
		<label
			class="m-0 flex items-center gap-2 font-display text-[1.1875rem] font-bold text-ink min-[900px]:text-[1.375rem]"
			for={`${id}-refl`}
		>
			Reflection
			<small class="font-hand text-base font-normal text-ink-soft">(optional)</small>
		</label>
		{#if !preview}
			<button
				type="button"
				class="flex size-10 flex-none items-center justify-center rounded-lg border border-line bg-light text-accent transition-colors hover:bg-paper-deep"
				aria-label="Write Reflection in full screen"
				title="Full screen writing"
				onclick={() => (editor = 'refl')}
			>
				<CommunityIcon name="expand" size={16} />
			</button>
		{/if}
	</div>

	<div class="relative mt-0.5 h-[92px] shrink-0">
		<textarea
			id={`${id}-refl`}
			class="block h-full w-full resize-none overflow-y-auto overscroll-contain border-0 bg-transparent px-1 pr-3.5 pb-6 font-hand text-[1.375rem] leading-[2rem] text-ink placeholder:text-ink-muted focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="300"
			placeholder="Any thoughts, lessons, or things you want to remember?"
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.refl}
			oninput={(event) => update({ refl: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-3.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft tabular-nums"
		>
			{entry.refl.length}/300
		</span>
	</div>

	<div class="shrink-0">
		<PrivacyPicker
			friendsShared={sharingWithFriends}
			communityShared={sharingWithCommunity}
			communityLabel={selectedCommunity?.tag ?? ''}
			readonly={preview}
			onToggleFriends={toggleFriendsSharing}
			onToggleCommunity={toggleCommunitySharing}
			onSelectPrivate={selectPrivate}
		/>
	</div>

	{#if sharingWithFriends && !preview && friends.friends.length > 0}
		<div
			class="mt-2 flex shrink-0 flex-wrap items-center gap-1.5"
			role="group"
			aria-label="Friend visibility"
		>
			<span class="font-ui text-xs font-semibold text-ink-soft">Visible to friends</span>
			<span class="sr-only"
				>Tap a friend to hide this page from them, or tap again to let them see it.</span
			>
			{#each friends.friends as friend (friend.id)}
				<button
					type="button"
					class="rounded-full border px-2.5 py-0.5 font-ui text-xs font-semibold transition-all {isExcluded(
						friend.id
					)
						? 'border-red-500 bg-red-500/10 text-red-700'
						: 'border-line bg-paper/70 text-ink-soft hover:bg-light'}"
					onclick={() => toggleFriend(friend.id)}
					title={isExcluded(friend.id) ? 'Hidden from this friend' : 'This friend can see it'}
				>
					{friend.displayName.split(' ')[0]}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Save stays on the same row as the journal. The community picker is
	     hidden for now; when community sharing is on, the button compacts. -->
	<div
		class="sticky z-[2] mt-1.5 flex shrink-0 items-center justify-between gap-2 border-t border-line/70 bg-[var(--color-book-bg)] pt-2 pb-1 {viewport.single
			? 'bottom-[76px]'
			: 'bottom-0'}"
	>
		<span class="font-ui text-xs font-semibold text-ink-muted tabular-nums">
			{pageNumber}
		</span>

		<Button
			size={sharingWithCommunity && !preview ? 'sm' : 'md'}
			class={sharingWithCommunity && !preview ? 'h-9 shrink-0 px-3' : 'h-10 shrink-0 px-4'}
			icon="check"
			loading={saving}
			disabled={preview}
			onclick={save}
		>
			{saving ? 'Saving…' : sharingWithCommunity && !preview ? 'Save' : 'Save this page'}
		</Button>
	</div>

	<StickerLayer {entry} side="R" {preview} />
</section>

{#if !preview}
	<WritingModal
		open={editor !== null}
		title={editor === 'refl' ? 'Reflection' : "What's on your mind?"}
		value={editor === 'refl' ? entry.refl : entry.mind}
		maxlength={editor === 'refl' ? 300 : 500}
		placeholder={editor === 'refl'
			? 'Any thoughts, lessons, or things you want to remember?'
			: "Talk about anything: your thoughts, feelings, experiences, or just what's happening in your day."}
		paper={journal.paper}
		onClose={() => (editor = null)}
		onInput={(value) => update(editor === 'refl' ? { refl: value } : { mind: value })}
	/>
{/if}

<style>
	.right-page::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		background: linear-gradient(to right, rgb(70 45 20 / 0.26), rgb(70 45 20 / 0) 52px);
	}

	.enter {
		animation: enter 0.28s ease-out;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateX(24px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
