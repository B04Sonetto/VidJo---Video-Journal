# Supabase setup

VidJo uses Supabase for username/password accounts, email-code sign-in, journal
rows, private video storage, and student profiles. The app works without Supabase
(device-only mode), but a configured project gives each account its own journal
across devices.

## 1. Environment variables

Create `.env` in the project root:

```sh
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
```

`PUBLIC_SUPABASE_ANON_KEY` is still accepted as a fallback for older projects.
Both keys are public; row-level security is what protects the data.

Restart `npm run dev` after changing `.env`.

## 2. Run the schema

Open **Dashboard → SQL → New query**, paste all of
[`schema.sql`](./schema.sql), and run it. It is safe to re-run. It creates:

- `public.vidjo_entries` with `auth.uid()` row-level security and `video_path` storage.
- `public.vidjo_profiles` with globally unique usernames (enforced by a case-insensitive index `lower(username)`), display names (nicknames), bios, avatars, friend codes, and profile preferences (`accent_color`, `theme`, `default_privacy`, `allow_friend_requests`).
- `public.vidjo_friends` and `public.vidjo_friend_requests`, plus the RPCs listed below.
- `public.vidjo_communities` seeded with the seven default communities, `public.vidjo_community_members`, and a `community_slug` column on entries.
- `public.vidjo_reactions` and `public.vidjo_comments` for feed reactions and comments.
- `public.vidjo_is_member()` and membership checks on every journal/storage/profile/social policy.
- Trigger that stamps `vidjo_registered` onto every new account (email and OAuth).
- Triggers that create a profile row only after the account is confirmed (OAuth sign-in, or a valid email code/link).
- `public.is_username_available(uname)` RPC callable during signup.
- The **private** `vidjo-videos` storage bucket and owner-scoped signed-URL policies.
- `claim_device_entries()` for migrating pre-account rows.
- `public.vidjo_deleted_accounts` plus `vidjo_remember_deleted_account()` and `vidjo_block_deleted_signup()` for the optional Before User Created hook.
- `hook_reject_social_signups()`, a pass-through kept for projects that still have the legacy Before User Created hook configured.

The script is safe to re-run. Re-running it on an existing project adds new
columns/tables without deleting entries, and backfills only missing friend codes.

## 3. Email accounts & security

1. Go to **Authentication → Providers → Email** and make sure Email is enabled.
2. Under **Authentication → Advanced / Security**, turn on **"Prevent email enumeration"**:
   - This ensures direct API callers to `/auth/v1/otp` or `/auth/v1/signup` cannot infer whether an email exists or not.
3. Under **Authentication → URL Configuration**, set:
   - **Site URL** to your production URL (for local work, `http://localhost:5173`).
   - **Redirect URLs** to include every origin you use plus the callback paths:
     - `http://localhost:5173`
     - `http://localhost:5173/auth/callback`
     - `http://localhost:5173/auth/reset`
     - `http://127.0.0.1:5173`, `http://127.0.0.1:5173/auth/callback`, and `http://127.0.0.1:5173/auth/reset`
       (Spotify no longer accepts `localhost` redirects, so open the dev server at `http://127.0.0.1:5173`.
       Google sign-in must use the same origin as Spotify or the session will not carry over.)
     - `https://your-app.vercel.app`
     - `https://your-app.vercel.app/auth/callback`
     - `https://your-app.vercel.app/auth/reset`

4. Open **Authentication → Email Templates** and paste the matching file from
   [`email-templates/`](./email-templates) into each template:

   | Supabase template    | File                                    |
   | -------------------- | --------------------------------------- |
   | Confirm signup       | `email-templates/confirm-signup.html`   |
   | Invite user          | `email-templates/invite.html`           |
   | Magic Link           | `email-templates/magic-link.html`       |
   | Change Email Address | `email-templates/change-email.html`     |
   | Reset Password       | `email-templates/reset-password.html`   |
   | Reauthentication     | `email-templates/reauthentication.html` |

   Each file is a complete HTML document with inline styles, so it works in
   Gmail, Apple Mail, and Outlook without external images or CSS. The confirm,
   magic-link, and reauthentication templates include `{{ .Token }}` so students
   can type the six-digit code in the app instead of following the link.

   To preview one, open the file in a browser. Replace the `{{ .… }}`
   placeholders with sample values if you want to see the final wording.

   Keep the six-digit code length under **Authentication → Providers → Email →
   Email OTP Length** (default `6`) so it matches the app's code field.

### Password + Unique Username accounts

The **Create an account** form asks for an email, password, unique `@username`,
and a separate nickname/display name. It checks username availability live as
students type. Usernames are stored in `public.vidjo_profiles` with a
case-insensitive unique constraint, preventing duplicate handles. The nickname is
what appears on entries and in the social feeds; the username is the permanent
handle.

