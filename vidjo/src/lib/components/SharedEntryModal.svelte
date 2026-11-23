<script lang="ts">
	import { tick } from 'svelte';
	import { portal } from '#lib/actions/portal';
	import { MOOD_BY_KEY } from '#lib/data/moods';
	import { censor } from '#lib/censor';
	import AttachedSongCard from '#lib/components/AttachedSongCard.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import PhotoHighlight from '#lib/components/PhotoHighlight.svelte';
	import ThemedVideoPlayer from '#lib/components/ThemedVideoPlayer.svelte';
	import type { SharedJournalEntry } from '#lib/types';

	let {
		open,
		entry,
		senderName = 'A friend',
		senderAvatar = '',
		videoUrl = '',
		thumbUrl = '',
		photoUrl = '',
		onClose
	}: {
		open: boolean;
		entry: SharedJournalEntry | null;
		senderName?: string;
		senderAvatar?: string;
		videoUrl?: string;
		thumbUrl?: string;
		photoUrl?: string;
		onClose: () => void;
	} = $props();

	const id = $props.id();
	let closeEl = $state<HTMLButtonElement | null>(null);
	let wasOpen = false;
	let lastFocus: HTMLElement | null = null;

	const mood = $derived.by(() => {
		const key = entry?.mood as keyof typeof MOOD_BY_KEY | undefined;
		return key && MOOD_BY_KEY[key] ? MOOD_BY_KEY[key] : null;
	});
	const formattedDate = $derived.by(() => {
		if (!entry?.date) return '';
		const date = new Date(`${entry.date}T12:00:00`);
		return Number.isNaN(date.getTime())
			? entry.date
			: date.toLocaleDateString(undefined, {
					weekday: 'long',
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				});
	});
	const title = $derived(censor(entry?.title?.trim() || 'Untitled page'));
	const mind = $derived(censor(entry?.mind || ''));
	const refl = $derived(censor(entry?.refl || ''));

	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			lastFocus = document.activeElement as HTMLElement | null;
			void tick().then(() => closeEl?.focus());
		} else if (!open && wasOpen) {
			wasOpen = false;
			lastFocus?.focus?.();
			lastFocus = null;
		}
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}}
/>

{#if open && entry}
	<div
		use:portal
		class="fixed inset-0 z-[93] flex items-center justify-center bg-[rgba(15,8,25,.8)] p-3 min-[720px]:p-6"
		data-modal-open
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) onClose();
		}}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-cover-edge bg-desk-2 text-book-bg shadow-[0_30px_80px_rgba(0,0,0,.7)]"
			role="dialog"
			aria-modal="true"
			aria-labelledby={`${id}-title`}
		>
			<header
				class="flex shrink-0 items-center gap-3 bg-[linear-gradient(135deg,var(--color-cover-edge),var(--color-desk))] px-5 py-4"
			>
				<Avatar
					src={senderAvatar}
					name={senderName}
					className="size-10 shrink-0"
					textClass="text-sm"
					ring="ring-2 ring-book-accent/50"
				/>
				<div class="min-w-0 flex-1">
					<p class="font-ui text-[10px] font-bold tracking-widest text-book-bg/65 uppercase">
						Shared journal page
					</p>
					<h2 id={`${id}-title`} class="truncate font-display text-lg font-bold">
						{senderName}'s page
					</h2>
				</div>
				<button
					bind:this={closeEl}
					type="button"
					class="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-book-bg/85 transition-colors hover:bg-white/20"
					onclick={onClose}
					aria-label="Close shared page"
				>
					<CommunityIcon name="x" size={18} />
				</button>
			</header>

			{#if entry?.highlightPath && photoUrl}
				<div class="border-b border-line bg-book-bg p-3">
					<PhotoHighlight
						src={photoUrl}
						caption={entry.highlightName || entry.title || 'Photo highlight'}
						class="aspect-[4/3] max-h-[50vh] w-full"
					/>
				</div>
			{/if}

			{#if entry?.videoPath && videoUrl}
				<div class="border-b border-line bg-book-bg p-2">
					<ThemedVideoPlayer
						src={videoUrl}
						poster={thumbUrl}
						preload="metadata"
						class="mx-auto aspect-video max-h-[50vh] w-full"
					/>
				</div>
			{/if}

			<div class="min-h-0 flex-1 modal-scroll overflow-y-auto p-4 min-[720px]:p-6">
				<article
					class="mx-auto max-w-[600px] overflow-hidden rounded-[24px] border border-line bg-book-bg text-book-ink shadow-[0_18px_44px_rgba(0,0,0,.35)]"
				>
					<div
						class="relative flex flex-col items-center justify-center gap-2 px-6 py-7 text-center"
						style={mood
							? `background: radial-gradient(circle at 50% 30%, ${mood.c} 0%, var(--color-book-bg) 85%)`
							: 'background: linear-gradient(135deg, var(--color-paper-deep), var(--color-book-edge))'}
					>
						{#if mood}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from data/moods.ts -->
							{@html mood.svg}
							<span class="-mt-1 font-hand text-lg leading-none font-bold">
								feeling {mood.l.toLowerCase()}
							</span>
						{:else}
							<span
								class="flex size-14 items-center justify-center rounded-full bg-book-bg/80 text-book-accent"
							>
								<CommunityIcon name="book" size={26} />
							</span>
						{/if}
						<span class="mt-1 font-ui text-[11px] font-semibold text-book-ink/70">
							{formattedDate}
						</span>
					</div>

					<div class="px-5 py-5 min-[720px]:px-7">
						<h3
							class="text-center font-display text-2xl leading-tight font-bold [overflow-wrap:anywhere]"
						>
							{title}
						</h3>

						{#if mind}
							<div
								class="mt-5 rounded border border-line/70 bg-book-bg paper-lined [background-position:0_12px] px-4 py-3"
							>
								<p
									class="mb-2 font-ui text-[10px] font-bold tracking-widest text-book-accent uppercase"
								>
									What's on my mind
								</p>
								<p class="font-hand text-xl leading-8 [overflow-wrap:anywhere] whitespace-pre-wrap">
									{mind}
								</p>
							</div>
						{/if}

						{#if refl}
							<div
								class="mt-4 flex items-start gap-2.5 rounded border border-line bg-paper-deep/80 px-3 py-3"
							>
								<span class="mt-0.5 shrink-0 text-book-accent" aria-hidden="true">
									<CommunityIcon name="star" size={16} />
								</span>
								<div class="min-w-0">
									<p
										class="font-ui text-[10px] font-bold tracking-widest text-book-accent uppercase"
									>
										Reflection
									</p>
									<p
										class="mt-1 font-hand text-lg leading-snug font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap"
									>
										{refl}
									</p>
								</div>
							</div>
						{/if}

						{#if entry.song}
							<div class="mt-4">
								<AttachedSongCard song={entry.song} label="Song on this page" />
							</div>
						{/if}

						{#if !mind && !refl && !entry.song}
							<p class="mt-5 text-center font-hand text-lg text-book-ink/60">
								This page has no writing yet.
							</p>
						{/if}
					</div>
				</article>
			</div>

			<footer
				class="flex shrink-0 items-center justify-between gap-3 border-t border-cover-edge bg-desk px-5 py-3"
			>
				<span class="font-hand text-sm text-book-bg/60">A little piece of their day.</span>
				<button
					type="button"
					class="min-h-10 rounded-xl bg-cta px-4 font-ui text-sm font-bold text-cta-text transition-colors hover:bg-cta-hover"
					onclick={onClose}
				>
					Done
				</button>
			</footer>
		</div>
	</div>
{/if}
