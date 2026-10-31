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
- `public.vidjo_profiles` with globally unique usernames (enforced by a case-insensitive index `lower(username)`), display names, bios, and avatars.
- `public.vidjo_is_member()` and membership checks on every journal/storage/profile policy.
- Trigger that stamps `vidjo_registered` onto email signups.
- Trigger that auto-creates profile rows upon registration.
- `public.is_username_available(uname)` RPC callable during signup.
- The **private** `vidjo-videos` storage bucket and owner-scoped signed-URL policies.
- `claim_device_entries()` for migrating pre-account rows.
- `hook_reject_social_signups()`, the Before User Created hook that prevents Google from creating new accounts.

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
     - `https://your-app.vercel.app`
     - `https://your-app.vercel.app/auth/callback`
     - `https://your-app.vercel.app/auth/reset`

4. Open **Authentication → Email Templates** and add the six-digit token to both
   the **Magic Link** and **Confirm signup** templates. Minimal template:

```html
<h2>Your VidJo sign-in code</h2>
<p>Enter this code in the app:</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: 700">{{ .Token }}</p>
<p>Or open the journal directly: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
```

### Password + Unique Username accounts

The **Create an account** form checks username availability live as students type.
Usernames are stored in `public.vidjo_profiles` with a case-insensitive unique constraint,
preventing duplicate handles.

## 4. Google sign-in (optional)

Google is disabled by default in a new Supabase project. To enable it:

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application).
2. Add authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase, enable Google under **Authentication → Providers → Google**.
4. Enable the **Before User Created** hook (`public.hook_reject_social_signups`) under **Authentication → Hooks** so only existing accounts can link Google.

## 5. Private video storage (`vidjo-videos`)

The schema creates `vidjo-videos` as a **private bucket** (`public = false`).
Videos are uploaded to `vidjo-videos/<auth.uid()>/<date>/<timestamp>-<name>`.

- To play videos, the app requests a short-lived **signed URL** in memory (never stored in the database or localStorage).
- Row-level security on `storage.objects` ensures private videos can **only be accessed by the owner**.
- Entries marked with `privacy: 'friends'` or `privacy: 'community'` will be accessible to authenticated members once the social hub launches.
- Anyone attempting to access public `/storage/v1/object/public/...` URLs is rejected.

## 6. Shared computer security & caching

- **Videos:** Large video files are stored in **IndexedDB** (`vidjo-media`), *not* localStorage (which is limited to ~5MB and cannot hold video files). Once a video is uploaded to Supabase private storage, the local IndexedDB copy is automatically deleted.
- **Journal pages:** Journal pages are cached in `localStorage` under `vidjo-journal-v3:<ownerId>` for offline viewing.
- **Cache clearing:** On shared computers, users can clear cached data anytime from the **Profile modal** or by checking **"Clear cached pages on sign out"** in the account dropdown menu.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Email code returns error for non-existent email | Enable **Prevent email enumeration** in Supabase Auth settings. |
| Username is already taken | Usernames are globally unique. Pick a different handle. |
| Video does not play | Check that the `vidjo-videos` bucket exists and re-run `schema.sql`. |
| Shared browser has old journal entries | Sign out with "Clear cached pages on sign out" checked. |
