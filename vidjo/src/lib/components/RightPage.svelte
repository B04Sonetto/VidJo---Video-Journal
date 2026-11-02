<script lang="ts">
	import PrivacyPicker from '#lib/components/PrivacyPicker.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
	import { PROMPTS } from '#lib/data/prompts';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav } from '#lib/state/navigation.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { Entry, Privacy } from '#lib/types';

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

	$effect(() => {
		// A fresh page starts with the prompt line tucked away.
		if (previousDate !== undefined && previousDate !== entry.date) {
			prompt = '';
		}
		previousDate = entry.date;
	});

	function update(patch: Partial<Entry>) {
		if (!preview) journal.updateCurrent(patch);
	}

	function needPrompt() {
		if (preview) return;
		prompt = PROMPTS[promptIndex++ % PROMPTS.length];
		requestAnimationFrame(() => mindEl?.focus());
	}

	function selectPrivacy(privacy: Privacy) {
		if (!preview) journal.setPrivacy(privacy);
	}

	function isExcluded(friendId: string) {
		return entry.excludedFriendIds.includes(friendId);
	}

	function isIncluded(friendId: string) {
		return entry.includedFriendIds.includes(friendId);
	}

	function toggleFriend(friendId: string) {
		if (preview) return;
		const excluded = [...entry.excludedFriendIds];
		const included = [...entry.includedFriendIds];
		if (isExcluded(friendId)) {
			excluded.splice(excluded.indexOf(friendId), 1);
			included.push(friendId);
		} else if (isIncluded(friendId)) {
			included.splice(included.indexOf(friendId), 1);
		} else {
			excluded.push(friendId);
		}
		journal.updateCurrent({ excludedFriendIds: excluded, includedFriendIds: included });
	}
</script>

