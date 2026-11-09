<script lang="ts">
	import type { Snippet } from 'svelte';
	import CommunityIcon from '#lib/components/CommunityIcon.svelte';

	type Variant = 'primary' | 'outline' | 'paper' | 'ghost' | 'danger';
	type Size = 'sm' | 'md' | 'lg';

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		disabled = false,
		loading = false,
		icon = '',
		trailingIcon = '',
		onclick,
		children,
		class: className = ''
	}: {
		variant?: Variant;
		size?: Size;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		loading?: boolean;
		icon?: string;
		trailingIcon?: string;
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
		class?: string;
	} = $props();

	const base =
		'inline-flex items-center justify-center gap-2 rounded-xl font-ui font-bold whitespace-nowrap transition-all duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';

	const sizes: Record<Size, string> = {
		sm: 'min-h-9 px-3 text-xs',
		md: 'min-h-11 px-4 text-sm',
		lg: 'min-h-12 px-5 text-[15px]'
	};

	const variants: Record<Variant, string> = {
		primary:
			'bg-gold text-[#2A1B3D] shadow-[0_6px_18px_rgba(212,162,76,.26)] hover:bg-[#E2B666] hover:shadow-[0_8px_22px_rgba(212,162,76,.34)]',
		outline:
			'border border-[#5A4580] bg-desk-2 text-[#EDE6F7] hover:border-lav/70 hover:bg-[#34214E]',
		paper:
			'border-[1.5px] border-line bg-[#FFFDF6] text-ink hover:border-[#BFAE86] hover:bg-[#FBF3DF]',
		ghost: 'text-[#CFC3E6] hover:bg-white/[.08] hover:text-white',
		danger: 'border border-[#D19A9A]/60 bg-[#3A222B] text-white hover:bg-[#4A2A32]'
	};

	const iconSize = $derived(size === 'sm' ? 14 : 16);
</script>

<button
	{type}
	disabled={disabled || loading}
	aria-busy={loading}
	class="{base} {sizes[size]} {variants[variant]} {className}"
	{onclick}
>
	{#if loading}
		<span
			class="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
			aria-hidden="true"
		></span>
	{:else if icon}
		<CommunityIcon name={icon} size={iconSize} class="shrink-0" />
	{/if}
	{@render children?.()}
	{#if trailingIcon && !loading}
		<CommunityIcon name={trailingIcon} size={iconSize} class="shrink-0" />
	{/if}
</button>
