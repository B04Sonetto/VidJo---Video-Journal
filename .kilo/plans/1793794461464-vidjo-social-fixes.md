# VidJo Social Fixes & Notifications Plan

## Current State Assessment

**Issues reported by user:**

1. **Share friends does not work** — PrivacyPicker's Friends toggle in `RightPage.svelte` calls `journal.setFriendsSharing()` which updates local state and queues a save via `queueSave()` → `flush()` (400ms debounce). Local state updates synchronously, but `FriendsView.svelte`'s `$effect` that calls `friends.syncOwnPosts()` may not reliably re-derive shelves after sharing toggles. Additionally, `getMyFriendsEntries()` at `friends.svelte.ts:354` filters entries requiring `entry.title || entry.mind || entry.videoPath` — mood-only entries are excluded from the friends feed.

2. **Green/red/gray friend visibility buttons don't work** — `RightPage.svelte:241-258` render per-friend toggle buttons calling `toggleFriend(friend.id)` → `journal.updateCurrent({ excludedFriendIds, includedFriendIds })`. Local state updates synchronously via `Object.assign`, but the buttons' visual state (`isExcluded`/`isIncluded`) reads from `entry.excludedFriendIds`/`entry.includedFriendIds` which should update. The issue may be that `queueSave` debounces and if the user navigates away before flush, changes may not persist remotely.

3. **Friend saves journal, shares with friends, mood not updating** — Same filter as issue 1: `getMyFriendsEntries()` excludes entries where only `mood` is set (no title/mind/videoPath). A friend who sets a mood and saves won't appear in your feed.

4. **Discover view should be golden** — `CommunityView.svelte` discovery section uses `bg-paper` (cream/white). Should use gold accent colors (`#D4A24C`, `#E8C9A0`) to match the "golden" theme request.

5. **Joining too many communities keeps going back to your communities** — `joinAndOpen()` sets `activeSlug = slug` and `showDiscovery = false`. `feedVisible = community.hasJoined && !showDiscovery`. If joining multiple communities rapidly, state races may leave `showDiscovery` true or `hasJoined` not yet reflected from Supabase refresh, keeping the user stuck in discovery.

6. **Can't leave community** — `leaveCommunity()` calls `community.toggleJoin(slug)` which issues a Supabase DELETE on `vidjo_community_members`. If RLS blocks deletion or the query fails, `toggleJoin` reverts optimistically and shows a toast the user may miss. Need to verify Supabase RLS allows members to delete their own membership row.

7. **No auto-refresh on friend requests** — Friend requests only load on `friends.init()` and `refreshRemote()`. No Supabase real-time subscription on `vidjo_friend_requests`. User must re-navigate to see new incoming requests.

8. **Remove emojis, use icons** — Found emojis across components:
   - `FriendJournalModal.svelte`: ✕ (close), ★ (reflection), ✿ (empty state)
   - `FriendsView.svelte`: ✕ (close modal)
   - `LeftPage.svelte`: ✦ (decorative ×3)
   - `LoginScreen.svelte`: ✦ (decorative ×4), ✓ (available)
   - `ProfileModal.svelte`: ✦, ✕, ✓, ✨ (badge labels), 👥 (badge icon), preset avatar emojis (✨🎨📚🎧🚀🐱🌱🎬)
   - `PrivacyPicker.svelte`: ✓ (active checkmark)
   - `SocialModal.svelte`: ✨, ✕, 👥, 🌍, 🔍, 📹
   - `RightPage.svelte`: ✦ (save button ×2)
   - `StickerTray.svelte`: ✦ (×2)
   - `CommunityView.svelte`: ✦, ★

9. **Create notifications tab** — New main navigation view `'notifications'` showing: incoming friend requests, comments on the user's posts from others. Needs real-time updates.

## Affected Files

