class Viewport {
	single = $state(false);
	reduced = $state(false);

	init() {
		if (typeof window === 'undefined') return () => {};

		const single = window.matchMedia('(max-width: 899px)');
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

		const update = () => {
			this.single = single.matches;
			this.reduced = reduced.matches;
		};

		update();
		single.addEventListener('change', update);
		reduced.addEventListener('change', update);

		return () => {
			single.removeEventListener('change', update);
			reduced.removeEventListener('change', update);
		};
	}
}

export const viewport = new Viewport();
