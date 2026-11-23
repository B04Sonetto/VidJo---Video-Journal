import { isFutureDate } from '#lib/dates';

export type MainView = 'journal' | 'friends' | 'community' | 'profile' | 'notifications';

export type ProfileTab = 'overview' | 'portfolio' | 'achievements' | 'settings' | 'edit';

export type FriendsTab = 'shelf' | 'messages';

class Navigation {
	/** Active main view tab */
	view = $state<MainView>('journal');

	/** Active tab inside the Friends page. */
	friendsTab = $state<FriendsTab>('shelf');

	/** Active tab inside the full profile page. */
	profileTab = $state<ProfileTab>('overview');

	/** When set, the profile page renders this user's profile instead of the current user's. */
	viewingProfileUserId = $state<string | null>(null);

	/** A page ID or date the book should flip to. Consumed by Book.svelte. */
	target = $state<string | null>(null);

	/** Which side of the book to show after the jump. Consumed by Book.svelte. */
	targetSide = $state<'L' | 'R' | null>(null);

	jump(date: string, side: 'L' | 'R' | null = null) {
		// Future pages cannot be created, so never navigate to one either.
		if (isFutureDate(date)) return false;
		this.view = 'journal';
		this.target = date;
		this.targetSide = side;
		return true;
	}

	setView(newView: MainView) {
		this.view = newView;
	}

	setFriendsTab(tab: FriendsTab) {
		this.friendsTab = tab;
	}

	openMessages() {
		this.friendsTab = 'messages';
		this.view = 'friends';
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
