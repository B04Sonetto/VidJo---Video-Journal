<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { initFocusTrap } from '#lib/focusTrap';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(initFocusTrap);
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
