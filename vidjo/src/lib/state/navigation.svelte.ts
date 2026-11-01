export type MainView = 'journal' | 'friends' | 'community' | 'profile';

class Navigation {
	/** Active main view tab */
	view = $state<MainView>('journal');

	/** A date the book should flip to. Consumed by Book.svelte. */
	target = $state<string | null>(null);

	jump(date: string) {
		this.view = 'journal';
		this.target = date;
	}

	setView(newView: MainView) {
		this.view = newView;
	}
}

export const nav = new Navigation();
