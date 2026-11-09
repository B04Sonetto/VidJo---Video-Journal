<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { completeAuthCallback } from '#lib/authCallback';
	import { auth } from '#lib/state/auth.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	let checking = $state(true);
	let ready = $state(false);
	let failed = $state(false);
	let error = $state('');
	let notice = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let passwordVisible = $state(false);
	let busy = $state(false);
	let passwordInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		void (async () => {
			const result = await completeAuthCallback();
			checking = false;

			if (!result.ok) {
				error = result.error;
				failed = true;
				return;
			}

			ready = true;
			await tick();
			passwordInput?.focus();
		})();
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		notice = '';

		if (password.length < 6) {
			error = 'Use a password with at least 6 characters.';
			passwordInput?.focus();
			return;
		}

		if (password !== confirmPassword) {
			error = 'The two passwords do not match.';
			return;
		}

		busy = true;
		try {
			const message = await auth.updatePassword(password);
			if (message) {
				error = message;
				return;
			}

			notice = 'Your password has been updated. Opening your journal…';
			await goto(resolve('/'), { replaceState: true });
		} catch {
			error = 'Could not reach Supabase. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Reset password — VidJo</title>
</svelte:head>

<main
	class="mx-auto flex min-h-[100dvh] w-full max-w-[620px] items-center justify-center px-4 py-10"
>
	<div
		class="w-full rounded-[26px] border border-[#4A3670] bg-paper px-7 py-10 text-ink shadow-[0_30px_80px_rgba(0,0,0,.55)] min-[420px]:px-10"
	>
		<h1 class="font-display text-[34px] leading-[1.05] font-bold">Choose a new password</h1>

		{#if checking}
			<p class="mt-5 flex items-center gap-2 font-ui text-sm text-ink-soft">
				<Spinner size={18} class="text-accent" />
				Checking your reset link…
			</p>
		{:else if failed}
			<p
				class="mt-5 rounded-xl border-[1.5px] border-[#D19A9A] bg-[#FBEAEA] px-3 py-2 font-ui text-sm text-[#8A2F2F]"
				role="alert"
			>
				{error}
			</p>
			<a
				href={resolve('/')}
				class="mt-6 inline-flex h-12 items-center justify-center rounded-xl border border-[#6A528F] bg-accent px-6 font-ui text-[15px] font-bold text-white hover:bg-[#624690]"
			>
				Back to sign in
			</a>
		{:else if ready}
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

			<form class="mt-5" onsubmit={save} novalidate aria-busy={busy}>
				<label class="block font-ui text-[13px] font-bold text-ink" for="vidjo-new-password">
					New password
				</label>
				<div class="relative mt-1.5">
					<input
						bind:this={passwordInput}
						bind:value={password}
						id="vidjo-new-password"
						type={passwordVisible ? 'text' : 'password'}
						name="new-password"
						autocomplete="new-password"
						placeholder="At least 6 characters"
						class="h-12 w-full rounded-xl border-[1.5px] border-line bg-[#FFFDF6] px-3.5 pr-16 font-ui text-base text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:ring-0"
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

				<label class="mt-4 block font-ui text-[13px] font-bold text-ink" for="vidjo-new-confirm">
					Confirm password
				</label>
				<input
					bind:value={confirmPassword}
					id="vidjo-new-confirm"
					type={passwordVisible ? 'text' : 'password'}
					name="confirm-password"
					autocomplete="new-password"
					placeholder="Type it once more"
					class="mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-line bg-[#FFFDF6] px-3.5 font-ui text-base text-ink placeholder:text-[#9B8CB5] focus:border-accent focus:ring-0"
					disabled={busy}
					required
				/>

				<Button type="submit" size="lg" class="mt-5 w-full" loading={busy}>
					Save password & open journal
				</Button>
			</form>
		{/if}
	</div>
</main>