| File | Purpose |
|------|---------|
| `src/lib/state/friends.svelte.ts` | Friend state, `getMyFriendsEntries()` filter, real-time subscriptions |
| `src/lib/state/community.svelte.ts` | Community join/leave, `toggleJoin()` error handling |
| `src/lib/state/journal.svelte.ts` | `queueSave`, `flush`, sharing persistence |
| `src/lib/components/RightPage.svelte` | PrivacyPicker integration, friend visibility buttons |
| `src/lib/components/FriendsView.svelte` | `$effect` sync, shelves derivation |
| `src/lib/components/CommunityView.svelte` | Discovery golden theme, join/leave flow, `feedVisible` logic |
| `src/lib/components/ProfilePage.svelte` | Settings tab — may need notifications entry point |
| `src/lib/components/ProfileModal.svelte` | Emoji removal (avatar presets, badges, checkmarks) |
| `src/lib/components/PrivacyPicker.svelte` | ✓ emoji → icon |
| `src/lib/components/SocialModal.svelte` | Emoji removal |
| `src/lib/components/FriendJournalModal.svelte` | Emoji removal |
| `src/lib/components/LeftPage.svelte` | ✦ emoji removal |
| `src/lib/components/LoginScreen.svelte` | Emoji removal |
| `src/lib/components/StickerTray.svelte` | ✦ emoji removal |
| `src/lib/components/CommunityIcon.svelte` | May need new icon names (check, x, bell, etc.) |
| `src/lib/state/navigation.svelte.ts` | Add `'notifications'` to `MainView` type |
| `src/lib/components/Header.svelte` | Add notifications tab/button |
| `src/lib/components/NotificationsView.svelte` | NEW — notifications UI |

## Design Decisions

### Icon replacements (CommunityIcon names to add)
| Emoji | Replacement Icon | Notes |
|-------|-----------------|-------|
| ✕ | `x` | Close buttons |
| ✓ | `check` | Active states, availability |
| ✦ | `spark` or `sparkles` | Decorative stars |
| ✿ | `sparkles` | Empty state |
| ★ | `star` | Reflection marker |
| ✨ | `sparkles` | Badges, "active development" |
| 🔍 | `search` (new) | Search icon |
| 📹 | `video` (new) | Video indicator |
| 👥 | `users` | Friends badge |
| 🌍 | `globe` | Community badge |
| 🎨📚🎧🚀🐱🌱🎬 | `spark`, `book`, `music`, `rocket(new)`, `cat(new)`, `leaf`, `video(new)` | Avatar presets |

### Notifications data model
No new DB tables needed. Notifications derive from existing data:
- **Friend requests**: `friends.incomingRequests` (already in state)
- **Comments on your posts**: Query `vidjo_comments` where `post_owner_id = currentUserId` AND `author_id != currentUserId`, context in `('friends', 'community')`
- Real-time: Supabase channel on `vidjo_friend_requests` (insert for incoming) + `vidjo_comments` (insert where owner is current user)

### Mood filter fix
`getMyFriendsEntries()` line 354: change `(entry.title || entry.mind || entry.videoPath)` to `(entry.title || entry.mind || entry.videoPath || entry.mood)` so mood-only shared entries appear in friends' feeds.

### Discovery golden theme
Wrap discovery section in gold-gradient background, gold text accents, gold-bordered community cards.

### Leave community
`toggleJoin()` already reverts on error. Add explicit toast on successful leave (already exists at line 317). The issue is likely Supabase RLS — document that RLS policy must allow `DELETE` on `vidjo_community_members` where `user_id = auth.uid()`.

### Real-time friend requests
Add `subscribeToFriendRequests()` in `friends.svelte.ts` using Supabase `channel().on('postgres_changes', ...)`. On insert of a pending request where `to_user = currentUserId`, call `refreshRemote()` or incrementally add to `friendRequests`.

## Task List

### Phase 1: Bug fixes (sharing, mood, visibility buttons)

1. **Fix mood filter in friends feed** — `friends.svelte.ts:354`: add `|| entry.mood` to the condition so mood-only shared entries appear.

2. **Fix `syncOwnPosts()` reactivity** — `FriendsView.svelte:124-143`: the `$effect` touches entry properties with `void` but may not reliably trigger. Replace with a more robust dependency on `journal.entries` keys or call `syncOwnPosts()` explicitly after sharing toggles. Add a `$effect` on `journal.entries` that calls `friends.syncOwnPosts()` untracked.

