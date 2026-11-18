<script lang="ts">
	import { profile } from '#lib/state/profile.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

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
		happy: 'Happy',
		calm: 'Calm',
		tired: 'Tired',
		sad: 'Sad',
		stressed: 'Stressed',
		angry: 'Fired Up',
		excited: 'Excited'
	};
</script>

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === 'Escape') onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
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
			class="relative z-10 flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-hidden rounded-3xl border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
		>
			<!-- Header -->
			<div
				class="relative border-b border-line bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-6 pt-5 pb-4 text-book-bg"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<span class="text-xl">
							<CommunityIcon name="sparkles" size={20} />
						</span>
						<h2 id="social-modal-title" class="font-display text-xl font-bold tracking-wide">
							VidJo Social Hub
						</h2>
					</div>
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
						onclick={onClose}
						aria-label="Close"
					>
						<CommunityIcon name="x" size={16} />
					</button>
				</div>

				<!-- Tabs switcher -->
				<div class="mt-4 flex gap-2">
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {currentTab ===
						'friends'
							? 'bg-cta text-cta-text shadow'
							: 'bg-cover/35 text-book-bg/70 hover:bg-cover/50'}"
						onclick={() => (currentTab = 'friends')}
					>
						<CommunityIcon name="users" size={16} />
						Friends
						<span class="rounded-full bg-cover/50 px-2 py-0.5 text-[11px]">Next up!</span>
					</button>
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl px-4 py-2 font-ui text-sm font-semibold transition-all {currentTab ===
						'community'
							? 'bg-cta text-cta-text shadow'
							: 'bg-cover/35 text-book-bg/70 hover:bg-cover/50'}"
						onclick={() => (currentTab = 'community')}
					>
						<CommunityIcon name="globe" size={16} />
						Campus Community
						<span class="rounded-full bg-cover/50 px-2 py-0.5 text-[11px]">Sneak peek</span>
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="modal-scroll flex-1 overflow-y-auto px-6 py-5">
				{#if currentTab === 'friends'}
					<!-- FRIENDS VIEW -->
					<div class="flex flex-col gap-5">
						<!-- Your Handle banner -->
						<div
							class="flex items-center justify-between rounded-2xl border border-line bg-paper-deep p-3.5"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-10 items-center justify-center rounded-full bg-book-accent/15 font-display text-base font-bold text-book-accent"
								>
									{profile.initials}
								</div>
								<div>
									<div class="font-ui text-xs text-book-ink/70">Your Shareable Handle</div>
									<div class="font-display font-bold text-book-ink">@{profile.username}</div>
								</div>
							</div>
							<span
								class="rounded-full bg-book-accent/20 px-3 py-1 font-ui text-xs font-semibold note-accent"
							>
								Ready for Friends
							</span>
						</div>

						<!-- Search bar mockup -->
						<div class="relative">
							<span class="absolute inset-y-0 left-3.5 flex items-center text-book-ink/70">
								<CommunityIcon name="search" size={14} />
							</span>
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Find classmates by @username or name…"
								class="w-full rounded-xl border border-line bg-book-bg py-2.5 pr-4 pl-10 font-ui text-sm text-book-ink transition outline-none focus:border-book-accent focus:ring-2 focus:ring-book-accent/25"
							/>
						</div>

						<div>
							<div class="flex items-center justify-between">
								<span class="font-ui text-xs font-semibold text-book-ink/70">
									Friend entries preview
								</span>
								<span class="font-ui text-xs text-book-accent">
									Sharing: "Friends + Community"
								</span>
							</div>

							<div class="mt-3 flex flex-col gap-3">
								{#each SAMPLE_FRIENDS as friend (friend.username)}
									<div
										class="flex items-center justify-between rounded-2xl border border-line bg-paper-deep/70 p-4 transition-all hover:border-book-accent/40 hover:shadow-sm"
									>
										<div class="flex items-center gap-3.5">
											<div
												class="flex size-12 items-center justify-center rounded-2xl bg-book-bg text-2xl shadow-sm"
											>
												{friend.avatar}
											</div>
											<div>
												<div class="flex items-center gap-2">
													<b class="font-display text-sm font-bold text-book-ink">{friend.name}</b>
													<span class="font-ui text-xs text-book-ink/70">@{friend.username}</span>
												</div>
												<p class="font-ui text-xs text-book-ink/70">{friend.bio}</p>
												<div class="mt-1 flex items-center gap-2 text-[11px]">
													<span
														class="rounded-md bg-book-bg px-2 py-0.5 text-book-ink/70 shadow-inner"
													>
														{MOOD_EMOJIS[friend.latestMood] || friend.latestMood}
													</span>
													{#if friend.sharedVideo}
														<span class="flex items-center gap-1 font-medium text-book-accent">
															<CommunityIcon name="video" size={14} />
															Video shared
														</span>
													{/if}
													<span class="text-book-ink/70">• {friend.latestDate}</span>
												</div>
											</div>
										</div>

										<button
											type="button"
											class="rounded-xl border border-line bg-book-bg px-3 py-1.5 font-ui text-xs font-semibold text-book-accent shadow-sm hover:bg-book-accent/10"
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
						<div class="rounded-2xl border border-line bg-paper-deep p-4">
							<b class="font-display text-base font-bold text-book-ink">Campus Community Reel</b>
							<p class="mt-1 font-ui text-xs leading-relaxed text-book-ink/70">
								Turn on <span class="font-semibold text-book-accent">"Community"</span> to post a
								page to the campus reel, and
								<span class="font-semibold text-book-accent">"Friends"</span> at the same time to share
								it with your friends too.
							</p>
						</div>

						<div>
							<span class="font-ui text-xs font-semibold text-book-ink/70">
								Trending campus topics & prompts
							</span>
							<div class="mt-2.5 flex flex-col gap-3">
								{#each COMMUNITY_PROMPTS as topic (topic.tag)}
									<div
										class="rounded-2xl border border-line bg-paper-deep/70 p-4 transition-all hover:border-book-accent/40"
									>
										<div class="flex items-center justify-between">
											<span class="font-ui text-xs font-bold text-book-accent">{topic.tag}</span>
											<span
												class="rounded-full bg-book-bg px-2.5 py-0.5 font-ui text-[11px] text-book-ink/70"
											>
												{topic.entriesCount} student responses
											</span>
										</div>
										<p class="mt-2 font-hand text-lg text-book-ink">
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
			<div class="flex items-center justify-between border-t border-line bg-paper-deep px-6 py-4">
				<p class="flex items-center gap-1 font-ui text-xs text-book-ink/70">
					<CommunityIcon name="sparkles" size={12} />
					Friends and Community features are in active development!
				</p>
				<button
					type="button"
					class="rounded-xl bg-cta px-4 py-2 font-ui text-sm font-semibold text-cta-text shadow hover:bg-cta-hover"
					onclick={onClose}
				>
					Got it
				</button>
			</div>
		</div>
	</div>
{/if}
