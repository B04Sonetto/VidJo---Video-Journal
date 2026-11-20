<script lang="ts">
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { pwa } from '#lib/state/pwa.svelte';
	import { spotify } from '#lib/state/spotify.svelte';

	let wasOffline = $state(false);
	let installVisible = $state(false);

	// Give the journal a moment to appear before the install card slides in.
	$effect(() => {
		if (!pwa.showInstallCard) {
			installVisible = false;
			return;
		}

		const timer = setTimeout(() => (installVisible = true), 3200);
		return () => clearTimeout(timer);
	});

	// When the connection returns, retry whatever was queued while offline.
	$effect(() => {
		if (pwa.offline) {
			wasOffline = true;
			return;
		}

		if (!wasOffline) return;
		wasOffline = false;

		if (journal.remote) {
			void journal.flush();
			journal.toast('Back online — syncing your pages');
		} else {
			journal.toast('Back online — reopen VidJo to sync');
		}
	});

	// Spotify's mini player and "Connect Spotify" button are fixed to the same
	// bottom corner and sit above this card, hiding it. Lift the card above them.
	// (The expanded player has its own backdrop, so it needs no special case.)
	const spotifyDocked = $derived(
		auth.active &&
			!spotify.panelOpen &&
			(spotify.connected ||
				Boolean(spotify.track) ||
				(spotify.connectionKnown && spotify.configured && spotify.status !== 'unsupported'))
	);

	const cardBase =
		'fixed right-3 left-3 z-[65] mx-auto max-w-[430px] rounded-2xl border border-cover-edge bg-desk-2/98 p-4 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-md min-[900px]:right-6 min-[900px]:left-auto min-[900px]:mx-0 min-[900px]:w-[370px]';

	const cardBottom = $derived(
		spotifyDocked
			? 'bottom-[calc(env(safe-area-inset-bottom)+170px)] min-[900px]:bottom-[calc(max(24px,env(safe-area-inset-bottom))+84px)]'
			: 'bottom-[calc(env(safe-area-inset-bottom)+82px)] min-[900px]:bottom-[max(24px,env(safe-area-inset-bottom))]'
	);

	const cardClass = $derived(`${cardBase} ${cardBottom}`);
</script>

{#if pwa.offline}
	<div
		role="status"
		aria-live="polite"
		class="fixed top-[max(10px,env(safe-area-inset-top))] left-1/2 z-[75] flex w-[min(460px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#D4A24C]/45 bg-desk-2/96 px-4 py-2.5 font-ui text-[12.5px] font-semibold text-[#F4E8CB] shadow-[0_10px_28px_rgba(0,0,0,.45)] backdrop-blur-md"
		in:fly={{ y: -12, duration: 220, easing: backOut }}
		out:fly={{ y: -8, duration: 150 }}
	>
		<span
			class="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold"
			aria-hidden="true"
		>
			<CommunityIcon name="alert" size={14} />
		</span>
		<span>Offline — pages saved on this device are still available.</span>
	</div>
{/if}

{#if pwa.showUpdateCard}
	<section
		class={cardClass}
		aria-label="Update available"
		in:fly={{ y: 20, duration: 260, easing: backOut }}
		out:fly={{ y: 10, duration: 160 }}
	>
		<div class="flex items-start gap-3">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"
				aria-hidden="true"
			>
				<CommunityIcon name="refresh" size={19} />
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-display text-lg leading-tight font-bold text-white">A fresh page is ready</p>
				<p class="mt-1 font-ui text-xs leading-relaxed text-lav">
					Refresh to load the newest VidJo. Your journal and videos stay exactly where they are.
				</p>
			</div>
			<button
				type="button"
				class="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-lav/80 transition-colors hover:bg-white/10 hover:text-white"
				aria-label="Dismiss update"
				onclick={() => pwa.dismissUpdate()}
			>
				<CommunityIcon name="x" size={16} />
			</button>
		</div>

		<div class="mt-3 flex gap-2">
			<button
				type="button"
				class="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gold px-4 font-ui text-sm font-bold text-desk transition-colors hover:bg-[#E0B266] active:scale-[.99]"
				onclick={() => pwa.applyUpdate()}
			>
				<CommunityIcon name="refresh" size={15} />
				Refresh VidJo
			</button>
			<button
				type="button"
				class="min-h-11 shrink-0 rounded-xl border border-cover-edge px-3.5 font-ui text-sm font-semibold text-lav transition-colors hover:bg-white/10"
				onclick={() => pwa.dismissUpdate()}
			>
				Later
			</button>
		</div>
	</section>
{:else if installVisible && pwa.showInstallCard}
	<section
		class={cardClass}
		aria-label="Install VidJo"
		in:fly={{ y: 20, duration: 260, easing: backOut }}
		out:fly={{ y: 10, duration: 160 }}
	>
		<div class="flex items-start gap-3">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold"
				aria-hidden="true"
			>
				<CommunityIcon name="rocket" size={19} />
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-display text-lg leading-tight font-bold text-white">Keep VidJo close</p>
				{#if pwa.canInstall}
					<p class="mt-1 font-ui text-xs leading-relaxed text-lav">
						Install the app for a full-screen journal that opens straight from your home screen.
					</p>
				{:else}
					<p class="mt-1 font-ui text-xs leading-relaxed text-lav">
						In Safari, tap <b class="text-white">Share</b>, then
						<b class="text-white">Add to Home Screen</b> to keep VidJo one tap away.
					</p>
				{/if}
			</div>
			<button
				type="button"
				class="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-lav/80 transition-colors hover:bg-white/10 hover:text-white"
				aria-label="Dismiss install prompt"
				onclick={() => (pwa.canInstall ? pwa.dismissInstall() : pwa.dismissIosHint())}
			>
				<CommunityIcon name="x" size={16} />
			</button>
		</div>

		<div class="mt-3 flex gap-2">
			{#if pwa.canInstall}
				<button
					type="button"
					class="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gold px-4 font-ui text-sm font-bold text-desk transition-colors hover:bg-[#E0B266] active:scale-[.99]"
					onclick={() => void pwa.promptInstall()}
				>
					<CommunityIcon name="rocket" size={15} />
					Install VidJo
				</button>
				<button
					type="button"
					class="min-h-11 shrink-0 rounded-xl border border-cover-edge px-3.5 font-ui text-sm font-semibold text-lav transition-colors hover:bg-white/10"
					onclick={() => pwa.dismissInstall()}
				>
					Not now
				</button>
			{:else}
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl bg-gold px-4 font-ui text-sm font-bold text-desk transition-colors hover:bg-[#E0B266] active:scale-[.99]"
					onclick={() => pwa.dismissIosHint()}
				>
					Got it
				</button>
			{/if}
		</div>
	</section>
{/if}
