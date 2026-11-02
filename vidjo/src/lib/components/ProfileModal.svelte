<script lang="ts">
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { journal } from '#lib/state/journal.svelte';
	import { friends } from '#lib/state/friends.svelte';
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';

	const themes = [
		{ id: 'classic', label: 'Classic Scrapbook', swatch: '#51397A' },
		{ id: 'sunset', label: 'Sunset Warmth', swatch: '#B85C43' },
		{ id: 'midnight', label: 'Midnight Study', swatch: '#1F3557' }
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

	const modalName = $derived(isViewingOther ? viewedUser?.display_name : profile.displayName);
	const modalUsername = $derived(isViewingOther ? viewedUser?.username : profile.username);
	const modalAvatar = $derived(isViewingOther ? viewedUser?.avatar_url : profile.avatarUrl);
	const modalInitials = $derived(
		(isViewingOther ? viewedUser?.display_name : profile.displayName)?.trim()[0]?.toUpperCase() ||
			'V'
	);
	const modalFriendCode = $derived(isViewingOther ? viewedUser?.friend_code : profile.friendCode);
	const modalBio = $derived(isViewingOther ? viewedUser?.bio : profile.bio);

	const PRESET_AVATARS = [
		{ label: 'Sparkle', emoji: '✨', bg: 'from-amber-400 to-orange-500' },
		{ label: 'Artist', emoji: '🎨', bg: 'from-purple-500 to-indigo-600' },
		{ label: 'Reader', emoji: '📚', bg: 'from-emerald-400 to-teal-600' },
		{ label: 'Music', emoji: '🎧', bg: 'from-pink-500 to-rose-600' },
		{ label: 'Rocket', emoji: '🚀', bg: 'from-blue-500 to-cyan-600' },
		{ label: 'Cat', emoji: '🐱', bg: 'from-amber-500 to-yellow-600' },
		{ label: 'Plant', emoji: '🌱', bg: 'from-lime-500 to-green-600' },
		{ label: 'Camera', emoji: '🎬', bg: 'from-fuchsia-500 to-purple-700' }
	];

	function startEdit() {
		editUsername = profile.username;
		editDisplayName = profile.displayName;
		editBio = profile.bio;
		editAvatar = profile.avatarUrl;
		saveError = '';
		usernameStatus = { checking: false, available: true };
		mode = 'edit';
	}

	function cancelEdit() {
		mode = 'view';
		saveError = '';
	}

	function onUsernameInput(val: string) {
		editUsername = val.trim();
		usernameStatus = { checking: true, available: null };

		if (checkTimer) clearTimeout(checkTimer);
		checkTimer = setTimeout(async () => {
			if (!editUsername) {
				usernameStatus = { checking: false, available: null };
				return;
			}
			const result = await profile.checkUsernameAvailable(editUsername);
			usernameStatus = {
				checking: false,
				available: result.available,
				error: result.error
			};
		}, 350);
	}

	async function save() {
		saveError = '';

		if (usernameStatus.available === false) {
			saveError = usernameStatus.error || 'Please choose an available username.';
			return;
		}

		const result = await profile.saveProfile({
			username: editUsername,
			display_name: editDisplayName,
			bio: editBio,
			avatar_url: editAvatar,
			banner_url: null
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
			const key = current.toISOString().split('T')[0];
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
			class="relative z-10 flex max-h-[90vh] w-full max-w-[540px] flex-col overflow-hidden rounded-3xl border border-[#4E396E] bg-paper text-ink shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
		>
			<!-- Top banner with cute paper tape / ribbon -->
			<div
				class="relative flex items-center justify-between border-b border-line bg-[linear-gradient(135deg,#34214E,#231438)] px-6 py-5 text-white"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex size-9 items-center justify-center rounded-xl bg-lav/20 text-gold shadow-inner"
					>
						✦
					</div>
					<div>
						<h2 id="profile-title" class="font-display text-xl font-bold tracking-wide">
							{mode === 'view' ? 'Student Profile' : 'Edit Profile'}
						</h2>
						<p class="font-ui text-xs text-[#C9B8E8]">
							{mode === 'view'
								? 'Visible to friends and the VidJo community'
								: 'Customize your identity and handle'}
						</p>
					</div>
				</div>

				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={onClose}
					aria-label="Close"
				>
					✕
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
							<div class="relative shrink-0">
								{#if modalAvatar}
									<img
										src={modalAvatar}
										alt={modalName}
										class="size-24 rounded-full border-4 border-gold/60 object-cover shadow-lg"
									/>
								{:else}
									<div
										class="flex size-24 items-center justify-center rounded-full border-4 border-gold/60 bg-[linear-gradient(135deg,#C9B8E8,#7D58C2)] font-display text-4xl font-bold text-white shadow-lg"
									>
										{modalInitials}
									</div>
								{/if}
								<span
									class="absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full bg-[#3F7A4F] text-xs text-white ring-2 ring-paper"
									title="Active student"
								>
									✓
								</span>
							</div>

							<!-- Names & Handle -->
							<div class="mt-3 flex-1 sm:mt-0">
								<div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
									<h3 class="font-display text-2xl font-bold text-ink">
										{modalName}
									</h3>
									<span
										class="rounded-full bg-lav/30 px-2.5 py-0.5 font-ui text-xs font-semibold text-accent"
									>
										@{modalUsername}
									</span>
								</div>

								{#if isOwnProfile && auth.email}
									<p class="mt-0.5 font-ui text-xs text-ink-soft">
										{auth.email}
									</p>
								{/if}

								<!-- Friend Code -->
								{#if isOwnProfile}
									<div class="mt-2 flex items-center justify-center gap-2 sm:justify-start">
										<span class="font-ui text-xs text-ink-soft">Friend Code:</span>
										<code
											class="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-xs font-bold text-accent select-all"
										>
											{modalFriendCode}
										</code>
										<button
											type="button"
											class="font-ui text-xs font-semibold text-accent hover:underline"
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
								<div class="mt-3 rounded-2xl border border-line bg-light/60 p-3 text-left">
									{#if modalBio}
										<p class="font-hand text-lg leading-relaxed text-ink">
											“{modalBio}”
										</p>
									{:else}
										<p class="font-ui text-xs text-ink-soft italic">
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
									class="bg-paper-2 flex flex-col items-center rounded-2xl border border-line p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-accent">{totalPages}</span>
									<span class="font-ui text-[10px] text-ink-soft min-[480px]:text-[11px]"
										>Pages</span
									>
								</div>
								<div
									class="flex flex-col items-center rounded-2xl border border-[#E6D9B8] bg-[linear-gradient(135deg,#FFF8E7,#F7F2FD)] p-3 text-center"
								>
									<span class="flex items-center gap-1 font-display text-xl font-bold text-gold">
										🔥 {streak}
									</span>
									<span class="font-ui text-[10px] text-ink-soft min-[480px]:text-[11px]"
										>Day Streak</span
									>
								</div>
								<div
									class="bg-paper-2 flex flex-col items-center rounded-2xl border border-line p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-[#3F7A4F]"
										>{friends.friendCount}</span
									>
									<span class="font-ui text-[10px] text-ink-soft min-[480px]:text-[11px]"
										>Friends</span
									>
								</div>
								<div
									class="bg-paper-2 flex flex-col items-center rounded-2xl border border-line p-3 text-center"
								>
									<span class="font-display text-xl font-bold text-lav">{badges.length}</span>
									<span class="font-ui text-[10px] text-ink-soft min-[480px]:text-[11px]"
										>Badges</span
									>
								</div>
							</div>

							<!-- Badges -->
							<div class="bg-paper-2 rounded-2xl border border-line p-4">
								<div class="flex items-center justify-between">
									<span class="font-ui text-xs font-bold tracking-wide text-accent uppercase"
										>Achievements</span
									>
									<span class="font-ui text-[11px] text-ink-soft">{badges.length} earned</span>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									{#if badges.includes('first-post')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-semibold text-accent"
											>✨ First Page</span
										>
									{/if}
									{#if badges.includes('five-pages')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-semibold text-accent"
											>📓 Scribbler</span
										>
									{/if}
									{#if badges.includes('ten-pages')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#D5C6E8] bg-light px-3 py-1 font-ui text-xs font-semibold text-accent"
											>📚 Storyteller</span
										>
									{/if}
									{#if badges.includes('three-day-streak')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#F0D9A8] bg-[#FFF8E7] px-3 py-1 font-ui text-xs font-semibold text-[#7A5618]"
											>🔥 3-Day Streak</span
										>
									{/if}
									{#if badges.includes('week-streak')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#F0D9A8] bg-[#FFF8E7] px-3 py-1 font-ui text-xs font-semibold text-[#7A5618]"
											>🔥 Week Streak</span
										>
									{/if}
									{#if badges.includes('made-friend')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#C9E6D1] bg-[#EDF6EF] px-3 py-1 font-ui text-xs font-semibold text-[#2F6B45]"
											>🤝 Friendly</span
										>
									{/if}
									{#if badges.includes('social-circle')}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-[#C9E6D1] bg-[#EDF6EF] px-3 py-1 font-ui text-xs font-semibold text-[#2F6B45]"
											>👥 Social Circle</span
										>
									{/if}
									{#if badges.length === 0}
										<p class="font-ui text-xs text-ink-soft">
											Start writing pages and making friends to earn badges!
										</p>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Friends & Community Preview Card -->
						<div class="bg-paper-2 rounded-2xl border border-line p-4">
							<div class="flex items-center justify-between">
								<span class="font-ui text-xs font-bold tracking-wide text-accent uppercase">
									Community Preview
								</span>
								<span
									class="rounded-md bg-gold/20 px-2 py-0.5 font-ui text-[11px] font-medium text-[#7A5618]"
								>
									Public Profile
								</span>
							</div>
							<p class="mt-1 font-ui text-xs text-ink-soft">
								Here is how your profile card will appear to friends and in the student community
								directory:
							</p>

							<!-- Preview mockup card -->
							<div
								class="mt-3 flex items-center gap-3 rounded-xl border border-line bg-paper p-3 shadow-sm"
							>
								{#if modalAvatar}
									<img
										src={modalAvatar}
										alt=""
										class="size-11 rounded-full object-cover ring-2 ring-gold/40"
									/>
								{:else}
									<div
										class="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#C9B8E8,#7D58C2)] font-display text-lg font-bold text-white ring-2 ring-gold/40"
									>
										{modalInitials}
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<b class="truncate font-display text-sm font-bold text-ink">{modalName}</b>
										<span class="text-xs text-ink-soft">@{modalUsername}</span>
									</div>
									<p class="truncate font-hand text-sm text-ink-soft">
										{modalBio || 'Small videos, big thoughts.'}
									</p>
								</div>
								<span
									class="rounded-full bg-lav/20 px-2.5 py-1 font-ui text-xs font-medium text-accent"
								>
									Friend
								</span>
							</div>
						</div>

						{#if isOwnProfile}
							<!-- Device & Shared Browser Security notice -->
							<div
								class="rounded-2xl border border-[#E4D7F5] bg-[#F7F2FD] p-4 text-xs text-ink-soft"
							>
								<div class="flex items-start gap-2.5">
									<span class="text-base">🛡️</span>
									<div class="flex-1">
										<b class="font-ui text-ink">Shared Computer Security</b>
										<p class="mt-0.5 font-ui leading-normal">
											On shared computers, you can clear cached journal pages from this browser so
											other visitors cannot view them.
										</p>
										{#if clearCacheConfirm}
											<div class="mt-2.5 flex items-center gap-2">
												<button
													type="button"
													class="rounded-lg bg-red-600 px-3 py-1 font-ui text-xs font-semibold text-white hover:bg-red-700"
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
												class="mt-2 text-xs font-medium text-accent underline hover:text-ink"
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
							<div class="rounded-2xl border border-line bg-light/60 p-4">
								<div class="mb-3 flex items-center justify-between">
									<span class="font-ui text-xs font-bold tracking-wide text-accent uppercase">
										Journal theme
									</span>
									<span class="font-ui text-[11px] text-ink-soft">
										{profile.theme.charAt(0).toUpperCase() + profile.theme.slice(1)}
									</span>
								</div>
								<div class="flex flex-wrap gap-2">
									{#each themes as theme (theme.id)}
										<button
											type="button"
											class="flex items-center justify-center rounded-xl border p-3 transition-all {profile.theme ===
											theme.id
												? 'border-accent bg-accent/20 ring-2 ring-accent'
												: 'border-white/10 text-ink-soft hover:border-white/20'}"
											onclick={() => (profile.theme = theme.id)}
										>
											<span
												class="size-6 rounded-full"
												style="background: {theme.swatch}"
												aria-hidden="true"
											></span>
											<span class="font-ui text-[11px] font-semibold text-ink">
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
							<span class="block font-ui text-xs font-bold tracking-wide text-ink-soft uppercase">
								Choose Your Avatar
							</span>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								{#each PRESET_AVATARS as preset (preset.label)}
									<button
										type="button"
										class="flex size-11 items-center justify-center rounded-full text-xl shadow-sm transition-transform hover:scale-110 active:scale-95 {editAvatar ===
										preset.emoji
											? 'scale-105 ring-3 ring-accent'
											: 'border border-line'}"
										onclick={() => (editAvatar = preset.emoji)}
										title={preset.label}
									>
										{preset.emoji}
									</button>
								{/each}
								<button
									type="button"
									class="hover:bg-paper-2 rounded-full border border-line px-3 py-1 font-ui text-xs text-ink-soft"
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
								class="block font-ui text-xs font-bold tracking-wide text-ink-soft uppercase"
							>
								Display Name
							</label>
							<input
								id="edit-display-name"
								type="text"
								bind:value={editDisplayName}
								placeholder="e.g. Maya Lin"
								maxlength="32"
								class="mt-1.5 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 font-ui text-sm text-ink shadow-inner transition outline-none focus:border-accent focus:ring-2 focus:ring-lav/40"
							/>
							<span class="mt-1 block font-ui text-[11px] text-ink-soft">
								How friends will know you across VidJo.
							</span>
						</div>

						<!-- Unique Username -->
						<div>
							<label
								for="edit-username"
								class="flex items-center justify-between font-ui text-xs font-bold tracking-wide text-ink-soft uppercase"
							>
								<span>Unique Username</span>
								{#if usernameStatus.checking}
									<span class="text-accent">Checking availability…</span>
								{:else if usernameStatus.available === true}
									<span class="text-[#3F7A4F]">✓ Available</span>
								{:else if usernameStatus.available === false}
									<span class="text-red-600">{usernameStatus.error || 'Taken'}</span>
								{/if}
							</label>
							<div class="relative mt-1.5">
								<span
									class="absolute inset-y-0 left-3.5 flex items-center font-ui text-sm text-ink-soft"
								>
									@
								</span>
								<input
									id="edit-username"
									type="text"
									value={editUsername}
									oninput={(e) => onUsernameInput(e.currentTarget.value)}
									placeholder="username"
									maxlength="24"
									class="w-full rounded-xl border border-line bg-paper py-2.5 pr-3.5 pl-8 font-ui text-sm text-ink shadow-inner transition outline-none focus:border-accent focus:ring-2 focus:ring-lav/40"
								/>
							</div>
							<span class="mt-1 block font-ui text-[11px] text-ink-soft">
								Letters, numbers, underscores, dots, or dashes (2–24 characters). Must be globally
								unique.
							</span>
						</div>

						<!-- Bio -->
						<div>
							<div class="flex items-center justify-between">
								<label
									for="edit-bio"
									class="block font-ui text-xs font-bold tracking-wide text-ink-soft uppercase"
								>
									Bio / About You
								</label>
								<span class="font-ui text-[11px] text-ink-soft">
									{editBio.length}/200
								</span>
							</div>
							<textarea
								id="edit-bio"
								bind:value={editBio}
								rows="3"
								maxlength="200"
								placeholder="Share a short note about yourself, your hobbies, or what inspires your journal entries..."
								class="mt-1.5 w-full resize-none rounded-xl border border-line bg-paper px-3.5 py-2.5 font-hand text-base text-ink shadow-inner transition outline-none focus:border-accent focus:ring-2 focus:ring-lav/40"
							></textarea>
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="bg-paper-2 flex items-center justify-between border-t border-line px-6 py-4">
				{#if mode === 'view'}
					<button
						type="button"
						class="rounded-xl border border-line px-4 py-2 font-ui text-sm font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink"
						onclick={onClose}
					>
						Close
					</button>
					{#if isOwnProfile}
						<button
							type="button"
							class="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white shadow transition-all hover:bg-[#624690] active:scale-95"
							onclick={startEdit}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path>
							</svg>
							Edit Profile
						</button>
					{/if}
				{:else}
					<button
						type="button"
						class="rounded-xl border border-line px-4 py-2 font-ui text-sm font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink"
						onclick={cancelEdit}
						disabled={profile.saving}
					>
						Cancel
					</button>
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-ui text-sm font-bold text-white shadow transition-all hover:bg-[#624690] active:scale-95 disabled:opacity-50"
						onclick={save}
						disabled={profile.saving || usernameStatus.available === false}
					>
						{#if profile.saving}
							<div
								class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
							Saving…
						{:else}
							Save Changes
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
