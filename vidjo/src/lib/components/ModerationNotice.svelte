<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { moderation } from '#lib/state/moderation.svelte';

	let acknowledging = $state(false);
	const activeWarning = $derived(moderation.activeWarning);
	const pendingCount = $derived(moderation.pendingWarnings.length);

	function formatDate(value: string | null) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleDateString(undefined, {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	async function acknowledge() {
		const warning = activeWarning;
		if (!warning || acknowledging) return;
		acknowledging = true;
		try {
			await moderation.acknowledge(warning.id);
		} finally {
			acknowledging = false;
		}
	}
</script>

{#if moderation.banned}
	<div
		class="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-[#120A20]/95 px-4 py-8"
		role="dialog"
		aria-modal="true"
		aria-labelledby="banTitle"
	>
		<div
			class="w-full max-w-[520px] rounded-[26px] border border-[#D19A9A]/60 bg-[#24143D] p-7 text-center text-white shadow-[0_40px_120px_rgba(0,0,0,.75)] min-[480px]:p-9"
		>
			<span
				class="mx-auto flex size-16 items-center justify-center rounded-full bg-[#D19A9A]/15 text-[#F0A3A3]"
			>
				<svg
					width="30"
					height="30"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="9"></circle>
					<path d="M5.5 5.5l13 13"></path>
				</svg>
			</span>

			<h1 id="banTitle" class="mt-4 font-display text-3xl leading-tight font-bold">
				Your account is suspended
			</h1>
			<p class="mt-2 font-ui text-sm leading-relaxed text-[#D6CBEC]">
				A moderator has paused your access to VidJo. This is a suspension, not a deletion — your
				journal, videos, and friends are still saved.
			</p>

			<div class="mt-5 rounded-2xl border border-[#D19A9A]/30 bg-[#1B102B] px-4 py-4 text-left">
				<p class="font-ui text-[11px] font-bold tracking-wide text-[#F0A3A3] uppercase">Reason</p>
				<p class="mt-1 font-ui text-sm leading-relaxed text-white">
					{moderation.banReason || 'Repeated or serious community guideline violations.'}
				</p>
				{#if moderation.bannedAt}
					<p class="mt-2 font-ui text-[11px] text-[#9E8CC0]">
						Suspended {formatDate(moderation.bannedAt)}
					</p>
				{/if}
			</div>

			<p class="mt-4 font-ui text-xs leading-relaxed text-[#9E8CC0]">
				If you believe this was a mistake, contact a VidJo moderator. They can restore access
				without losing any of your pages.
			</p>

			<button
				type="button"
				class="mt-6 h-11 w-full rounded-xl border border-[#5A4580] bg-[#33224D] font-ui text-sm font-bold text-white transition-colors hover:bg-[#43306A]"
				onclick={() => void auth.signOut()}
			>
				Sign out
			</button>
		</div>
	</div>
{:else if activeWarning}
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#120A20]/85 px-4 py-8"
		role="dialog"
		aria-modal="true"
		aria-labelledby="warningTitle"
	>
		<div
			class="w-full max-w-[520px] rounded-[26px] border border-[#D4A24C]/60 bg-paper p-7 text-ink shadow-[0_30px_80px_rgba(0,0,0,.6)] min-[480px]:p-8"
		>
			<div class="flex items-start gap-3">
				<span
					class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#D4A24C]/25 text-[#8A5A12]"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 9v4"></path>
						<path d="M12 17h.01"></path>
						<path
							d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
						></path>
					</svg>
				</span>
				<div>
					<h2 id="warningTitle" class="font-display text-2xl leading-tight font-bold text-ink">
						Moderator warning
					</h2>
					{#if pendingCount > 1}
						<p class="mt-1 font-ui text-[11px] font-semibold text-[#8A5A12]">
							{pendingCount} unread warnings — this is the newest.
						</p>
					{/if}
				</div>
			</div>

			<p class="mt-4 font-ui text-sm font-bold text-ink">{activeWarning.reason}</p>
			<p class="mt-1.5 font-hand text-xl leading-snug text-ink">{activeWarning.message}</p>

			<div
				class="mt-4 rounded-xl bg-[#FFFDF6] px-3 py-2 font-ui text-[11px] leading-relaxed text-ink-soft"
			>
				Your page or comment was <b class="text-ink">not deleted</b>. This warning stays on your
				account so you can see why it was sent. Repeated abuse can lead to a temporary suspension.
			</div>

			{#if activeWarning.created_at}
				<p class="mt-3 font-ui text-[10px] text-ink-soft">
					{formatDate(activeWarning.created_at)}
				</p>
			{/if}

			<button
				type="button"
				class="mt-5 h-11 w-full rounded-xl bg-accent font-ui text-sm font-bold text-white transition-colors hover:bg-[#624690] disabled:cursor-wait disabled:opacity-70"
				disabled={acknowledging}
				onclick={() => void acknowledge()}
			>
				{acknowledging ? 'Saving…' : pendingCount > 1 ? 'Next warning' : 'I understand'}
			</button>
		</div>
	</div>
{/if}
