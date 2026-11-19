<script lang="ts">
	import { messages } from '#lib/state/messages.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { isThemeName, THEMES } from '#lib/themes';
	import type { DmThreadMember, DmThreadSummary } from '#lib/types';

	let {
		open,
		thread,
		onClose,
		onOpenPinned
	}: {
		open: boolean;
		thread: DmThreadSummary | null;
		onClose: () => void;
		onOpenPinned: () => void;
	} = $props();

	let renameOpen = $state(false);
	let renameValue = $state('');
	let addOpen = $state(false);
	let selected = $state<string[]>([]);
	let localError = $state('');
	let photoInputEl = $state<HTMLInputElement | null>(null);
	let nicknameFor = $state<string | null>(null);
	let nicknameValue = $state('');
	// Reset the panel once per opening, not every time the member list reloads.
	let wasOpen = false;

	const members = $derived(thread ? (messages.membersByThread[thread.threadId] ?? []) : []);
	const me = $derived(members.find((member) => member.isMe) ?? null);
	const isOwner = $derived(me?.role === 'owner');
	const isGroup = $derived(thread?.kind === 'group');
	const settings = $derived(thread ? (messages.chatSettings[thread.threadId] ?? null) : null);
	const chatTheme = $derived(settings?.theme ?? 'classic');
	const photoUrl = $derived(
		settings?.photoPath ? (messages.imageUrls[settings.photoPath] ?? '') : ''
	);
	const peer = $derived(members.find((member) => !member.isMe) ?? null);
	const memberCount = $derived(
		members.length || settings?.memberCount || thread?.members.length || 0
	);
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
		nicknameFor = null;
		nicknameValue = '';
		renameValue = thread.title ?? '';
		if (!messages.membersByThread[thread.threadId]) {
			void messages.loadMembers(thread.threadId);
		}
		void messages.loadChatSettings(thread.threadId);
	});

	function formatCreated(value: string | undefined) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
	}

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

	async function changePhoto(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';
		if (!file || !thread) return;

		localError = '';
		const ok = await messages.setChatPhoto(thread.threadId, file);
		if (!ok) localError = messages.error || 'Could not change the chat photo.';
	}

	async function changeTheme(theme: string) {
		if (!thread || !isThemeName(theme)) return;
		localError = '';
		const ok = await messages.setChatTheme(thread.threadId, theme);
		if (!ok) localError = messages.error || 'Could not change this chat theme.';
	}

	function editNickname(member: DmThreadMember) {
		nicknameFor = member.userId;
		nicknameValue = member.nickname || member.name;
		localError = '';
	}

	async function saveNickname() {
		if (!thread || !nicknameFor) return;
		const target = nicknameFor;
		localError = '';
		const ok = await messages.setNickname(thread.threadId, target, nicknameValue);
		if (ok) {
			nicknameFor = null;
			nicknameValue = '';
		} else {
			localError = messages.error || 'Could not save that nickname.';
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

	function showPinned() {
		onOpenPinned();
		onClose();
	}

	function handleKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if open && thread}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,8,25,.78)] p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="chat-settings-title"
	>
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close chat settings dialog"
		></button>

		<div
			class="relative z-10 flex max-h-[85vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
		>
			<div class="flex items-center gap-3 border-b border-line px-5 py-4">
				{#if isGroup}
					{#if photoUrl}
						<Avatar
							src={photoUrl}
							name={thread.title || 'Group chat'}
							className="size-12 shrink-0"
							textClass="text-base"
							ring="ring-2 ring-gold/50"
						/>
					{:else}
						<span
							class="flex size-12 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
							aria-hidden="true"
						>
							<CommunityIcon name="users" size={20} />
						</span>
					{/if}
				{:else}
					<Avatar
						src={peer?.avatar ?? null}
						name={peer?.name || 'Friend'}
						className="size-12 shrink-0"
						textClass="text-base"
						ring="ring-2 ring-gold/50"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					<h2 id="chat-settings-title" class="truncate font-display text-xl font-bold">
						Customize chat
					</h2>
					<p class="truncate font-ui text-[11px] text-book-ink/60">
						{thread.title || peer?.name || 'Conversation'} · {memberCount}
						{memberCount === 1 ? 'member' : 'members'}
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

			<div class="min-h-0 flex-1 modal-scroll space-y-5 overflow-y-auto px-5 py-4">
				<section>
					<h3 class="font-ui text-xs font-bold tracking-wide text-book-ink/70 uppercase">
						Chat info
					</h3>
					<dl class="mt-2 grid grid-cols-2 gap-2">
						<div class="rounded-xl border border-line bg-book-bg/80 px-3 py-2">
							<dt class="font-ui text-[10px] text-book-ink/55">Type</dt>
							<dd class="font-ui text-xs font-bold capitalize">
								{isGroup ? 'Group chat' : 'Direct message'}
							</dd>
						</div>
						<div class="rounded-xl border border-line bg-book-bg/80 px-3 py-2">
							<dt class="font-ui text-[10px] text-book-ink/55">Started</dt>
							<dd class="truncate font-ui text-xs font-bold">
								{formatCreated(settings?.createdAt) || '—'}
							</dd>
						</div>
					</dl>
					<button
						type="button"
						class="mt-2 flex min-h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-book-bg/80 px-3 text-left font-ui text-xs font-semibold text-book-ink/80 transition-colors hover:bg-paper-deep"
						onclick={showPinned}
					>
						<CommunityIcon name="pin" size={14} class="shrink-0 text-book-accent" />
						<span class="flex-1">View pinned messages</span>
						<CommunityIcon name="arrow-right" size={13} class="shrink-0 text-book-ink/50" />
					</button>
				</section>

				{#if isGroup && isOwner}
					<section>
						<h3 class="font-ui text-xs font-bold tracking-wide text-book-ink/70 uppercase">
							Group details
						</h3>
						<div class="mt-2 flex flex-wrap gap-2">
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
								class="min-h-9 rounded-lg border border-line bg-book-bg px-3 font-ui text-xs font-bold text-book-ink/80 transition-colors hover:bg-paper-deep"
								onclick={() => photoInputEl?.click()}
							>
								Change photo
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
						<input
							bind:this={photoInputEl}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							class="sr-only"
							tabindex="-1"
							onchange={(event) => void changePhoto(event)}
							aria-hidden="true"
						/>

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
					</section>
				{/if}

				<section>
					<h3 class="font-ui text-xs font-bold tracking-wide text-book-ink/70 uppercase">
						Chat theme
					</h3>
					<p class="mt-1 font-ui text-[11px] text-book-ink/60">
						Only you see this colour in this conversation.
					</p>
					<div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
						{#each THEMES as theme (theme.id)}
							<button
								type="button"
								class="flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors {chatTheme ===
								theme.id
									? 'border-book-accent bg-book-accent/10'
									: 'border-line bg-book-bg/70 hover:bg-paper-deep'}"
								onclick={() => void changeTheme(theme.id)}
								aria-pressed={chatTheme === theme.id}
								title={theme.label}
							>
								<span
									class="size-6 rounded-full border border-black/10 shadow-inner"
									style={`background: ${theme.swatch}`}
								></span>
								<span class="font-ui text-[9px] font-semibold">{theme.short}</span>
							</button>
						{/each}
					</div>
				</section>

				<section>
					<h3 class="font-ui text-xs font-bold tracking-wide text-book-ink/70 uppercase">
						Members
					</h3>
					<ul class="mt-2 space-y-1">
						{#each members as member (member.userId)}
							<li class="rounded-xl px-1.5 py-1.5">
								<div class="flex items-center gap-2.5">
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
									{#if isOwner || member.isMe}
										<button
											type="button"
											class="flex size-8 shrink-0 items-center justify-center rounded-full text-book-ink/55 transition-colors hover:bg-book-accent/15 hover:text-book-accent"
											onclick={() => editNickname(member)}
											aria-label={`Edit nickname for ${member.name}`}
											title="Edit nickname"
										>
											<CommunityIcon name="pen" size={14} />
										</button>
									{/if}
									{#if isGroup && isOwner && !member.isMe}
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
								</div>
								{#if nicknameFor === member.userId}
									<form
										class="mt-2 flex gap-2 pl-11"
										onsubmit={(event) => {
											event.preventDefault();
											void saveNickname();
										}}
									>
										<label class="sr-only" for={`nickname-${member.userId}`}>
											Nickname for {member.name}
										</label>
										<input
											id={`nickname-${member.userId}`}
											bind:value={nicknameValue}
											maxlength="24"
											class="h-9 min-w-0 flex-1 rounded-xl border border-line bg-book-bg px-3 font-ui text-xs text-book-ink focus:border-book-accent focus:outline-none"
										/>
										<button
											type="submit"
											class="min-h-9 rounded-xl bg-cta px-3 font-ui text-[11px] font-bold text-cta-text transition-colors hover:bg-cta-hover"
										>
											Save
										</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</section>

				{#if localError}
					<p
						class="rounded-xl border border-[#E3B9B9] bg-[#FBEAEA] px-3 py-2 font-ui text-xs font-semibold text-[#8A2F2F]"
					>
						{localError}
					</p>
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
				{#if isGroup}
					<button
						type="button"
						class="min-h-10 rounded-xl border border-[#D19A9A]/60 px-3 font-ui text-xs font-bold text-[#8A2F2F] transition-colors hover:bg-[#D19A9A]/15"
						onclick={() => void leave()}
					>
						Leave group
					</button>
				{:else}
					<span></span>
				{/if}
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
