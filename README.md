# VidJo — Video Journal

<p align="center">
  <img src="https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=svelte&logoColor=white" alt="SvelteKit" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/IndexedDB-7B61FF?style=for-the-badge&logo=googlechrome&logoColor=white" alt="IndexedDB" />
</p>

<p align="center">
  <strong>Record your life in motion.</strong>
  <br />
  A privacy-aware, student-first video journal built for reflection, memory, and meaningful social connection.
</p>

<p align="center">
  <a href="#getting-started">Get started</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#architecture">Architecture</a>
  ·
  <a href="#supabase-setup">Supabase</a>
</p>

---

## Why VidJo?

VidJo turns everyday moments into journal entries that feel human and personal.

Instead of plain text alone, you can:

- record a short video from your camera
- add a mood and a reflection
- decorate the page with stickers and visual context
- revisit memories through a calendar and paper-like journal layout
- share selectively with friends or communities
- keep everything local and resilient when the network is unreliable

It blends personal journaling, social connection, and modern web app polish into one experience.

---

## Highlights

- Video journaling with browser recording and upload support
- Privacy modes: private, friends, or community
- Journal book experience with paper-style interface and page flips
- Mood-based entries and emotional reflection prompts
- Friend requests, profiles, and community feeds
- Offline-first storage for entries and captured video media
- Supabase-powered persistence for multi-device accounts
- Admin moderation and activity overview tools

---

## Feature overview

| Area | What it does |
| --- | --- |
| Journal | Write, save, and review entries with title, mood, reflection, and media |
| Video | Record in-browser or upload an existing clip with poster thumbnails |
| Privacy | Keep entries private, share with friends, or post into communities |
| Social | Add friends, create profiles, and participate in social feeds |
| Offline | Store entries and media locally using device storage and IndexedDB |
| Admin | View moderation and usage analytics in an admin console |
| Auth | Support email/password sign-in, magic-link flows, and optional Google OAuth |

---

## App experience

VidJo is designed like a thoughtful digital journal rather than a generic social app.

- A warm, personal interface inspired by paper notebooks and memory keeping
- Calendar-based navigation to revisit old moments
- Book-style reading flow for past entries
- Sticker layering and customization for expressive journaling
- Community discovery without losing the personal journal feel

---

## Tech stack

- SvelteKit
- Svelte 5
- TypeScript
- Tailwind CSS
- Vite
- Supabase
- IndexedDB for media fallback
- Optional Sentry error tracking

---

## Getting started

From the project directory:

```bash
cd vidjo
npm install
npm run dev
```

Then open the local URL printed by Vite in your browser.

### Production build

```bash
cd vidjo
npm run build
node build
```

---

## Environment variables

Create a `.env` file inside `vidjo/`:

```bash
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
```

Optional:

```bash
PUBLIC_SENTRY_DSN=https://your-key@your-sentry-host/1
PUBLIC_SENTRY_ENVIRONMENT=production
PUBLIC_APP_RELEASE=vidjo@1.0.0
```

If Supabase is not configured, the app can continue in device-only mode with local fallbacks.

---

## Supabase setup

The app includes schema and setup documentation in:

- `vidjo/supabase/schema.sql`
- `vidjo/supabase/README.md`

The schema creates the core social and journal tables, including:

- user profiles and account metadata
- journal entries and media references
- friends and friend requests
- community membership and feed content
- reactions and comments
- private video storage buckets and access rules
- admin and analytics helpers

> Run the schema in your Supabase SQL editor before using the social features.

---

## Architecture

```text
vidjo/
├── src/
│   ├── app.html
│   ├── env.ts
│   ├── hooks.client.ts
│   ├── hooks.server.ts
│   ├── lib/
│   │   ├── components/
│   │   ├── data/
│   │   ├── state/
│   │   ├── authCallback.ts
│   │   ├── authErrors.ts
│   │   ├── avatar.ts
│   │   ├── dates.ts
│   │   ├── imageUpload.ts
│   │   ├── observability.ts
│   │   ├── supabase.ts
│   │   ├── types.ts
│   │   ├── videoStore.ts
│   │   └── videoThumb.ts
│   └── routes/
├── static/
├── supabase/
│   ├── README.md
│   └── schema.sql
├── docs/
│   ├── moderation-test-report.md
│   ├── video-moderation-plan.md
│   └── video-transcoding-plan.md
├── package.json
├── README.md
├── vite.config.ts
└── tsconfig.json
```

### Runtime model

1. Users sign in or start in local-only mode.
2. New entries are recorded or uploaded.
3. Metadata and media are stored locally and synced when the backend is ready.
4. Privacy rules decide who can view the journal entry.
5. Calendar, profile, friends, and community views read from the same data model.

---

## Development scripts

```bash
npm run dev
npm run build
npm run preview
npm run check
npm run lint
npm run format
```

---

## Why this project stands out

VidJo is more than a journal app — it is a thoughtful, expressive digital memory space.

It blends:

- personal storytelling
- emotional reflection
- social sharing
- privacy awareness
- a polished product aesthetic

This makes it especially good for student life tracking, personal growth, and low-pressure social connection.

---

## Notes

- The main application lives in the `vidjo/` directory.
- The repository root contains project-level metadata and supporting artifacts.
- Detailed app documentation is also available in `vidjo/README.md` and `vidjo/supabase/README.md`.

---

<p align="center">
  <strong>Built for memory, reflection, and connection.</strong>
</p>
