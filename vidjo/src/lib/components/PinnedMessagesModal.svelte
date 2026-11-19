<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { censor } from '#lib/censor';
	import { messages } from '#lib/state/messages.svelte';

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();

	$effect(() => {
		if (open) void messages.loadPinnedMessages();
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-[58] flex items-center justify-center bg-[rgba(15,8,25,.78)] p-4"
		role="presentation"
	>
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close pinned messages"
		></button>

		<div
			class="relative z-10 flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,.55)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby="pinned-title"
		>
			<div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
				<div class="flex items-center gap-2">
					<span
						class="flex size-8 items-center justify-center rounded-full bg-book-bg text-book-accent"
					>
						<CommunityIcon name="pin" size={16} />
					</span>
					<div>
						<h2 id="pinned-title" class="font-display text-lg leading-tight font-bold">
							Pinned messages
						</h2>
						<p class="font-ui text-[10px] text-book-ink/60">Only visible to you in this chat</p>
					</div>
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

			<div class="min-h-0 flex-1 modal-scroll space-y-2 overflow-y-auto px-5 py-4">
				{#if messages.loadingPinned}
					<p class="py-6 text-center font-hand text-base text-book-ink/60">Gathering your pins…</p>
				{:else if messages.pinnedMessages.length === 0}
					<div class="flex flex-col items-center px-4 py-8 text-center">
						<span
							class="flex size-12 items-center justify-center rounded-full bg-book-bg text-book-accent"
						>
							<CommunityIcon name="pin" size={20} />
						</span>
						<p class="mt-3 font-display text-base font-bold">Nothing pinned yet</p>
						<p class="mt-1 max-w-[240px] font-ui text-[11px] leading-relaxed text-book-ink/65">
							Hold a message and choose Pin to keep it here.
						</p>
					</div>
				{:else}
					{#each messages.pinnedMessages as message (message.clientId || message.id)}
						<div class="rounded-xl border border-line bg-book-bg/80 p-3">
							<div class="flex items-center justify-between gap-2">
								<p class="font-ui text-[11px] font-bold text-accent">{message.senderName}</p>
								<p class="font-ui text-[9px] text-book-ink/50">
									{new Date(message.createdAt).toLocaleString(undefined, {
										month: 'short',
										day: 'numeric',
										hour: 'numeric',
										minute: '2-digit'
									})}
								</p>
							</div>
							<p class="mt-1 line-clamp-3 font-ui text-xs leading-relaxed text-book-ink/80">
								{censor(
									message.body ||
										message.fileName ||
										message.sharedEntry?.title ||
										(message.imagePath ? 'Photo' : 'Attachment')
								)}
							</p>
							<div class="mt-2 flex gap-2">
								<button
									type="button"
									class="rounded-full border border-line px-2.5 py-1 font-ui text-[10px] font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep"
									onclick={() => {
										messages.setReply(message);
										onClose();
									}}
								>
									Reply
								</button>
								<button
									type="button"
									class="rounded-full border border-line px-2.5 py-1 font-ui text-[10px] font-semibold text-book-ink/75 transition-colors hover:bg-paper-deep"
									onclick={() =>
										void messages.togglePin(message).then(() => messages.loadPinnedMessages())}
								>
									Unpin
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="border-t border-line bg-paper-deep/70 px-5 py-3 text-right">
				<button
					type="button"
					class="min-h-9 rounded-xl bg-cta px-4 font-ui text-xs font-bold text-cta-text transition-colors hover:bg-cta-hover"
					onclick={onClose}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