A profile is created **only after the email is confirmed**. Abandoning a signup
before entering the code does not reserve the username, so you can retry with a
different handle. If you retry the same address, the app asks Supabase to send a
fresh confirmation code instead of silently doing nothing. If your project was
set up with the older trigger, run [`fix-signup-verification.sql`](./fixes/fix-signup-verification.sql)
in the SQL editor once; it switches the triggers and releases usernames held by
unfinished signups.

If signups show `Database error saving new user`, run
[`fix-signup-all.sql`](./fixes/fix-signup-all.sql) in the Supabase SQL editor.
It repairs the profile trigger, removes Supabase's orphaned starter `profiles`
trigger if present, and fixes the optional Before User Created hook together.
It is safe to re-run. Keep the auth hook disabled until the repair completes if
the existing hook is currently preventing all account creation.

If the Postgres log says `relation "public.profiles" does not exist`, the starter
`on_auth_user_created → handle_new_user()` trigger is still installed after
`public.profiles` was deleted. VidJo does not use `public.profiles` — profiles
live in `public.vidjo_profiles` — so do **not** recreate the old table. Running
`fix-signup-all.sql` drops the orphaned trigger and function. Do not delete
`public.vidjo_profiles`; if you did, re-run `schema.sql` to recreate it.

## 4. Friend codes, friends, and requests

Every profile has a unique `VJ-XXXXXX` friend code.

- Codes are generated by `public.vidjo_generate_friend_code(uuid)` using the same
  deterministic algorithm as the browser. A user's existing code is never
  overwritten; missing codes are backfilled when the schema runs.
- Students add friends by entering a friend code. Calls go through
  `public.send_friend_request_by_code(code)`, which looks the code up in Supabase.
- Request actions use `public.accept_friend_request(request_id)`,
  `public.decline_friend_request(request_id)`, and
  `public.cancel_friend_request(request_id)`.
- Removing a friend uses `public.remove_friend(friend_id)`.
- `public.vidjo_friends` stores accepted friendships, and
  `public.vidjo_friend_requests` stores pending, declined, or cancelled requests.
- If a profile has `allow_friend_requests = false`, new requests are rejected.

Friends-only entries become visible to accepted friends through
`public.vidjo_can_view_post(owner, post_date)`. No demo friends are fabricated
when Supabase is configured.

## 5. Communities

Communities are subreddit-style groups seeded by the schema:

`#LSPUStudents`, `#MusicLovers`, `#AnimeLovers`, `#BookClub`, `#GamersGuild`,
`#SmallWins`, `#CampusSunset`, `#CreativeFlow`, `#MidtermSurvivals`,
`#MentalHealth`, `#StudyTogether`, and `#GreenCampus`.

- `public.vidjo_communities` holds the catalog (slug, name, tag, description, icon, color, sort order).
- `public.vidjo_community_members` tracks who joined which community. Students can join or leave at any time.
- Entries shared with `privacy = 'community'` can carry a `community_slug`; the app shows discovery until at least one community is joined, and then filters the feed by joined communities.
- `public.vidjo_reactions` stores `love`, `spark`, `warm`, and `proud` reactions.
- `public.vidjo_comments` stores comments on community and friends posts.
- All social rows are protected by RLS and require the `vidjo_registered` marker.

If the social tables have not been created yet, the app falls back to local
community membership and logs a console warning. Run the updated `schema.sql` to
make membership, requests, reactions, and comments persist across deployments.

If account creation fails with **"Database error saving new user"**, run
[`fixes/fix-signup-profile-trigger.sql`](fixes/fix-signup-profile-trigger.sql) in
the Supabase SQL editor. It prevents optional profile creation from aborting
authentication; users can finish profile setup in VidJo after signing in. Check
the Supabase Postgres logs for the underlying profile error.

## 6. Google sign-in (optional)

Google is disabled by default in a new Supabase project. To enable it:

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application).
2. Add authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase, enable Google under **Authentication → Providers → Google**.
4. New Google users are asked to choose a username and nickname on their first sign-in. No profile row is created until they press **Create account**.
5. To stop a deleted account from silently signing up again, re-run `schema.sql`, then open **Authentication → Hooks → Before User Created**, choose **Postgres function**, and select `public.vidjo_block_deleted_signup`. The app records deleted emails in `public.vidjo_deleted_accounts`. Remove a row from that table if a moderator approves restoring the email.

   **Troubleshooting:** if signup fails with `Error running hook URI: pg-functions://postgres/public/vidjo_block_deleted_signup`, run `supabase/fixes/fix-signup-hook.sql` in the SQL editor. The hook used a PL/pgSQL variable named `email`, which shadows the `email` column of `vidjo_deleted_accounts` and aborts with `column reference "email" is ambiguous`. To restore signups immediately while you investigate, disable the hook under **Authentication → Hooks** and re-enable it once the SQL succeeds.

