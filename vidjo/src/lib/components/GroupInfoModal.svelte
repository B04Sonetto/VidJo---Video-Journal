<script lang="ts">
	import { messages } from '#lib/state/messages.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import type { DmThreadSummary } from '#lib/types';

	let {
		open,
		thread,
		onClose
	}: { open: boolean; thread: DmThreadSummary | null; onClose: () => void } = $props();

	let renameOpen = $state(false);
	let renameValue = $state('');
	let addOpen = $state(false);
	let selected = $state<string[]>([]);
	let localError = $state('');
	// Reset the panel once per opening, not every time the member list reloads.
	let wasOpen = false;

	const members = $derived(thread ? (messages.membersByThread[thread.threadId] ?? []) : []);
	const me = $derived(members.find((member) => member.isMe) ?? null);
	const isOwner = $derived(me?.role === 'owner');
	const available = $derived(
		friends.friends.filter((friend) => !members.some((member) => member.userId === friend.id))
	);

	$effect(() => {
		if (!open || !thread) {
			wasOpen = false;
			return;
		}
		if (wasOpen) return;
		wasOpen = true;

		renameOpen = false;
		addOpen = false;
		selected = [];
		localError = '';
		renameValue = thread.title ?? '';
		if (!messages.membersByThread[thread.threadId]) {
			void messages.loadMembers(thread.threadId);
		}
	});

	function toggle(friendId: string) {
		if (selected.includes(friendId)) {
			selected = selected.filter((id) => id !== friendId);
			return;
		}
		if (members.length + selected.length >= 12) {
			localError = 'Groups can have at most 12 people.';
			return;
		}
		selected = [...selected, friendId];
	}

	async function rename() {
		if (!thread) return;
		localError = '';
		const ok = await messages.renameGroup(thread.threadId, renameValue);
		if (ok) {
			renameOpen = false;
		} else {
			localError = messages.error || 'Could not rename the group.';
		}
	}

	async function addSelected() {
		if (!thread || selected.length === 0) return;
		localError = '';
		const ok = await messages.addMembers(thread.threadId, selected);
		if (ok) {
			addOpen = false;
			selected = [];
		} else {
			localError = messages.error || 'Could not add those friends.';
		}
	}

	async function remove(userId: string) {
		if (!thread) return;
		localError = '';
		const ok = await messages.removeMember(thread.threadId, userId);
		if (!ok) localError = messages.error || 'Could not remove that person.';
	}

	async function leave() {
		if (!thread) return;
		localError = '';
		const ok = await messages.leaveGroup(thread.threadId);
		if (ok) onClose();
		else localError = messages.error || 'Could not leave the group.';
	}

	function handleKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if open && thread}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="group-info-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close group info dialog"
		></button>

		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-[440px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
				<div class="min-w-0">
					<h2 id="group-info-title" class="truncate font-display text-xl font-bold">
						{thread.title || 'Group chat'}
					</h2>
					<p class="font-ui text-[11px] text-book-ink/60">
						{members.length}
						{members.length === 1 ? 'member' : 'members'}
					</p>
				</div>
				<button
					type="button"
					class="flex size-9 shrink-0 items-center justify-center rounded-full bg-book-bg text-book-ink/70 transition-colors hover:bg-paper-deep hover:text-book-ink"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<div class="min-h-0 flex-1 modal-scroll overflow-y-auto px-5 py-4">
				{#if isOwner}
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="min-h-9 rounded-lg border border-line bg-book-bg px-3 font-ui text-xs font-bold text-book-ink/80 transition-colors hover:bg-paper-deep"
							onclick={() => {
								renameOpen = !renameOpen;
								renameValue = thread.title ?? '';
								localError = '';
							}}
						>
							Rename group
						</button>
						<button
							type="button"
							class="min-h-9 rounded-lg bg-cta px-3 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover"
							onclick={() => {
								addOpen = !addOpen;
								selected = [];
								localError = '';
							}}
						>
							Add people
						</button>
					</div>

					{#if renameOpen}
						<form
							class="mt-3 flex gap-2"
							onsubmit={(event) => {
								event.preventDefault();
								void rename();
							}}
						>
							<label class="sr-only" for="group-rename">Group name</label>
							<input
								id="group-rename"
								bind:value={renameValue}
								maxlength="60"
								class="h-10 min-w-0 flex-1 rounded-xl border border-line bg-book-bg px-3 font-ui text-sm text-book-ink focus:border-book-accent focus:outline-none"
							/>
							<button
								type="submit"
								class="min-h-10 rounded-xl bg-cta px-3 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover"
							>
								Save
							</button>
						</form>
					{/if}

					{#if addOpen}
						<div class="mt-3 rounded-xl border border-line bg-book-bg p-2">
							{#if available.length === 0}
								<p class="px-2 py-2 font-hand text-base text-book-ink/70">
									All of your friends are already here.
								</p>
							{:else}
								<ul class="max-h-[190px] modal-scroll space-y-1 overflow-y-auto">
									{#each available as friend (friend.id)}
										{@const checked = selected.includes(friend.id)}
										<li>
											<button
												type="button"
												class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors {checked
													? 'bg-book-accent/15'
													: 'hover:bg-paper-deep'}"
												onclick={() => toggle(friend.id)}
												aria-pressed={checked}
											>
												<Avatar
													src={friend.avatarUrl}
													name={friend.displayName}
													className="size-8"
													textClass="text-xs"
													ring="ring-1 ring-line/60"
												/>
												<span class="min-w-0 flex-1 truncate font-ui text-xs font-semibold">
													{friend.displayName}
												</span>
												<span
													class="flex size-5 shrink-0 items-center justify-center rounded-full border {checked
														? 'border-cta bg-cta text-cta-text'
														: 'border-line text-transparent'}"
													aria-hidden="true"
												>
													<CommunityIcon name="check" size={11} />
												</span>
											</button>
										</li>
									{/each}
								</ul>
								<button
									type="button"
									class="mt-2 min-h-9 w-full rounded-lg bg-cta px-3 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
									onclick={() => void addSelected()}
									disabled={selected.length === 0}
								>
									Add {selected.length > 0 ? selected.length : ''}
									{selected.length === 1 ? 'person' : 'people'}
								</button>
							{/if}
						</div>
					{/if}
				{/if}

				<p class="mt-5 font-ui text-xs font-semibold text-book-ink/70">Members</p>
				<ul class="mt-2 space-y-1">
					{#each members as member (member.userId)}
						<li class="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
							<Avatar
								src={member.avatar}
								name={member.name}
								className="size-9"
								textClass="text-sm"
								ring="ring-2 ring-gold/40"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate font-ui text-sm font-semibold">
									{member.name}
									{#if member.isMe}
										<span class="font-normal text-book-ink/55">(you)</span>
									{/if}
								</p>
								<p class="truncate font-ui text-[11px] text-book-ink/60">@{member.username}</p>
							</div>
							{#if member.role === 'owner'}
								<span
									class="shrink-0 rounded-full bg-book-accent/15 px-2 py-0.5 font-ui text-[10px] font-bold text-book-accent"
								>
									Owner
								</span>
							{/if}
							{#if isOwner && !member.isMe}
								<button
									type="button"
									class="flex size-8 shrink-0 items-center justify-center rounded-full text-book-ink/55 transition-colors hover:bg-[#D19A9A]/25 hover:text-[#8A2F2F]"
									onclick={() => void remove(member.userId)}
									aria-label="Remove {member.name} from the group"
									title="Remove from group"
								>
									<CommunityIcon name="x" size={14} />
								</button>
							{/if}
						</li>
					{/each}
				</ul>

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
					class="min-h-10 rounded-xl border border-[#D19A9A]/60 px-3 font-ui text-xs font-bold text-[#8A2F2F] transition-colors hover:bg-[#D19A9A]/15"
					onclick={() => void leave()}
				>
					Leave group
				</button>
				<button
					type="button"
					class="min-h-10 rounded-xl border border-line px-4 font-ui text-sm font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep"
					onclick={onClose}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
