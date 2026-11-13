# AI video moderation — feasibility and implementation plan

Date: 2026-11-13

Status: **Plan only. No provider, API key, or budget has been chosen yet.**

## 1. Short answer

Yes. AI can detect a useful subset of vulgar or unsafe video content:
 
- **Visual content:** explicit nudity, sexual activity, exposed genitalia,
  graphic violence, gore, drugs, and some hate symbols are detectable with
  commercial image/video moderation APIs. Accuracy is good for clear cases and
  weaker for art, medical/educational content, swimwear, animation, and dark or
  blurry footage.
- **Audio content:** speech can be transcribed and then classified for slurs,
  threats, harassment, and hate speech. General swearing is easy to detect, but
  VidJo's policy allows swearing in videos, so the audio classifier must target
  slurs, threats, and harassment rather than profanity.
- **Context:** AI cannot reliably tell an insult from a quote, a joke, a song
  lyric, reclaimed language, or an educational discussion. It produces
  confidence scores, not verdicts.

The practical design is therefore **AI triage plus human review**, not a fully
automatic judge. AI should hide or hold a shared video, warn the author, and
send a case to an admin. It should not silently delete the private journal video
or permanently ban someone on a single low-confidence score.

## 2. What "vulgar" means for VidJo

The current policy from the moderation work is:

| Surface                    | Swearing         | Slurs / threats / harassment | Explicit visual content |
| -------------------------- | ---------------- | ---------------------------- | ----------------------- |
| Private journal text       | Allowed          | Not scanned                  | Not scanned             |
| Private video              | Allowed          | Not scanned                  | Not scanned             |
| Friends/Community text     | Masked           | Warning, possible ban        | N/A                     |
| Shared video               | Allowed in audio | Should be detected           | Should be detected      |
| Video with a minor present | —                | —                            | Highest severity        |

So video moderation should focus on:

1. Nudity and sexual content.
2. Sexual content involving minors (highest severity, legal escalation).
3. Graphic violence, gore, and threats.
4. Hate symbols and slurs in audio or on-screen text.
5. Harassment directed at a person.
6. Drugs and other unsafe content, reviewed with context.

It should **not** flag ordinary swearing in a private or shared video just
because the word list contains it.

## 3. Recommended architecture

### 3.1 Principles

- Only shared videos are scanned. Private pages are never sent to a third party.
- The original video is never deleted by the moderation pipeline. It is hidden
  from shared surfaces while a case is pending or rejected.
- The owner can see the status ("Checking", "Visible", "Under review",
  "Hidden") and appeal.
- An admin makes the final call for anything that could lead to a ban.
- Failure is closed for sharing but open for the owner: if the provider is down,
  the video stays visible only to its owner until the check succeeds or an admin
  releases it.

### 3.2 High-level flow

```text
User shares a page with a video
        │
        ▼
Database trigger / client call creates a moderation job
        │
        ▼
Frame sampling + audio extraction
        │
        ├── images ──► image moderation API ──► labels + scores
        │
        └── audio ───► speech-to-text ──► text moderation ──► labels + scores
        │
        ▼
Score aggregation and policy thresholds
        │
        ├── approve  ──► video becomes visible to friends/community
        ├── hold     ──► hidden from others, queued for admin review
        └── reject   ──► hidden from others, warning sent, admin can ban
        │
        ▼
Author notification + admin queue + optional appeal
```

### 3.3 Where the work runs

Supabase Edge Functions are good for orchestration and calling APIs, but they
are not a reliable place to run native `ffmpeg`. Pick one of these:

**Option A — managed video moderation API (fastest MVP)**

Send the whole video or a signed URL to a vendor that extracts frames and audio
itself. Examples to evaluate: Hive AI, Sightengine, Azure AI Content Safety /
Video Indexer, Google Cloud Video Intelligence, AWS Rekognition Video. Pros:
least infrastructure. Cons: the full video leaves Supabase, vendor-specific
pricing, and usually no control over frame selection.

**Option B — frame sampling + image API + speech-to-text (recommended)**

Extract frames and audio, then call narrower services. This keeps more control
over cost and can avoid sending the whole file. It needs a small worker outside
Supabase Edge Functions (Fly.io, Render, Railway, a VPS, or a container job) or
a hosted media-processing API. Recommended for VidJo because videos are short
(up to 3 minutes) and the main risks are visual.

**Option C — on-device pre-screen**

Use a small NSFW/image model in the browser (for example NSFWJS or a TensorFlow
Lite model) to flag obvious cases before upload. Pros: private, free, no key.
Cons: weaker accuracy, large download, device-dependent, and easy to bypass.
Use it only as an extra signal, never as the enforcement layer.

