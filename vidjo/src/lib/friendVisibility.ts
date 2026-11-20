import type { EntryRow } from '#lib/types';

type SharedEntry = Pick<EntryRow, 'privacy' | 'share_with_friends' | 'excluded_friend_ids'>;

export function isFriendExcluded(excludedFriendIds: readonly string[] | null, friendId: string) {
	return (excludedFriendIds ?? []).includes(friendId);
}

export function isVisibleToFriend(entry: SharedEntry, friendId: string): boolean {
	const sharedWithFriends =
		entry.privacy === 'friends' ||
		(entry.privacy === 'community' && entry.share_with_friends === true);
	return sharedWithFriends && !isFriendExcluded(entry.excluded_friend_ids, friendId);
}

export function toggleExcludedFriend(
	excludedFriendIds: readonly string[] | null,
	friendId: string
): string[] {
	const excluded = excludedFriendIds ?? [];
	return isFriendExcluded(excluded, friendId)
		? excluded.filter((id) => id !== friendId)
		: [...excluded, friendId];
}