## 7. Private video storage (`vidjo-videos`)

The schema creates `vidjo-videos` as a **private bucket** (`public = false`).
Videos are uploaded to `vidjo-videos/<auth.uid()>/<date>/<timestamp>-<name>`.

- To play videos, the app requests a short-lived **signed URL** in memory (never stored in the database or localStorage).
- Row-level security on `storage.objects` ensures private videos can **only be accessed by the owner**.
- Entries marked with `privacy: 'friends'` or `privacy: 'community'` are readable by their intended audience through signed URLs and the `vidjo_can_view_post()` policy.
- Anyone attempting to access public `/storage/v1/object/public/...` URLs is rejected.

## 8. Shared computer security & caching

- **Videos:** Large video files are stored in **IndexedDB** (`vidjo-media`), _not_ localStorage (which is limited to ~5MB and cannot hold video files). Once a video is uploaded to Supabase private storage, the local IndexedDB copy is automatically deleted.
- **Journal pages:** Journal pages are cached in `localStorage` under `vidjo-journal-v3:<ownerId>` for offline viewing.
- **Cache clearing:** On shared computers, users can clear cached data anytime from **Profile → Settings → Clear local cache** or by checking **"Clear cached pages on sign out"** in the account dropdown menu.

## 9. Direct messages and group chats

Messaging is friends-first and works only for signed-in accounts:

- `public.vidjo_dm_threads` stores one row per conversation (`direct` or `group`).
- `public.vidjo_dm_participants` stores membership, roles (`owner`/`member`), and
  each person's read timestamp.
- `public.vidjo_dm_messages` stores messages. A `client_id` makes retries
  idempotent, so a flaky connection cannot create duplicates.
- Photos are stored in the private `vidjo-dm-images` bucket at
  `<thread_id>/<user_id>/<file>` and linked from `vidjo_dm_messages.image_path`.
  Only thread participants can read them, and the app requests short-lived
  signed URLs instead of storing public links. PNG, JPG, GIF, and WebP up to
  5 MB are allowed.
- Giphy GIFs are stored as links in `vidjo_dm_messages.gif_url` and hotlinked
  from `media*.giphy.com`. The schema only accepts HTTPS Giphy media URLs, and a
  message can carry either a photo or a GIF, never both.

Rules enforced by the schema:

- Direct threads only exist between accepted friends. Sending re-checks the
  friendship, so unfriending makes an existing direct thread read-only.
- Groups are created by an owner who can only invite their own friends. Groups
  can hold up to 12 people. Only the owner can add, remove, or rename members.
- Every write goes through a `SECURITY DEFINER` RPC:
  `vidjo_dm_send` (text and/or an uploaded photo path or Giphy URL),
  `vidjo_dm_send_direct`, `vidjo_dm_create_group`, `vidjo_dm_add_members`,
  `vidjo_dm_remove_member`, `vidjo_dm_leave_group`, `vidjo_dm_rename_group`,
  and `vidjo_dm_mark_read`.
- Reads use `vidjo_dm_inbox`, `vidjo_dm_thread`, and `vidjo_dm_thread_members`.
  Clients only receive `SELECT` grants on the three tables; direct inserts,
  updates, and deletes are revoked.
- Message bodies are censored server-side with the same word list as comments.
- Senders are limited to 20 messages per minute and 200 per day.
- `vidjo_dm_threads`, `vidjo_dm_participants`, and `vidjo_dm_messages` are in the
  Realtime publication, so inboxes and open threads update live.

Re-run `schema.sql` after deploying the messaging UI, then re-run
[`fixes/fix-messaging-features.sql`](./fixes/fix-messaging-features.sql) and
[`fixes/fix-chat-upgrades.sql`](./fixes/fix-chat-upgrades.sql) **in that order**.
Do not run `schema.sql` last on a project that already has file attachments: it
recreates an older `vidjo_dm_send` overload. If you have already done that, run
[`fixes/fix-dm-send-ambiguity.sql`](./fixes/fix-dm-send-ambiguity.sql) once to
remove the stale overloads.

## 10. Message push notifications (optional)

Message alerts have two modes:

- **While VidJo is open** — no server setup. In Profile → Settings → Privacy, tap **Turn on** for Message notifications and accept the browser permission prompt. A notification appears for incoming messages that are not in the conversation you are reading.
- **In the background** — needs VAPID keys and the `dm-push` Edge Function. Without them the toggle still gives foreground alerts, so the feature is useful even before the server side is deployed.

Background setup:

