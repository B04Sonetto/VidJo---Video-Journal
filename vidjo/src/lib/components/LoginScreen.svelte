<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { auth } from '#lib/state/auth.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { USERNAME_MAX, validateUsername } from '#lib/username';

	type View = 'signin' | 'signup' | 'signup-2' | 'code';

	let view = $state<View>('signin');
	let email = $state('');
	let username = $state('');
	let nickname = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let digits = $state<string[]>(['', '', '', '', '', '']);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let cooldown = $state(0);
	let emailInput = $state<HTMLInputElement | null>(null);
	let codeInputs: (HTMLInputElement | null)[] = [];
	let cooldownTimer: ReturnType<typeof setInterval> | null = null;
	let passwordVisible = $state(false);
	let forgotPassword = $state(false);
	let codePurpose = $state<'otp' | 'signup'>('otp');
	let autoTried = false;

	let usernameChecking = $state(false);
	let usernameAvailable = $state<boolean | null>(null);
	let usernameError = $state('');
	let usernameTimer: ReturnType<typeof setTimeout> | null = null;
	let usernameCheckSeq = 0;

	function onUsernameChange(val: string) {
		const clean = val.trim();
		username = clean;
		usernameAvailable = null;
		usernameError = '';
		usernameChecking = false;
		const seq = ++usernameCheckSeq;

		if (usernameTimer) {
			clearTimeout(usernameTimer);
			usernameTimer = null;
		}

		if (!clean) return;

		if (!validUsername(clean)) {
			usernameError = validateUsername(clean);
			return;
		}

		usernameChecking = true;
		usernameTimer = setTimeout(async () => {
			const check = await profile.checkUsernameAvailable(clean);
			// Ignore a stale response if the person kept typing.
			if (seq !== usernameCheckSeq) return;
			usernameTimer = null;
			usernameChecking = false;
			usernameAvailable = check.available;
			if (!check.available) {
				usernameError = check.error || 'Username is already taken';
			}
		}, 300);
	}

	let heading = $derived(
		view === 'code'
			? 'Enter your sign-in code'
			: view === 'signup'
				? 'Create your journal'
				: view === 'signup-2'
					? 'Set a password'
					: 'Sign in to your journal'
	);
	let subtitle = $derived(
		view === 'code'
			? codePurpose === 'signup'
				? `We sent a confirmation email to ${email.trim()}.`
				: `If ${email.trim()} has a VidJo account, we sent it a sign-in code.`
			: view === 'signup'
				? 'Step 1 of 2 — enter your email and pick a username.'
				: view === 'signup-2'
					? 'Step 2 of 2 — secure your journal with a password.'
					: 'Sign in with your email and password, or use a one-time code.'
	);
	let primaryLabel = $derived(
		view === 'code'
			? 'Verify & open journal'
			: view === 'signup'
				? 'Continue'
				: view === 'signup-2'
					? 'Create account'
					: 'Sign in'
	);
	let busyLabel = $derived(
		view === 'code' ? 'Checking…' : view === 'signup-2' ? 'Creating account…' : 'Signing in…'
	);

	onMount(() => {
		void tick().then(() => emailInput?.focus());
		return () => {
			if (cooldownTimer) clearInterval(cooldownTimer);
			if (usernameTimer) clearTimeout(usernameTimer);
			usernameCheckSeq += 1;
		};
	});

	$effect(() => {
		if (!auth.redirectError) return;
		error = auth.redirectError;
		auth.clearRedirectError();
	});

	function startCooldown(seconds = 60) {
		cooldown = seconds;
		if (cooldownTimer) clearInterval(cooldownTimer);
		cooldownTimer = setInterval(() => {
			cooldown = Math.max(0, cooldown - 1);
			if (cooldown === 0 && cooldownTimer) {
				clearInterval(cooldownTimer);
				cooldownTimer = null;
			}
		}, 1000);
	}

	function validEmail(value: string) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
	}

	function validUsername(value: string) {
		return validateUsername(value) === '';
	}

	function switchView(next: View) {
		view = next;
		error = '';
		notice = '';
		forgotPassword = false;
		autoTried = false;

		if (next !== 'code') {
			digits = ['', '', '', '', '', ''];
		}

		void tick().then(() => {
			if (next === 'signin' || next === 'signup') {
				emailInput?.focus();
			} else if (next === 'signup-2') {
				(document.getElementById('vidjo-password') as HTMLInputElement | null)?.focus();
			}
		});
	}

	// Advance from step 1 to step 2 in 2-step signup
	function continueSignup() {
		error = '';
		if (!validEmail(email)) {
			error = 'Enter a valid email address.';
			emailInput?.focus();
			return;
		}
		if (!validUsername(username)) {
			error = validateUsername(username);
			return;
		}
		if (usernameChecking) {
			error = 'Still checking that username — give it a second and try again.';
			return;
		}
		if (usernameAvailable === false) {
			error = usernameError || 'That username is already taken. Try another.';
			return;
		}
		view = 'signup-2';
		void tick().then(() => {
			(document.getElementById('vidjo-password') as HTMLInputElement | null)?.focus();
		});
	}

	async function sendCode() {
		error = '';
		notice = '';

		if (!validEmail(email)) {
			error = 'Enter a valid email address.';
			emailInput?.focus();
			return;
		}

		// Don't fire another OTP request while a cooldown is in effect.
		if (cooldown > 0) return;

		busy = true;
		try {
			const message = await auth.sendCode(email.trim());
			if (message) {
				error = message;
				if (/too many|rate limit/i.test(message)) startCooldown(60);
				return;
			}

			codePurpose = 'otp';
			view = 'code';
			notice = `If ${email.trim()} has a VidJo account, a sign-in code is on its way.`;
			startCooldown();
			await tick();
			codeInputs[0]?.focus();
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	async function resend() {
		if (cooldown > 0 || busy) return;

		error = '';
		busy = true;
		try {
			const message =
				codePurpose === 'signup'
					? await auth.resendSignup(email.trim())
					: await auth.sendCode(email.trim());

			if (message) {
				error = message;
				if (/too many|rate limit/i.test(message)) startCooldown(60);
				return;
			}

			notice =
				codePurpose === 'signup'
					? `A fresh confirmation code is on its way to ${email.trim()}.`
					: `If ${email.trim()} has a VidJo account, a fresh code is on its way.`;
			startCooldown();
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	async function verify() {
		const token = digits.join('');

		if (token.length !== 6) {
			error = 'Enter the 6-digit code from your email.';
			codeInputs[0]?.focus();
			return;
		}
		if (busy) return;

		busy = true;
		error = '';

		try {
			const message = await auth.verifyCode(email.trim(), token, codePurpose);
			if (message) {
				error = message;
				digits = ['', '', '', '', '', ''];
				autoTried = false;
				await tick();
				codeInputs[0]?.focus();
			}
		} catch {
			error = 'Could not check that code. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		const token = digits.join('');
		if (view === 'code' && token.length === 6 && !busy && !autoTried) {
			autoTried = true;
			void verify();
		}
		if (token.length < 6) autoTried = false;
	});

	function onDigitInput(index: number, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const raw = input.value.replace(/\D/g, '');

		if (!raw) {
			digits[index] = '';
			return;
		}

		const chars = raw.slice(0, 6 - index).split('');
		for (let i = 0; i < chars.length; i += 1) digits[index + i] = chars[i];
		input.value = digits[index] ?? '';

		const next = Math.min(5, index + chars.length);
		void tick().then(() => codeInputs[next]?.focus());
	}

	function onDigitKey(index: number, event: KeyboardEvent) {
		if (event.key === 'Backspace' && !digits[index] && index > 0) {
			digits[index - 1] = '';
			void tick().then(() => codeInputs[index - 1]?.focus());
		} else if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			codeInputs[index - 1]?.focus();
		} else if (event.key === 'ArrowRight' && index < 5) {
			event.preventDefault();
			codeInputs[index + 1]?.focus();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			void verify();
		}
	}

	function onPaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData('text') ?? '';
		const raw = text.replace(/\D/g, '').slice(0, 6);
		if (!raw) return;

		event.preventDefault();
		digits = Array.from({ length: 6 }, (_, index) => raw[index] ?? '');
		void tick().then(() => codeInputs[Math.min(5, raw.length)]?.focus());
	}

	function useDifferentEmail() {
		const wasSignup = codePurpose === 'signup';
		view = wasSignup ? 'signup' : 'signin';
		digits = ['', '', '', '', '', ''];
		error = '';
		notice = '';
		autoTried = false;
		forgotPassword = false;
		void tick().then(() => emailInput?.focus());
	}

	async function google() {
		if (busy) return;

		busy = true;
		error = '';
		try {
			const message = await auth.signInWithGoogle();
			if (message) error = message;
		} catch {
			error = 'Could not start Google sign-in. Try again in a moment.';
		} finally {
			busy = false;
		}
	}

	// Jazz modified this function to use the new auth.signInWithEmail and auth.signInWithUsername methods================
	async function signIn() {
		if (busy) return;

		error = '';
		notice = '';

		const identifier = email.trim();

		if (!identifier) {
			error = 'Enter your email or username.';
			emailInput?.focus();
			return;
		}

		if (!password) {
			error = 'Enter your password.';
			return;
		}

		busy = true;

		try {
			const message = validEmail(identifier)
				? await auth.signInWithEmail(identifier, password)
				: await auth.signInWithUsername(identifier, password);

			if (message) {
				error = message;
				return;
			}

			// Success — onAuthStateChange updates auth state.
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}
	// end ======================================================================================

	async function createAccount() {
		if (busy) return;

		error = '';
		notice = '';

		// Re-validate everything (in case user navigated directly)
		if (!validUsername(username)) {
			error = validateUsername(username);
			view = 'signup';
			return;
		}

		if (usernameChecking) {
			error = 'Still checking that username — give it a second and try again.';
			return;
		}

		if (usernameAvailable === false) {
			error = usernameError || 'That username is already taken. Try another.';
			view = 'signup';
			return;
		}

		if (!validEmail(email)) {
			error = 'Enter a valid email address.';
			view = 'signup';
			emailInput?.focus();
			return;
		}

		if (password.length < 6) {
			error = 'Use a password with at least 6 characters.';
			return;
		}

		if (password !== confirmPassword) {
			error = 'The two passwords do not match.';
			return;
		}

		busy = true;
		try {
			const result = await auth.signUp(
				email.trim(),
				password,
				username.trim(),
				nickname.trim() || username.trim()
			);
			if (result.error) {
				error = result.error;
				return;
			}

			if (result.needsConfirmation) {
				codePurpose = 'signup';
				view = 'code';
				notice = `We sent a confirmation email to ${email.trim()}. Click the link or enter the 6-digit code to finish.`;
				startCooldown();
				await tick();
				codeInputs[0]?.focus();
				return;
			}

			// No session and no confirmation request usually means the address
			// already has an account. Point them at the sign-in form.
			if (!auth.signedIn) {
				view = 'signin';
				notice = 'If you already have an account, sign in with your email and password.';
			}
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	async function sendReset() {
		if (busy) return;

		error = '';
		notice = '';

		if (!validEmail(email)) {
			error = 'Enter a valid email address.';
			emailInput?.focus();
			return;
		}

		busy = true;
		try {
			const message = await auth.resetPassword(email.trim());
			if (message) {
				error = message;
				return;
			}

			notice = 'Check your email for a password reset link.';
			forgotPassword = false;
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();

		if (view === 'code') {
			void verify();
		} else if (view === 'signup') {
			continueSignup();
		} else if (view === 'signup-2') {
			void createAccount();
		} else if (forgotPassword) {
			void sendReset();
		} else {
			void signIn();
		}
	}

	function showForgotPassword() {
		forgotPassword = true;
		error = '';
		notice = '';
	}
</script>

<section
	class="mx-auto flex min-h-[100dvh] w-full max-w-[1080px] items-center justify-center py-6 min-[900px]:py-10"
	aria-label="Sign in to VidJo"
>
	<div
		class="grid w-full overflow-hidden rounded-[26px] border border-cover-edge bg-desk-2 shadow-[0_30px_80px_rgba(0,0,0,.55)] min-[900px]:grid-cols-[1.02fr_.98fr]"
	>
		<aside
			class="relative hidden overflow-hidden bg-[linear-gradient(155deg,var(--color-cover),var(--color-cover-edge)_58%,var(--color-desk))] p-10 text-white min-[900px]:flex min-[900px]:flex-col"
			aria-hidden="true"
		>
			<div class="flex items-center gap-3">
				<svg width="40" height="48" viewBox="0 0 44 52" aria-hidden="true" class="shrink-0">
					<path d="M30 6a20 20 0 100 40 17 17 0 01-8-20 17 17 0 018-20z" fill="#E8C9A0"></path>
					<path d="M38 12l1.4 3.6 3.6 1.4-3.6 1.4L38 22l-1.4-3.6L33 17l3.6-1.4z" fill="#D4A24C"
					></path>
				</svg>
				<div>
					<div class="font-display text-[38px] leading-none font-bold">VidJo</div>
					<div class="mt-1 font-ui text-xs text-lav">Small videos, big thoughts.</div>
				</div>
			</div>

			<div class="mt-10 max-w-[380px]">
				<h2 class="m-0 font-display text-[40px] leading-[1.05] font-bold text-balance">
					A page for every day you want to keep.
				</h2>
				<p class="mt-4 font-ui text-[15px] leading-relaxed text-lav">
					Record a short video, write what is on your mind, and flip back to the ordinary days that
					turned out to matter.
				</p>
			</div>

			<!-- An actual spread, not a mock-up of features -->
			<div class="mt-9 w-full max-w-[420px]">
				<div
					class="grid grid-cols-2 overflow-hidden rounded-2xl shadow-[0_24px_50px_rgba(0,0,0,.45)] ring-1 ring-black/20"
				>
					<div class="bg-paper p-4 text-ink">
						<div class="flex items-baseline justify-between gap-2">
							<span class="font-display text-sm font-bold">Today</span>
							<span class="font-ui text-[10px] text-ink-soft tabular-nums">Nov 8</span>
						</div>
						<div
							class="relative mt-3 aspect-[4/5] overflow-hidden rounded-lg bg-[linear-gradient(160deg,var(--color-cover),var(--color-cover-edge))]"
						>
							<span class="absolute inset-0 flex items-center justify-center">
								<span
									class="flex size-9 items-center justify-center rounded-full bg-white/90 text-desk"
								>
									<CommunityIcon name="play" size={14} />
								</span>
							</span>
							<span
								class="absolute right-1.5 bottom-1.5 rounded bg-black/45 px-1 py-0.5 font-ui text-[9px] font-semibold text-white tabular-nums"
							>
								0:42
							</span>
						</div>
						<p class="mt-3 font-hand text-[15px] leading-snug text-ink">
							Walked home the long way.
						</p>
					</div>
					<div class="border-l border-line/70 bg-paper p-4 text-ink">
						<div class="font-ui text-[10px] font-semibold text-ink-soft">On my mind</div>
						<p class="mt-1.5 font-hand text-[15px] leading-snug">
							The light through the trees was doing something.
						</p>
						<div class="mt-3 space-y-2">
							<div class="h-1.5 w-full rounded-full bg-line/70"></div>
							<div class="h-1.5 w-11/12 rounded-full bg-line/70"></div>
							<div class="h-1.5 w-4/5 rounded-full bg-line/70"></div>
						</div>
						<div class="mt-4 flex flex-wrap gap-1.5">
							<span
								class="rounded-full bg-gold/25 px-2 py-0.5 font-ui text-[9px] font-semibold text-[#7A4E0C]"
							>
								Calm
							</span>
							<span
								class="rounded-full bg-accent/10 px-2 py-0.5 font-ui text-[9px] font-semibold text-accent"
							>
								Friends
							</span>
						</div>
					</div>
				</div>
			</div>

			<p class="mt-auto flex items-center gap-2 pt-8 font-ui text-xs text-lav">
				<CommunityIcon name="lock" size={14} class="shrink-0" />
				Private by default. Only you can read your pages.
			</p>
		</aside>

		<div
			class="relative bg-paper px-5 py-8 text-ink min-[420px]:px-8 min-[900px]:px-10 min-[900px]:py-12"
		>
			<div class="mb-6 flex items-center gap-2.5 min-[900px]:hidden">
				<svg
					width="30"
					height="36"
					viewBox="0 0 44 52"
					aria-hidden="true"
					class="shrink-0 text-accent"
				>
					<path d="M30 6a20 20 0 100 40 17 17 0 01-8-20 17 17 0 018-20z" fill="#D4A24C"></path>
					<path d="M38 12l1.4 3.6 3.6 1.4-3.6 1.4L38 22l-1.4-3.6L33 17l3.6-1.4z" fill="currentColor"
					></path>
				</svg>
				<span class="font-display text-2xl font-bold">VidJo</span>
			</div>

			<h1 class="font-display text-[34px] leading-[1.05] font-bold text-balance text-ink">
				{heading}
			</h1>
			<p class="mt-2 font-ui text-sm leading-relaxed text-ink-soft" aria-live="polite">
				{subtitle}
			</p>

			{#if view === 'signup' || view === 'signup-2'}
				<div
					class="mt-3 flex items-center gap-2"
					aria-label={`Step ${view === 'signup' ? '1' : '2'} of 2`}
				>
					<span class="h-1.5 w-7 rounded-full bg-accent"></span>
					<span class="h-1.5 w-7 rounded-full {view === 'signup-2' ? 'bg-accent' : 'bg-line'}"
					></span>
					<span class="ml-1 font-ui text-[11px] font-semibold text-ink-soft">
						Step {view === 'signup' ? '1' : '2'} of 2
					</span>
				</div>
			{/if}

			{#if notice}
				<p
					class="mt-4 rounded-xl border-[1.5px] border-[#9CC4A8] bg-[#EDF6EF] px-3 py-2 font-ui text-sm text-[#2F6B45]"
					role="status"
				>
					{notice}
				</p>
			{/if}

			{#if error}
				<p
					class="mt-4 rounded-xl border-[1.5px] border-[#D19A9A] bg-[#FBEAEA] px-3 py-2 font-ui text-sm text-[#8A2F2F]"
					role="alert"
				>
					{error}
				</p>
			{/if}

			<form class="mt-6" onsubmit={submit} novalidate aria-busy={busy}>
				{#if view === 'code'}
					<button
						type="button"
						class="mb-4 inline-flex items-center gap-1.5 font-ui text-[13px] font-medium text-accent hover:underline"
						onclick={useDifferentEmail}
						disabled={busy}
					>
						<CommunityIcon name="arrow-left" size={15} />
						Use a different email
					</button>

					<fieldset class="m-0 border-0 p-0">
						<legend class="mb-2 font-ui text-[13px] font-bold text-ink">6-digit code</legend>
						<div class="flex justify-between gap-1.5 min-[420px]:gap-2">
							{#each digits as digit, index (index)}
								<input
									bind:this={codeInputs[index]}
									value={digit}
									type="text"
									inputmode="numeric"
									pattern="[0-9]*"
									maxlength="1"
									autocomplete={index === 0 ? 'one-time-code' : 'off'}
									aria-label={`Code digit ${index + 1}`}
									class="h-14 w-full min-w-0 rounded-xl border-2 border-line bg-paper text-center font-display text-2xl font-bold text-ink transition-colors focus:border-accent focus:outline-none"
									disabled={busy}
									oninput={(event) => onDigitInput(index, event)}
									onkeydown={(event) => onDigitKey(index, event)}
									onpaste={onPaste}
								/>
							{/each}
						</div>
					</fieldset>

					<Button type="submit" size="lg" class="mt-4 w-full" loading={busy} disabled={busy}>
						{busy ? busyLabel : primaryLabel}
					</Button>

					<div class="mt-4 flex flex-wrap items-center justify-between gap-2 font-ui text-[12px]">
						<span class="text-ink-soft">Didn't get it?</span>
						<button
							type="button"
							class="font-bold text-accent tabular-nums hover:underline disabled:cursor-default disabled:text-ink-soft disabled:no-underline"
							disabled={cooldown > 0 || busy}
							onclick={resend}
						>
							{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
						</button>
					</div>

					<p class="mt-4 font-ui text-xs leading-snug text-ink-soft">
						Tip: the email contains a 6-digit code and a sign-in link. Use whichever is easier — the
						link opens your journal on this device.
					</p>
				{:else if view === 'signup'}
					<!-- ── Step 1: Email + Unique Username ── -->
					<label class="block font-ui text-[13px] font-bold text-ink" for="vidjo-email">
						Email address
					</label>
					<input
						bind:this={emailInput}
						bind:value={email}
						id="vidjo-email"
						type="email"
						name="email"
						autocomplete="email"
						inputmode="email"
						placeholder="you@example.com"
						class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
						disabled={busy}
						required
					/>

					<div class="mt-4 flex items-center justify-between">
						<label class="block font-ui text-[13px] font-bold text-ink" for="vidjo-username">
							Username
						</label>
						{#if usernameChecking}
							<span class="font-ui text-[11px] text-accent">Checking availability…</span>
						{:else if usernameAvailable === true}
							<span class="flex items-center gap-1 font-ui text-[11px] text-success">
								<CommunityIcon name="check" size={11} />
								Available
							</span>
						{:else if usernameError}
							<span class="font-ui text-[11px] text-red-600">{usernameError}</span>
						{/if}
					</div>
					<div class="relative mt-1.5">
						<span
							class="absolute inset-y-0 left-3.5 flex items-center font-ui text-sm text-ink-muted"
						>
							@
						</span>
						<input
							value={username}
							oninput={(e) => onUsernameChange(e.currentTarget.value)}
							id="vidjo-username"
							type="text"
							name="username"
							autocomplete="username"
							placeholder="e.g. mara"
							maxlength={USERNAME_MAX}
							class="h-12 w-full rounded-xl border-2 border-line bg-paper pr-3.5 pl-8 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
							disabled={busy}
							required
						/>
					</div>
					<p class="mt-1 font-ui text-[11px] text-ink-soft">
						Choose a unique username (2–{USERNAME_MAX} characters) for your journal, friends, and community.
					</p>

					<label class="mt-4 block font-ui text-[13px] font-bold text-ink" for="vidjo-nickname">
						Nickname <span class="text-xs font-normal text-ink-soft">(shown to friends)</span>
					</label>
					<input
						bind:value={nickname}
						id="vidjo-nickname"
						type="text"
						name="nickname"
						autocomplete="nickname"
						placeholder="e.g. Rice Shower"
						maxlength="32"
						class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
						disabled={busy}
					/>
					<p class="mt-1 font-ui text-[11px] text-ink-soft">
						Your nickname can be anything. Your @username stays unique across VidJo.
					</p>

					<Button type="submit" size="lg" class="mt-5 w-full" trailingIcon="arrow-right">
						Continue
					</Button>

					<p class="mt-5 font-ui text-[12px] leading-relaxed text-ink-soft">
						{#if auth.signupAvailable}
							Already have an account?
							<button
								type="button"
								class="font-bold text-accent hover:underline"
								onclick={() => switchView('signin')}
								disabled={busy}
							>
								Sign in
							</button>
						{:else}
							New sign-ups are paused right now. Try signing in instead.
						{/if}
					</p>
				{:else if view === 'signup-2'}
					<!-- ── Step 2: Password ── -->
					<button
						type="button"
						class="mb-3 inline-flex items-center gap-1.5 font-ui text-[13px] font-medium text-accent hover:underline"
						onclick={() => switchView('signup')}
						disabled={busy}
					>
						<CommunityIcon name="arrow-left" size={15} />
						Back to step 1
					</button>

					<label class="block font-ui text-[13px] font-bold text-ink" for="vidjo-password">
						Password
					</label>
					<div class="relative mt-1.5">
						<input
							bind:value={password}
							id="vidjo-password"
							type={passwordVisible ? 'text' : 'password'}
							name="password"
							autocomplete="new-password"
							placeholder="At least 6 characters"
							class="h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 pr-16 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
							disabled={busy}
							required
						/>
						<button
							type="button"
							tabindex={-1 as number | undefined}
							class="absolute inset-y-0 right-0 flex items-center rounded-r-xl bg-transparent px-2.5 font-ui text-xs text-ink-soft hover:text-ink"
							onclick={() => (passwordVisible = !passwordVisible)}
							aria-label={passwordVisible ? 'Hide password' : 'Show password'}
						>
							<CommunityIcon name={passwordVisible ? 'eye-off' : 'eye'} size={16} />
						</button>
					</div>

					<label class="mt-4 block font-ui text-[13px] font-bold text-ink" for="vidjo-confirm">
						Confirm password
					</label>
					<input
						bind:value={confirmPassword}
						id="vidjo-confirm"
						type={passwordVisible ? 'text' : 'password'}
						name="confirm-password"
						autocomplete="new-password"
						placeholder="Type it once more"
						class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
						disabled={busy}
						required
					/>

					<Button type="submit" size="lg" class="mt-5 w-full" loading={busy} disabled={busy}>
						{busy ? busyLabel : primaryLabel}
					</Button>
				{:else}
					<!-- ── Sign In ── -->
					<label class="block font-ui text-[13px] font-bold text-ink" for="vidjo-email">
						Email or username
					</label>
					<input
						bind:this={emailInput}
						bind:value={email}
						id="vidjo-email"
						type="text"
						name="identifier"
						autocomplete="username"
						inputmode="text"
						placeholder="Enter your email or username"
						class="mt-1.5 h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
						disabled={busy}
						required
					/>

					{#if !forgotPassword}
						<label class="mt-4 block font-ui text-[13px] font-bold text-ink" for="vidjo-password">
							Password
						</label>
						<div class="relative mt-1.5">
							<input
								bind:value={password}
								id="vidjo-password"
								type={passwordVisible ? 'text' : 'password'}
								name="password"
								autocomplete="current-password"
								placeholder="Your password"
								class="h-12 w-full rounded-xl border-2 border-line bg-paper px-3.5 pr-16 font-ui text-base text-ink transition-colors placeholder:text-ink-muted focus:border-accent focus:outline-none"
								disabled={busy}
								required
							/>
							<button
								type="button"
								tabindex={-1 as number | undefined}
								class="absolute inset-y-0 right-0 flex items-center rounded-r-xl bg-transparent px-2.5 font-ui text-xs text-ink-soft hover:text-ink"
								onclick={() => (passwordVisible = !passwordVisible)}
								aria-label={passwordVisible ? 'Hide password' : 'Show password'}
							>
								<CommunityIcon name={passwordVisible ? 'eye-off' : 'eye'} size={16} />
							</button>
						</div>
						<button
							type="button"
							tabindex={-1 as number | undefined}
							class="mt-2 font-ui text-[12px] font-medium text-accent hover:underline"
							onclick={showForgotPassword}
							disabled={busy}
						>
							Forgot password?
						</button>
					{:else}
						<div class="mt-2 flex items-center gap-2 font-ui text-[12px] text-ink">
							<CommunityIcon name="alert" size={14} class="shrink-0" />
							We'll send a reset link to {email.trim() || 'your email'}.
						</div>
					{/if}

					{#if forgotPassword && view === 'signin'}
						<Button
							size="lg"
							class="mt-4 w-full"
							loading={busy}
							disabled={busy}
							onclick={sendReset}
						>
							{busy ? 'Sending reset link…' : 'Send reset link'}
						</Button>
						<button
							type="button"
							class="mt-3 inline-flex items-center gap-1.5 font-ui text-[12px] font-medium text-accent hover:underline"
							onclick={() => (forgotPassword = false)}
							disabled={busy}
						>
							<CommunityIcon name="arrow-left" size={14} />
							Back to sign in
						</button>
					{:else}
						<Button
							type="submit"
							size="lg"
							class="mt-4 w-full"
							loading={busy}
							disabled={busy}
							trailingIcon="arrow-right"
						>
							{busy ? busyLabel : primaryLabel}
						</Button>

						<div class="mt-4 text-center">
							<button
								type="button"
								class="font-ui text-[12px] font-medium text-accent tabular-nums hover:underline disabled:cursor-default disabled:text-ink-soft disabled:no-underline"
								onclick={sendCode}
								disabled={busy || cooldown > 0}
							>
								{cooldown > 0
									? `Send another code in ${cooldown}s`
									: 'Email me a sign-in code instead'}
							</button>
						</div>
					{/if}

					{#if !forgotPassword}
						<div class="my-5 flex items-center gap-3 font-ui text-[11px] text-ink-soft">
							<span class="h-px flex-1 bg-line"></span>
							or
							<span class="h-px flex-1 bg-line"></span>
						</div>

						<Button variant="paper" size="lg" class="w-full" disabled={busy} onclick={google}>
							<svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
								<path
									fill="#FFC107"
									d="M43.6 20.1H42V20H24v8h11.3A12 12 0 1112 24a12 12 0 016.3-10.6l5.7-5.7A20 20 0 1044 24c0-1.3-.1-2.6-.4-3.9z"
								></path>
								<path
									fill="#FF3D00"
									d="M6.3 14.7l6.6 4.8A12 12 0 0024 12c3.1 0 5.9 1.2 8.1 3.1l5.7-5.7A20 20 0 006.3 14.7z"
								></path>
								<path
									fill="#4CAF50"
									d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A12 12 0 0112 24c0-1.4.2-2.7.7-4l-6.6-5.1A20 20 0 0024 44z"
								></path>
								<path
									fill="#1976D2"
									d="M43.6 20.1H42V20H24v8h11.3a12 12 0 01-4.1 5.5l6.3 5.3C37.1 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
								></path>
							</svg>
							Continue with Google
						</Button>

						{#if auth.providersChecked && !auth.googleAvailable}
							<p class="mt-2 text-center font-ui text-[11px] text-ink-soft">
								Google isn't enabled in this Supabase project yet. Add it under Authentication →
								Providers.
							</p>
						{:else}
							<p class="mt-2 text-center font-ui text-[11px] text-ink-soft">
								New Google accounts choose a username before opening the journal.
							</p>
						{/if}
					{/if}

					<p class="mt-5 font-ui text-[12px] leading-relaxed text-ink-soft">
						{#if auth.signupAvailable}
							New here?
							<button
								type="button"
								class="font-bold text-accent hover:underline"
								onclick={() => switchView('signup')}
								disabled={busy}
							>
								Create an account
							</button>
							— it only takes a moment.
						{:else}
							New sign-ups are paused right now.
						{/if}
					</p>
				{/if}
			</form>
		</div>
	</div>
</section>
