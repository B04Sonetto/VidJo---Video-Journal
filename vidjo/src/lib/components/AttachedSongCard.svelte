<script lang="ts">
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';
	import { spotify } from '#lib/state/spotify.svelte';
	import type { EntrySong } from '#lib/types';

	let {
		song,
		compact = false,
		label = 'Attached song',
		onRemove = null
	}: {
		song: EntrySong | null | undefined;
		compact?: boolean;
		label?: string;
		onRemove?: (() => void | Promise<void>) | null;
	} = $props();

	function toTrack(s: EntrySong) {
		return {
			uri: s.uri,
			name: s.name,
			artists: s.artists,
			album: s.album,
			image: s.image,
			url: s.url
		};
	}

	async function play(event?: MouseEvent) {
		event?.stopPropagation();
		event?.preventDefault();
		if (!song) return;
		spotify.openPanel();
		void spotify.playTrack(toTrack(song));
	}

	async function remove(event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		if (!onRemove) return;
		await onRemove();
	}
</script>

{#if song}
	<div
		class="song-card group relative w-full rounded-2xl border border-book-accent/35 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-book-accent)_18%,var(--color-paper)),color-mix(in_srgb,#1DB954_10%,var(--color-paper-deep,transparent)))] shadow-[0_8px_24px_rgba(0,0,0,.08)] transition-all hover:-translate-y-0.5 hover:border-book-accent/55 hover:shadow-[0_12px_28px_rgba(0,0,0,.12)]"
	>
		<button
			type="button"
			class="flex w-full items-center gap-2.5 text-left focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-book-accent/50 focus-visible:outline-none {compact
				? 'p-2'
				: 'p-2.5'} {onRemove ? (compact ? 'pr-9' : 'pr-10') : ''}"
			onclick={(e) => play(e)}
			title={`Play "${song.name}" on Spotify`}
			aria-label={`Play attached song ${song.name}`}
		>
			<div
				class="relative shrink-0 overflow-hidden rounded-xl border border-line/70 bg-cover/30 {compact
					? 'size-10'
					: 'size-12'}"
			>
				{#if song.image}
					<img src={song.image} alt="" class="h-full w-full object-cover" loading="lazy" />
				{:else}
					<div class="flex h-full w-full items-center justify-center text-[#1DB954]">
						<CommunityIcon name="music" size={compact ? 16 : 18} />
					</div>
				{/if}
				<span
					class="absolute inset-0 flex items-center justify-center bg-desk/25 opacity-0 transition-opacity group-hover:opacity-100"
				>
					<span
						class="flex items-center justify-center rounded-full bg-[#1DB954] text-[#062012] shadow {compact
							? 'size-6'
							: 'size-7'}"
					>
						<CommunityIcon name="play" size={compact ? 11 : 13} />
					</span>
				</span>
			</div>
			<div class="min-w-0 flex-1">
				<p
					class="font-ui font-bold tracking-wide text-book-accent uppercase {compact
						? 'text-[9px]'
						: 'text-[10px]'}"
				>
					{label}
				</p>
				<p class="truncate font-ui font-semibold text-ink {compact ? 'text-xs' : 'text-sm'}">
					{song.name}
				</p>
				{#if song.artists}
					<p class="truncate font-ui text-ink-soft {compact ? 'text-[10px]' : 'text-[11px]'}">
						{song.artists}
					</p>
				{/if}
			</div>
			<span
				class="flex shrink-0 items-center justify-center rounded-full border border-[#1DB954]/35 bg-[#1DB954]/12 text-[#169c46] {compact
					? 'size-7'
					: 'size-8'}"
				aria-hidden="true"
			>
				<CommunityIcon name="spotify" size={compact ? 13 : 15} />
			</span>
		</button>

		{#if onRemove}
			<button
				type="button"
				class="absolute top-1.5 right-1.5 z-[2] flex items-center justify-center rounded-full border border-line/70 bg-paper/90 text-ink-soft shadow-sm transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:outline-none {compact
					? 'size-6'
					: 'size-7'}"
				onclick={remove}
				aria-label="Remove attached song"
				title="Remove song"
			>
				<CommunityIcon name="x" size={compact ? 11 : 13} />
			</button>
		{/if}
	</div>
{/if}