1. Generate a VAPID key pair (for example `npx web-push generate-vapid-keys`).
2. Add `PUBLIC_VAPID_PUBLIC_KEY=<public key>` to `vidjo/.env` and redeploy the app. The public key is safe to expose to browsers.
3. Store the other half as Supabase secrets (Dashboard → Edge Functions → Secrets): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (for example `mailto:you@example.com`). They must match the public key from step 2.
4. Run [`fixes/fix-push-notifications.sql`](./fixes/fix-push-notifications.sql) in the SQL editor. It creates `vidjo_push_subscriptions` with owner-only RLS; the Edge Function reads all rows with the service role.
5. Deploy the sender: `supabase functions deploy dm-push`.
6. Dashboard → Database → Webhooks → Create a webhook for `public.vidjo_dm_messages`, event `INSERT`, type `HTTP Request`, URL `https://<project-ref>.supabase.co/functions/v1/dm-push`, with an authorization header of `Bearer <service_role_key>`.
7. Turn notifications on from each device. The browser subscription is saved to `vidjo_push_subscriptions`, and the function fans each new message out to every thread member except the sender.

Tapping a notification focuses the open app, or opens it if it was closed. Subscriptions rejected with 404/410 by the push service are deleted automatically.

When `PUBLIC_VAPID_PUBLIC_KEY` is empty, the app deliberately never calls `pushManager.subscribe()` — foreground notifications still work and no subscription rows are created.

## 11. Journal streaks

Streaks are calculated from the same pages the calendar counts: a saved page or
any page with a mood, title, thought, reflection, sticker, video, or friend
exception. Sample pages never count.

- `public.vidjo_streak_for(target uuid)` returns
  `{ current, longest, totalDays, todayCounted }` as JSON. It is aggregate only,
  so no page content leaves the database.
- The RPC returns `null` unless the caller is the owner or an accepted friend,
  which is what lets friends' profiles show a streak without exposing entries.
- A streak stays alive through the whole of today. If today is still blank the
  current run counts back from yesterday, so the number does not drop at
  midnight before the member has written.
- The client mirrors the same rules in `src/lib/streak.ts` for the journal
  header, badges, and calendar heatmap.

Re-run `schema.sql` so `vidjo_streak_for` exists. If the live project already
has the older one-argument version, run `supabase/fixes/fix-timezone.sql` to replace
it and to widen the future-page trigger for members outside UTC.

## Troubleshooting

| Symptom                                                                                     | Fix                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email code returns error for non-existent email                                             | Enable **Prevent email enumeration** in Supabase Auth settings.                                                                                                                         |
| `relation "public.profiles" does not exist` on signup                                       | Run `supabase/fixes/fix-signup-all.sql`. It drops the orphaned Supabase starter `on_auth_user_created` trigger. Do not recreate `public.profiles` — VidJo uses `public.vidjo_profiles`. |
| Username is already taken                                                                   | Usernames are globally unique. Pick a different handle.                                                                                                                                 |
| Account appears before the code is entered, or retrying says username taken / sends no code | Run `supabase/fixes/fix-signup-verification.sql` in the SQL editor.                                                                                                                     |
| Friend code is not found                                                                    | Both accounts must exist in `vidjo_profiles`, and the code must include the `VJ-` prefix. Re-run `schema.sql` if codes are missing.                                                     |
| Communities or friends disappear after deploy                                               | Re-run `schema.sql` so the social tables, `community_slug`, and RPCs exist. Local membership is only a fallback.                                                                        |
| Video does not play                                                                         | Check that the `vidjo-videos` bucket exists and re-run `schema.sql`.                                                                                                                    |
| Photos do not send                                                                          | Check that the private `vidjo-dm-images` bucket and its storage policies exist; re-run `schema.sql`.                                                                                    |
| GIF button is missing                                                                       | Set `PUBLIC_GIPHY_API_KEY` and restart the dev server or redeploy.                                                                                                                      |
| GIFs do not send                                                                            | Re-run `schema.sql`, then `fixes/fix-messaging-features.sql` and `fixes/fix-chat-upgrades.sql` in that order.                                                                           |
| Message send says "Could not choose the best candidate function"                            | Run `fixes/fix-dm-send-ambiguity.sql` once. It removes the 5- and 6-argument `vidjo_dm_send` overloads left behind by re-running older migrations.                                      |
| Shared browser has old journal entries                                                      | Sign out with "Clear cached pages on sign out" checked.                                                                                                                                 |
| Pages will not sync just after local midnight                                               | Run `supabase/fixes/fix-timezone.sql`. The future-page trigger compared against the UTC date, so members east of UTC were blocked until UTC caught up.                                  |
| Friend's streak looks one day behind                                                        | Run `supabase/fixes/fix-timezone.sql` and redeploy. `vidjo_streak_for` now accepts the viewer's local date as `p_today`.                                                                |
