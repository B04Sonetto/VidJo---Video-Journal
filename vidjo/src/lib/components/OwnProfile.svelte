<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { community } from '#lib/state/community.svelte';
	import { nav, type ProfileTab } from '#lib/state/navigation.svelte';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { censor } from '#lib/censor';
	import { normalizeImageUrl, optimizedBannerUrl } from '#lib/avatar';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	let { onClose }: { onClose: () => void } = $props();

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const hasContent = (entry: {
		saved?: boolean;
		title?: string;
		mind?: string;
		videoPath?: string;
	}) => Boolean(entry.saved || entry.title || entry.mind || entry.videoPath);

	const totalPages = $derived(Object.values(journal.entries).filter(hasContent).length);

	const streak = $derived(journal.streak.current);
	const bestStreak = $derived(journal.streak.longest);

	type Badge = { id: string; label: string; icon: string; tone: 'lav' | 'gold' | 'green' };

	const badges = $derived.by<Badge[]>(() => {
		const earned: Badge[] = [];
		if (totalPages >= 1)
			earned.push({ id: 'first', label: 'First Page', icon: 'sparkles', tone: 'lav' });
		if (totalPages >= 5) earned.push({ id: 'five', label: 'Scribbler', icon: 'book', tone: 'lav' });
		if (totalPages >= 10)
			earned.push({ id: 'ten', label: 'Storyteller', icon: 'star', tone: 'gold' });
		if (streak >= 3)
			earned.push({ id: 'streak3', label: '3-Day Streak', icon: 'flame', tone: 'gold' });
		if (streak >= 7)
			earned.push({ id: 'streak7', label: 'Week Streak', icon: 'flame', tone: 'gold' });
		if (streak >= 30)
			earned.push({ id: 'streak30', label: 'Month of Pages', icon: 'flame', tone: 'gold' });
		if (streak >= 100)
			earned.push({ id: 'streak100', label: '100-Day Streak', icon: 'flame', tone: 'gold' });
		if (friends.friendCount >= 1)
			earned.push({ id: 'friend', label: 'Friendly', icon: 'users', tone: 'green' });
		if (friends.friendCount >= 3)
			earned.push({ id: 'circle', label: 'Social Circle', icon: 'users', tone: 'green' });
		if (community.joinedCommunities.length >= 1) {
			earned.push({ id: 'community', label: 'Community Member', icon: 'globe', tone: 'lav' });
		}
		return earned;
	});

	const sharedPosts = $derived(
		Object.entries(journal.entries)
			.filter(
				([, entry]) =>
					entry.privacy !== 'private' &&
					(entry.title || entry.mind || entry.refl || entry.videoPath)
			)
			.map(([date, entry]) => ({
				date,
				title: entry.title || 'Untitled page',
				mood: entry.mood,
				hasVideo: Boolean(entry.videoPath),
				label: entry.communitySlug
					? community.tagFor(entry.communitySlug)
					: entry.privacy === 'friends'
						? 'Friends'
						: 'Shared'
			}))
			.sort((a, b) => b.date.localeCompare(a.date))
	);

	const bannerOriginal = $derived(normalizeImageUrl(profile.bannerUrl));
	const bannerOptimized = $derived(optimizedBannerUrl(bannerOriginal));
	let bannerUseOriginal = $state(false);
	let bannerFailed = $state(false);
	const bannerSrc = $derived(bannerUseOriginal ? bannerOriginal : bannerOptimized);

	$effect(() => {
		void bannerOriginal;
		bannerFailed = false;
		bannerUseOriginal = false;
	});

	function handleBannerError() {
		if (!bannerUseOriginal && bannerOriginal && bannerOptimized !== bannerOriginal) {
			bannerUseOriginal = true;
			return;
		}
		bannerFailed = true;
	}

	$effect(() => {
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});

	function go(tab: ProfileTab) {
		onClose();
		nav.openProfile(tab);
	}

	function copyCode() {
		const code = profile.friendCode;
		if (!code) return;
		void navigator.clipboard?.writeText(code);
		copied = true;
		journal.toast(`Friend code ${code} copied!`);
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2400);
	}

	function toneClasses(tone: Badge['tone']) {
		if (tone === 'gold') return 'border-book-accent/40 bg-book-accent/15 text-book-accent';
		if (tone === 'green') return 'border-[#3F7A4F]/40 bg-[#3F7A4F]/15 text-[#8BE2A4]';
		return 'border-cover bg-cover/25 text-book-bg/75';
	}

	function formatDate(date: string) {
		const parsed = new Date(`${date}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) return date;
		return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 min-[720px]:p-5"
	role="dialog"
	aria-modal="true"
	aria-labelledby="profile-title"
>
	<button
		type="button"
		class="fixed inset-0 h-full w-full cursor-default"
		onclick={onClose}
		aria-label="Close profile"
	></button>

	<div
		class="relative z-10 flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[32px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_28px_70px_rgba(0,0,0,.6)]"
	>
		<div class="profile-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			<!-- Banner -->
			<div class="relative h-36 shrink-0 min-[720px]:h-40">
				{#if bannerSrc && !bannerFailed}
					<img
						src={bannerSrc}
						alt=""
						class="absolute inset-0 h-full w-full object-cover"
						decoding="async"
						referrerpolicy="no-referrer"
						onerror={handleBannerError}
					/>
				{:else}
					<div
						class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-cover)_0%,var(--color-cover-edge)_60%,var(--color-desk)_100%)]"
					></div>
				{/if}
				<div
					class="absolute inset-0 [background-image:radial-gradient(circle_at_20%_30%,rgba(212,162,76,.4)_0%,transparent_40%),radial-gradient(circle_at_80%_20%,rgba(201,184,232,.3)_0%,transparent_35%)] opacity-40"
				></div>
				<div
					class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-desk-2/80 to-transparent"
					aria-hidden="true"
				></div>

				<button
					type="button"
					class="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/70 hover:text-white"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>

				<div class="absolute -bottom-14 left-1/2 -translate-x-1/2">
					<Avatar
						src={profile.avatarUrl}
						name={profile.displayName}
						className="size-28"
						textClass="text-5xl"
						ring="border-4 border-book-accent/60 shadow-[0_18px_36px_rgba(0,0,0,.5)]"
					/>
				</div>
			</div>

			<div class="px-5 pt-[4.5rem] pb-6 text-center min-[720px]:px-8">
				<h2
					id="profile-title"
					class="line-clamp-2 font-display text-3xl font-bold [overflow-wrap:anywhere] min-[720px]:text-4xl"
				>
					{profile.nickname}
				</h2>

				<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
					<span
						class="max-w-full truncate rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg/80"
					>
						@{profile.username}
					</span>
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-book-accent/40 bg-book-accent/15 px-3 py-1 font-ui text-xs font-semibold text-book-accent"
					>
						<CommunityIcon name="user" size={12} />
						This is you
					</span>
				</div>

				<p class="mt-1.5 font-ui text-xs text-book-bg/65">
					{#if auth.email}
						<span class="[overflow-wrap:anywhere]">{auth.email}</span> ·
					{/if}
					Member since {profile.memberSince}
				</p>

				{#if profile.bio}
					<p
						class="mx-auto mt-4 max-w-[420px] font-hand text-xl leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap text-book-bg/90"
					>
						“{profile.bio}”
					</p>
				{:else}
					<p class="mx-auto mt-4 max-w-[420px] font-hand text-lg text-book-bg/60">
						No bio yet. Add a few words so friends know what you're about.
					</p>
				{/if}

				<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
					<span
						class="rounded-full bg-cover/35 px-3 py-1 font-mono text-xs font-bold tracking-wider text-book-accent tabular-nums select-all"
					>
						{profile.friendCode}
					</span>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-full bg-cover/35 px-3 py-1 font-ui text-xs font-semibold text-book-bg transition-colors hover:bg-cover/50"
						onclick={copyCode}
					>
						<CommunityIcon name={copied ? 'check' : 'copy'} size={13} />
						{copied ? 'Copied' : 'Copy friend code'}
					</button>
				</div>

				<!-- Actions -->
				<div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
					<Button icon="pen" onclick={() => go('edit')}>Edit profile</Button>
					<Button variant="outline" icon="user" onclick={() => go('overview')}>Full profile</Button>
					<Button variant="ghost" icon="settings" onclick={() => go('settings')}>Settings</Button>
				</div>

				<!-- Stats -->
				<div class="mt-6 grid grid-cols-2 gap-3 min-[480px]:grid-cols-4">
					<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3.5">
						<p class="font-display text-2xl font-bold tabular-nums">{totalPages}</p>
						<p class="font-ui text-[11px] text-book-bg/65">Pages</p>
					</div>
					<div class="rounded-2xl border border-book-accent/40 bg-book-accent/10 p-3.5">
						<p
							class="flex items-center justify-center gap-1.5 font-display text-2xl font-bold text-book-accent tabular-nums"
						>
							<CommunityIcon name="flame" size={18} />
							{streak}
						</p>
						<p class="font-ui text-[11px] text-book-bg/65">
							Day streak{bestStreak > streak ? ` · best ${bestStreak}` : ''}
						</p>
					</div>
					<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3.5">
						<p class="font-display text-2xl font-bold text-[#8BE2A4] tabular-nums">
							{friends.friendCount}
						</p>
						<p class="font-ui text-[11px] text-book-bg/65">Friends</p>
					</div>
					<div class="rounded-2xl border border-cover-edge bg-cover/15 p-3.5">
						<p class="font-display text-2xl font-bold text-book-bg/80 tabular-nums">
							{badges.length}
						</p>
						<p class="font-ui text-[11px] text-book-bg/65">Badges</p>
					</div>
				</div>

				<!-- Badges -->
				<div class="mt-5 text-left">
					<h3 class="font-display text-lg font-bold">Achievements</h3>
					{#if badges.length === 0}
						<p class="mt-2 font-ui text-xs leading-relaxed text-book-bg/65">
							Write a page or add a friend to earn your first badge.
						</p>
					{:else}
						<div class="mt-2.5 flex flex-wrap gap-2">
							{#each badges as badge (badge.id)}
								<span
									class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-ui text-xs font-semibold {toneClasses(
										badge.tone
									)}"
								>
									<CommunityIcon name={badge.icon} size={13} />
									{badge.label}
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Shared pages -->
				<div class="mt-6 text-left">
					<div class="flex items-center justify-between gap-2">
						<h3 class="font-display text-lg font-bold">Pages you shared</h3>
						{#if sharedPosts.length > 0}
							<button
								type="button"
								class="inline-flex min-h-9 items-center font-ui text-xs font-semibold text-book-accent hover:underline"
								onclick={() => go('portfolio')}
							>
								Full portfolio
							</button>
						{/if}
					</div>

					{#if sharedPosts.length === 0}
						<div
							class="mt-3 rounded-2xl border border-cover-edge bg-cover/20 px-5 py-7 text-center"
						>
							<span
								class="mx-auto flex size-11 items-center justify-center rounded-full bg-cover/35 text-book-accent"
							>
								<CommunityIcon name="sparkles" size={20} />
							</span>
							<p class="mt-3 font-display text-base font-bold">Nothing shared yet</p>
							<p class="mt-1 font-ui text-xs leading-relaxed text-book-bg/65">
								Set a page to Friends or Community and it will show up here.
							</p>
						</div>
					{:else}
						<ul class="profile-scroll mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-1">
							{#each sharedPosts.slice(0, 8) as post (post.date)}
								{@const mood = post.mood && MOOD_BY_KEY[post.mood] ? MOOD_BY_KEY[post.mood] : null}
								<li>
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-2xl border border-cover-edge bg-cover/25 p-3 text-left transition-colors hover:border-book-accent/50 hover:bg-cover/40"
										onclick={() => {
											onClose();
											nav.jump(post.date);
										}}
									>
										{#if mood}
											<span
												class="flex size-11 shrink-0 items-center justify-center rounded-full"
												style="background: {mood.c}88"
												aria-hidden="true"
											>
												<span class="size-8 [&>svg]:size-full">
													<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
													{@html mood.svg}
												</span>
											</span>
										{:else}
											<span
												class="flex size-11 shrink-0 items-center justify-center rounded-full bg-cover/45 text-book-accent"
												aria-hidden="true"
											>
												<CommunityIcon name="book" size={18} />
											</span>
										{/if}
										<div class="min-w-0 flex-1">
											<p
												class="line-clamp-1 font-display text-base font-bold [overflow-wrap:anywhere]"
											>
												{censor(post.title)}
											</p>
											<p class="font-ui text-[11px] text-book-bg/65">
												{formatDate(post.date)} · {post.label}
											</p>
										</div>
										{#if post.hasVideo}
											<CommunityIcon name="video" size={15} class="shrink-0 text-book-accent" />
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Keep profile scrolling on its own layer so it doesn't repaint the
	   modal shell (or anything behind it) on every frame. */
	.profile-scroll {
		overscroll-behavior: contain;
		transform: translateZ(0);
	}
</style>
