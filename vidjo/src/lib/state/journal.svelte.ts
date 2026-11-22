import { track } from '#lib/analytics';
import { isObscene } from '#lib/censor';
import { STICKER_BY_KEY } from '#lib/data/stickers';
import { isFutureDate, todayKey, uid } from '#lib/dates';
import { peekDeviceId } from '#lib/identity';
import { captureError } from '#lib/observability';
import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import { summarizeStreak, type StreakSummary } from '#lib/streak';
import { viewport } from '#lib/state/viewport.svelte';
import { captureVideoThumbnail } from '#lib/videoThumb';
import {
	clearStoredVideosForOwner,
	deleteStoredVideo,
	getStoredVideo,
	putStoredVideo
} from '#lib/videoStore';
import type {
	Entry,
	EntryRow,
	EntrySong,
	MoodKey,
	PaperStyle,
	Privacy,
	Side,
	Sticker
} from '#lib/types';

const STORAGE_PREFIX = 'vidjo-journal-v3';
const LEGACY_STORAGE_KEY = 'vidjo-journal-v2';
const CLAIMED_KEY = 'vidjo-claimed-by';
const PAPER_KEY = 'vidjo-paper';

/** Shared title limit. Keep in sync with the input's `maxlength`. */
export const TITLE_MAX = 80;

/**
 * Signed video URLs live in memory only. Two hours is long enough for a normal
 * journal session; the player asks for a fresh URL if one expires.
 */
const SIGNED_URL_TTL = 60 * 60 * 2;

/** Recover an object path from a URL made by older builds with a public bucket. */
function legacyVideoPath(url: unknown): string {
	if (typeof url !== 'string' || !url) return '';
	const marker = `/storage/v1/object/public/${VIDEO_BUCKET}/`;
	const index = url.indexOf(marker);
	if (index < 0) return '';

	try {
		return decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
	} catch {
		return url.slice(index + marker.length).split('?')[0];
	}
}

const VIDEO_MIME_BY_EXT: Record<string, string> = {
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mkv: 'video/x-matroska'
};

/**
 * The bucket's `allowed_mime_types` only accepts plain video MIME types.
 * MediaRecorder commonly reports values such as `video/mp4;codecs=avc1`, so
 * strip parameters and fall back to the file extension before uploading.
 */
function videoContentType(blob: Blob, name: string): string {
	const base = (blob.type || '').split(';')[0].trim().toLowerCase();
	if (base.startsWith('video/')) return base;

	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	return VIDEO_MIME_BY_EXT[ext] ?? 'video/webm';
}

/** Fill in missing fields from older cached entries, including legacy video URLs. */
function normalizeEntry(
	raw: Partial<Entry> & { date: string; videoUrl?: string; song?: unknown }
): Entry {
	return {
		date: raw.date,
		mood: raw.mood ?? '',
		title: (raw.title ?? '').slice(0, TITLE_MAX),
		mind: raw.mind ?? '',
		refl: raw.refl ?? '',
		privacy: raw.privacy ?? 'private',
		communitySlug: raw.communitySlug ?? '',
		stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
		saved: Boolean(raw.saved),
		sample: Boolean(raw.sample),
		videoPath: raw.videoPath || legacyVideoPath(raw.videoUrl),
		videoThumbPath: raw.videoThumbPath ?? '',
		videoName: raw.videoName ?? '',
		excludedFriendIds: Array.isArray(raw.excludedFriendIds) ? raw.excludedFriendIds : [],
		includedFriendIds: Array.isArray(raw.includedFriendIds) ? raw.includedFriendIds : [],
		shareWithFriends: Boolean(raw.shareWithFriends),
		song: normalizeSong(raw.song)
	};
}

function storageKey(ownerId: string) {
	return `${STORAGE_PREFIX}:${ownerId}`;
}

function readPaper(): PaperStyle {
	try {
		const value = localStorage.getItem(PAPER_KEY);
		if (value === 'lined' || value === 'dotted' || value === 'grid' || value === 'plain') {
			return value;
		}
	} catch {
		// Ignore storage restrictions.
	}
	return 'lined';
}

function normalizeSong(raw: unknown): EntrySong | null {
	if (!raw || typeof raw !== 'object') return null;
	const song = raw as Record<string, unknown>;
	const uri = typeof song.uri === 'string' ? song.uri : '';
	const name = typeof song.name === 'string' ? song.name.trim() : '';
	if (!uri || !name) return null;
	const artists = typeof song.artists === 'string' ? song.artists.trim() : '';
	const album = typeof song.album === 'string' ? song.album.trim() : '';
	const image = typeof song.image === 'string' ? song.image : '';
	const url = typeof song.url === 'string' ? song.url : '';
	return {
		uri,
		name,
		artists,
		...(album ? { album } : {}),
		...(image ? { image } : {}),
		...(url ? { url } : {})
	};
}

export function blankEntry(date: string, privacy: Privacy = 'private'): Entry {
	return {
		date,
		mood: '',
		title: '',
		mind: '',
		refl: '',
		privacy,
		communitySlug: '',
		stickers: [],
		saved: false,
		sample: false,
		videoPath: '',
		videoThumbPath: '',
		videoName: '',
		excludedFriendIds: [],
		includedFriendIds: [],
		shareWithFriends: false,
		song: null
	};
}

