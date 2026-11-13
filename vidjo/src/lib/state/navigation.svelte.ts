import { isFutureDate } from '#lib/dates';

export type MainView = 'journal' | 'friends' | 'community' | 'profile' | 'notifications';

export type ProfileTab = 'overview' | 'portfolio' | 'achievements' | 'settings' | 'edit';

class Navigation {
	/** Active main view tab */
	view = $state<MainView>('journal');

	/** Active tab inside the full profile page. */
	profileTab = $state<ProfileTab>('overview');

	/** When set, the profile page renders this user's profile instead of the current user's. */
	viewingProfileUserId = $state<string | null>(null);

	/** A date the book should flip to. Consumed by Book.svelte. */
	target = $state<string | null>(null);

	jump(date: string) {
		// Future pages cannot be created, so never navigate to one either.
		if (isFutureDate(date)) return false;
		this.view = 'journal';
		this.target = date;
		return true;
	}

	setView(newView: MainView) {
		this.view = newView;
	}

	openProfile(tab: ProfileTab = 'overview') {
		this.viewingProfileUserId = null;
		this.profileTab = tab;
		this.view = 'profile';
	}

	viewProfile(userId: string) {
		this.viewingProfileUserId = userId;
		this.profileTab = 'overview';
		this.view = 'profile';
	}
}

export const nav = new Navigation();
