<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import PwaNotice from '#lib/components/PwaNotice.svelte';
	import { initFocusTrap } from '#lib/focusTrap';
	import { profile } from '#lib/state/profile.svelte';
	import { pwa } from '#lib/state/pwa.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/** Keep the iOS/Android status bar in step with the journal theme. */
	const themeColors: Record<string, string> = {
		classic: '#1B102B',
		sunset: '#241218',
		midnight: '#0C1322'
	};

	onMount(() => {
		const cleanupFocusTrap = initFocusTrap();
		const cleanupPwa = pwa.init();

		return () => {
			cleanupFocusTrap();
			cleanupPwa();
		};
	});

	$effect(() => {
		const color = themeColors[profile.theme] ?? themeColors.classic;
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
