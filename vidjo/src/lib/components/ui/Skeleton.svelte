<script lang="ts">
	let {
		class: className = 'h-4 w-full',
		paper = false
	}: {
		class?: string;
		paper?: boolean;
	} = $props();
</script>

<span class="{paper ? 'skeleton-paper' : 'skeleton'} block {className}" aria-hidden="true"></span>
