<script lang="ts">
	import { messages } from '#lib/state/messages.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();

	let title = $state('');
	let selected = $state<string[]>([]);
	let localError = $state('');

	const total = $derived(selected.length + 1);

	$effect(() => {
		if (open) {
			title = '';
			selected = [];
			localError = '';
		}
	});

	function toggle(friendId: string) {
		localError = '';
		if (selected.includes(friendId)) {
			selected = selected.filter((id) => id !== friendId);
			return;
		}
		if (selected.length >= 11) {
			localError = 'Groups can have at most 12 people.';
			return;
		}
		selected = [...selected, friendId];
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		localError = '';

		if (!title.trim()) {
			localError = 'Give your group a name.';
			return;
		}
		if (selected.length === 0) {
			localError = 'Choose at least one friend.';
			return;
		}

		const ok = await messages.createGroup(title, selected);
		if (ok) {
			onClose();
		} else {
			localError = messages.error || 'Could not create the group.';
		}
	}

	function handleKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="new-group-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close new group dialog"
		></button>

		<form
			class="relative z-10 flex max-h-[85vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
			onsubmit={create}
		>
			<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
				<div>
					<h2 id="new-group-title" class="font-display text-xl font-bold">New group chat</h2>
					<p class="font-ui text-[11px] text-book-ink/60">
						{total}
						{total === 1 ? 'person' : 'people'} · up to 12
					</p>
				</div>
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="modal-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
				<label for="group-title" class="block font-ui text-xs font-semibold text-book-ink/70">
					Group name
				</label>
				<input
					id="group-title"
					bind:value={title}
					type="text"
					maxlength="60"
					placeholder="e.g. Art club sketches"
					class="mt-1.5 h-11 w-full rounded-xl border-2 border-line bg-book-bg px-3.5 font-ui text-sm text-book-ink placeholder:text-book-ink/45 focus:border-book-accent focus:outline-none"
				/>

				<p class="mt-5 font-ui text-xs font-semibold text-book-ink/70">
					Invite friends
					{#if selected.length > 0}
						<span class="font-normal text-book-ink/55">· {selected.length} selected</span>
					{/if}
				</p>

				{#if friends.friends.length === 0}
					<p
						class="mt-2 rounded-xl border border-line bg-book-bg px-3 py-3 font-hand text-base leading-snug text-book-ink/70"
					>
						Add a friend first. Groups are made from your friends.
					</p>
				{:else}
					<ul class="mt-2 space-y-1">
						{#each friends.friends as friend (friend.id)}
							{@const checked = selected.includes(friend.id)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors {checked
										? 'bg-book-accent/15'
										: 'hover:bg-paper-deep'}"
									onclick={() => toggle(friend.id)}
									aria-pressed={checked}
								>
									<Avatar
										src={friend.avatarUrl}
										name={friend.displayName}
										className="size-9"
										textClass="text-sm"
										ring="ring-2 ring-gold/40"
									/>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-ui text-sm font-semibold">
											{friend.displayName}
										</span>
										<span class="block truncate font-ui text-[11px] text-book-ink/60">
											@{friend.username}
										</span>
									</span>
									<span
										class="flex size-6 shrink-0 items-center justify-center rounded-full border {checked
											? 'border-cta bg-cta text-cta-text'
											: 'border-line bg-book-bg text-transparent'}"
										aria-hidden="true"
									>
										<CommunityIcon name="check" size={13} />
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if localError}
					<p
						class="mt-4 rounded-xl border border-[#E3B9B9] bg-[#FBEAEA] px-3 py-2 font-ui text-xs font-semibold text-[#8A2F2F]"
					>
						{localError}
					</p>
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
				<button
					type="button"
					class="min-h-10 rounded-xl border border-line px-4 font-ui text-sm font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep"
					onclick={onClose}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cta px-4 font-ui text-sm font-bold text-cta-text transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
					disabled={messages.creatingGroup || !title.trim() || selected.length === 0}
				>
					<CommunityIcon name="users" size={15} />
					{messages.creatingGroup ? 'Creating…' : 'Create group'}
				</button>
			</div>
		</form>
	</div>
{/if}
