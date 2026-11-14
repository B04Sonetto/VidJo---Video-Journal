# VidJo — Video Journal

VidJo is a privacy-aware, student-focused video journal and social platform built with SvelteKit. Users can record or upload short videos, add a mood, write reflections, decorate entries with stickers, and revisit past journal moments in a calendar-driven book interface.

The app is designed for personal storytelling, but also includes friend and community features, profile pages, admin moderation tools, and optional Supabase-powered persistence and social sharing.

## What this app does

VidJo lets users:

- Record video directly in the browser or upload an existing clip
- Write journal entries with titles, reflections, and mood selection
- Save entries locally and sync them to Supabase when available
- Browse past entries in a paper-like book layout and calendar view
- Share entries with private, friends-only, or community privacy levels
- Build a profile with username, avatar, bio, stats, and friend code
- Connect with friends and explore community feeds
- Moderate content and manage account activity through admin tools
- Keep working offline with local fallback storage

## Core features

### Video journaling
- Browser-based video recording using the MediaRecorder API
- Front/back camera toggle and retake flow
- Optional upload fallback when record-on-device is not available
- IndexedDB storage for media caching so recordings are not lost
- Poster thumbnail generation for journal cards and previews
- Private video storage with signed URLs in Supabase-backed setups

### Journal experience
- Digital book layout with page-turn motion and responsive design
- Mood selection with hand-drawn style mood states
- Journal writing with title, reflection, prompts, and character tracking
- Sticker layer editing, resizing, rotation, and drag support
- Calendar-based browsing of previous entries by date
- Offline-first behavior with localStorage persistence

### Social features
- User profiles and unique handles
- Friend requests and friend-only post visibility
- Community discovery, memberships, reactions, and comments
- Social feeds with trending and “for you” views
- Privacy controls around content visibility and sharing

### Admin and moderation
- Moderation panel for comment/report checks
- Rule-based member and usage overview
- Admin visibility into aggregated account activity without exposing journal content

### Authentication and storage
- Email/password sign-in and email code sign-in flow
- Optional Google OAuth support
- Supabase-powered account storage and authorization
- Graceful fallback to local device-only mode when backend configuration is unavailable

## Tech stack

- SvelteKit
- Svelte 5
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- Optional Sentry error monitoring
- IndexedDB for local media storage

## Repository layout

This repo contains the main app under the `vidjo/` directory.

```text
.
├── README.md
├── Community.dc.html
├── Friends.dc.html
├── package-lock.json
├── vidjo/
│   ├── README.md
│   ├── package.json
│   ├── src/
│   │   ├── app.html
│   │   ├── env.ts
│   │   ├── hooks.client.ts
│   │   ├── hooks.server.ts
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   ├── data/
│   │   │   ├── state/
│   │   │   ├── authCallback.ts
│   │   │   ├── authErrors.ts
│   │   │   ├── avatar.ts
│   │   │   ├── dates.ts
│   │   │   ├── imageUpload.ts
│   │   │   ├── observability.ts
│   │   │   ├── supabase.ts
│   │   │   ├── types.ts
│   │   │   ├── videoStore.ts
│   │   │   └── videoThumb.ts
│   │   └── routes/
│   ├── static/
│   ├── supabase/
│   │   ├── README.md
│   │   └── schema.sql
│   ├── docs/
│   │   ├── moderation-test-report.md
│   │   ├── video-moderation-plan.md
│   │   └── video-transcoding-plan.md
│   └── vite.config.ts
└── .kilo/
```

## Getting started

From the repo root:

```bash
cd vidjo
npm install
npm run dev
```

Then open the local URL printed by Vite in the browser.

## Environment variables

Create a `.env` file inside `vidjo/` with values like:

```bash
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
```

Optional values:

```bash
PUBLIC_SENTRY_DSN=https://your-key@your-sentry-host/1
PUBLIC_SENTRY_ENVIRONMENT=production
PUBLIC_APP_RELEASE=vidjo@1.0.0
```

If Supabase is not configured, the app can still run in device-only mode using local storage.

## Supabase setup

The project includes a database schema and setup guidance in `vidjo/supabase/schema.sql` and `vidjo/supabase/README.md`.

The schema creates:

- `vidjo_entries` for video journal entries
- `vidjo_profiles` for profile data and user metadata
- `vidjo_friends` and request tables
- `vidjo_communities` and community membership data
- `vidjo_reactions` and `vidjo_comments`
- private storage bucket rules for video uploads
- analytics and admin-related database functions

Before using social features, run the schema in your Supabase SQL editor and make sure your environment variables are set correctly.

## Development scripts

Inside `vidjo/`:

```bash
npm run dev
npm run build
npm run preview
npm run check
npm run lint
npm run format
```

## Deployment

The app uses SvelteKit adapters:

- `adapter-vercel` when running in Vercel
- `adapter-node` otherwise

This lets the project work cleanly on Vercel and also supports local Node builds.

To build and run the production server:

```bash
cd vidjo
npm run build
node build
```

## How the application works

VidJo is structured around a journal-first experience with optional social features.

1. Users sign in or continue in device-only mode.
2. They create or upload a short video entry.
3. They choose a mood and write their reflection.
4. They decorate the page with stickers and set privacy.
5. Entries are stored locally and synced to Supabase if configured.
6. Past entries can be viewed through the book and calendar.
7. Friends and communities can view shared content based on privacy settings.

This makes the app useful both as a personal diary and as a connected social journaling experience.

## Privacy and data model

VidJo is designed with privacy in mind:

- Private entries are owner-scoped
- Friends-only posts are viewable by accepted friends only
- Community posts are visible within opted-in communities
- Video files are kept private when using Supabase storage
- localStorage is used for journaling fallback and cache management
- optional analytics are limited and filtered to avoid storing sensitive content

## Notes

- The main app is located in `vidjo/`.
- The repo root is used as a project container and includes some additional artifacts.
- The project is already documented in detail in `vidjo/README.md` and `vidjo/supabase/README.md`.

## Summary

VidJo is a complete digital video journaling app with personal reflection tools, community sharing, profile management, secure storage, and social functionality. It is built for a student audience but is flexible enough for personal use, journaling, and lightweight social network interactions.

If you want, I can also turn this into a more polished GitHub landing-page style README with badges, screenshots placeholders, and a more marketing-focused intro.