function rowToEntry(row: EntryRow & { song?: unknown }): Entry {
	return {
		date: row.entry_date,
		mood: row.mood ?? '',
		title: row.title ?? '',
		mind: row.mind ?? '',
		refl: row.refl ?? '',
		privacy: row.privacy ?? 'private',
		communitySlug: row.community_slug ?? '',
		stickers: Array.isArray(row.stickers) ? row.stickers : [],
		saved: Boolean(row.saved),
		sample: Boolean(row.sample),
		videoPath: row.video_path || legacyVideoPath(row.video_url),
		videoThumbPath: row.video_thumb_path ?? '',
		videoName: row.video_name ?? '',
		excludedFriendIds: Array.isArray(row.excluded_friend_ids) ? row.excluded_friend_ids : [],
		includedFriendIds: Array.isArray(row.included_friend_ids) ? row.included_friend_ids : [],
		shareWithFriends: Boolean(row.share_with_friends),
		song: normalizeSong(row.song)
	};
}

function entryToRow(ownerId: string, entry: Entry): EntryRow {
	return {
		owner_id: ownerId,
		entry_date: entry.date,
		mood: entry.mood || null,
		title: entry.title,
		mind: entry.mind,
		refl: entry.refl,
		privacy: entry.privacy,
		community_slug: entry.communitySlug || null,
		// These columns are NOT NULL in Postgres, so send empty values rather
		// than null or the whole upsert is rejected.
		stickers: entry.stickers.map((sticker) => ({ ...sticker })),
		saved: Boolean(entry.saved),
		sample: Boolean(entry.sample),
		video_path: entry.videoPath || null,
		video_thumb_path: entry.videoThumbPath || null,
		excluded_friend_ids: [...entry.excludedFriendIds],
		included_friend_ids: [...entry.includedFriendIds],
		share_with_friends: Boolean(entry.shareWithFriends),
		video_url: null,
		video_name: entry.videoName || null,
		song: entry.song ? { ...entry.song } : null
	};
}

class Journal {
	entries = $state<Record<string, Entry>>({});
	paper = $state<PaperStyle>('lined');
	/** Privacy assigned to newly created pages (Profile → Settings). */
	defaultPrivacy = $state<Privacy>('private');
	current = $state(todayKey());
	side = $state<Side>('L');
	selected = $state<string[]>([]);
	lastPage = $state<Side>('R');
	sessionVideos = $state<Record<string, string>>({});
	/** Signed poster URLs, keyed by entry date. Posters are optional. */
	sessionThumbs = $state<Record<string, string>>({});
	/** Per-date reason a stored video cannot be played, so the UI can stop spinning. */
	videoFailures = $state<Record<string, string>>({});

	ready = $state(false);
	busy = $state(false);
	syncing = $state(false);
	remote = $state(false);
	uploading = $state(false);

	toastMessage = $state('');
	toastVisible = $state(false);
	toastSeq = $state(0);

	private ownerId = '';
	private pending = new Set<string>();
	private flushing = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;
	private initSeq = 0;
	private signedUrlPending = new Set<string>();
	private thumbPending = new Set<string>();
	private thumbUnavailable = new Set<string>();
	private videoRefreshAttempts = new Map<string, number>();
	private remoteDeletes = new Map<string, Promise<void>>();

	get sortedDates(): string[] {
		return Object.keys(this.entries).sort();
	}

	/** Current and best streak for this journal. Recomputed when entries change. */
	get streak(): StreakSummary {
		return summarizeStreak(this.entries);
	}

	async init(ownerId: string, allowRemote = true) {
		if (!ownerId) return;
		if (this.ready && this.ownerId === ownerId) return;
		if (this.ownerId && this.ownerId !== ownerId) this.reset();

		const seq = ++this.initSeq;
		this.ownerId = ownerId;
		this.ready = false;
		this.remote = false;
		this.paper = readPaper();
		this.entries = this.readLocal(ownerId);

		const claimed = await this.claimLegacy(ownerId);
		if (seq !== this.initSeq) return;
		this.entries = { ...claimed, ...this.entries };

		const useRemote = allowRemote && isSupabaseConfigured;

		if (useRemote) {
			try {
				const { data, error } = await supabase
					.from('vidjo_entries')
					.select('*')
					.eq('owner_id', ownerId)
					.order('entry_date', { ascending: true });

				if (seq !== this.initSeq) return;
				if (error) throw error;

				const remote = Object.fromEntries(
					(data as EntryRow[]).map((row) => [row.entry_date, rowToEntry(row)])
				);
				const localDates = Object.keys(this.entries);
				const remoteDates = Object.keys(remote);

				if (remoteDates.length === 0 && localDates.length === 0) {
					// First run for this account: start with an empty journal.
					this.entries = {};
				} else {
					// Keep anything created while offline, then let remote rows win on
					// the same date. Local-only pages are pushed back up.
					const localOnly = localDates.filter((date) => !remote[date]);
					this.entries = { ...this.entries, ...remote };

					if (localOnly.length > 0) {
						const { error: upsertError } = await supabase.from('vidjo_entries').upsert(
							localOnly.map((date) => entryToRow(ownerId, this.entries[date])),
							{ onConflict: 'owner_id,entry_date' }
						);

						if (seq !== this.initSeq) return;
						if (upsertError) throw upsertError;
					}
				}

				this.remote = true;
			} catch (error) {
				if (seq !== this.initSeq) return;
				console.warn('[VidJo] Supabase is unavailable, falling back to local storage.', error);
				this.remote = false;

				if (Object.keys(this.entries).length === 0) {
					this.entries = {};
				}
			}
		} else if (Object.keys(this.entries).length === 0) {
			this.entries = {};
		}

		if (seq !== this.initSeq) return;
		this.persistLocal();

		const today = todayKey();
		if (!this.entries[today]) {
			this.entries[today] = blankEntry(today, this.defaultPrivacy);
		}

		this.current = today;
		this.side = 'L';
		this.selected = [];
		this.ready = true;

		void this.hydrateVideos(seq);
	}