<section
	class="page right absolute top-5 z-[1] flex h-[700px] w-[560px] flex-col gap-2.5 bg-paper px-10 pt-[34px] pb-11 font-hand text-ink"
	class:left-5={viewport.single && !preview}
	class:left-[580px]={!viewport.single && !preview}
	class:left-0={preview}
	class:top-0={preview}
	class:rounded-[14px]={viewport.single}
	class:rounded-r-[14px]={!viewport.single}
	class:rounded-l-[3px]={!viewport.single}
	class:shadow-[3px_2px_0_-1px_var(--color-paper-edge),6px_4px_0_-2px_#DCCFAF]={!preview}
	class:shadow-none={preview}
	class:right-page={!preview && !viewport.single}
	class:enter
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-label="Right page: writing"
>
	<label class="sr-only" for={`${id}-title`}>Title</label>
	<input
		id={`${id}-title`}
		class="h-[54px] w-full border-0 border-b-2 border-line bg-transparent px-1 pb-1 font-hand text-[32px] font-bold text-ink placeholder:text-[#8E7FAA] focus:border-line focus:ring-0 focus:outline-offset-4"
		type="text"
		maxlength="80"
		placeholder="Title (optional): just a random dayâ€¦"
		autocomplete="off"
		value={entry.title}
		readonly={preview}
		tabindex={preview ? -1 : 0}
		oninput={(event) => update({ title: event.currentTarget.value })}
	/>

	<div class="mt-1.5 flex items-center justify-between gap-3">
		<label
			class="m-0 flex items-center gap-2 font-display text-[22px] font-bold text-ink"
			for={`${id}-mind`}
		>
			What's on your mind?
		</label>
		<button
			type="button"
			class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#CDBBE9] bg-light px-3.5 font-hand text-base font-bold text-accent shadow-sm transition-colors hover:bg-[#E8DCF8]"
			disabled={preview}
			onclick={needPrompt}
		>
			âœ¦ Need a prompt?
		</button>
	</div>

	{#if prompt}
		<div
			class="mt-2 rounded-xl border-2 border-[#D4A24C] bg-[#FFF3D6] px-3 py-2 font-hand text-lg text-accent shadow-sm"
		>
			{prompt}
		</div>
	{/if}

	<div class="relative mt-3 flex min-h-0 flex-1">
		<textarea
			bind:this={mindEl}
			id={`${id}-mind`}
			class="block h-full w-full resize-none border-0 bg-transparent px-1 font-hand text-[22px] leading-[32px] text-ink placeholder:text-[#8E7FAA] focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="500"
			placeholder="Talk about anything: your thoughts, feelings, experiences, or just what's happening in your day."
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.mind}
			oninput={(event) => update({ mind: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-1.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft"
		>
			{entry.mind.length}/500
		</span>
	</div>

	<label
		class="m-0 flex items-center gap-2 font-display text-[22px] font-bold text-ink"
		for={`${id}-refl`}
	>
		Reflection
		<small class="font-hand text-base font-normal text-ink-soft">(optional)</small>
	</label>

	<div class="relative">
		<textarea
			id={`${id}-refl`}
			class="block h-24 w-full resize-none border-0 bg-transparent px-1 font-hand text-[22px] leading-[32px] text-ink placeholder:text-[#8E7FAA] focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="300"
			placeholder="Any thoughts, lessons, or things you want to remember?"
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.refl}
			oninput={(event) => update({ refl: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-1.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft"
		>
			{entry.refl.length}/300
		</span>
	</div>

	<PrivacyPicker value={entry.privacy} readonly={preview} onSelect={selectPrivacy} />



	{#if (entry.privacy === 'private' || entry.privacy === 'friends') && !preview && friends.friends.length > 0}
		<span class="mt-2 block font-ui text-xs font-bold tracking-wider text-ink-soft uppercase">
			<svg
				class="size-4 shrink-0 text-accent"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><circle cx="12" cy="12" r="10"></circle><path
					d="M9.09 9a3 3 0 00-4.1 4.1l-2.4 2.4a3 3 0 004.1 4.1l2.4-2.4a3 3 0 004.1-4.1l-2.4-2.4a3 3 0 00-4.1-4.1z"
				></path></svg
			>
			Friend exceptions
		</span>
		<p class="mt-0.5 font-ui text-xs text-ink-soft">
			Tap a classmate to exclude them from this page, or tap again to grant an exception.
		</p>
		<div class="mt-1.5 flex flex-wrap gap-2">
			{#each friends.friends as friend (friend.id)}
				<button
					type="button"
					class="rounded-full border px-2.5 py-0.5 font-ui text-xs font-semibold transition-all {isExcluded(
						friend.id
					)
						? 'border-red-500 bg-red-500/20 text-red-400'
						: isIncluded(friend.id)
							? 'border-[#3F7A4F] bg-[#3F7A4F]/20 text-[#8BE2A4]'
							: 'border-white/20 text-white/70 hover:bg-white/10'}"
					onclick={() => toggleFriend(friend.id)}
					title={isExcluded(friend.id)
						? 'Excluded'
						: isIncluded(friend.id)
							? 'Exception (can see)'
							: 'Default'}
				>
					{friend.displayName.split(' ')[0]}
				</button>
			{/each}
		</div>
	{/if}

	{#if entry.privacy === 'community' && !preview}
		<div class="rounded-xl border-2 border-line bg-[#FFFDF6] p-3">
			{#if community.joinedCommunities.length === 0}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="font-hand text-base text-ink-soft">
						Join a community to choose where this page appears.
					</p>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-ui text-xs font-bold text-white hover:bg-[#624690]"
						onclick={() => nav.setView('community')}
					>
						<CommunityIcon name="globe" size={13} />
						Find communities
					</button>
				</div>
			{:else}
				<label
					class="flex items-center gap-2 font-ui text-xs font-bold tracking-wider text-ink-soft uppercase"
					for={`${id}-community`}
				>
					<CommunityIcon name="globe" size={14} />
					Post to community
				</label>
				<select
					id={`${id}-community`}
					class="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 font-ui text-sm text-ink focus:border-accent focus:outline-none"
					value={entry.communitySlug}
					onchange={(event) => journal.setCommunity(event.currentTarget.value)}
				>
					<option value="">Choose a communityâ€¦</option>
					{#each community.joinedCommunities as item (item.slug)}
						<option value={item.slug}>{item.tag} â€” {item.name}</option>
					{/each}
				</select>
			{/if}
		</div>
	{/if}

	<button
		type="button"
		class="mt-1.5 flex h-[54px] items-center justify-center gap-3.5 rounded-xl bg-accent font-display text-[21px] font-bold text-white shadow-[0_4px_14px_rgba(42,27,61,.3)] transition-all hover:bg-[#624690] hover:shadow-[0_6px_18px_rgba(42,27,61,.4)] active:scale-[0.99] disabled:opacity-60"
		disabled={preview}
		onclick={() => !preview && journal.markSaved()}
	>
		<span class="text-gold">âœ¦</span>
		Save VidJo
		<span class="text-gold">âœ¦</span>
	</button>

	<div class="absolute right-0 bottom-3.5 left-0 text-center font-hand text-base text-ink-soft">
		{pageNumber}
	</div>

	<StickerLayer {entry} side="R" {preview} />
</section>

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