3. **Ensure friend visibility buttons persist** — `RightPage.svelte`: `toggleFriend` calls `journal.updateCurrent()` which queues a save. Verify the visual class updates immediately (it reads from `entry` which is mutated synchronously). The main risk is remote persistence if user navigates away before `flush()` debounce completes. Consider calling `await journal.flush()` after `toggleFriend` when remote.

### Phase 2: Community improvements

4. **Golden discover theme** — `CommunityView.svelte`: Add gold gradient background and gold accent styling to the discovery/join view section (the `{:else if !community.hasJoined || showDiscovery}` branch).

5. **Fix join/leave navigation** — `CommunityView.svelte:joinAndOpen()`: ensure `showDiscovery = false` and `activeSlug = slug` are set atomically. After `community.toggleJoin()` completes, verify `feedVisible` becomes true. Consider awaiting `toggleJoin` before navigating.

6. **Fix leave community** — `community.svelte.ts:toggleJoin()`: on successful leave, ensure `persistLocalMemberships()` is called and state reverts correctly on error. Add clearer error toast. Document RLS requirement.

### Phase 3: Real-time notifications

7. **Add real-time friend request subscription** — `friends.svelte.ts`: Add `initRealtime()` method that subscribes to `vidjo_friend_requests` inserts where `to_user = currentUserId` and `status = 'pending'`. Call it from `init()`. On new request, refresh friend requests state.

8. **Add notifications state** — Could extend `friends.svelte.ts` with a `notifications` array, or create a new state file. Recommend extending `friends.svelte.ts` since friend requests already live there. Add `loadCommentNotifications()` that queries `vidjo_comments` where `post_owner_id = currentUserId` and `author_id != currentUserId`.

### Phase 4: Emoji → icon replacement

9. **Add missing icons to `CommunityIcon.svelte`** — Add cases for: `x` (close), `check` (already exists), `search`, `video`, `rocket`, `cat`. `check` already exists. `spark`/`sparkles`/`star`/`globe`/`users`/`leaf`/`book`/`music` already exist.

10. **Replace emojis in all components** — Listed above. Replace each emoji with `<CommunityIcon name="..." />` or inline SVG.

### Phase 5: Notifications tab

11. **Add `'notifications'` to `MainView`** — `navigation.svelte.ts: type MainView`.

12. **Create `NotificationsView.svelte`** — New component showing two sections:
    - Friend requests (incoming) with Accept/Decline buttons
    - Comments on your posts (friends + community contexts) with post title, commenter name, comment text, timestamp
    - Empty states for each section
    - Real-time updates via the subscriptions from step 7-8

13. **Wire notifications into navigation** — `Header.svelte`: add notifications tab/button. `nav.setView('notifications')` handler.

## Validation

- `npm run check` → 0 errors
- `npm run build` → succeeds
- Manual verification:
  - Share a page with friends → appears in friend's feed (including mood-only entries)
  - Toggle friend visibility (exclude/include) → button visual state updates immediately, persists on save
  - Join a community → discovery view transitions to feed, not stuck
  - Leave a community → membership removed, "Left X" toast shows
  - Send friend request from second account → request appears in real-time without refresh
  - Comment on your own post from second account → appears in notifications
  - All emojis replaced with icons (visual check)

## Open Questions (need user confirmation)

1. **Notifications tab placement**: Add as a new main nav tab in Header alongside Journal/Friends/Community/Profile, or as a sub-section within the Friends view? Recommend: new main nav tab.

2. **Real-time channel for comments**: Subscribe to `vidjo_comments` inserts in real-time, or poll? Recommend: Supabase real-time channel for immediate display.

3. **RLS policies**: The `vidjo_community_members` DELETE and `vidjo_friend_requests` real-time subscription require appropriate Supabase RLS policies. Need to confirm these exist or document them as prerequisites.

4. **Notification persistence**: Store notifications in localStorage or only in-memory state? Recommend: in-memory state (loaded on init, updated via real-time) since notifications are transient.