	clearLocalCache(ownerId = this.ownerId) {
		if (!ownerId) return;
		try {
			localStorage.removeItem(storageKey(ownerId));
		} catch {
			// Ignore storage access errors.
		}
		void clearStoredVideosForOwner(ownerId);
	}

	reset(clearLocal = false) {
		const prevOwner = this.ownerId;
		if (clearLocal && prevOwner) {
			this.clearLocalCache(prevOwner);
		}

		this.initSeq += 1;
		this.ownerId = '';
		this.ready = false;
		this.busy = false;
		this.syncing = false;
		this.remote = false;
		this.uploading = false;
		this.entries = {};
		this.current = todayKey();
		this.side = 'L';
		this.selected = [];
		this.lastPage = 'R';
		this.pending.clear();
		this.flushing = false;
		this.signedUrlPending.clear();
		this.thumbPending.clear();
		this.thumbUnavailable.clear();
		this.remoteDeletes.clear();

		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		for (const url of Object.values(this.sessionVideos)) {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		}
		for (const url of Object.values(this.sessionThumbs)) {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		}
		this.sessionVideos = {};
		this.sessionThumbs = {};
		this.videoFailures = {};
		this.videoRefreshAttempts.clear();
	}

	private async claimLegacy(ownerId: string): Promise<Record<string, Entry>> {
		try {
			const claimedBy = localStorage.getItem(CLAIMED_KEY);
			if (claimedBy && claimedBy !== ownerId) return {};

			localStorage.setItem(CLAIMED_KEY, ownerId);

			const merged: Record<string, Entry> = {};
			const deviceId = peekDeviceId();

			// Move rows written before accounts existed onto this account. The
			// database function is scoped to the signed-in user and deletes the
			// old device rows after copying them.
			if (deviceId && deviceId !== ownerId && isSupabaseConfigured) {
				try {
					const { error } = await supabase.rpc('claim_device_entries', {
						device_id: deviceId
					});

					if (error) {
						console.warn('[VidJo] Could not claim old device entries.', error);
					}
				} catch {
					// Old rows are a bonus, not a requirement.
				}
			}

			// Local pages are the most recent copy of any offline work.
			try {
				const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
				if (raw) {
					const saved = JSON.parse(raw) as {
						entries?: Record<string, Partial<Entry> & { date: string }>;
					};
					if (saved.entries) {
						for (const [date, item] of Object.entries(saved.entries)) {
							merged[date] = normalizeEntry(item);
						}
					}
				}
			} catch {
				// Ignore corrupt or unavailable local storage.
			}

			return merged;
		} catch {
			return {};
		}
	}

	private readLocal(ownerId: string): Record<string, Entry> {
		try {
			const raw = localStorage.getItem(storageKey(ownerId));
			if (raw) {
				const saved = JSON.parse(raw) as {
					entries?: Record<string, Partial<Entry> & { date: string }>;
					paper?: PaperStyle;
				};
				if (saved.paper) this.paper = saved.paper;
				if (saved.entries) {
					return Object.fromEntries(
						Object.entries(saved.entries).map(([date, entry]) => [date, normalizeEntry(entry)])
					);
				}
			}
		} catch {
			// Ignore corrupt or unavailable local storage.
		}

		return {};
	}

	persistLocal() {
		if (!this.ownerId) return;

		try {
			localStorage.setItem(
				storageKey(this.ownerId),
				JSON.stringify({ entries: $state.snapshot(this.entries), paper: this.paper })
			);
			localStorage.setItem(PAPER_KEY, this.paper);
		} catch {
			// A full or blocked storage should never break the journal.
		}
	}

