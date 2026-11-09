<script lang="ts">
	let {
		size = 18,
		class: className = ''
	}: {
		size?: number;
		class?: string;
	} = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	class="animate-spin {className}"
	aria-hidden="true"
>
	<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity=".25"></circle>
	<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
	></path>
</svg>
