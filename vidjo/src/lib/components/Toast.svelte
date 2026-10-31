<script lang="ts">
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { journal } from '#lib/state/journal.svelte';
</script>

{#if journal.toastVisible}
	{#key journal.toastSeq}
		<div
			role="status"
			class="fixed bottom-[max(24px,env(safe-area-inset-bottom))] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#D6C7EE] bg-[#F7F2FD]/95 px-5 py-3 font-ui text-[14px] font-semibold text-ink shadow-[0_12px_32px_rgba(30,16,46,.45)] backdrop-blur-md"
			in:fly={{ y: 22, duration: 280, easing: backOut }}
			out:fly={{ y: 10, duration: 180 }}
		>
			<span class="flex size-2 rounded-full bg-accent" aria-hidden="true"></span>
			<span>{journal.toastMessage}</span>
		</div>
	{/key}
{/if}