	queueSave(date = this.current) {
		if (!this.ownerId) return;

		this.pending.add(date);
		this.persistLocal();

		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, 400);
	}

	async flush() {
		if (!this.remote || !this.ownerId) return;
		// A second flush while one is in flight would upload the same rows and
		// could clear pending dates that were just queued. Let the active loop
		// pick them up instead.
		if (this.flushing || this.pending.size === 0) return;

		this.flushing = true;
		this.syncing = true;
		try {
			while (this.pending.size > 0) {
				const dates = [...this.pending];
				this.pending.clear();

				// If a page was deleted and recreated, let the DELETE land first.
				await Promise.all(dates.map((date) => this.remoteDeletes.get(date)));

				const rows = dates
					.map((date) => this.entries[date])
					.filter((entry): entry is Entry => Boolean(entry))
					.map((entry) => entryToRow(this.ownerId, entry));

				if (rows.length === 0) continue;

				const { error } = await supabase
					.from('vidjo_entries')
					.upsert(rows, { onConflict: 'owner_id,entry_date' });

				if (error) {
					console.warn('[VidJo] Could not sync to Supabase.', error);
					this.toast('Could not sync — your page is saved on this device');
					// Put the failed dates back so the next save retries them,
					// then stop this loop rather than spinning on the failure.
					for (const date of dates) this.pending.add(date);
					break;
				}
			}
		} finally {
			this.syncing = false;
			this.flushing = false;
		}
	}

	async removeRemote(date: string) {
		if (!this.remote || !this.ownerId) return;
		const { error } = await supabase
			.from('vidjo_entries')
			.delete()
			.eq('owner_id', this.ownerId)
			.eq('entry_date', date);
		if (error) console.warn('[VidJo] Could not delete the remote entry.', error);
	}

	/**
	 * Deletes a page remotely and remembers the request. If the same date is
	 * recreated before the DELETE finishes, `flush()` waits for it first so the
	 * fresh page cannot be removed by the older request.
	 */
	private trackRemoteDelete(date: string) {
		const task = this.removeRemote(date);
		this.remoteDeletes.set(date, task);
		void task.finally(() => {
			if (this.remoteDeletes.get(date) === task) this.remoteDeletes.delete(date);
		});
		return task;
	}

	isBlank(entry: Entry) {
		return (
			!entry.saved &&
			!entry.communitySlug &&
			entry.includedFriendIds.length === 0 &&
			entry.excludedFriendIds.length === 0 &&
			!entry.mood &&
			!entry.title &&
			!entry.mind &&
			!entry.refl &&
			entry.stickers.length === 0 &&
			!entry.videoPath &&
			!this.videoFor(entry.date) &&
			!entry.song
		);
	}

	leaveCurrentIfBlank() {
		const entry = this.entries[this.current];
		if (!entry) return;
		if (this.current !== todayKey() && this.isBlank(entry)) {
			delete this.entries[this.current];
			this.persistLocal();
			void this.trackRemoteDelete(this.current);
		}
	}

	async deleteEntry(date: string) {
		const entry = this.entries[date];
		if (!entry) return;

		// Clean up video and poster if present
		if (entry.videoPath || entry.videoThumbPath) {
			void this.deleteRemoteObjects([entry.videoPath, entry.videoThumbPath]);
		}
		void deleteStoredVideo(this.videoKey(date));
		this.clearSessionVideo(date);
		this.clearSessionThumb(date);
		this.thumbUnavailable.delete(date);

		// Pick the neighbouring page before mutating so the fallback is the page
		// next to the one being deleted, not the oldest page in the journal.
		const order = this.sortedDates;
		const idx = order.indexOf(date);
		const neighbour = order[idx < order.length - 1 ? idx + 1 : idx - 1];

		// Remove from remote. Track the request so a page recreated for this date
		// is upserted only after the delete has completed.
		void this.trackRemoteDelete(date);

		// Remove from local state
		delete this.entries[date];
		this.persistLocal();

		// Navigate to a nearby date. Deleting the last remaining page would
		// otherwise leave `current` pointing at a date with no entry, which makes
		// Book/LeftPage/RightPage dereference `undefined`.
		let target = neighbour && this.entries[neighbour] ? neighbour : this.sortedDates[0];
		if (!target) {
			target = todayKey();
			this.entries[target] = blankEntry(target, this.defaultPrivacy);
			this.persistLocal();
		}

		if (this.current === date) {
			this.current = target;
			this.side = 'L';
		}

		this.toast('Page deleted');
	}

	ensureEntry(date: string) {
		// A page may exist for today or an earlier day only. This guard also
		// covers a stale calendar tab or a crafted call to `ensureEntry`.
		if (isFutureDate(date)) {
			this.toast('Future pages are locked. You can write today or an earlier day.');
			return null;
		}
		if (!this.entries[date]) this.entries[date] = blankEntry(date, this.defaultPrivacy);
		return this.entries[date];
	}

	/** Shared text is masked when other people read it. Explain that before they post. */
	private warnIfSharedTextHasProfanity(entry: Entry) {
		if (isObscene([entry.title, entry.mind, entry.refl].join(' '))) {
			this.toast('Heads up: swearing is hidden in Friends and Community text.');
		}
	}

	updateCurrent(patch: Partial<Entry>) {
		const entry = this.entries[this.current];
		if (!entry) return;
		if (typeof patch.title === 'string') patch.title = patch.title.slice(0, TITLE_MAX);
		Object.assign(entry, patch);
		if (entry.sample) entry.sample = false;
		this.queueSave(this.current);
	}

	toggleMood(mood: MoodKey) {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.mood = entry.mood === mood ? '' : mood;
		entry.sample = false;
		this.queueSave(this.current);
	}

	async setSongForCurrent(song: EntrySong | null) {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.song = song ? { ...song } : null;
		entry.sample = false;
		this.queueSave(this.current);
		await this.flush();
	}

	/**
	 * Friends and Community are independent sharing destinations. A page in a
	 * community can also be shared with friends through `shareWithFriends`, while
	 * a friends-only page keeps `privacy` as `friends`. Private is its own choice
	 * and turns off both destinations.
	 */
	setFriendsSharing(enabled: boolean) {
		const entry = this.entries[this.current];
		if (!entry) return;

		if (entry.privacy === 'community') {
			entry.shareWithFriends = enabled;
		} else {
			entry.privacy = enabled ? 'friends' : 'private';
			entry.shareWithFriends = false;
		}

		// Included friends only matter for private pages; clear that list so a
		// stale exception can't keep exposing a page after privacy changes.
		entry.includedFriendIds = [];
		if (entry.privacy === 'private') entry.excludedFriendIds = [];

		entry.sample = false;
		this.queueSave(this.current);
		if (enabled) this.warnIfSharedTextHasProfanity(entry);
	}

	setCommunitySharing(enabled: boolean) {
		const entry = this.entries[this.current];
		if (!entry) return;

		const friendsOn =
			entry.privacy === 'friends' || (entry.privacy === 'community' && entry.shareWithFriends);

		if (enabled) {
			entry.privacy = 'community';
			entry.shareWithFriends = friendsOn;
		} else {
			entry.privacy = friendsOn ? 'friends' : 'private';
			entry.shareWithFriends = false;
			entry.communitySlug = '';
		}

		// Included friends only matter for private pages; clear that list so a
		// stale exception can't keep exposing a page after privacy changes.
		entry.includedFriendIds = [];
		if (entry.privacy === 'private') entry.excludedFriendIds = [];

		entry.sample = false;
		this.queueSave(this.current);
		if (enabled) this.warnIfSharedTextHasProfanity(entry);
	}

	setPrivate() {
		const entry = this.entries[this.current];
		if (!entry) return;

		entry.privacy = 'private';
		entry.communitySlug = '';
		entry.shareWithFriends = false;
		entry.includedFriendIds = [];
		entry.excludedFriendIds = [];
		entry.sample = false;
		this.queueSave(this.current);
	}

	setCommunity(communitySlug: string) {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.communitySlug = communitySlug;
		entry.sample = false;
		this.queueSave(this.current);
	}

	markSaved() {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.saved = true;
		entry.sample = false;
		this.queueSave(this.current);

		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		void this.flush();
		track('entry_saved', {
			has_video: Boolean(entry.videoPath),
			privacy: entry.privacy,
			mood: Boolean(entry.mood)
		});
		this.toast('Saved to your journal');
	}

	videoFor(date: string) {
		const session = this.sessionVideos[date];
		if (session) return session;

		const path = this.entries[date]?.videoPath;
		if (path && isSupabaseConfigured && !this.videoFailures[date]) {
			void this.resolveSignedUrl(date, path);
		}
		return '';
	}

	/** Signed poster URL for a stored video, or '' while it loads or if unavailable. */
	thumbFor(date: string) {
		const session = this.sessionThumbs[date];
		if (session) return session;

		const path = this.entries[date]?.videoThumbPath;
		if (path && isSupabaseConfigured && !this.thumbUnavailable.has(date)) {
			void this.resolveThumbnail(date, path);
		}
		return '';
	}

	/** Human-readable reason the stored video cannot be played, or '' when it can. */
	videoProblem(date: string) {
		return this.videoFailures[date] ?? '';
	}

	/** Ask storage for a fresh URL after the previous one expired or failed to play. */
	refreshVideo(date: string) {
		const attempts = (this.videoRefreshAttempts.get(date) ?? 0) + 1;
		this.videoRefreshAttempts.set(date, attempts);

		if (attempts > 2) {
			this.videoFailures[date] = 'The video could not be played.';
			return;
		}

		this.clearSessionVideo(date);
		delete this.videoFailures[date];
		void this.resolveSignedUrl(date);
	}

	/** Reset the refresh budget once a video actually plays. */
	videoPlayed(date: string) {
		this.videoRefreshAttempts.delete(date);
	}

	/** Manual retry from the page when signing previously failed. */
	retryVideo(date: string) {
		this.videoRefreshAttempts.delete(date);
		delete this.videoFailures[date];
		this.clearSessionVideo(date);
		void this.resolveSignedUrl(date);
	}

	async resolveSignedUrl(date: string, path?: string) {
		const targetPath = path ?? this.entries[date]?.videoPath;
		if (!targetPath || !isSupabaseConfigured) return;
		if (this.sessionVideos[date]) return;
		if (this.signedUrlPending.has(date)) return;

		this.signedUrlPending.add(date);
		try {
			const { data, error } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(targetPath, SIGNED_URL_TTL);

			if (error || !data?.signedUrl) {
				const detail = error as { message?: string; statusCode?: string | number } | null;
				const message = detail?.message?.trim() || 'The video could not be loaded.';
				const folder = targetPath.split('/')[0] || '';
				const mismatch = Boolean(this.ownerId && folder && folder !== this.ownerId);

				// All signing failures arrive as HTTP 400. Log the actual storage
				// message so a missing object is not mistaken for an app bug.
				console.warn('[VidJo] Could not create a signed video URL.', {
					path: targetPath,
					owner: this.ownerId,
					pathOwner: folder,
					ownerMismatch: mismatch,
					status: detail?.statusCode ?? null,
					message
				});

				this.videoFailures[date] = mismatch
					? 'This video was uploaded under a different account, so it cannot be played here.'
					: /not found|does not exist|invalid key|not authorized|permission/i.test(message)
						? 'This video is no longer available in storage.'
						: message;
				track('video_play_failed', {
					reason: mismatch
						? 'permission'
						: /not found|does not exist|invalid key|not authorized/i.test(message)
							? 'missing'
							: 'unknown'
				});
				return;
			}

			this.sessionVideos[date] = data.signedUrl;
			delete this.videoFailures[date];
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn('[VidJo] Could not create a signed video URL.', {
				path: targetPath,
				owner: this.ownerId,
				message
			});
			captureError(err, { area: 'video-sign' });
			this.videoFailures[date] = message;
		} finally {
			this.signedUrlPending.delete(date);
		}
	}

	private async resolveThumbnail(date: string, path?: string) {
		const targetPath = path ?? this.entries[date]?.videoThumbPath;
		if (!targetPath || !isSupabaseConfigured) return;
		if (this.sessionThumbs[date] || this.thumbPending.has(date)) return;
		if (this.thumbUnavailable.has(date)) return;

		this.thumbPending.add(date);
		try {
			const { data, error } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(targetPath, SIGNED_URL_TTL);

			if (error || !data?.signedUrl) {
				// Posters are optional. Remember the failure so every render does not
				// retry the same missing object.
				this.thumbUnavailable.add(date);
				return;
			}

			this.sessionThumbs[date] = data.signedUrl;
		} catch (error) {
			this.thumbUnavailable.add(date);
			console.debug('[VidJo] Could not sign a video poster.', { path: targetPath, error });
		} finally {
			this.thumbPending.delete(date);
		}
	}

	private videoKey(date: string) {
		return `${this.ownerId}:${date}`;
	}

	async setVideo(file: File, thumbnail?: Blob | null) {
		if (!file) return;

		const entry = this.entries[this.current];
		if (!entry) return;

		const date = this.current;
		const ownerId = this.ownerId;
		const previousPath = entry.videoPath;
		const previousThumbPath = entry.videoThumbPath;

		this.uploading = true;
		this.clearSessionVideo(date);
		this.clearSessionThumb(date);
		delete this.videoFailures[date];
		this.thumbUnavailable.delete(date);
		this.videoRefreshAttempts.delete(date);

		try {
			let uploadedPath = '';
			let uploadedUrl = '';
			let uploadedThumbPath = '';
			let uploadedThumbUrl = '';
			let bucketMissing = false;

			// Capture the poster while the video uploads. Capture is best-effort and
			// resolves to null on failure, so it never blocks the upload.
			const thumbPromise = thumbnail ? Promise.resolve(thumbnail) : captureVideoThumbnail(file);

			if (this.remote) {
				const result = await this.uploadVideoBlob(file, date, file.name);
				uploadedPath = result.path;
				uploadedUrl = result.url;
				bucketMissing = result.bucketMissing;

				if (uploadedPath) {
					const thumb = await thumbPromise;
					if (thumb) {
						const thumbResult = await this.uploadThumbBlob(thumb, date);
						uploadedThumbPath = thumbResult.path;
						uploadedThumbUrl = thumbResult.url;
						// Keep the local capture as a session-only poster if the
						// thumbnail upload failed.
						if (!uploadedThumbUrl) this.sessionThumbs[date] = URL.createObjectURL(thumb);
					}
				}
			}

			if (this.ownerId !== ownerId || this.entries[date] !== entry) return;

			if (uploadedPath) {
				entry.videoPath = uploadedPath;
				entry.videoThumbPath = uploadedThumbPath;
				entry.videoName = file.name;
				this.sessionVideos[date] = uploadedUrl;
				if (uploadedThumbUrl) this.sessionThumbs[date] = uploadedThumbUrl;
				await deleteStoredVideo(this.videoKey(date));
				this.toast('Video added to this page');
			} else {
				const thumb = await thumbPromise;
				entry.videoPath = '';
				entry.videoThumbPath = '';
				entry.videoName = file.name;
				this.sessionVideos[date] = URL.createObjectURL(file);
				if (thumb) this.sessionThumbs[date] = URL.createObjectURL(thumb);
				const stored = await putStoredVideo(this.videoKey(date), file);

				if (!stored) {
					this.toast('Video added for this session');
				} else if (bucketMissing) {
					this.toast('Video saved on this device. Create the vidjo-videos bucket to sync.');
				} else {
					this.toast('Video saved on this device');
				}
			}

			if (this.ownerId !== ownerId || this.entries[date] !== entry) return;

			const stalePaths = [previousPath, previousThumbPath].filter((path): path is string =>
				Boolean(path)
			);
			if (stalePaths.length > 0) {
				void this.deleteRemoteObjects(stalePaths);
			}
			track('video_added', {
				mode: uploadedPath ? 'cloud' : 'device',
				mime: file.type.includes('mp4') ? 'mp4' : file.type.includes('webm') ? 'webm' : 'other'
			});
			entry.sample = false;
			this.queueSave(date);
		} finally {
			this.uploading = false;
		}
	}

	async removeVideo(date = this.current) {
		const entry = this.entries[date];
		if (!entry) return;

		const previousPath = entry.videoPath;
		const previousThumbPath = entry.videoThumbPath;

		this.clearSessionVideo(date);
		this.clearSessionThumb(date);
		void deleteStoredVideo(this.videoKey(date));
		delete this.videoFailures[date];
		this.thumbUnavailable.delete(date);
		this.videoRefreshAttempts.delete(date);
		entry.videoPath = '';
		entry.videoThumbPath = '';
		entry.videoName = '';
		entry.sample = false;
		this.queueSave(date);
		track('video_removed');

		const stalePaths = [previousPath, previousThumbPath].filter((path): path is string =>
			Boolean(path)
		);
		if (stalePaths.length === 0) {
			this.toast('Video removed');
			return;
		}

		const deleted = await this.deleteRemoteObjects(stalePaths);
		if (!deleted && this.remote) {
			this.toast('Video removed from this page, but the stored file could not be deleted.');
		} else {
			this.toast('Video removed');
		}
	}

	private clearSessionVideo(date: string) {
		const url = this.sessionVideos[date];
		if (!url) return;
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		delete this.sessionVideos[date];
	}

	private clearSessionThumb(date: string) {
		const url = this.sessionThumbs[date];
		if (!url) return;
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		delete this.sessionThumbs[date];
	}

	private async hydrateVideos(seq: number) {
		const entries = Object.values(this.entries);

		await Promise.all(
			entries.map(async (entry) => {
				const key = this.videoKey(entry.date);
				const blob = await getStoredVideo(key);
				if (seq !== this.initSeq) return;

				if (blob) {
					if (entry.videoPath) {
						void deleteStoredVideo(key);
					} else {
						if (!entry.videoName) entry.videoName = 'vidjo-video.webm';
						this.sessionVideos[entry.date] = URL.createObjectURL(blob);
						void captureVideoThumbnail(blob).then((thumb) => {
							if (!thumb || seq !== this.initSeq) return;
							if (this.entries[entry.date] !== entry || entry.videoPath) return;
							if (this.sessionThumbs[entry.date]) return;
							this.sessionThumbs[entry.date] = URL.createObjectURL(thumb);
						});
						if (this.remote) void this.uploadLocalVideo(entry, blob, key, seq);
						return;
					}
				}

				if (entry.videoPath) {
					void this.resolveSignedUrl(entry.date, entry.videoPath);
				}
				if (entry.videoThumbPath) {
					void this.resolveThumbnail(entry.date, entry.videoThumbPath);
				}
			})
		);
	}

	private async uploadLocalVideo(entry: Entry, blob: Blob, key: string, seq: number) {
		const thumbPromise = captureVideoThumbnail(blob);
		const { path, url } = await this.uploadVideoBlob(
			blob,
			entry.date,
			entry.videoName || 'vidjo-video.webm'
		);
		if (!path || seq !== this.initSeq) return;

		const thumb = await thumbPromise;
		if (seq !== this.initSeq) return;

		let thumbPath = '';
		if (thumb) {
			const thumbResult = await this.uploadThumbBlob(thumb, entry.date);
			if (seq !== this.initSeq) return;
			thumbPath = thumbResult.path;
			if (thumbResult.url) {
				this.clearSessionThumb(entry.date);
				this.sessionThumbs[entry.date] = thumbResult.url;
			}
		}

		entry.videoPath = path;
		entry.videoThumbPath = thumbPath;
		this.sessionVideos[entry.date] = url;
		await deleteStoredVideo(key);
		this.queueSave(entry.date);
		this.toast('Video synced to your account');
	}

	private async uploadVideoBlob(blob: Blob, date: string, name: string) {
		if (!isSupabaseConfigured || !this.remote || !this.ownerId) {
			return { path: '', url: '', bucketMissing: false };
		}

		try {
			const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'video.webm';
			const path = `${this.ownerId}/${date}/${Date.now()}-${safeName}`;
			const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(path, blob, {
				contentType: videoContentType(blob, safeName),
				upsert: true
			});

			if (error) throw error;

			const { data: signedData, error: signError } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(path, SIGNED_URL_TTL);

			if (signError) throw signError;

			return { path, url: signedData?.signedUrl ?? '', bucketMissing: false };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn('[VidJo] Video upload failed.', error);
			captureError(error, { area: 'video-upload' });
			return { path: '', url: '', bucketMissing: /bucket/i.test(message) };
		}
	}

	private async uploadThumbBlob(blob: Blob, date: string) {
		if (!isSupabaseConfigured || !this.remote || !this.ownerId) {
			return { path: '', url: '' };
		}

		try {
			const path = `${this.ownerId}/${date}/${Date.now()}-thumb.jpg`;
			const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(path, blob, {
				contentType: 'image/jpeg',
				upsert: true
			});

			if (error) throw error;

			const { data: signedData, error: signError } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(path, SIGNED_URL_TTL);

			if (signError) throw signError;

			return { path, url: signedData?.signedUrl ?? '' };
		} catch (error) {
			// A poster is optional. Keep the video even if the thumbnail upload fails.
			console.warn('[VidJo] Video poster upload failed.', error);
			captureError(error, { area: 'video-thumb-upload' });
			return { path: '', url: '' };
		}
	}

	private async deleteRemoteObjects(pathsOrUrls: string[]): Promise<boolean> {
		if (!isSupabaseConfigured || !this.ownerId) return false;

		const paths = pathsOrUrls
			.map((pathOrUrl) => {
				if (pathOrUrl.includes('http://') || pathOrUrl.includes('https://')) {
					return legacyVideoPath(pathOrUrl);
				}
				return pathOrUrl;
			})
			.filter((path) => {
				if (!path) return false;

				// The delete policy only allows objects inside the signed-in user's
				// folder. Skip other keys instead of sending a request that cannot work.
				const folder = path.split('/')[0] || '';
				if (folder !== this.ownerId) {
					console.warn('[VidJo] Not deleting a video outside this account folder.', {
						path,
						owner: this.ownerId
					});
					return false;
				}
				return true;
			});

		if (paths.length === 0) return false;

		try {
			const { error } = await supabase.storage.from(VIDEO_BUCKET).remove(paths);
			if (error) {
				// `.remove()` resolves with an error object instead of throwing, so
				// this is the only place a failed deletion is visible.
				console.warn('[VidJo] Could not delete stored video files.', {
					paths,
					status: error.statusCode ?? null,
					message: error.message
				});
				captureError(new Error(error.message), {
					area: 'video-delete',
					status: error.statusCode ?? null
				});
				return false;
			}
			return true;
		} catch (error) {
			console.warn('[VidJo] Could not delete stored video files.', { paths, error });
			captureError(error, { area: 'video-delete' });
			return false;
		}
	}

	findSticker(id: string) {
		return this.entries[this.current]?.stickers.find((sticker) => sticker.id === id);
	}

	addSticker(type: string, extra: Partial<Sticker> = {}) {
		const entry = this.entries[this.current];
		if (!entry) return;

		const definition = STICKER_BY_KEY[type];
		// In the two-page spread the right (writing) page is the decorate target;
		// stickers can still be dragged to the left page afterward.
		const page = viewport.single ? this.side : 'R';

		const sticker: Sticker = {
			id: uid(),
			type,
			page,
			x: Math.round(50 + (Math.random() * 30 - 15)),
			y: Math.round(50 + (Math.random() * 30 - 15)),
			size: definition?.s ?? 120,
			rot: Math.round(Math.random() * 24 - 12),
			...extra
		};

		entry.stickers.push(sticker);
		entry.sample = false;
		this.selected = [sticker.id];
		this.lastPage = page;
		this.queueSave(this.current);
		this.toast('Sticker added');
	}

	addImageSticker(src: string) {
		this.addSticker('img', { src, size: 130 });
	}

	updateSticker(id: string, patch: Partial<Sticker>) {
		const sticker = this.findSticker(id);
		if (!sticker) return;
		Object.assign(sticker, patch);
		this.commit();
	}

	deleteSticker(id: string) {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.stickers = entry.stickers.filter((sticker) => sticker.id !== id);
		this.selected = this.selected.filter((sid) => sid !== id);
		this.commit();
	}

	deleteSelected() {
		const entry = this.entries[this.current];
		if (!entry) return;
		const toRemove = [...this.selected];
		for (const id of toRemove) {
			entry.stickers = entry.stickers.filter((sticker) => sticker.id !== id);
		}
		this.selected = [];
		this.commit();
		this.toast(`${toRemove.length} sticker${toRemove.length > 1 ? 's' : ''} removed`);
	}

	selectSticker(id: string | null, multi = false) {
		if (id === null) {
			this.selected = [];
			return;
		}
		if (multi) {
			if (this.selected.includes(id)) {
				this.selected = this.selected.filter((sid) => sid !== id);
			} else {
				this.selected = [...this.selected, id];
			}
		} else {
			this.selected = [id];
		}
	}

	commit() {
		const entry = this.entries[this.current];
		if (entry?.sample) entry.sample = false;
		this.queueSave(this.current);
	}

	setPaper(paper: PaperStyle) {
		this.paper = paper;
		this.persistLocal();
	}

	toast(message: string) {
		this.toastMessage = message;
		this.toastSeq += 1;
		this.toastVisible = true;

		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => {
			this.toastVisible = false;
		}, 2200);
	}
}

export const journal = new Journal();
