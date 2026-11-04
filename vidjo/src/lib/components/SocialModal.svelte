<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';

	let {
		tab = 'friends',
		open = false,
		onClose
	}: {
		tab: 'friends' | 'community';
		open: boolean;
		onClose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let currentTab = $state<'friends' | 'community'>(tab);
	let searchQuery = $state('');

	const SAMPLE_FRIENDS = [
		{
			name: 'Samira Chen',
			username: 'samirac',
			avatar: '🎨',
			bio: 'Studying digital animation. Coffee addict ☕',
			latestMood: 'happy',
			latestDate: 'Today',
			sharedVideo: true,
			mutuals: 4
		},
		{
			name: 'Jordan Rivera',
			username: 'jordan_r',
			avatar: '🎧',
			bio: 'Beats, tracks, and library study sessions.',
			latestMood: 'calm',
			latestDate: 'Yesterday',
			sharedVideo: true,
			mutuals: 7
		},
		{
			name: 'Liam Vance',
			username: 'liamv',
			avatar: '🌱',
			bio: 'Plant dad & biology major. Finding calm.',
			latestMood: 'excited',
			latestDate: 'Oct 28',
			sharedVideo: false,
			mutuals: 2
		}
	];

	const COMMUNITY_PROMPTS = [
		{
			tag: '#MidtermSurvivals',
			entriesCount: 42,
			prompt: 'What was your small victory or favorite study break today?'
		},
		{
			tag: '#CampusSunset',
			entriesCount: 88,
			prompt: 'Capture the golden hour view from your favorite campus spot.'
		},
		{
			tag: '#CreativeFlow',
			entriesCount: 31,
			prompt: 'Show what project or idea kept you up past midnight this week.'
		}
	];

	const MOOD_EMOJIS: Record<string, string> = {
		happy: '😊 Happy',
		calm: '😌 Calm',
		tired: '😴 Tired',
		sad: '🥺 Sad',
		stressed: '🤯 Stressed',
		angry: '😤 Fired Up',
		excited: '✨ Excited'
	};
</script>

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === 'Escape') onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="social-modal-title"
	>
		<!-- Backdrop click -->
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close modal"
		></button>

		<div
			class="relative z-10 flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-hidden rounded-3xl border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
		>
			<!-- Header -->
			<div
				class="relative border-b border-line bg-[linear-gradient(135deg,#34214E,#231438)] px-6 pt-5 pb-4 text-white"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<span class="text-xl">✨</span>
						<h2 id="social-modal-title" class="font-display text-xl font-bold tracking-wide">
							VidJo Social Hub
						</h2>
					</div>
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
						onclick={onClose}
						aria-label="Close"
					>
						✕
					</button>
				</div>

				<!-- Tabs switcher -->
				<div class="mt-4 flex gap-2">
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {currentTab ===
						'friends'
							? 'bg-accent text-white shadow'
							: 'bg-white/10 text-[#C9B8E8] hover:bg-white/15'}"
						onclick={() => (currentTab = 'friends')}
					>
						<span>👥</span>
						Friends
						<span class="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">Next up!</span>
					</button>
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {currentTab ===
						'community'
							? 'bg-accent text-white shadow'
							: 'bg-white/10 text-[#C9B8E8] hover:bg-white/15'}"
						onclick={() => (currentTab = 'community')}
					>
						<span>🌍</span>
						Campus Community
						<span class="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">Sneak peek</span>
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto px-6 py-5">
				{#if currentTab === 'friends'}
					<!-- FRIENDS VIEW -->
					<div class="flex flex-col gap-5">
						<!-- Your Handle banner -->
						<div
							class="bg-paper-2 flex items-center justify-between rounded-2xl border border-lav/40 p-3.5"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-10 items-center justify-center rounded-full bg-lav/30 font-display text-base font-bold text-accent"
								>
									{profile.initials}
								</div>
								<div>
									<div class="font-ui text-xs text-ink-soft">Your Shareable Handle</div>
									<div class="font-display font-bold text-ink">@{profile.username}</div>
								</div>
							</div>
							<span
								class="rounded-full bg-gold/20 px-3 py-1 font-ui text-xs font-semibold text-[#7A5618]"
							>
								Ready for Friends
							</span>
						</div>

						<!-- Search bar mockup -->
						<div class="relative">
							<span class="absolute inset-y-0 left-3.5 flex items-center text-ink-soft">🔍</span>
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Find classmates by @username or name…"
								class="w-full rounded-xl border border-line bg-paper py-2.5 pr-4 pl-10 font-ui text-sm text-ink transition outline-none focus:border-accent focus:ring-2 focus:ring-lav/30"
							/>
						</div>

						<div>
							<div class="flex items-center justify-between">
								<span class="font-ui text-xs font-bold tracking-wider text-ink-soft uppercase">
									Friend Entries Preview
								</span>
								<span class="font-ui text-xs text-accent"> Sharing: "Friends + Community" </span>
							</div>

							<div class="mt-3 flex flex-col gap-3">
								{#each SAMPLE_FRIENDS as friend (friend.username)}
									<div
										class="flex items-center justify-between rounded-2xl border border-line bg-light/70 p-4 transition-all hover:border-lav/60 hover:shadow-sm"
									>
										<div class="flex items-center gap-3.5">
											<div
												class="flex size-12 items-center justify-center rounded-2xl bg-paper text-2xl shadow-sm"
											>
												{friend.avatar}
											</div>
											<div>
												<div class="flex items-center gap-2">
													<b class="font-display text-sm font-bold text-ink">{friend.name}</b>
													<span class="font-ui text-xs text-ink-soft">@{friend.username}</span>
												</div>
												<p class="font-ui text-xs text-ink-soft">{friend.bio}</p>
												<div class="mt-1 flex items-center gap-2 text-[11px]">
													<span class="rounded-md bg-paper px-2 py-0.5 text-ink-soft shadow-inner">
														{MOOD_EMOJIS[friend.latestMood] || friend.latestMood}
													</span>
													{#if friend.sharedVideo}
														<span class="flex items-center gap-1 font-medium text-accent">
															📹 Video shared
														</span>
													{/if}
													<span class="text-ink-soft">• {friend.latestDate}</span>
												</div>
											</div>
										</div>

										<button
											type="button"
											class="rounded-xl border border-line bg-paper px-3 py-1.5 font-ui text-xs font-semibold text-accent shadow-sm hover:bg-lav/20"
										>
											View Journal
										</button>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{:else}
					<!-- COMMUNITY VIEW -->
					<div class="flex flex-col gap-5">
						<div class="bg-paper-2 rounded-2xl border border-line p-4">
							<b class="font-display text-base font-bold text-ink">Campus Community Reel</b>
							<p class="mt-1 font-ui text-xs leading-relaxed text-ink-soft">
								Turn on <span class="font-semibold text-accent">"Community"</span> to post a page to
								the campus reel, and <span class="font-semibold text-accent">"Friends"</span> at the same
								time to share it with your friends too.
							</p>
						</div>

						<div>
							<span class="font-ui text-xs font-bold tracking-wider text-ink-soft uppercase">
								Trending Campus Topics & Prompts
							</span>
							<div class="mt-2.5 flex flex-col gap-3">
								{#each COMMUNITY_PROMPTS as topic (topic.tag)}
									<div
										class="rounded-2xl border border-line bg-light/70 p-4 transition-all hover:border-lav/60"
									>
										<div class="flex items-center justify-between">
											<span class="font-ui text-xs font-bold text-accent">{topic.tag}</span>
											<span
												class="rounded-full bg-paper px-2.5 py-0.5 font-ui text-[11px] text-ink-soft"
											>
												{topic.entriesCount} student responses
											</span>
										</div>
										<p class="mt-2 font-hand text-lg text-ink">
											“{topic.prompt}”
										</p>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="bg-paper-2 flex items-center justify-between border-t border-line px-6 py-4">
				<p class="font-ui text-xs text-ink-soft">
					✨ Friends and Community features are in active development!
				</p>
				<button
					type="button"
					class="rounded-xl bg-accent px-4 py-2 font-ui text-sm font-semibold text-white shadow hover:bg-[#624690]"
					onclick={onClose}
				>
					Got it
				</button>
			</div>
		</div>
	</div>
{/if}
