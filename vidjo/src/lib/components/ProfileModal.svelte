<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { dateKey } from '#lib/dates';
	import { cleanDisplayName } from '#lib/avatar';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { USERNAME_MAX } from '#lib/username';

	const themes = [
		{ id: 'classic', label: 'Classic Scrapbook', swatch: '#51397A' },
		{ id: 'sunset', label: 'Sunset Warmth', swatch: '#B85C43' },
		{ id: 'midnight', label: 'Midnight Study', swatch: '#1F3557' },
		{ id: 'evergreen', label: 'Evergreen', swatch: '#3E6B52' },
		{ id: 'rosewood', label: 'Rosewood', swatch: '#A8435C' },
		{ id: 'harbor', label: 'Harbor', swatch: '#2F7C74' }
	] as const;

	let { open, onClose, userId }: { open: boolean; onClose: () => void; userId?: string | null } =
		$props();

	let mode = $state<'view' | 'edit'>('view');
	let editUsername = $state('');
	let editDisplayName = $state('');
	let editBio = $state('');
	let editAvatar = $state<string | null>(null);

	let usernameStatus = $state<{ checking: boolean; available: boolean | null; error?: string }>({
		checking: false,
		available: null
	});

	let saveError = $state('');
	let checkTimer: ReturnType<typeof setTimeout> | null = null;
	let usernameCheckSeq = 0;
	let clearCacheConfirm = $state(false);

	const isViewingOther = $derived(Boolean(userId) && userId !== auth.ownerId);
	const viewedUser = $derived(isViewingOther ? profile.viewedProfile : (profile.profile ?? null));
	const isOwnProfile = $derived(!isViewingOther);

	$effect(() => {
		if (open && isViewingOther && userId) {
			void profile.loadViewedProfile(userId);
		} else if (!isViewingOther) {
			profile.viewedProfile = null;
			profile.viewedProfilePosts = [];
		}
	});

	const modalName = $derived(
		cleanDisplayName(isViewingOther ? viewedUser?.display_name : profile.displayName)
	);
	const modalUsername = $derived(isViewingOther ? viewedUser?.username : profile.username);
	const modalAvatar = $derived(isViewingOther ? viewedUser?.avatar_url : profile.avatarUrl);
	const modalFriendCode = $derived(isViewingOther ? viewedUser?.friend_code : profile.friendCode);
	const modalBio = $derived(isViewingOther ? viewedUser?.bio : profile.bio);

	// Presets are stored in `avatar_url` as emoji. The legacy names are kept so
	// profiles saved by older builds still highlight the right choice.
	const PRESET_AVATARS = [
		{ label: 'Sparkle', emoji: '✨', legacy: 'sparkles' },
		{ label: 'Artist', emoji: '🎨', legacy: 'spark' },
		{ label: 'Reader', emoji: '📚', legacy: 'book' },
		{ label: 'Music', emoji: '🎧', legacy: 'music' },
		{ label: 'Rocket', emoji: '🚀', legacy: 'rocket' },
		{ label: 'Cat', emoji: '🐱', legacy: 'cat' },
		{ label: 'Plant', emoji: '🌱', legacy: 'leaf' },
		{ label: 'Camera', emoji: '🎬', legacy: 'video' }
	];

	function isPresetSelected(preset: (typeof PRESET_AVATARS)[number]) {
		return editAvatar === preset.emoji || editAvatar === preset.legacy;
	}

	function startEdit() {
		editUsername = profile.username;
		editDisplayName = profile.displayName;
		editBio = profile.bio;
		editAvatar = profile.avatarUrl;
		saveError = '';
		usernameCheckSeq += 1;
		if (checkTimer) {
			clearTimeout(checkTimer);
			checkTimer = null;
		}
		usernameStatus = { checking: false, available: true };
		mode = 'edit';
	}

	function cancelEdit() {
		mode = 'view';
		saveError = '';
	}

	function onUsernameInput(val: string) {
		const clean = val.trim();
		editUsername = clean;
		usernameStatus = { checking: true, available: null };
		const seq = ++usernameCheckSeq;

		if (checkTimer) {
			clearTimeout(checkTimer);
			checkTimer = null;
		}

		if (!clean) {
			usernameStatus = { checking: false, available: null };
			return;
		}

		checkTimer = setTimeout(async () => {
			const result = await profile.checkUsernameAvailable(clean);
			// Ignore a stale response if the person kept typing.
			if (seq !== usernameCheckSeq) return;
			checkTimer = null;
			usernameStatus = {
				checking: false,
				available: result.available,
				error: result.error
			};
		}, 350);
	}

	async function save() {
		saveError = '';

		if (usernameStatus.checking) {
			saveError = 'Still checking that username — give it a second and try again.';
			return;
		}

		if (usernameStatus.available === false) {
			saveError = usernameStatus.error || 'Please choose an available username.';
			return;
		}

		const result = await profile.saveProfile({
			username: editUsername,
			display_name: editDisplayName,
			bio: editBio,
			avatar_url: editAvatar,
			banner_url: profile.bannerUrl
		});

		if (result.error) {
			saveError = result.error;
			return;
		}

		journal.toast('Profile updated successfully!');
		mode = 'view';
	}

	function clearDeviceCache() {
		journal.clearLocalCache();
		clearCacheConfirm = false;
		journal.toast('Local journal cache cleared from this device');
	}

	let totalPages = $derived(Object.keys(journal.entries).length);

	let streak = $state(0);
	let badges = $state<string[]>([]);

	function calculateStreak() {
		const dates = Object.keys(journal.entries).sort((a, b) => b.localeCompare(a));
		if (dates.length === 0) {
			streak = 0;
			return;
		}
		let count = 0;
		let current = new SvelteDate();
		for (let i = 0; i < 365; i++) {
			const key = dateKey(current);
			if (dates.includes(key) && journal.entries[key]?.saved) {
				count++;
				current.setDate(current.getDate() - 1);
			} else if (count > 0) {
				break;
			} else {
				current.setDate(current.getDate() - 1);
			}
		}
		streak = count;
	}

	function calculateBadges() {
		const earned: string[] = [];
		if (totalPages >= 1) earned.push('first-post');
		if (totalPages >= 5) earned.push('five-pages');
		if (totalPages >= 10) earned.push('ten-pages');
		if (streak >= 3) earned.push('three-day-streak');
		if (streak >= 7) earned.push('week-streak');
		if (friends.friendCount >= 1) earned.push('made-friend');
		if (friends.friendCount >= 3) earned.push('social-circle');
		badges = earned;
	}

	$effect(() => {
		if (open) {
			calculateStreak();
			calculateBadges();
		}
	});

	onMount(() => {
		calculateStreak();
		calculateBadges();
		return () => {
			if (checkTimer) clearTimeout(checkTimer);
			usernameCheckSeq += 1;
		};
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') onClose();
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="profile-title"
	>
		<!-- Backdrop click -->
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default"
			onclick={onClose}
			aria-label="Close profile modal"
		></button>

		<div
			class="relative z-10 flex max-h-[90vh] w-full max-w-[540px] flex-col overflow-hidden rounded-3xl border border-cover-edge note-scrap text-book-ink shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
		>
			<!-- Top banner with cute paper tape / ribbon -->
			<div
				class="relative flex items-center justify-between border-b border-line bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-6 py-5 text-book-bg"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex size-9 items-center justify-center rounded-xl bg-book-accent/20 text-book-accent"
					>
						<CommunityIcon name="user" size={18} />
					</div>
					<div>
						<h2 id="profile-title" class="font-display text-xl font-bold tracking-wide">
							{mode === 'view' ? 'Student Profile' : 'Edit Profile'}
						</h2>
						<p class="font-ui text-xs text-book-bg/65">
							{mode === 'view'
								? 'Visible to friends and the VidJo community'
								: 'Customize your identity and handle'}
						</p>
					</div>
				</div>

				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-book-bg/80 transition-colors hover:bg-white/20 hover:text-book-bg"
					onclick={onClose}
					aria-label="Close"
				>
					<CommunityIcon name="x" size={16} />
				</button>
			</div>

			<!-- Modal Body (Scrollable) -->
			<div class="flex-1 overflow-y-auto px-6 py-6">
				{#if mode === 'view'}
					<!-- VIEW MODE -->
					<div class="flex flex-col gap-6">
						<!-- Main Profile Header Card -->
						<div
							class="flex flex-col items-center text-center sm:flex-row sm:items-start sm:gap-5 sm:text-left"
						>
							<!-- Avatar -->
							<div class="shrink-0">
								<Avatar
									src={modalAvatar}
									name={modalName}
									className="size-24"
									textClass="text-4xl"
									ring="border-4 border-gold/60 shadow-lg"
								/>
							</div>

							<!-- Names & Handle -->
							<div class="mt-3 flex-1 sm:mt-0">
								<div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
									<h3 class="font-display text-2xl font-bold text-book-ink">
										{modalName}
									</h3>
									<span
										class="rounded-full bg-book-accent/15 px-2.5 py-0.5 font-ui text-xs font-semibold text-book-accent"
									>
										@{modalUsername}
									</span>
								</div>

								{#if isOwnProfile && auth.email}
									<p class="mt-0.5 font-ui text-xs text-book-ink/70">
										{auth.email}
									</p>
								{/if}

								<!-- Friend Code -->
								{#if isOwnProfile}
									<div class="mt-2 flex items-center justify-center gap-2 sm:justify-start">
										<span class="font-ui text-xs text-book-ink/70">Friend Code:</span>
										<code
											class="rounded-md bg-book-accent/15 px-2 py-0.5 font-mono text-xs font-bold text-book-accent select-all"
										>
											{modalFriendCode}
										</code>
										<button
											type="button"
											class="font-ui text-xs font-semibold text-book-accent hover:underline"
											onclick={() => {
												const code = modalFriendCode;
												if (!code) return;
												void navigator.clipboard?.writeText(code);
												journal.toast(`Friend Code ${code} copied!`);
											}}
										>
											Copy
										</button>
									</div>
								{/if}

								<!-- Bio -->
								<div class="mt-3 rounded-2xl border border-line bg-paper-deep/60 p-3 text-left">
									{#if modalBio}
										<p class="font-hand text-lg leading-relaxed text-book-ink">
											“{modalBio}”
										</p>
									{:else}
										<p class="font-ui text-xs leading-relaxed text-book-ink/70">
											{#if isOwnProfile}
												No bio yet. Click "Edit Profile" below to share a few words with your
												classmates and community!
											{:else}
												No bio set yet.
											{/if}
										</p>
									{/if}
								</div>
							</div>
						</div>

						{#if isOwnProfile}
							<!-- Quick Stats Strip -->
							<div class="grid grid-cols-4 gap-2 min-[480px]:gap-3">
								<div
									class="flex flex-col items-center rounded-2xl border border-line bg-paper-deep p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-book-accent">{totalPages}</span>
									<span class="font-ui text-[10px] text-book-ink/70 min-[480px]:text-[11px]"
										>Pages</span
									>
								</div>
								<div
									class="flex flex-col items-center rounded-2xl border border-book-accent/40 bg-book-accent/10 p-3 text-center"
								>
									<span
										class="flex items-center gap-1 font-display text-xl font-bold text-book-accent tabular-nums"
									>
										<CommunityIcon name="flame" size={16} />
										{streak}
									</span>
									<span class="font-ui text-[10px] text-book-ink/70 min-[480px]:text-[11px]"
										>Day streak</span
									>
								</div>
								<div
									class="flex flex-col items-center rounded-2xl border border-line bg-paper-deep p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-[#3F7A4F]"
										>{friends.friendCount}</span
									>
									<span class="font-ui text-[10px] text-book-ink/70 min-[480px]:text-[11px]"
										>Friends</span
									>
								</div>
								<div
									class="flex flex-col items-center rounded-2xl border border-line bg-paper-deep p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-book-ink">{badges.length}</span>
									<span class="font-ui text-[10px] text-book-ink/70 min-[480px]:text-[11px]"
										>Badges</span
									>
								</div>
							</div>

							<!-- Badges -->
							<div class="rounded-2xl border border-line bg-paper-deep p-4">
								<div class="flex items-center justify-between">
									<span class="font-ui text-xs font-semibold text-book-accent">Achievements</span>
									<span class="font-ui text-[11px] text-book-ink/70">{badges.length} earned</span>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									{#if badges.includes('first-post')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-deep px-3 py-1 font-ui text-xs font-semibold text-book-accent"
										>
											<CommunityIcon name="sparkles" size={13} />
											First Page
										</span>
									{/if}
									{#if badges.includes('five-pages')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-deep px-3 py-1 font-ui text-xs font-semibold text-book-accent"
										>
											<CommunityIcon name="book" size={13} />
											Scribbler
										</span>
									{/if}
									{#if badges.includes('ten-pages')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-deep px-3 py-1 font-ui text-xs font-semibold text-book-accent"
										>
											<CommunityIcon name="book" size={13} />
											Storyteller
										</span>
									{/if}
									{#if badges.includes('three-day-streak')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-book-accent/40 bg-book-accent/10 px-3 py-1 font-ui text-xs font-semibold note-accent"
										>
											<CommunityIcon name="flame" size={13} />
											3-day streak
										</span>
									{/if}
									{#if badges.includes('week-streak')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-book-accent/40 bg-book-accent/10 px-3 py-1 font-ui text-xs font-semibold note-accent"
										>
											<CommunityIcon name="flame" size={13} />
											Week streak
										</span>
									{/if}
									{#if badges.includes('made-friend')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#C9E6D1] bg-[#EDF6EF] px-3 py-1 font-ui text-xs font-semibold text-[#2F6B45]"
										>
											<CommunityIcon name="users" size={13} />
											Friendly
										</span>
									{/if}
									{#if badges.includes('social-circle')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#C9E6D1] bg-[#EDF6EF] px-3 py-1 font-ui text-xs font-semibold text-[#2F6B45]"
										>
											<CommunityIcon name="users" size={13} />
											Social Circle
										</span>
									{/if}
									{#if badges.length === 0}
										<p class="font-ui text-xs text-book-ink/70">
											Start writing pages and making friends to earn badges!
										</p>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Friends & Community Preview Card -->
						<div class="rounded-2xl border border-line bg-paper-deep p-4">
							<div class="flex items-center justify-between">
								<span class="font-ui text-xs font-semibold text-book-accent">Community preview</span
								>
								<span
									class="rounded-md bg-book-accent/20 px-2 py-0.5 font-ui text-[11px] font-medium note-accent"
								>
									Public Profile
								</span>
							</div>
							<p class="mt-1 font-ui text-xs text-book-ink/70">
								Here is how your profile card will appear to friends and in the student community
								directory:
							</p>

							<!-- Preview mockup card -->
							<div
								class="mt-3 flex items-center gap-3 rounded-xl border border-line bg-book-bg p-3 shadow-sm"
							>
								<Avatar
									src={modalAvatar}
									name={modalName}
									className="size-11"
									textClass="text-lg"
									ring="ring-2 ring-gold/40"
								/>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<b class="truncate font-display text-sm font-bold text-book-ink">{modalName}</b>
										<span class="text-xs text-book-ink/70">@{modalUsername}</span>
									</div>
									<p class="truncate font-hand text-sm text-book-ink/70">
										{modalBio || 'Small videos, big thoughts.'}
									</p>
								</div>
								<span
									class="rounded-full bg-book-accent/15 px-2.5 py-1 font-ui text-xs font-medium text-book-accent"
								>
									Friend
								</span>
							</div>
						</div>

						{#if isOwnProfile}
							<!-- Device & Shared Browser Security notice -->
							<div
								class="rounded-2xl border border-line bg-paper-deep p-4 text-xs text-book-ink/70"
							>
								<div class="flex items-start gap-2.5">
									<CommunityIcon name="shield" size={16} class="mt-0.5 shrink-0 text-book-accent" />
									<div class="flex-1">
										<b class="font-ui text-book-ink">Shared computer security</b>
										<p class="mt-0.5 font-ui leading-normal">
											On shared computers, you can clear cached journal pages from this browser so
											other visitors cannot view them.
										</p>
										{#if clearCacheConfirm}
											<div class="mt-2.5 flex items-center gap-2">
												<button
													type="button"
													class="rounded-lg bg-red-600 px-3 py-1 font-ui text-xs font-semibold text-book-bg hover:bg-red-700"
													onclick={clearDeviceCache}
												>
													Confirm: Clear local cache now
												</button>
												<button
													type="button"
													class="rounded-lg border border-line bg-white px-2.5 py-1 font-ui text-xs hover:bg-gray-100"
													onclick={() => (clearCacheConfirm = false)}
												>
													Cancel
												</button>
											</div>
										{:else}
											<button
												type="button"
												class="mt-2 text-xs font-medium text-book-accent underline hover:text-book-ink"
												onclick={() => (clearCacheConfirm = true)}
											>
												Clear local journal pages from this browser
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						{#if isOwnProfile}
							<!-- Journal theme -->
							<div class="rounded-2xl border border-line bg-paper-deep/60 p-4">
								<div class="mb-3 flex items-center justify-between">
									<span class="font-ui text-xs font-semibold text-book-accent">Journal theme</span>
									<span class="font-ui text-[11px] text-book-ink/70">
										{profile.theme.charAt(0).toUpperCase() + profile.theme.slice(1)}
									</span>
								</div>
								<div class="flex flex-wrap gap-2">
									{#each themes as theme (theme.id)}
										<button
											type="button"
											class="flex items-center justify-center rounded-xl border p-3 transition-all {profile.theme ===
											theme.id
												? 'border-book-accent bg-book-accent/20 ring-2 ring-book-accent'
												: 'border-line text-book-ink/70 hover:border-book-accent/40'}"
											onclick={() => {
												profile.theme = theme.id;
												void profile.savePreferences();
											}}
										>
											<span
												class="size-6 rounded-full"
												style="background: {theme.swatch}"
												aria-hidden="true"
											></span>
											<span class="font-ui text-[11px] font-semibold text-book-ink">
												{theme.label}
											</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<!-- EDIT MODE -->
					<div class="flex flex-col gap-5">
						{#if saveError}
							<div
								class="rounded-xl border border-red-300 bg-red-50 p-3 font-ui text-xs font-medium text-red-700"
							>
								{saveError}
							</div>
						{/if}

						<!-- Avatar selection -->
						<div>
							<span class="block font-ui text-xs font-semibold text-book-ink/70">
								Choose your avatar
							</span>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								{#each PRESET_AVATARS as preset (preset.label)}
									<button
										type="button"
										class="flex size-11 items-center justify-center rounded-full text-xl shadow-sm transition-transform hover:scale-110 active:scale-95 {isPresetSelected(
											preset
										)
											? 'scale-105 ring-3 ring-accent'
											: 'border border-line'}"
										onclick={() => (editAvatar = preset.emoji)}
										title={preset.label}
										aria-label={`Use ${preset.label} avatar`}
										aria-pressed={isPresetSelected(preset)}
									>
										<span aria-hidden="true">{preset.emoji}</span>
									</button>
								{/each}
								<button
									type="button"
									class="rounded-full border border-line px-3 py-1 font-ui text-xs text-book-ink/70 hover:bg-paper-deep"
									onclick={() => (editAvatar = null)}
								>
									Initials only
								</button>
							</div>
						</div>

						<!-- Display Name -->
						<div>
							<label
								for="edit-display-name"
								class="block font-ui text-xs font-semibold text-book-ink/70"
							>
								Display name
							</label>
							<input
								id="edit-display-name"
								type="text"
								bind:value={editDisplayName}
								placeholder="e.g. Maya Lin"
								maxlength="32"
								class="mt-1.5 w-full rounded-xl border border-line bg-book-bg px-3.5 py-2.5 font-ui text-sm text-book-ink shadow-inner transition outline-none focus:border-book-accent focus:ring-2 focus:ring-book-accent/30"
							/>
							<span class="mt-1 block font-ui text-[11px] text-book-ink/70">
								How friends will know you across VidJo.
							</span>
						</div>

						<!-- Unique Username -->
						<div>
							<label
								for="edit-username"
								class="flex items-center justify-between font-ui text-xs font-semibold text-book-ink/70"
							>
								<span>Unique username</span>
								{#if usernameStatus.checking}
									<span class="text-book-accent">Checking availability…</span>
								{:else if usernameStatus.available === true}
									<span class="flex items-center gap-1 text-[#3F7A4F]">
										<CommunityIcon name="check" size={11} />
										Available
									</span>
								{:else if usernameStatus.available === false}
									<span class="text-red-600">{usernameStatus.error || 'Taken'}</span>
								{/if}
							</label>
							<div class="relative mt-1.5">
								<span
									class="absolute inset-y-0 left-3.5 flex items-center font-ui text-sm text-book-ink/70"
								>
									@
								</span>
								<input
									id="edit-username"
									type="text"
									value={editUsername}
									oninput={(e) => onUsernameInput(e.currentTarget.value)}
									placeholder="username"
									maxlength={USERNAME_MAX}
									class="w-full rounded-xl border border-line bg-book-bg py-2.5 pr-3.5 pl-8 font-ui text-sm text-book-ink shadow-inner transition outline-none focus:border-book-accent focus:ring-2 focus:ring-book-accent/30"
								/>
							</div>
							<span class="mt-1 block font-ui text-[11px] text-book-ink/70">
								Letters, numbers, underscores, dots, or dashes (2–{USERNAME_MAX} characters). Must be
								globally unique.
							</span>
						</div>

						<!-- Bio -->
						<div>
							<div class="flex items-center justify-between">
								<label for="edit-bio" class="block font-ui text-xs font-semibold text-book-ink/70">
									Bio / About you
								</label>
								<span class="font-ui text-[11px] text-book-ink/70">
									{editBio.length}/200
								</span>
							</div>
							<textarea
								id="edit-bio"
								bind:value={editBio}
								rows="3"
								maxlength="200"
								placeholder="Share a short note about yourself, your hobbies, or what inspires your journal entries..."
								class="mt-1.5 w-full resize-none rounded-xl border border-line bg-book-bg px-3.5 py-2.5 font-hand text-base text-book-ink shadow-inner transition outline-none focus:border-book-accent focus:ring-2 focus:ring-book-accent/30"
							></textarea>
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="flex items-center justify-between border-t border-line bg-paper-deep px-6 py-4">
				{#if mode === 'view'}
					<Button variant="note" onclick={onClose}>Close</Button>
					{#if isOwnProfile}
						<Button icon="pen" onclick={startEdit}>Edit profile</Button>
					{/if}
				{:else}
					<Button variant="note" onclick={cancelEdit} disabled={profile.saving}>Cancel</Button>
					<Button
						icon="check"
						loading={profile.saving}
						disabled={usernameStatus.available === false}
						onclick={save}
					>
						Save changes
					</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
