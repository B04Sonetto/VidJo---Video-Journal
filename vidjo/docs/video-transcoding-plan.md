# Video transcoding and thumbnails — plan

Status: **plan only, not implemented**

## Why this is needed

- Recordings are produced by `MediaRecorder` at 2.5 Mbps, 720p, up to 3 minutes.
- `pickMimeType()` prefers MP4/H.264 (Safari), but Chrome and Firefox usually
  record WebM/VP8 or WebM/VP9.
- Safari cannot reliably play WebM. A video recorded on Android or Chrome can
  therefore be unplayable for a friend on iPhone.
- Shared pages currently render a bare `<video>` with no poster, so feeds show a
  black rectangle until playback starts.
- Files are stored in the private `vidjo-videos` Supabase bucket and played
  through 2-hour signed URLs. Anything we add must keep that privacy model.

## Goals

1. Every shared video plays on Chrome, Firefox, Safari, and mobile Safari.
2. Every video has a thumbnail/poster, including in friend and community feeds.
3. No journal text, titles, or bios are ever sent to an external service.
4. Stay on free tiers. No paid transcoding subscription.
5. Keep the current signed-URL access rules; no public buckets.

## Option A — client-side only (recommended first)

No new service, no new secrets, no video leaves Supabase.

### A1. Thumbnail capture

- After recording/upload, seek the local video to about 1 second.
- Draw the frame to an offscreen `<canvas>` at 640px wide.
- Export `image/jpeg` at quality 0.72 (a few tens of KB).
- Upload next to the video as `…/thumb.jpg` in the same owner/date folder.
- Add `video_thumb_path text` to `vidjo_entries`.
- Sign the thumbnail with the same TTL as the video and pass it as
  `<video poster={thumbnailUrl}>`.
- If thumbnail capture fails, keep the video and show the existing styled
  placeholder; never block the upload.

**Result:** thumbnails work everywhere, for free, without a third party.

### A2. MP4-first recording

- Keep `video/mp4;codecs=avc1,mp4a` as the first `MediaRecorder` candidate.
- Probe support before recording and, when only WebM is available, show a short
  note: “This browser records WebM. It will be converted for sharing if needed.”
- Lower the default bitrate from 2.5 Mbps to about 1.8 Mbps at 720p. A 3-minute
  clip drops from roughly 56 MB to roughly 40 MB with no visible loss for a
  journal video.
- Keep `playsinline`, `controls`, and the existing 3-minute cap.

**Result:** most Safari recordings are already MP4, and files are smaller.

### A3. Optional WebM → MP4 conversion with ffmpeg.wasm

Used only when the recording is WebM and the page is shared to friends or a
community, or when the user presses “Make this video compatible”.

- Lazy-load `@ffmpeg/ffmpeg` and the single-thread core only on demand. Nothing
  is added to the initial bundle.
- Convert to H.264/AAC MP4 at 720p, CRF 26, `-movflags +faststart` so playback
  starts before the file is fully downloaded.
- Run in a Web Worker. Show progress and a cancel button.
- Upload the MP4, keep the WebM as a fallback only while the conversion runs,
  then delete it.
- If conversion fails or the browser runs out of memory, keep the original and
  show a clear message.

**Trade-offs:**

- Free and private; no account, key, or quota.
- The single-thread core is several megabytes and can take 1–3 minutes for a
  3-minute clip on a phone, and can hit memory limits on older iOS devices.
- Best treated as a best-effort compatibility step for shared videos, not a
  required step for private pages.

## Option B — free hosted API: Cloudinary free plan

Cloudinary's free plan currently includes 25 monthly credits shared across
storage, bandwidth, and transformations, with video transcoding, adaptive
streaming, and thumbnail generation. This is the strongest “real API” free
option checked (October 2026).

- Upload with delivery type `authenticated`, not public. Playback uses signed,
  expiring URLs.
- A SvelteKit server route (or Supabase Edge Function) holds the API secret and
  signs uploads. Never put the secret in `PUBLIC_*` env vars.
- Transcode to H.264 MP4 and optionally HLS; generate the poster from the same
  asset.
- Apply a hard local cap (for example 20 credits) and fall back to the Supabase
  original when the cap is reached.

**Trade-offs:**

- Journal videos leave Supabase and are stored/processed by a third party.
  Because this is a private journal, only shared (friends/community) videos
  should be eligible, and the UI must say so before upload.
- 25 credits is enough for a small pilot but not for heavy use. Video
  transformations are metered by seconds processed, so a long library can
  exhaust the allowance quickly.
- Adds an account, a secret, and a second storage system to keep in sync with
  deletion.

Other free APIs checked:

| Service           | Free allowance                                    | Fit                                                               |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| ImageKit          | 20 GB bandwidth, 3 GB storage, 500 video units/mo | Good, but private-file support and 3 GB storage make it tight     |
| Rendi             | 50 GB processed/mo, raw ffmpeg API                | Generous, but needs orchestration and a place to put output       |
| Mux               | 100k delivered minutes/mo plus a usage credit     | Excellent playback, but a hosted video platform and a third party |
| Transloadit       | 5 GB/mo                                           | Free output is trimmed; not suitable                              |
| Cloudflare Stream | none                                              | Paid                                                              |
| Bunny Stream      | 14-day trial only                                 | Paid                                                              |

## Option C — self-hosted ffmpeg worker

- Small Node/Go service running ffmpeg:
  `-c:v libx264 -preset veryfast -crf 25 -c:a aac -movflags +faststart`, plus an
  optional HLS ladder.
- Triggered from a SvelteKit server route after upload. The worker downloads the
  private object with a service-role signed URL, transcodes, uploads the MP4 and
  thumbnail back, and updates the entry.
- Free software and fully private, but needs a host. Free container tiers sleep,
  throttle CPU, and have short request limits, so a 3-minute transcode is
  unreliable. This becomes attractive only if VidJo gets a stable VPS.

## Recommendation

**Phase 1 (do first): Option A1 + A2.**
Thumbnails and MP4-first recording solve the visible problems immediately, cost
nothing, and introduce no privacy trade-off.

**Phase 2 (only if real Safari failures remain): Option A3.**
Add the lazy ffmpeg.wasm compatibility step for WebM recordings that are shared.

**Phase 3 (only if A3 is too slow on target phones): Option B.**
Evaluate Cloudinary with authenticated delivery, a hard free-tier cap, and
opt-in only for videos the user chooses to share publicly. If VidJo later gets a
stable server, prefer Option C instead.

## Schema changes

```sql
alter table public.vidjo_entries
	add column if not exists video_thumb_path text;
```

Thumbnails live in `vidjo-videos` under the same `owner_id/date/` folder, so the
existing read/upload/delete policies apply without a second bucket.

## App changes

- `journal.svelte.ts`: capture and upload the poster in `setVideo`, sign it next
  to the video, delete it with the video, clear it on signing failure.
- `LeftPage.svelte`, `FriendJournalModal.svelte`, `CommunityView.svelte`: use
  `poster={thumbnailUrl}` and the styled fallback while it loads.
- `RecordVideoModal.svelte`: bitrate and capability note; optional conversion
  progress UI.
- `types.ts` / persistence: include `videoThumbPath` in the `Entry` shape and
  the `vidjo_entries` upsert.

## Test matrix

- Chrome desktop records WebM → plays in Safari and on iPhone.
- iPhone Safari records MP4 → plays in Chrome.
- Thumbnail appears in the owner journal, friend reader, and community feed.
- Signed URL expiry refreshes both video and thumbnail.
- Deleting a video removes the poster object too.
- A private page never triggers a third-party upload.
