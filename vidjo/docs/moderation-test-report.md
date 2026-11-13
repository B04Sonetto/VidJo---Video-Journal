# Moderation, warnings, bans, censorship, and calendar safety — test report

Date: 2026-11-13

Status: **Implementation complete. Automated checks pass. Live Supabase checks
must be run after applying `supabase/schema.sql` to the project.**

## 1. What was tested

This change covers:

1. Direct insults produce a warning, but the post or comment is never deleted.
2. Admins can warn and ban from a report or from the Members list.
3. A banned member sees a suspension screen with the reason and can sign out.
4. Banning only changes the role and ban metadata; journals, videos, comments,
   friends, reactions, and the auth account stay in place.
5. Shared page text and comments are censored for readers.
6. Private journal text and video audio are not censored.
7. Future calendar days are locked in the UI and rejected by the database.
8. The sticker delete control is larger, visible on hover/selection, and no
   longer starts a drag when pressed.

## 2. Automated checks

Commands were run from the `vidjo` project root.

| Command         | Result                                              |
| --------------- | --------------------------------------------------- |
| `npm run check` | Pass — `svelte-check found 0 errors and 0 warnings` |
| `npm run lint`  | Pass — Prettier clean and ESLint clean              |
| `npm run build` | Pass — SSR and client production build completed    |

There is no unit-test runner configured in `package.json` yet. The checks above
are static/type/format checks, not behavioural tests.

## 3. Before manual testing

1. Open the Supabase SQL editor for the VidJo project.
2. Run the full `supabase/schema.sql`. The moderation section is idempotent and
   safe to re-run.
3. Confirm the new RPCs exist:
   - `vidjo_moderation_status()`
   - `vidjo_ack_warning(uuid)`
   - `vidjo_admin_warn_user(uuid, text, text)`
   - `vidjo_admin_ban_user(uuid, text)`
   - `vidjo_admin_unban_user(uuid)`
4. Confirm `vidjo_admin_list_reports(int)` returns the new `reported_user_id`
   column.
5. Use two normal accounts and one admin account. Keep a private page with a
   video on one normal account for the preservation checks.

## 4. Manual test matrix

Mark each row when it has been executed against the live project.

### A. Future dates and one page per day

| ID  | Steps                                                               | Expected result                                                                     | Status |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| A1  | Sign in. Open the calendar. Look at days after today.               | Future cells are greyed out, show a lock, and have `disabled`/`aria-disabled`.      | ☐      |
| A2  | Click a future day.                                                 | Nothing opens. A toast says future pages are locked.                                | ☐      |
| A3  | Set the browser clock to a future date, reload, and click that day. | The page is still treated as future and blocked by the calendar guard.              | ☐      |
| A4  | From the browser console, call `journal.ensureEntry('2999-01-01')`. | Returns `null`, shows the toast, and creates no entry.                              | ☐      |
| A5  | From the browser console, call `nav.jump('2999-01-01')`.            | Returns `false` and the view does not change.                                       | ☐      |
| A6  | Insert a future row through the REST API with a valid user token.   | The database raises `VidJo pages can only be created for today or an earlier date.` | ☐      |
| A7  | Update an existing row's `entry_date` to tomorrow through the API.  | The database rejects the update.                                                    | ☐      |
| A8  | Create a page for today, then try to create a second row for today. | The primary key `(owner_id, entry_date)` keeps it to one row per day.               | ☐      |
| A9  | Create pages for several past days.                                 | Each past day opens normally and keeps its own page.                                | ☐      |

### B. Warnings for direct abuse

