<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { completeAuthCallback } from '#lib/authCallback';

	let message = $state('Finishing sign-in…');
	let failed = $state(false);

	onMount(() => {
		void (async () => {
			const result = await completeAuthCallback();

			if (result.ok) {
				await goto('/', { replaceState: true });
				return;
			}

			message = result.error;
			failed = true;
		})();
	});
</script>

<svelte:head>
	<title>Signing in — VidJo</title>
</svelte:head>

<main
	class="mx-auto flex min-h-[100dvh] w-full max-w-[620px] items-center justify-center px-4 py-10"
>
	<div
		class="w-full rounded-[26px] border border-[#4A3670] bg-paper px-7 py-10 text-center text-ink shadow-[0_30px_80px_rgba(0,0,0,.55)] min-[420px]:px-10"
	>
		{#if failed}
			<span
				class="mx-auto flex size-12 items-center justify-center rounded-full bg-[#FBEAEA] text-2xl text-[#8A2F2F]"
				aria-hidden="true"
			>
				!
			</span>
			<h1 class="mt-4 font-display text-3xl font-bold">Could not finish sign-in</h1>
			<p class="mt-2 font-hand text-xl leading-snug text-ink-soft">{message}</p>
			<a
				href="/"
				class="mt-6 inline-flex h-12 items-center justify-center rounded-xl border border-[#6A528F] bg-accent px-6 font-ui text-[15px] font-bold text-white hover:bg-[#624690]"
			>
				Back to sign in
			</a>
		{:else}
			<svg
				class="mx-auto size-9 animate-spin text-accent"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".3"></circle>
				<path d="M21 12a9 9 0 00-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"
				></path>
			</svg>
			<h1 class="mt-4 font-display text-3xl font-bold">One moment…</h1>
			<p class="mt-2 font-hand text-xl leading-snug text-ink-soft">{message}</p>
		{/if}
	</div>
</main>
