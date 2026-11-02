# VidJo Journal

A video journal for students: record or upload a small video, pick a mood, write
what is on your mind, decorate the page with stickers, and flip through past
entries on a calendar.

This is a SvelteKit rebuild of the `VidJo Journal.html` design, with Supabase
auth/persistence and an offline `localStorage` fallback.

## Features

- **Camera recording** — records directly in the browser with `MediaRecorder`,
  including a live preview, retake, front/back camera flip, and a 3-minute cap.
  You can still upload an existing video instead.
- **Email accounts** — sign up with a username and password, sign in with a
  password, or request a 6-digit email code / magic link. Sessions persist across
  reloads until sign-out.
- **Optional Google sign-in** — Google is available to accounts that already
  registered with email. A Before User Created hook stops Google from creating
  new accounts, and OAuth-only sessions are rejected by the app and by RLS.
- **Per-account journals** — entries are scoped to the signed-in user, with a
  one-time claim of pre-account device data.
- **Video fallback** — recordings are kept in IndexedDB and uploaded to Supabase
  Storage when the bucket is available, so a page never loses its video.
- **Mood picker** — seven hand-drawn moods with pressed/selected states.
- **Journal writing** — title, "What's on your mind?", optional reflection,
  character counters, and a prompt generator.
- **Privacy choices** — private, friends, or community (stored with each entry).
- **Full profile page** — a separate nickname and globally unique `@username`, bio,
  member-since date, friend code, stats, portfolio, achievements, and settings.
  Profile settings cover accent color, theme, default privacy, friend requests, and
  cache controls.
- **Friends** — search by friend code, send/accept/decline/cancel requests, remove
  friends, and see a friend-only feed backed by Supabase.
- **Communities** — subreddit-style discovery with seeded communities including LSPU Students, Music Lovers, Anime Lovers, Book Club, Gamers Guild, and more. Join
  or leave, filter by community, switch between Trending and For You, and react or
  comment on community posts. Community membership and social activity persist in
  Supabase rather than only in the browser.
- **Account menu** — Profile and Settings open the profile page directly; there are
  no separate profile modals.
- **Collapsible sticker tray** — the open/closed state is remembered. Drag
  stickers, add your own image, resize, rotate, delete, and drag stickers across
  the spine between pages.
- **Paper styles** — lined, dotted, grid, or plain. The choice is remembered.
- **Book navigation** — 3D page-flip animation, page-corner controls, arrow-key
  navigation, and a single-page layout below 900px.
- **Calendar** — month view with mood/video markers, a list of entries, and
  jump-to-day navigation.
- **Autosave** — entries are written to `localStorage` immediately and synced to
  Supabase on a short debounce.
- **Accessible controls** — focus styles, keyboard sticker movement/deletion,
  live page announcements, and reduced-motion support.

## Getting started

```sh
npm install
npm run dev
```

Open the printed local URL.

- **With Supabase configured:** create an account with a username, email, and
  password, or sign in with an existing password or a 6-digit email code. A new
  account gets three sample pages plus today's blank page.
- **Without Supabase configured:** the app opens in device-only mode and stores
  everything locally. No login screen is shown.

## Supabase setup

Add two public environment variables to `.env`:

```sh
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
```

`PUBLIC_SUPABASE_ANON_KEY` is also accepted for older projects.

Then run `supabase/schema.sql` in the Supabase SQL editor. It creates:

- `public.vidjo_entries` with `auth.uid()` row-level security.
- `public.vidjo_profiles` with unique usernames, nicknames, avatars, friend codes,
  and profile preferences (`accent_color`, `theme`, `default_privacy`,
  `allow_friend_requests`).
- `public.vidjo_friends` and `public.vidjo_friend_requests`, plus RPCs for sending,
  accepting, declining, and cancelling requests and removing friends.
- `public.vidjo_communities` (seeded with `#LSPUStudents`, `#MusicLovers`, `#AnimeLovers`, `#BookClub`, `#GamersGuild`, `#SmallWins`, `#CampusSunset`,
  `#CreativeFlow`, `#MidtermSurvivals`, `#MentalHealth`, `#StudyTogether`, and
  `#GreenCampus`) and `public.vidjo_community_members`.
- `public.vidjo_reactions` and `public.vidjo_comments` for the friends/community feeds.
- Membership checks on journal/storage policies so OAuth-only accounts cannot
  read or write data.
- The public `vidjo-videos` storage bucket and owner-scoped upload policies.
- A `claim_device_entries()` function for migrating pre-account rows.
- A `hook_reject_social_signups()` function for the Before User Created hook;
  enable it under **Authentication → Hooks** to stop Google OAuth signups.

> **Upgrading an existing project?** Re-run the full `schema.sql`. It is written to
> be re-run safely and adds the social/community tables, `community_slug`, and the
> profile preference columns without deleting existing entries or friend codes.

Email sign-in also needs a `{{ .Token }}` line in the **Magic Link** and
**Confirm signup** email templates so the 6-digit code is included. See
[`supabase/README.md`](supabase/README.md) for the full checklist, Google OAuth
steps, redirect URLs, and troubleshooting.

If Supabase is not configured, the table is missing, or a request fails, the app
continues with `localStorage` and shows a toast when a remote sync fails. Entries
are always written locally first, so the journal still opens offline.

### Sessions and privacy

The browser client persists the Supabase session and refreshes tokens
automatically, so users stay signed in across reloads until they sign out from
the account menu. Journal rows use the auth user id as `owner_id`, and the RLS
policies only allow that user to read or write their own rows. They also require
the `vidjo_registered` marker that is stamped onto email signups, so an account
auto-created by Google cannot access the journal even with a valid session.

The video bucket is private, and the player uses short-lived signed URLs.
Private videos cannot be viewed by anyone other than their owner.

Journal pages are cached locally per account so the book opens offline.
On shared browsers, users can check "Clear cached pages on sign out" or click
"Clear local cache" under **Profile → Settings** so no entries remain stored on
that device.

## Scripts

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                           |
| `npm run build`   | Production build                                    |
| `npm run preview` | Preview the production build                        |
| `npm run check`   | Run `svelte-check` (TypeScript + Svelte)            |
| `npm run lint`    | Check formatting with Prettier and lint with ESLint |
| `npm run format`  | Format the project with Prettier                    |

## Deployment adapters

`vite.config.ts` uses **`adapter-vercel` when `VERCEL=1`** (set automatically by
Vercel) and **`adapter-node` otherwise**. This keeps Vercel deployments working
while allowing `npm run build` to finish on Windows, where `adapter-vercel` may
fail creating symlinks in `.vercel/output`.

To build the Node server locally:

```sh
npm run build
node build
```

## Project structure

```text
src/
  env.ts                  Public environment variable declarations
  lib/
    components/           Header, Book, pages, login, profile, community, friends
    data/                 Moods, stickers, prompts, sample entries
    state/                Journal, auth, profile, friends, community, navigation
    authCallback.ts       Shared OAuth / email-link callback handling
    authErrors.ts         Friendly Supabase auth error messages
    dates.ts              Date helpers and TODAY
    identity.ts           Device id helpers for offline/legacy data
    supabase.ts           Supabase client, auth persistence, bucket name
    videoStore.ts         IndexedDB cache for recordings
    types.ts              Shared types
  routes/
    +page.svelte          Auth gate and app composition
    auth/callback/        OAuth, magic-link, and confirmation landing page
    auth/reset/           Password recovery form
    layout.css            Tailwind theme tokens and paper/sticker utilities
supabase/
  schema.sql              Tables, auth RLS, storage bucket, legacy claim
  README.md               Supabase setup notes
```
