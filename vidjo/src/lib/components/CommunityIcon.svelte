<script lang="ts">
	let {
		name = 'globe',
		size = 18,
		class: className = ''
	}: {
		name?: string;
		size?: number;
		class?: string;
	} = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if name === 'globe'}
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
		<path d="M2 12h20"></path>
	{:else if name === 'spark'}
		<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"></path>
	{:else if name === 'sparkles'}
		<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"></path>
		<path d="M19 15.5 19.7 18l2.3.7-2.3.8-.7 2.5-.8-2.5-2.2-.8 2.2-.7Z"></path>
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4"></circle>
		<path
			d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
		></path>
	{:else if name === 'music'}
		<path d="M9 18V5l12-2v13"></path>
		<circle cx="6" cy="18" r="3"></circle>
		<circle cx="18" cy="16" r="3"></circle>
	{:else if name === 'book'}
		<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"
		></path>
	{:else if name === 'heart'}
		<path
			d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
		></path>
	{:else if name === 'users'}
		<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
		<circle cx="9" cy="7" r="4"></circle>
		<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
		<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
	{:else if name === 'leaf'}
		<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"
		></path>
		<path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>
	{:else if name === 'trending'}
		<path d="m3 17 6-6 4 4 8-8"></path>
		<path d="M15 7h6v6"></path>
	{:else if name === 'flame'}
		<path
			d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.3 3.5 3.2 5 5.5A8 8 0 0 1 8.5 14.5z"
		></path>
	{:else if name === 'star'}
		<polygon
			points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
		></polygon>
	{:else if name === 'check'}
		<path d="M20 6 9 17l-5-5"></path>
	{:else if name === 'cat'}
		<path
			d="M11.76 2.823c2.568.29 4.686 2.197 5.226 4.776.668 3.173-2.827 5.236-3.768 5.236a3.25 3.25 0 0 1-1.713-.491 3.25 3.25 0 0 0-2.219-1.088l-.347-.272-.347.272a3.24 3.24 0 0 0-2.219 1.088 3.25 3.25 0 0 1-1.713.491c-.941 0-4.437-2.063-3.768-5.236.54-2.579 2.658-4.486 5.226-4.776a11.6 11.6 0 0 1 3.323 0ZM7.86 13.976c-.424-.242-.73-.517-.936-.792l-1.207-1.609c-.773-1.03-1.204-2.406-.986-3.799.229-1.474 1.079-2.798 2.266-3.722l1.04-.811c1.187-.925 2.763-1.224 4.15-.798l.776.237c1.387.424 2.706 1.292 3.851 2.557l.195.216c1.145 1.264 1.569 2.847 1.078 4.33l-.143.345c-.491 1.482-1.958 2.398-3.393 2.226l-1.313-.156c-1.436-.172-2.54-1.077-2.905-2.024l-.189-.49c-.366-.948-1.121-1.789-2.204-2.24Z"
		/>
		<circle cx="9.14" cy="10.88" r=".775" />
		<circle cx="13.04" cy="10.88" r=".775" />
	{:else if name === 'x'}
		<path d="M18 6l-12 12M6 6l12 12"></path>
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="8"></circle>
		<path d="m21 21-4.3-4.3"></path>
	{:else if name === 'video'}
		<polygon points="14 2 6 7.8 6 16.2 14 22 14 2"></polygon>
		<path d="M9.5 13h5l4-2.5L14.5 8h-5z"></path>
	{:else if name === 'rocket'}
		<path
			d="M5 18h1a5 5 0 0 0 4.533-3.046l4.166-4.166a1 1 0 0 1 1.294 0l2.172 2.172a1 1 0 0 1 0 1.294l-4.166 4.166A5 5 0 0 0 19 19h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1ZM7.05 9.95a1 1 0 0 1 1.414 0l4.166 4.166a1 1 0 0 1 0 1.414l-4.166 4.166a1 1 0 0 1-1.414 0l-4.166-4.166a1 1 0 0 1 0-1.414l4.166-4.166a1 1 0 0 1 1.414 0Z"
		></path>
	{:else if name === 'user-minus'}
		<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
		<circle cx="9" cy="7" r="4"></circle>
		<path d="M22 21v-2a4 4 0 00-3-3.87"></path>
		<path d="M16 3.13a4 4 0 010 7.75"></path>
	{:else if name === 'arrow-left'}
		<path d="M19 12H5M11 18l-6-6 6-6"></path>
	{:else if name === 'arrow-right'}
		<path d="M5 12h14M13 6l6 6-6 6"></path>
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14"></path>
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3"></circle>
		<path
			d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
		></path>
	{:else if name === 'copy'}
		<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	{:else if name === 'bell'}
		<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
		<path d="M13.7 21a2 2 0 0 1-3.4 0"></path>
	{:else if name === 'user'}
		<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
		<circle cx="12" cy="7" r="4"></circle>
	{:else if name === 'calendar'}
		<rect width="18" height="18" x="3" y="4" rx="2"></rect>
		<path d="M16 2v4M8 2v4M3 10h18"></path>
	{:else if name === 'play'}
		<path d="M7 4.5v15l13-7.5z"></path>
	{:else if name === 'trash'}
		<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
		></path>
	{:else if name === 'lock'}
		<rect x="4" y="10" width="16" height="10" rx="2"></rect>
		<path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
	{:else if name === 'eye'}
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
		<circle cx="12" cy="12" r="3"></circle>
	{:else if name === 'eye-off'}
		<path d="m3 3 18 18M10.6 10.6a3 3 0 0 0 4.2 4.2"></path>
		<path
			d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7c1 0 1.9-.1 2.7-.4"
		></path>
	{:else if name === 'shield'}
		<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>
	{:else if name === 'mail'}
		<rect x="2" y="4" width="20" height="16" rx="2"></rect>
		<path d="m22 7-10 6L2 7"></path>
	{:else if name === 'alert'}
		<circle cx="12" cy="12" r="9"></circle>
		<path d="M12 8v4M12 16h.01"></path>
	{:else if name === 'refresh'}
		<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"></path>
	{:else if name === 'external'}
		<path d="M14 3h7v7M21 3l-9 9"></path>
		<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>
	{:else if name === 'upload'}
		<path d="M12 16V4M7 9l5-5 5 5"></path>
		<path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path>
	{:else if name === 'camera'}
		<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Z"
		></path>
		<circle cx="12" cy="13" r="3.5"></circle>
	{:else if name === 'chevron-down'}
		<path d="m6 9 6 6 6-6"></path>
	{:else if name === 'pen'}
		<path d="M12 20h9"></path>
		<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>
	{:else if name === 'grid'}
		<rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
		<rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
		<rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
		<rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
	{:else if name === 'logout'}
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>
	{:else}
		<circle cx="12" cy="12" r="9"></circle>
		<path d="M3 12h18"></path>
	{/if}
</svg>