**Recommendation:** start with **Option B**, but implement the first phase with
client-sampled frames so the full video never leaves Supabase. Add server-side
audio and re-scanning of older videos later.

## 4. Phase plan

### Phase 0 — Policy and data model (1–2 days)

Decide and document:

- Which categories are auto-hidden, which are review-only, and which are allowed.
- Warning vs. ban rules for video findings.
- Retention: how long frame images, transcripts, and scores are kept.
- Who can see a flagged video, and how appeals work.
- Legal/CSAM escalation process. Do not build an automated CSAM classifier and
  treat it as sufficient; follow the applicable reporting law and provider
  requirements.

Add fields without enabling a provider yet:

```sql
alter table public.vidjo_entries
	add column if not exists moderation_status text not null default 'none',
	add column if not exists moderation_labels jsonb not null default '[]'::jsonb,
	add column if not exists moderation_score numeric,
	add column if not exists moderated_at timestamptz,
	add column if not exists moderation_job_id uuid;

-- none | pending | approved | flagged | rejected | error
```

Create a job table so retries and admin review are durable:

```sql
create table if not exists public.vidjo_video_moderation_jobs (
	id uuid primary key default gen_random_uuid(),
	owner_id text not null,
	entry_date date not null,
	video_path text not null,
	status text not null default 'queued', -- queued | running | done | error
	attempts int not null default 0,
	result jsonb,
	last_error text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
```

Gate shared videos in the feed while they are pending:

```sql
-- Concept only; apply carefully with the existing policies/RPCs.
-- Owners always see their own row. Other readers only see an approved video.
(coalesce(video_path, '') = '' or moderation_status = 'approved')
```

Text-only shared pages should not wait for video moderation. Only rows with a
`video_path` need the gate.

### Phase 1 — Visual screening for new shared videos (MVP)

1. When recording/uploading, sample 8–12 frames in the browser from the local
   video (roughly one per 10–20 seconds, plus the first and last second). Draw
   each frame to a canvas, export JPEG at about 640 px wide.
2. Send the frames to a SvelteKit route or Edge Function. The API key stays on
   the server; never expose it through `PUBLIC_*` variables.
3. The server sends each frame to an image moderation API (for example Google
   Vision SafeSearch, AWS Rekognition `DetectModerationLabels`, Azure Content
   Safety, Sightengine, or Hive).
4. Aggregate the labels:
   - Highest score per category.
   - Clear explicit nudity/sexual content above a high threshold → `flagged`.
   - Medium score → `flagged` for review.
   - No concerning labels → `approved`.
5. Store labels, scores, and timestamps on the entry/job.
6. The owner sees "Under review" if anything is flagged. Friends and Community
   do not see the video until an admin approves it.
7. Send the author a warning only when the case is confirmed by an admin, not on
   a raw model score. This avoids punishing false positives.
8. Never delete the source object. Hiding is reversible.

This phase does not require audio. It catches the largest visual risks and can
ship without a video-processing worker.

### Phase 2 — Audio and on-screen text

1. Extract the audio track on a worker or use a provider that accepts a signed
   video URL.
