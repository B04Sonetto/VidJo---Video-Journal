<script lang="ts">
	import PrivacyPicker from '#lib/components/PrivacyPicker.svelte';
	import StickerLayer from '#lib/components/StickerLayer.svelte';
	import { PROMPTS } from '#lib/data/prompts';
	import { journal } from '#lib/state/journal.svelte';
	import { viewport } from '#lib/state/viewport.svelte';
	import type { Entry, Privacy } from '#lib/types';

	let {
		entry,
		pageNumber,
		preview = false,
		enter = false
	}: {
		entry: Entry;
		pageNumber: number;
		preview?: boolean;
		enter?: boolean;
	} = $props();

	const id = $props.id();
	let mindEl = $state<HTMLTextAreaElement | null>(null);
	let prompt = $state('');
	let promptIndex = 0;
	let previousDate: string | undefined;

	$effect(() => {
		// A fresh page starts with the prompt line tucked away.
		if (previousDate !== undefined && previousDate !== entry.date) {
			prompt = '';
		}
		previousDate = entry.date;
	});

	function update(patch: Partial<Entry>) {
		if (!preview) journal.updateCurrent(patch);
	}

	function needPrompt() {
		if (preview) return;
		prompt = PROMPTS[promptIndex++ % PROMPTS.length];
		requestAnimationFrame(() => mindEl?.focus());
	}

	function selectPrivacy(privacy: Privacy) {
		if (!preview) journal.setPrivacy(privacy);
	}
</script>

<section
	class="page right absolute top-5 z-[1] flex h-[700px] w-[560px] flex-col gap-2.5 bg-paper px-10 pt-[34px] pb-11 font-hand text-ink"
	class:left-5={viewport.single && !preview}
	class:left-[580px]={!viewport.single && !preview}
	class:left-0={preview}
	class:top-0={preview}
	class:rounded-[14px]={viewport.single}
	class:rounded-r-[14px]={!viewport.single}
	class:rounded-l-[3px]={!viewport.single}
	class:shadow-[3px_2px_0_-1px_var(--color-paper-edge),6px_4px_0_-2px_#DCCFAF]={!preview}
	class:shadow-none={preview}
	class:right-page={!preview && !viewport.single}
	class:enter
	class:paper-dotted={journal.paper === 'dotted'}
	class:paper-grid={journal.paper === 'grid'}
	aria-label="Right page: writing"
>
	<label class="sr-only" for={`${id}-title`}>Title</label>
	<input
		id={`${id}-title`}
		class="h-[54px] w-full border-0 border-b-2 border-line bg-transparent px-1 pb-1 font-hand text-[32px] font-bold text-ink placeholder:text-[#8E7FAA] focus:border-line focus:ring-0 focus:outline-offset-4"
		type="text"
		maxlength="80"
		placeholder="Title (optional): just a random day…"
		autocomplete="off"
		value={entry.title}
		readonly={preview}
		tabindex={preview ? -1 : 0}
		oninput={(event) => update({ title: event.currentTarget.value })}
	/>

	<div class="mt-1.5 flex items-center justify-between gap-3">
		<label
			class="m-0 flex items-center gap-2 font-display text-[22px] font-bold text-ink"
			for={`${id}-mind`}
		>
			What's on your mind?
		</label>
		<button
			type="button"
			class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#CDBBE9] bg-light px-3.5 font-hand text-base font-bold text-accent shadow-sm transition-colors hover:bg-[#E8DCF8]"
			disabled={preview}
			onclick={needPrompt}
		>
			✦ Need a prompt?
		</button>
	</div>

	{#if prompt}
		<p
			class="m-0 rotate-[-.6deg] rounded-md bg-[#FFF3D6] px-2.5 py-1 font-hand text-lg text-accent"
		>
			{prompt}
		</p>
	{/if}

	<div class="relative flex min-h-0 flex-1">
		<textarea
			bind:this={mindEl}
			id={`${id}-mind`}
			class="block h-full w-full resize-none border-0 bg-transparent px-1 font-hand text-[22px] leading-[32px] text-ink placeholder:text-[#8E7FAA] focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="500"
			placeholder="Talk about anything: your thoughts, feelings, experiences, or just what's happening in your day."
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.mind}
			oninput={(event) => update({ mind: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-1.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft"
		>
			{entry.mind.length}/500
		</span>
	</div>

	<label
		class="m-0 flex items-center gap-2 font-display text-[22px] font-bold text-ink"
		for={`${id}-refl`}
	>
		★ Reflection
		<small class="font-hand text-base font-normal text-ink-soft">(optional)</small>
	</label>

	<div class="relative">
		<textarea
			id={`${id}-refl`}
			class="block h-24 w-full resize-none border-0 bg-transparent px-1 font-hand text-[22px] leading-[32px] text-ink placeholder:text-[#8E7FAA] focus:ring-0 focus:outline-offset-4"
			class:paper-lined={journal.paper === 'lined'}
			maxlength="300"
			placeholder="Any thoughts, lessons, or things you want to remember?"
			readonly={preview}
			tabindex={preview ? -1 : 0}
			value={entry.refl}
			oninput={(event) => update({ refl: event.currentTarget.value })}></textarea>
		<span
			class="absolute right-1.5 -bottom-0.5 rounded bg-paper px-1 font-ui text-sm text-ink-soft"
		>
			{entry.refl.length}/300
		</span>
	</div>

	<PrivacyPicker value={entry.privacy} readonly={preview} onSelect={selectPrivacy} />

	<button
		type="button"
		class="mt-1.5 flex h-[54px] items-center justify-center gap-3.5 rounded-xl bg-accent font-display text-[21px] font-bold text-white shadow-[0_4px_14px_rgba(42,27,61,.3)] transition-all hover:bg-[#624690] hover:shadow-[0_6px_18px_rgba(42,27,61,.4)] active:scale-[0.99] disabled:opacity-60"
		disabled={preview}
		onclick={() => !preview && journal.markSaved()}
	>
		<span class="text-gold">✦</span>
		Save VidJo
		<span class="text-gold">✦</span>
	</button>

	{#if entry.saved}
		<div
			class="pointer-events-none absolute right-11 bottom-1.5 z-[4] rotate-[-4deg] rounded-[10px] border-[3px] border-double border-[#3F7A4F] px-2.5 font-display text-[17px] font-bold text-[#3F7A4F] opacity-85"
		>
			Saved ✦
		</div>
	{/if}

	<div class="absolute right-0 bottom-3.5 left-0 text-center font-hand text-base text-ink-soft">
		{pageNumber}
	</div>

	<StickerLayer {entry} side="R" {preview} />
</section>

<style>
	.right-page::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		background: linear-gradient(to right, rgb(70 45 20 / 0.26), rgb(70 45 20 / 0) 52px);
	}

	.enter {
		animation: enter 0.28s ease-out;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateX(24px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