| ID  | Steps                                                                 | Expected result                                                                          | Status |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| B1  | As user A, comment on user B's post: `you are an idiot`.              | Comment is saved, the insult is masked for readers, and A receives a warning.            | ☐      |
| B2  | Close and reopen the app as A, or wait for the 60-second status poll. | The warning modal appears with the reason and the "not deleted" note.                    | ☐      |
| B3  | Press "I understand".                                                 | The warning is acknowledged, the modal closes, and the DB row gets `acknowledged_at`.    | ☐      |
| B4  | Reload as A.                                                          | The acknowledged warning does not appear again.                                          | ☐      |
| B5  | As A, share a page containing `you are worthless`.                    | The page stays in the journal, is shared, and a warning is created for A.                | ☐      |
| B6  | As B, open the shared page.                                           | The insulting word is replaced with `***`; the page itself is still present.             | ☐      |
| B7  | As A, type profanity in a private page and do not share it.           | No warning is created and the private text is unchanged.                                 | ☐      |
| B8  | As A, add profanity to a shared page after it was already warned.     | No duplicate warning for the same comment/page source; text is still masked for readers. | ☐      |
| B9  | Post `fuck you` as a comment.                                         | Warning is issued and the phrase is masked.                                              | ☐      |
| B10 | Post a harmless comment such as `you are amazing`.                    | No warning, no mask.                                                                     | ☐      |

### C. Censorship scope

| ID  | Steps                                                               | Expected result                                                              | Status |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| C1  | Put profanity in a private page title/body/reflection.              | The owner sees the original text. No warning or mask.                        | ☐      |
| C2  | Share that page with Friends.                                       | Friend reads masked text; owner still sees the original text.                | ☐      |
| C3  | Share that page with a Community.                                   | Community readers see masked text in the feed and post detail.               | ☐      |
| C4  | Open the Friends journal reader.                                    | Page list, title, main text, reflection, and comments are all masked.        | ☐      |
| C5  | Open a profile's public post list.                                  | Shared post titles are masked.                                               | ☐      |
| C6  | Post a comment containing profanity.                                | Local optimistic copy is masked; the stored row is masked by the DB trigger. | ☐      |
| C7  | Record a video with swearing.                                       | Audio is unchanged and no warning is generated from audio.                   | ☐      |
| C8  | Read the row directly from the database as the owner.               | Shared page text is stored raw; masking is applied when displayed to others. | ☐      |
| C9  | Open Notifications with a comment on a page whose title is profane. | The comment preview and page title are both masked.                          | ☐      |

### D. Admin warning and ban

| ID  | Steps                                                           | Expected result                                                                           | Status |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| D1  | As admin, open Reports and press "Warn author".                 | A reason prompt appears; confirming inserts a manual warning.                             | ☐      |
| D2  | As the warned user, open the app.                               | The warning modal shows the admin's reason.                                               | ☐      |
| D3  | As admin, press "Ban author" on a report.                       | Confirming sets `user_role = 'banned'`, `ban_reason`, `banned_at`, and `banned_by`.       | ☐      |
| D4  | As the banned user, reload the app.                             | Full-screen suspension screen shows the reason and suspension date; no journal is loaded. | ☐      |
| D5  | As the banned user, press "Sign out".                           | Sign-out works even though profile RLS blocks normal reads.                               | ☐      |
| D6  | As the banned user, sign in again.                              | Suspension screen still appears; the account is not deleted.                              | ☐      |
| D7  | As admin, open Members.                                         | The banned member shows a Ban badge and the ban reason.                                   | ☐      |
| D8  | As admin, press "Restore".                                      | Role returns to `user`, ban fields are cleared, and the member can use the app again.     | ☐      |
| D9  | Leave the banned user's tab open while the admin restores them. | Within the next poll or on visibility change, the app reloads and the journal loads.      | ☐      |
| D10 | Try to ban an admin account through the RPC.                    | Rejected with `Admin accounts cannot be banned.`                                          | ☐      |
| D11 | Try to ban yourself through the RPC.                            | Rejected with `You cannot ban your own admin account.`                                    | ☐      |
| D12 | Try to call a warn/ban RPC as a normal user.                    | Rejected with `Admin access required.`                                                    | ☐      |

### E. Ban does not delete data

| ID  | Steps                                                                                      | Expected result                                                     | Status |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------ |
| E1  | Before banning, record counts of the user's entries, comments, videos, friends, reactions. | Record the numbers.                                                 | ☐      |
| E2  | Ban the user.                                                                              | Only `vidjo_profiles` role/ban columns change.                      | ☐      |
| E3  | Recount the same tables.                                                                   | Counts are unchanged. The auth user still exists in `auth.users`.   | ☐      |
| E4  | Restore the user.                                                                          | Their journal, video links, comments, and friends are still intact. | ☐      |

