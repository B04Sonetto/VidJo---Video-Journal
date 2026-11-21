<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import PwaNotice from '#lib/components/PwaNotice.svelte';
	import SpotifyPlayer from '#lib/components/SpotifyPlayer.svelte';
	import { initFocusTrap } from '#lib/focusTrap';
	import { notifications } from '#lib/state/notifications.svelte';
	import { profile } from '#lib/state/profile.svelte';
	import { pwa } from '#lib/state/pwa.svelte';
	import { themeMeta } from '#lib/themes';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		const cleanupFocusTrap = initFocusTrap();
		const cleanupPwa = pwa.init();
		notifications.init();

		return () => {
			cleanupFocusTrap();
			cleanupPwa();
		};
	});

	/** Keep the iOS/Android status bar in step with the journal theme. */
	$effect(() => {
		const color = themeMeta(profile.theme).desk;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Almendra:wght@400;700&family=DM+Sans:wght@400;500;700&family=Gaegu:wght@400;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children()}
<PwaNotice />
<SpotifyPlayer />
