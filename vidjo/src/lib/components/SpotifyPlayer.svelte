<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	const browser = typeof window !== 'undefined';
	import { backOut } from 'svelte/easing';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { spotify, type SpotifyTrack } from '#lib/state/spotify.svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { todayKey } from '#lib/dates';

	let query = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let handledCallback = $state(false);

	onMount(() => {
		// Check connection status so the header/player UI reflects current state.
		void spotify.refreshConnection(false);
		return () => {
			if (searchTimer) clearTimeout(searchTimer);
		};
	});

	$effect(() => {
		if (!browser || handledCallback) return;
		handledCallback = true;
		spotify.restoreReturnState(new URL(window.location.href));
		spotify.handleCallbackParams(new URL(window.location.href));
	});

	function onSearchInput(value: string) {
		query = value;
		if (searchTimer) clearTimeout(searchTimer);
		if (!value.trim()) {
			spotify.results = [];
			return;
		}
		searchTimer = setTimeout(() => {
			void spotify.search(value);
		}, 350);
	}

	function playResult(track: SpotifyTrack) {
		void spotify.playTrack(track);
	}

	let seeking = $state(false);
	let seekDraft = $state(0);

	const progressMax = $derived(Math.max(spotify.duration || spotify.track?.duration_ms || 0, 0));
	const displayPosition = $derived(
		seeking ? seekDraft : Math.min(spotify.position, progressMax || spotify.position)
	);
	const progressPct = $derived(
		progressMax > 0 ? Math.min(100, (displayPosition / progressMax) * 100) : 0
	);
	const volumePct = $derived(Math.round(spotify.volume * 100));
	const today = $derived(todayKey());
	const todaySong = $derived(journal.entries[today]?.song ?? null);
	const isTodaySongAttached = $derived(
		Boolean(todaySong && spotify.track?.uri && todaySong.uri === spotify.track.uri)
	);

	// Spotify is part of the journal. Showing "Connect Spotify" on the sign-in
	// screen sent people through Spotify and straight back to the login form.
	const showBar = $derived(
		auth.ready && auth.active && (spotify.connected || spotify.track || spotify.panelOpen)
	);
	const showConnectButton = $derived(
		auth.active &&
			spotify.connectionKnown &&
			spotify.configured &&
			spotify.status !== 'unsupported' &&
			!showBar
	);

	async function attachCurrentToToday() {
		const song = spotify.currentSong();
		if (!song) return;
		const entry = journal.ensureEntry(today);
		if (!entry) return;
		journal.current = today;
		journal.side = 'L';
		await journal.setSongForCurrent(song);
		journal.toast("Song attached to today's page");
	}

	async function removeSongFromToday() {
		const entry = journal.entries[today];
		if (!entry?.song) return;
		journal.current = today;
		journal.side = 'L';
		await journal.setSongForCurrent(null);
		journal.toast("Song removed from today's page");
	}

	function onSeekInput(e: Event) {
		seeking = true;
		seekDraft = Number((e.currentTarget as HTMLInputElement).value);
	}

	function onSeekCommit(e: Event) {
		const value = Number((e.currentTarget as HTMLInputElement).value);
		seeking = false;
		seekDraft = value;
		void spotify.seek(value);
	}
</script>

