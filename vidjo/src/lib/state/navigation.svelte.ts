export type MainView = 'journal' | 'friends' | 'community' | 'profile';

export type ProfileTab = 'overview' | 'portfolio' | 'achievements' | 'settings' | 'edit';

class Navigation {
	/** Active main view tab */
	view = $state<MainView>('journal');

	/** Active tab inside the full profile page. */
	profileTab = $state<ProfileTab>('overview');

	/** A date the book should flip to. Consumed by Book.svelte. */
	target = $state<string | null>(null);

	jump(date: string) {
		this.view = 'journal';
		this.target = date;
	}

	setView(newView: MainView) {
		this.view = newView;
	}

	openProfile(tab: ProfileTab = 'overview') {
		this.profileTab = tab;
		this.view = 'profile';
	}
}

export const nav = new Navigation();