2. Transcribe with a speech-to-text service (Whisper, Deepgram, AssemblyAI, or
   the provider's own transcription).
3. Run the transcript through a classifier tuned for **slurs, threats, and
   harassment**, not general profanity. Keep normal swearing out of the flag
   set.
4. Optionally run OCR on sampled frames for on-screen slurs or threats.
5. Add transcript findings to the same job result and threshold logic.
6. Treat song lyrics, quoted speech, and comedy as review-only. Do not
   auto-ban from a transcript alone.

### Phase 3 — Server-side re-scan and admin workflow

1. Add a worker endpoint that downloads a private object with a service-role
   signed URL, extracts frames/audio with `ffmpeg`, and uploads results to the
   job.
2. Re-scan videos uploaded before Phase 1 and videos shared by an older client.
3. Build an admin queue:
   - Video preview with a signed URL.
   - Labels, scores, transcript snippets, and frame thumbnails.
   - Actions: Approve, Hide, Warn author, Ban author, Request re-check.
4. Add an appeal button for the owner.
5. Add audit rows for every admin decision.

### Phase 4 — Automation and tuning

Only after the queue has real cases:

- Raise automatic approval for low-risk categories.
- Auto-hide only high-confidence explicit content.
- Keep a human in the loop for violence, drugs, hate, and anything involving a
  minor.
- Track precision/recall per category and per provider.
- Add a feedback loop from admin decisions to threshold tuning.

## 5. Provider comparison

Verify current quotas and prices before committing; free tiers change often.

| Option                                    | Visual        | Audio             | Whole-video upload | Notes                                                             |
| ----------------------------------------- | ------------- | ----------------- | ------------------ | ----------------------------------------------------------------- |
| Managed video moderation API (Hive, etc.) | Yes           | Often             | Yes                | Fastest to ship; least control; full video leaves Supabase        |
| Frame sampling + image API                | Yes           | No                | No (frames only)   | Cheapest and most private; needs frame extraction and aggregation |
| Frame sampling + image API + Whisper      | Yes           | Yes               | Audio only         | Best balance for VidJo; needs a worker for audio                  |
| Google Cloud Video Intelligence           | Yes           | Optional          | Yes                | Strong explicit-content detection; GCS-centric                    |
| AWS Rekognition Video                     | Yes           | No                | Yes (S3)           | Async jobs; needs S3 and IAM; pair with Transcribe for audio      |
| Azure AI Content Safety / Video Indexer   | Yes           | Yes               | Yes                | Good enterprise fit; check video-specific limits                  |
| On-device NSFW model                      | Partial       | No                | No                 | Private and free; weak, bypassable; use only as a pre-filter      |
| OpenAI moderation + Whisper               | Images + text | Audio via Whisper | No full video      | Useful building blocks, not a complete video moderation product   |

## 6. Thresholds and enforcement

Suggested starting policy:

| Finding                                       | Automatic action                                      | Human action                  |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| Explicit sexual content, high confidence      | Hide from shared surfaces; status `flagged`           | Review; warn or ban           |
| Sexual content involving a minor              | Hide immediately; restrict sharing; preserve evidence | Escalate per legal policy     |
| Graphic violence/gore, high confidence        | Hide; status `flagged`                                | Review context; warn or allow |
| Hate symbol or slur, high confidence in audio | Hide; status `flagged`                                | Review; warning first         |
| Threat or harassment                          | Hide; status `flagged`                                | Review; warn or ban           |
| Drugs                                         | Keep visible only if low confidence; otherwise review | Review context                |
| Ordinary swearing                             | No action                                             | None                          |
| Medium/low confidence                         | Keep owner-visible; hide from others until review     | Approve or hide               |
| Provider error/timeout                        | Owner-visible only; retry                             | Release manually if needed    |

Do not auto-ban from a single model result. A ban should require a confirmed
case, repeated violations, or a clear severe category.

## 7. Privacy and safety requirements

- Scanned videos leave the private bucket only through short-lived signed URLs
  or extracted frames. Never make the bucket public.
- Tell the user before sharing that a shared video may be checked by an
  automated system and reviewed by a moderator.
- Keep frame images and transcripts only as long as needed for review and
  appeals; delete them when the case closes unless policy requires retention.
- Use a data-processing agreement with the provider.
- Do not send private journal text, private videos, or unrelated pages.
- Log admin decisions, not raw video content, in analytics.
- Provide a human appeal path. False positives are expected, especially around
  art, medical content, swimwear, and music.

## 8. Cost and performance

- Only scan videos that are actually shared, and only once per content version.
  Cache by `video_path` plus `updated_at` or a content hash.
- Sample frames instead of every frame. For a 3-minute video, 8–12 frames is
  usually enough for clear visual content.
- Cap the number of frames and audio minutes per video.
- Add a daily provider budget. If the budget is exhausted, keep new shared
  videos owner-visible and queue them rather than failing open.
- Run jobs asynchronously. The share action should never wait for moderation.
- Retry with backoff and store the last error. Do not create duplicate jobs for
  the same unchanged object.

## 9. Test plan

Build a small, consented test set covering:

- Clear explicit content (synthetic or licensed test media).
- Suggestive but non-explicit content.
- Swimwear, art, medical/educational imagery.
- Animation and video-game violence.
- Dark, blurry, shaky, and low-resolution clips.
- Text overlays and on-screen slurs.
- Audio with ordinary swearing (must not flag).
- Audio with a slur or threat (must flag).
- Music lyrics and quoted speech (review, not auto-ban).
- Different accents, languages, and background noise.
- Provider timeout and malformed response.

Measure per category: precision, recall, latency, cost per video, error rate, and
the share of cases that need human review. Run in shadow mode first: record what
the system would have done without hiding anything.

## 10. Recommended next step

1. Choose the policy in Phase 0, especially the minor-safety and appeal rules.
2. Implement the schema and the `pending`/`approved` gate for shared videos.
3. Build the client frame sampler and a server route that calls one image
   moderation provider.
4. Pilot with a small group and a human review queue.
5. Add audio transcription and slur/threat detection only after the visual
   pipeline and admin workflow are stable.

This keeps the first release private, affordable, and reversible, while leaving
room for a full managed video API if the pilot shows that frame sampling misses
too much.