{#if showBar}
	{#if spotify.panelOpen}
		<div
			class="fixed inset-0 z-[74] bg-desk/45 backdrop-blur-[2px]"
			transition:fade={{ duration: 140 }}
			onclick={() => (spotify.panelOpen = false)}
			aria-hidden="true"
		></div>
		<div
			class="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+82px)] left-3 z-[75] mx-auto max-h-[min(62dvh,560px)] max-w-[420px] overflow-hidden rounded-[20px] border border-cover-edge bg-desk-2/98 text-book-bg shadow-[0_30px_90px_rgba(0,0,0,.62)] backdrop-blur-xl min-[900px]:right-5 min-[900px]:bottom-[calc(env(safe-area-inset-bottom)+20px)] min-[900px]:left-auto min-[900px]:max-h-[min(76dvh,680px)] min-[900px]:w-[420px] min-[900px]:rounded-[28px]"
			transition:fly={{ y: 24, duration: 260, easing: backOut }}
			role="dialog"
			aria-label="Spotify player"
		>
			<div
				class="spotify-theme-glow pointer-events-none absolute inset-0 opacity-80"
				aria-hidden="true"
			></div>
			<div
				class="relative flex max-h-[min(62dvh,560px)] flex-col min-[900px]:max-h-[min(76dvh,680px)]"
			>
				<header
					class="flex items-start justify-between gap-3 border-b border-cover-edge/70 px-3 py-2.5 min-[720px]:px-4 min-[720px]:py-4"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span
								class="flex size-8 items-center justify-center rounded-xl bg-[#1DB954]/20 text-[#1ED760]"
							>
								<CommunityIcon name="spotify" size={18} />
							</span>
							<div class="min-w-0">
								<p class="font-display text-lg leading-none font-bold">VidJo Player</p>
								<p class="mt-0.5 font-ui text-[11px] text-book-bg/65">
									{#if spotify.connected}
										{spotify.accountName
											? `Connected as ${spotify.accountName}`
											: 'Spotify connected'}
										{#if spotify.accountProduct}· {spotify.accountProduct}{/if}
									{:else}
										Listen with Spotify Premium
									{/if}
								</p>
							</div>
						</div>
					</div>
					<div class="flex items-center gap-1.5">
						{#if spotify.connected}
							<button
								type="button"
								class="rounded-full border border-cover-edge bg-cover/30 px-3 py-1.5 font-ui text-[11px] font-semibold text-book-bg/80 hover:bg-cover/50 hover:text-book-bg"
								onclick={() => void spotify.disconnect()}
							>
								Disconnect
							</button>
						{/if}
						<button
							type="button"
							class="flex size-9 items-center justify-center rounded-full border border-cover-edge bg-cover/30 text-book-bg/80 hover:bg-cover/50 hover:text-book-bg"
							onclick={() => (spotify.panelOpen = false)}
							aria-label="Close player"
						>
							<CommunityIcon name="x" size={16} />
						</button>
					</div>
				</header>

				<div class="modal-scroll overflow-y-auto px-4 py-4">
					{#if !spotify.configured}
						<div
							class="rounded-2xl border border-[#B85C5C]/40 bg-[#B85C5C]/10 p-4 font-ui text-sm text-book-bg/90"
						>
							Spotify is not configured on the server yet. Add your Spotify app credentials and
							redeploy.
						</div>
					{:else if !spotify.connected}
						<div class="rounded-2xl border border-cover-edge bg-cover/20 p-5 text-center">
							<div
								class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#1DB954]/20 text-[#1ED760] shadow-[0_10px_30px_rgba(29,185,84,.18)]"
							>
								<CommunityIcon name="headphones" size={28} />
							</div>
							<h3 class="mt-3 font-display text-xl font-bold">Play music in VidJo</h3>
							<p class="mt-1.5 font-ui text-sm leading-relaxed text-book-bg/70">
								Connect your Spotify Premium account to search tracks and listen right inside your
								journal. Next-song recommendations are based on your Spotify top tracks, not just
								the song you are playing.
							</p>
							<button
								type="button"
								class="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-5 font-ui text-sm font-bold text-[#062012] shadow-[0_10px_24px_rgba(29,185,84,.28)] transition-all hover:bg-[#1ED760] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
								onclick={() => void spotify.connect()}
								disabled={!spotify.configured}
							>
								<CommunityIcon name="spotify" size={18} />
								Connect Spotify
							</button>
							<p class="mt-2 font-ui text-[11px] text-book-bg/55">
								Requires Spotify Premium and read-only access to your top tracks.
							</p>
							{#if !spotify.configured}
								<p class="mt-2 font-ui text-[11px] font-semibold text-[#FFCF8A]">
									Spotify isn’t configured on the server yet.
								</p>
							{/if}
							{#if spotify.error}
								<p class="mt-2 font-ui text-[11px] font-semibold text-[#FFB4B4]">{spotify.error}</p>
							{:else if spotify.notice}
								<p class="mt-2 font-ui text-[11px] font-semibold text-[#BFF3D1]">
									{spotify.notice}
								</p>
							{/if}
						</div>
					{:else}
						{#if spotify.error}
							<div
								class="mb-3 rounded-xl border border-[#B85C5C]/40 bg-[#B85C5C]/12 px-3 py-2.5 font-ui text-xs text-[#FFD6D6]"
							>
								{spotify.error}
							</div>
						{/if}
						{#if spotify.notice}
							<div
								class="mb-3 rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/12 px-3 py-2.5 font-ui text-xs text-[#CFF7DF]"
							>
								{spotify.notice}
							</div>
						{/if}

						<div
							class="rounded-2xl border border-cover-edge bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-cover)_55%,transparent),color-mix(in_srgb,var(--color-desk)_70%,transparent))] p-3 shadow-inner"
						>
							<div class="flex items-center gap-3">
								<div
									class="relative size-[72px] shrink-0 overflow-hidden rounded-2xl border border-cover-edge/70 bg-cover/40 shadow-[0_10px_24px_rgba(0,0,0,.28)]"
								>
									{#if spotify.track?.image}
										<img
											src={spotify.track.image}
											alt=""
											class="h-full w-full object-cover"
											loading="lazy"
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-book-bg/45">
											<CommunityIcon
												name={spotify.status === 'loading' ? 'disc' : 'music'}
												size={28}
												class={spotify.status === 'loading' ? 'animate-spin' : ''}
											/>
										</div>
									{/if}
									{#if spotify.playing}
										<span
											class="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-[#1DB954] text-[#062012] shadow"
										>
											<CommunityIcon name="volume-2" size={11} />
										</span>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate font-ui text-sm font-bold text-book-bg">
										{spotify.track?.name || (spotify.ready ? 'Ready to play' : 'Starting player…')}
									</p>
									<p class="mt-0.5 truncate font-ui text-xs text-book-bg/70">
										{spotify.track?.artists ||
											(spotify.ready
												? 'Search for a song below'
												: 'Connecting to Spotify Web Playback SDK')}
									</p>
									{#if spotify.track?.album}
										<p class="mt-0.5 truncate font-ui text-[11px] text-book-bg/50">
											{spotify.track.album}
										</p>
									{/if}
								</div>
							</div>

							<div class="mt-3">
								<input
									type="range"
									min="0"
									max={Math.max(progressMax, 1)}
									value={Math.min(displayPosition, Math.max(progressMax, 1))}
									step="1000"
									class="spotify-seek h-2 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50"
									style="background: linear-gradient(to right, var(--color-book-accent), #1DB954) {progressPct}%, color-mix(in srgb, var(--color-cover-edge) 85%, transparent) {progressPct}%"
									oninput={onSeekInput}
									onchange={onSeekCommit}
									disabled={!spotify.canControl || progressMax <= 0}
									aria-label="Seek playback position"
								/>
								<div
									class="mt-1 flex items-center justify-between font-ui text-[10px] text-book-bg/55 tabular-nums"
								>
									<span>{spotify.formatTime(displayPosition)}</span>
									<span>{spotify.formatTime(progressMax)}</span>
								</div>
							</div>

							{#if spotify.track?.uri || todaySong}
								<div class="mt-3 flex items-center gap-2">
									{#if spotify.track?.uri}
										<button
											type="button"
											class="inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-[#1DB954]/35 bg-[#1DB954]/15 px-3 font-ui text-[11px] font-bold text-[#DFFFEA] transition-colors hover:bg-[#1DB954]/25 disabled:cursor-not-allowed disabled:opacity-50"
											onclick={() => void attachCurrentToToday()}
											disabled={!spotify.track?.uri}
											title={isTodaySongAttached
												? "This song is attached to today's page"
												: "Attach current song to today's journal page"}
										>
											<CommunityIcon name={isTodaySongAttached ? 'check' : 'music'} size={14} />
											{isTodaySongAttached ? 'Attached to today' : "Attach to today's page"}
										</button>
									{:else}
										<p class="flex-1 font-ui text-[11px] font-semibold text-book-bg/80">
											Song attached to today’s page
										</p>
									{/if}
									{#if todaySong}
										<button
											type="button"
											class="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-danger/40 bg-danger/10 text-danger transition-colors hover:bg-danger/20"
											onclick={() => void removeSongFromToday()}
											aria-label="Remove song from today's page"
											title="Remove song from today's page"
										>
											<CommunityIcon name="x" size={14} />
										</button>
									{/if}
								</div>
								<p class="mt-1.5 px-1 font-ui text-[10px] text-book-bg/55">
									Shows on today’s page and can be played from journal, friends, community, and
									messages.
								</p>
							{/if}

							<div class="mt-3 flex items-center justify-center gap-2">
								<button
									type="button"
									class="flex size-10 items-center justify-center rounded-full border border-cover-edge bg-cover/30 text-book-bg/85 hover:bg-cover/50 hover:text-book-bg disabled:opacity-40"
									onclick={() => void spotify.previous()}
									disabled={!spotify.canControl}
									aria-label="Previous track"
								>
									<CommunityIcon name="skip-back" size={17} />
								</button>
								<button
									type="button"
									class="flex size-12 items-center justify-center rounded-full bg-cta text-cta-text shadow-[0_10px_24px_var(--color-cta-shadow)] hover:bg-cta-hover disabled:opacity-40"
									onclick={() => void spotify.togglePlay()}
									disabled={!spotify.canControl}
									aria-label={spotify.playing ? 'Pause' : 'Play'}
								>
									<CommunityIcon name={spotify.playing ? 'pause' : 'play'} size={20} />
								</button>
								<button
									type="button"
									class="flex size-10 items-center justify-center rounded-full border border-cover-edge bg-cover/30 text-book-bg/85 hover:bg-cover/50 hover:text-book-bg disabled:opacity-40"
									onclick={() => void spotify.next()}
									disabled={!spotify.canControl}
									aria-label="Next track"
								>
									<CommunityIcon name="skip-forward" size={17} />
								</button>
							</div>

							<div class="mt-3 flex items-center gap-2 px-1">
								<CommunityIcon
									name={spotify.volume === 0 ? 'volume-x' : 'volume-2'}
									size={15}
									class="text-book-bg/60"
								/>
								<input
									type="range"
									min="0"
									max="100"
									step="1"
									value={volumePct}
									class="spotify-range h-2 w-full cursor-pointer appearance-none rounded-full"
									style="background: linear-gradient(to right, #1ED760 {volumePct}%, rgba(255,255,255,.38) {volumePct}%)"
									oninput={(e) =>
										void spotify.setVolume(
											Number((e.currentTarget as HTMLInputElement).value) / 100
										)}
									aria-label="Volume"
									aria-valuetext="{volumePct}%"
								/>
								<span class="min-w-8 text-right font-ui text-[10px] text-book-bg/75 tabular-nums"
									>{volumePct}%</span
								>
							</div>
							{#if spotify.needsPremium}
								<p class="mt-2 font-ui text-[11px] text-[#FFD6A8]">
									In-app playback needs a Spotify Premium account.
								</p>
							{/if}
						</div>

						<div class="mt-4">
							<label class="block">
								<span class="mb-1.5 block font-ui text-xs font-semibold text-book-accent"
									>Search Spotify</span
								>
								<div class="relative">
									<span
										class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-book-bg/45"
									>
										<CommunityIcon name="search" size={15} />
									</span>
									<input
										type="text"
										value={query}
										placeholder="Search songs, artists, albums…"
										class="h-11 w-full rounded-xl border border-cover-edge bg-desk pr-3 pl-9 font-ui text-sm text-book-bg placeholder:text-book-bg/40 focus:border-book-accent/60 focus:outline-none"
										oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
									/>
									{#if spotify.searching}
										<span class="absolute top-1/2 right-3 -translate-y-1/2 text-book-bg/50">
											<CommunityIcon name="refresh" size={14} class="animate-spin" />
										</span>
									{/if}
								</div>
							</label>

							{#if spotify.results.length > 0}
								<div class="mt-3 grid gap-2">
									{#each spotify.results as result (result.uri)}
										<button
											type="button"
											class="group flex w-full items-center gap-3 rounded-xl border border-cover-edge/70 bg-cover/15 p-2 text-left transition-all hover:border-book-accent/40 hover:bg-cover/30"
											onclick={() => playResult(result)}
										>
											<div class="relative size-11 shrink-0 overflow-hidden rounded-lg bg-cover/40">
												{#if result.image}
													<img
														src={result.image}
														alt=""
														class="h-full w-full object-cover"
														loading="lazy"
													/>
												{:else}
													<div
														class="flex h-full w-full items-center justify-center text-book-bg/40"
													>
														<CommunityIcon name="music" size={16} />
													</div>
												{/if}
												<span
													class="absolute inset-0 flex items-center justify-center bg-desk/35 opacity-0 transition-opacity group-hover:opacity-100"
												>
													<span
														class="flex size-7 items-center justify-center rounded-full bg-cta text-cta-text shadow"
													>
														<CommunityIcon name="play" size={13} />
													</span>
												</span>
											</div>
											<div class="min-w-0 flex-1">
												<p class="truncate font-ui text-sm font-semibold text-book-bg">
													{result.name}
												</p>
												<p class="truncate font-ui text-[11px] text-book-bg/65">{result.artists}</p>
											</div>
											<span class="shrink-0 font-ui text-[10px] text-book-bg/45 tabular-nums"
												>{spotify.formatTime(result.duration_ms || 0)}</span
											>
										</button>
									{/each}
								</div>
							{:else if query.trim() && !spotify.searching}
								<p class="mt-3 font-ui text-xs text-book-bg/55">No tracks found for "{query}".</p>
							{:else if !spotify.track}
								<p class="mt-3 font-ui text-xs text-book-bg/55">
									Search for a song to start listening while you write.
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if !spotify.panelOpen && (spotify.connected || spotify.track)}
		<div
			class="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+82px)] left-3 z-[73] mx-auto max-w-[520px] min-[900px]:right-5 min-[900px]:bottom-[calc(env(safe-area-inset-bottom)+20px)] min-[900px]:left-auto min-[900px]:w-[380px]"
			transition:fly={{ y: 18, duration: 220, easing: backOut }}
		>
			<div
				class="overflow-hidden rounded-2xl border border-cover-edge bg-desk-2/96 text-book-bg shadow-[0_18px_50px_rgba(0,0,0,.5)] backdrop-blur-xl"
			>
				<div
					class="spotify-theme-glow pointer-events-none absolute inset-0 opacity-60"
					aria-hidden="true"
				></div>
				<div
					class="relative flex items-center gap-2 p-2 pr-1.5 min-[480px]:gap-2.5 min-[480px]:p-2.5 min-[480px]:pr-2"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-0.5 text-left hover:bg-cover/20 min-[480px]:gap-2.5 min-[480px]:p-1"
						onclick={() => spotify.openPanel()}
						aria-label="Open Spotify player"
					>
						<div
							class="relative size-9 shrink-0 overflow-hidden rounded-lg border border-cover-edge/70 bg-cover/40 min-[480px]:size-11 min-[480px]:rounded-xl"
						>
							{#if spotify.track?.image}
								<img src={spotify.track.image} alt="" class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-[#1ED760]">
									<CommunityIcon name="spotify" size={18} />
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate font-ui text-[13px] leading-tight font-bold">
								{spotify.track?.name || (spotify.connected ? 'Spotify connected' : 'VidJo Player')}
							</p>
							<p class="truncate font-ui text-[11px] leading-tight text-book-bg/65">
								{spotify.track?.artists ||
									(spotify.connected ? 'Open to search and play music' : '')}
							</p>
						</div>
					</button>
					<div class="flex items-center gap-1">
						{#if spotify.connected}
							<button
								type="button"
								class="flex size-8 items-center justify-center rounded-full bg-cta text-cta-text shadow-[0_6px_16px_var(--color-cta-shadow)] hover:bg-cta-hover disabled:opacity-40 min-[480px]:size-9"
								onclick={() => void spotify.togglePlay()}
								disabled={!spotify.canControl && !spotify.track}
								aria-label={spotify.playing ? 'Pause' : 'Play'}
							>
								<CommunityIcon name={spotify.playing ? 'pause' : 'play'} size={15} />
							</button>
						{:else}
							<button
								type="button"
								class="rounded-full bg-[#1DB954] px-3 py-2 font-ui text-[11px] font-bold text-[#062012]"
								onclick={() => void spotify.connect()}
							>
								Connect
							</button>
						{/if}
						<button
							type="button"
							class="flex size-8 items-center justify-center rounded-full border border-cover-edge bg-cover/25 text-book-bg/75 hover:bg-cover/45 hover:text-book-bg min-[480px]:size-9"
							onclick={() => spotify.openPanel()}
							aria-label="Expand player"
						>
							<CommunityIcon name="chevron-up" size={16} />
						</button>
					</div>
				</div>
				{#if spotify.track}
					<div class="h-1 w-full bg-cover-edge/60">
						<div
							class="h-full bg-[linear-gradient(90deg,var(--color-book-accent),#1DB954)]"
							style="width: {progressPct}%"
						></div>
					</div>
				{/if}
			</div>
		</div>
	{:else if !spotify.panelOpen && !spotify.connected}
		<!-- no floating chrome when disconnected and closed -->
	{/if}
{/if}

{#if showConnectButton}
	<button
		type="button"
		class="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+82px)] z-[73] mx-auto flex max-w-[520px] items-center gap-2 rounded-full border border-[#1ED760]/40 bg-desk-2/96 px-3 py-2 font-ui text-xs font-bold text-book-bg shadow-[0_18px_50px_rgba(0,0,0,.5)] backdrop-blur-xl transition-transform hover:scale-[1.02] min-[480px]:px-4 min-[480px]:py-2.5 min-[900px]:right-5 min-[900px]:bottom-[calc(env(safe-area-inset-bottom)+20px)] min-[900px]:mx-0"
		onclick={() => void spotify.connect()}
		aria-label="Connect Spotify"
	>
		<CommunityIcon name="spotify" size={16} class="text-[#1ED760]" />
		Connect Spotify
	</button>
{/if}

<style>
	.spotify-theme-glow {
		background:
			radial-gradient(
				120% 90% at 0% 0%,
				color-mix(in srgb, var(--color-book-accent) 20%, transparent) 0%,
				transparent 55%
			),
			radial-gradient(120% 90% at 100% 100%, rgba(29, 185, 84, 0.16) 0%, transparent 55%);
	}
	.spotify-range::-webkit-slider-thumb,
	.spotify-seek::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: var(--color-cta);
		border: 2px solid var(--color-book-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.spotify-range:focus-visible {
		outline: 2px solid white;
		outline-offset: 3px;
	}

	.spotify-range::-webkit-slider-thumb,
	.spotify-range::-moz-range-thumb {
		border-color: white;
		transition: transform 120ms ease;
	}

	.spotify-range:hover::-webkit-slider-thumb,
	.spotify-range:focus-visible::-webkit-slider-thumb,
	.spotify-range:hover::-moz-range-thumb,
	.spotify-range:focus-visible::-moz-range-thumb {
		transform: scale(1.12);
	}
	.spotify-range::-moz-range-thumb,
	.spotify-seek::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: var(--color-cta);
		border: 2px solid var(--color-book-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}
</style>
