<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import { censor } from '#lib/censor';
	import type { DmMessage } from '#lib/types';

	let {
		message,
		mine,
		showHeader,
		imageSrc,
		onOpenImage
	}: {
		message: DmMessage;
		mine: boolean;
		showHeader: boolean;
		imageSrc: string;
		onOpenImage: (src: string) => void;
	} = $props();

	const isGif = $derived(Boolean(message.gifUrl));
	const hasMedia = $derived(Boolean(message.imagePath || message.gifUrl || message.previewUrl));
	const time = $derived.by(() => {
		if (message.pending) return 'Sending…';
		const date = new Date(message.createdAt);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	});
	const label = $derived(mine ? 'You' : message.senderName);
</script>

<div
	class="flex w-full items-start gap-2 {mine ? 'flex-row-reverse' : ''} {showHeader
		? 'mt-3'
		: 'mt-0.5'}"
>
	<div class="w-8 shrink-0">
		{#if showHeader}
			<Avatar
				src={message.senderAvatar}
				name={message.senderName}
				className="size-8"
				textClass="text-xs"
				ring="ring-1 ring-line/60"
			/>
		{/if}
	</div>

	<div class="flex max-w-[78%] min-w-0 flex-col {mine ? 'items-end' : 'items-start'}">
		{#if showHeader}
			<p
				class="mb-1 max-w-full truncate font-ui text-[11px] font-semibold text-book-ink/70"
				title={label}
			>
				{label}
			</p>
		{/if}

		<div
			class="rounded-2xl font-ui text-sm leading-relaxed [overflow-wrap:anywhere] {message.body
				? 'px-3.5 py-2'
				: 'p-1.5'} {mine
				? 'rounded-br-md bg-cta text-cta-text'
				: 'rounded-bl-md border border-line bg-book-bg text-book-ink'} {message.pending
				? 'opacity-70'
				: ''}"
		>
			{#if hasMedia}
				{#if imageSrc}
					<button
						type="button"
						class="block cursor-zoom-in"
						onclick={() => onOpenImage(imageSrc)}
						aria-label={isGif ? 'Open GIF in a new tab' : 'Open photo in a new tab'}
					>
						<img
							src={imageSrc}
							alt={message.body
								? censor(message.body)
								: isGif
									? `GIF from ${message.senderName}`
									: `Photo from ${message.senderName}`}
							class="block max-h-64 w-auto max-w-full rounded-xl object-cover"
							loading="lazy"
							decoding="async"
						/>
					</button>
				{:else}
					<div class="flex h-28 w-44 items-center justify-center rounded-xl bg-line/30">
						<span class="font-ui text-[11px] text-book-ink/70">
							Loading {isGif ? 'GIF' : 'photo'}…
						</span>
					</div>
				{/if}
			{/if}

			{#if message.body}
				<p class="whitespace-pre-wrap {hasMedia ? 'mt-1.5' : ''}">
					{censor(message.body)}
				</p>
			{/if}
		</div>

		<p class="mt-1 font-ui text-[10px] text-book-ink/70">{time}</p>
	</div>
</div>
