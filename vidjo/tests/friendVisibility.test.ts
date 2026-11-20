import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isFriendExcluded,
	isVisibleToFriend,
	toggleExcludedFriend
} from '../src/lib/friendVisibility.ts';

test('only pages shared with friends are visible in the friends feed', () => {
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'private', share_with_friends: false, excluded_friend_ids: [] },
			'friend-1'
		),
		false
	);
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'friends', share_with_friends: false, excluded_friend_ids: [] },
			'friend-1'
		),
		true
	);
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'community', share_with_friends: false, excluded_friend_ids: [] },
			'friend-1'
		),
		false
	);
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'community', share_with_friends: true, excluded_friend_ids: [] },
			'friend-1'
		),
		true
	);
});

test('a friend-specific exclusion hides a shared page', () => {
	assert.equal(isFriendExcluded(['friend-1'], 'friend-1'), true);
	assert.equal(isFriendExcluded(['friend-1'], 'friend-2'), false);
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'friends', share_with_friends: false, excluded_friend_ids: ['friend-1'] },
			'friend-1'
		),
		false
	);
	assert.equal(
		isVisibleToFriend(
			{ privacy: 'friends', share_with_friends: false, excluded_friend_ids: ['friend-1'] },
			'friend-2'
		),
		true
	);
});

test('toggling a friend exclusion adds and removes only that friend', () => {
	const current = ['friend-1'];
	assert.deepEqual(toggleExcludedFriend(current, 'friend-2'), ['friend-1', 'friend-2']);
	assert.deepEqual(toggleExcludedFriend(['friend-1', 'friend-2'], 'friend-1'), ['friend-2']);
	assert.deepEqual(current, ['friend-1']);
	assert.deepEqual(toggleExcludedFriend(null, 'friend-1'), ['friend-1']);
});