### F. Sticker delete UX

| ID  | Steps                                  | Expected result                                                                 | Status |
| --- | -------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| F1  | Add a sticker to a page.               | The delete button is hidden until the sticker is hovered, focused, or selected. | ☐      |
| F2  | Hover the sticker.                     | A 36 px gold-outlined delete button appears at the top-right, upright.          | ☐      |
| F3  | Press the delete button.               | Only that sticker is removed; the sticker does not start dragging.              | ☐      |
| F4  | Select the sticker, then press delete. | The sticker is removed and the change is saved.                                 | ☐      |
| F5  | Use keyboard focus on the sticker.     | The delete button becomes reachable and has an accessible label.                | ☐      |
| F6  | Use a touch device.                    | The button does not start a drag and is large enough to tap.                    | ☐      |

## 5. Database verification queries

Run these as an admin in the SQL editor after the manual pass.

```sql
-- Warning created for a comment and the comment still exists
select w.reason, w.source_type, w.source_id, w.acknowledged_at, c.body
from public.vidjo_warnings w
left join public.vidjo_comments c on c.id::text = w.source_id
order by w.created_at desc
limit 20;

-- Ban metadata without deleting anything
select user_id, user_role, ban_reason, banned_at, banned_by
from public.vidjo_profiles
where user_role = 'banned';

-- Confirm the auth account still exists
select id, email, created_at
from auth.users
where id = '<banned-user-id>';

-- Confirm journal rows still exist
select count(*) from public.vidjo_entries where owner_id = '<banned-user-id>';
select count(*) from public.vidjo_comments where author_id = '<banned-user-id>';

-- Confirm the future-date trigger
insert into public.vidjo_entries (owner_id, entry_date)
values ('<your-user-id>', current_date + 1);
-- Expected: ERROR: VidJo pages can only be created for today or an earlier date.
```

## 6. Known limitations

- **Word-list censorship is not AI.** It catches the listed words and simple
  spacing/punctuation variants, not leetspeak (`1d10t`), homoglyphs, or coded
  language. The list lives in both `src/lib/censor.ts` and
  `public.vidjo_censor_text()` and must be kept in sync.
- **Warnings are conservative.** Only second-person abuse, a small set of
  threats, and direct phrases such as `fuck you` trigger the automatic warning.
  "You are a bad person" or sarcasm will not trigger it. Moderators can still
  warn manually.
- **Shared page text is masked at display time.** The database keeps the
  author's raw words. A friend or community member who can read the row through
  the API can still see the unmasked value. Comments are masked in storage, so
  comments do not have this gap.
- **Private text and video audio are intentionally untouched.** Profanity in a
  video is allowed by the current policy.
- **UTC vs local date.** The database trigger compares against the server's
  `current_date` (UTC). Near midnight, a member in a timezone ahead of UTC
  (for example UTC+10) can have their local "today" treated as tomorrow by the
  database and be blocked until UTC catches up. The UI uses the browser's local
  date. If this matters for the first users, store the member's UTC offset and
  use it in the trigger.
- **Existing future pages are not deleted.** The trigger stops new ones. Pages
  created before the fix stay in storage until someone chooses to remove them.
- **Ban delivery is poll-based.** Warnings and ban changes are read at startup,
  every 60 seconds while the tab is visible, and when the tab becomes visible.
  There is no email or push notification. Realtime publication is enabled for
  `vidjo_warnings` only.
- **Admin actions use `prompt()`.** It is functional and keyboard-accessible,
  but a custom dialog would look better and support longer reasons.
- **No unit tests yet.** Add tests for `isFutureDate`, `censor`, and the SQL
  functions before this becomes a larger moderation system.

## 7. Recommended follow-up

1. Add Vitest coverage for date guards, censoring, and warning selection.
2. Add a moderation history tab so admins can see previous warnings before
   banning.
3. Replace `prompt()` with a styled modal that supports warning templates.
4. Move shared-page masking into a read-only database view or RPC if raw-text
   access by other members becomes a concern.
5. Decide whether "one page per day" needs a grace rule for UTC+ timezones.
6. Implement the video-moderation plan in `docs/video-moderation-plan.md` only
   after the policy, provider, and budget are chosen.
