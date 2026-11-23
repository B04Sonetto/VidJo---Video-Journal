import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';
import { track } from '#lib/analytics';
import { isObscene } from '#lib/censor';
import { STICKER_BY_KEY } from '#lib/data/stickers';
import { detectRasterImageMime, type RasterImageMime } from '#lib/imageUpload';
import { dateKey, isFutureDate, todayKey, uid } from '#lib/dates';
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
const UNCREATED_PAGE_AT = '1970-01-01T00:00:00.000Z';

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

/** Highlights are capped well below the 50 MB bucket limit so pages stay fast. */
const HIGHLIGHT_MAX_BYTES = 8 * 1024 * 1024;

const HIGHLIGHT_EXT: Record<RasterImageMime, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp'
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
	raw: Partial<Entry> & { date: string; videoUrl?: string; song?: unknown },
	id = ''
): Entry {
	return {
		id: raw.id || id || newPageId(),
		date: raw.date,
		createdAt: raw.createdAt || UNCREATED_PAGE_AT,
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
		highlightPath: raw.highlightPath ?? '',
		highlightName: raw.highlightName ?? '',
		excludedFriendIds: Array.isArray(raw.excludedFriendIds) ? raw.excludedFriendIds : [],
		includedFriendIds: Array.isArray(raw.includedFriendIds) ? raw.includedFriendIds : [],
		shareWithFriends: Boolean(raw.shareWithFriends),
		song: normalizeSong(raw.song)
	};
}

function newPageId() {
	return globalThis.crypto?.randomUUID?.() || uid();
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

export function blankEntry(
	date: string,
	privacy: Privacy = 'private',
	id = newPageId(),
	createdAt = new SvelteDate().toISOString()
): Entry {
	return {
		id,
		date,
		createdAt,
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
		highlightPath: '',
		highlightName: '',
		excludedFriendIds: [],
		includedFriendIds: [],
		shareWithFriends: false,
		song: null
	};
}

function rowToEntry(row: EntryRow & { song?: unknown }): Entry {
	return {
		id: row.id,
		date: row.entry_date,
		createdAt: row.created_at || UNCREATED_PAGE_AT,
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
		highlightPath: row.highlight_path ?? '',
		highlightName: row.highlight_name ?? '',
		excludedFriendIds: Array.isArray(row.excluded_friend_ids) ? row.excluded_friend_ids : [],
		includedFriendIds: Array.isArray(row.included_friend_ids) ? row.included_friend_ids : [],
		shareWithFriends: Boolean(row.share_with_friends),
		song: normalizeSong(row.song)
	};
}

function entryToRow(ownerId: string, entry: Entry): EntryRow {
	return {
		id: entry.id,
		owner_id: ownerId,
		entry_date: entry.date,
		created_at: entry.createdAt,
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
		highlight_path: entry.highlightPath || null,
		highlight_name: entry.highlightName || null,
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
	current = $state('');
	side = $state<Side>('L');
	selected = $state<string[]>([]);
	lastPage = $state<Side>('R');
	sessionVideos = $state<Record<string, string>>({});
	/** Signed poster URLs, keyed by entry date. Posters are optional. */
	sessionThumbs = $state<Record<string, string>>({});
	/** Signed highlight photo URLs, keyed by entry id. Memory-only, like videos. */
	sessionHighlights = $state<Record<string, string>>({});
	/** Per-date reason a stored video cannot be played, so the UI can stop spinning. */
	videoFailures = $state<Record<string, string>>({});
	highlightUploading = $state(false);

	ready = $state(false);
	busy = $state(false);
	syncing = $state(false);
	remote = $state(false);
	uploading = $state(false);
	dailyPageCount = $state(0);
	dailyCommunityShareCount = $state(0);

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
	private highlightPending = new Set<string>();
	private highlightUnavailable = new SvelteSet<string>();
	private videoRefreshAttempts = new Map<string, number>();
	private remoteDeletes = new Map<string, Promise<void>>();

	get currentDate() {
		return this.entries[this.current]?.date ?? todayKey();
	}

	get sortedDates(): string[] {
		return Object.values(this.entries)
			.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
			.map((entry) => entry.id);
	}

	entriesForDate(date: string) {
		return Object.values(this.entries)
			.filter((entry) => entry.date === date)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	latestEntryId(date: string) {
		return this.entriesForDate(date).at(-1)?.id ?? '';
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
					.order('entry_date', { ascending: true })
					.order('created_at', { ascending: true });

				if (seq !== this.initSeq) return;
				if (error) throw error;

				const remoteEntries = (data as EntryRow[]).map(rowToEntry);
				const remote = Object.fromEntries(remoteEntries.map((entry) => [entry.id, entry]));
				const remoteDates = new Set(remoteEntries.map((entry) => entry.date));
				const localEntries = Object.values(this.entries);

				if (remoteEntries.length === 0 && localEntries.length === 0) {
					// First run for this account: start with an empty journal.
					this.entries = {};
				} else {
					// Stable IDs allow multiple offline pages on a date. Only discard
					// a pre-ID cache row when its original date-keyed page is remote.
					const localOnly = localEntries.filter(
						(entry) =>
							!remote[entry.id] &&
							!(entry.id.startsWith(`legacy-${entry.date}-`) && remoteDates.has(entry.date)) &&
							!(entry.createdAt === UNCREATED_PAGE_AT && this.isBlank(entry))
					);
					this.entries = Object.fromEntries(
						[...localOnly, ...remoteEntries].map((entry) => [entry.id, entry])
					);

					if (localOnly.length > 0) {
						const { error: upsertError } = await supabase.from('vidjo_entries').upsert(
							localOnly.map((entry) => entryToRow(ownerId, entry)),
							{ onConflict: 'id' }
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
		if (!this.entries[this.latestEntryId(today)]) {
			const entry = blankEntry(today, this.defaultPrivacy, undefined, UNCREATED_PAGE_AT);
			this.entries[entry.id] = entry;
		}

		this.current = this.latestEntryId(today);
		this.side = 'L';
		this.selected = [];
		this.ready = true;

		void this.refreshDailyQuota();
		void this.hydrateVideos(seq);
		void this.hydrateHighlights(seq);
	}

	async refreshDailyQuota() {
		if (!this.remote) return;
		try {
			const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
			const { error: timezoneError } = await supabase.rpc('vidjo_set_local_timezone', {
				p_timezone: timeZone
			});
			if (timezoneError) throw timezoneError;

			const { data, error } = await supabase.rpc('vidjo_daily_limits');
			if (error) throw error;
			const counts = data as { pages?: number; community_shares?: number } | null;
			this.dailyPageCount = Number(counts?.pages) || 0;
			this.dailyCommunityShareCount = Number(counts?.community_shares) || 0;
		} catch (error) {
			console.warn('[VidJo] Could not load daily page limits.', error);
			this.toast('Could not check today’s page limits. Try again when online.');
		}
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
		this.highlightUploading = false;
		this.dailyPageCount = 0;
		this.dailyCommunityShareCount = 0;
		this.entries = {};
		this.current = '';
		this.side = 'L';
		this.selected = [];
		this.lastPage = 'R';
		this.pending.clear();
		this.flushing = false;
		this.signedUrlPending.clear();
		this.thumbPending.clear();
		this.thumbUnavailable.clear();
		this.highlightPending.clear();
		this.highlightUnavailable.clear();
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
		for (const url of Object.values(this.sessionHighlights)) {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		}
		this.sessionVideos = {};
		this.sessionThumbs = {};
		this.sessionHighlights = {};
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
							const entry = normalizeEntry(item, `legacy-${date}-${newPageId()}`);
							merged[entry.id] = entry;
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
					const entries: Record<string, Entry> = {};
					for (const [key, rawEntry] of Object.entries(saved.entries)) {
						const entry = normalizeEntry(rawEntry, `legacy-${key}-${newPageId()}`);
						entries[entry.id] = entry;
					}
					return entries;
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

		const entry = this.entries[date];
		if (entry?.createdAt === UNCREATED_PAGE_AT) {
			entry.createdAt = new SvelteDate().toISOString();
		}
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

				const { error } = await supabase.from('vidjo_entries').upsert(rows, { onConflict: 'id' });

				if (error) {
					console.warn('[VidJo] Could not sync to Supabase.', error);
					const message = error.message || '';
					const quotaError = /daily page limit|daily community share limit/i.test(message);
					if (quotaError) await this.refreshDailyQuota();
					this.toast(
						/daily page limit/i.test(message)
							? 'Daily page limit reached. You can create up to 3 pages each day.'
							: /daily community share limit/i.test(message)
								? 'Daily Community share limit reached. You can share up to 3 pages each day.'
								: 'Could not sync — your page is saved on this device'
					);
					// Put the failed dates back so the next save retries them,
					// then stop this loop rather than spinning on the failure.
					for (const date of dates) this.pending.add(date);
					break;
				}
			}
			if (this.pending.size === 0) void this.refreshDailyQuota();
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
			.eq('id', date);
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
			!this.videoFor(entry.id) &&
			!entry.highlightPath &&
			!this.highlightFor(entry.id) &&
			!entry.song
		);
	}

	leaveCurrentIfBlank() {
		const entry = this.entries[this.current];
		if (!entry) return;
		if (entry.date !== todayKey() && this.isBlank(entry)) {
			delete this.entries[this.current];
			this.persistLocal();
			void this.trackRemoteDelete(this.current);
		}
	}

	async deleteEntry(id: string) {
		const entry = this.entries[id];
		if (!entry) return;

		// Clean up media objects if present.
		const remotePaths = [entry.videoPath, entry.videoThumbPath, entry.highlightPath].filter(
			(path): path is string => Boolean(path)
		);
		if (remotePaths.length > 0) void this.deleteRemoteObjects(remotePaths);
		void deleteStoredVideo(this.videoKey(id));
		void deleteStoredVideo(this.highlightKey(id));
		this.clearSessionVideo(id);
		this.clearSessionThumb(id);
		this.clearSessionHighlight(id);
		this.thumbUnavailable.delete(id);
		this.highlightUnavailable.delete(id);

		// Pick the neighbouring page before mutating so the fallback is the page
		// next to the one being deleted, not the oldest page in the journal.
		const order = this.sortedDates;
		const idx = order.indexOf(id);
		const neighbour = order[idx < order.length - 1 ? idx + 1 : idx - 1];

		// Remove from remote. Track the request so a page recreated for this date
		// is upserted only after the delete has completed.
		const remoteDelete = this.trackRemoteDelete(id);

		// Remove from local state
		delete this.entries[id];
		this.persistLocal();
		if (dateKey(new Date(entry.createdAt)) === todayKey()) {
			this.dailyPageCount = Math.max(0, this.dailyPageCount - 1);
		}

		// Navigate to a nearby date. Deleting the last remaining page would
		// otherwise leave `current` pointing at a date with no entry, which makes
		// Book/LeftPage/RightPage dereference `undefined`.
		let target = neighbour && this.entries[neighbour] ? neighbour : this.sortedDates[0];
		if (!target) {
			const entry = blankEntry(todayKey(), this.defaultPrivacy, undefined, UNCREATED_PAGE_AT);
			this.entries[entry.id] = entry;
			target = entry.id;
			this.persistLocal();
		}

		if (this.current === id) {
			this.current = target;
			this.side = 'L';
		}

		this.toast('Page deleted');
		await remoteDelete;
		void this.refreshDailyQuota();
	}

	ensureEntry(date: string) {
		// A page may exist for today or an earlier day only. This guard also
		// covers a stale calendar tab or a crafted call to `ensureEntry`.
		if (isFutureDate(date)) {
			this.toast('Future pages are locked. You can write today or an earlier day.');
			return null;
		}
		const latestId = this.latestEntryId(date);
		if (latestId) return this.entries[latestId];
		const entry = blankEntry(date, this.defaultPrivacy);
		this.entries[entry.id] = entry;
		this.persistLocal();
		return entry;
	}

	createEntry(date = todayKey()) {
		if (isFutureDate(date)) {
			this.toast('Future pages are locked. You can write today or an earlier day.');
			return null;
		}
		const createdToday = Object.values(this.entries).filter(
			(entry) => dateKey(new Date(entry.createdAt)) === todayKey()
		).length;
		if (Math.max(createdToday, this.dailyPageCount) >= 3) {
			this.toast('Daily page limit reached. You can create up to 3 pages each day.');
			return null;
		}
		const entry = blankEntry(date, this.defaultPrivacy);
		this.entries[entry.id] = entry;
		this.current = entry.id;
		this.side = 'L';
		this.persistLocal();
		this.queueSave(entry.id);
		this.dailyPageCount = Math.max(this.dailyPageCount + 1, createdToday + 1);
		return entry;
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
		if (enabled && entry.privacy !== 'community' && this.dailyCommunityShareCount >= 3) {
			this.toast('Daily Community share limit reached. You can share up to 3 pages each day.');
			return;
		}

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
		if (enabled) this.dailyCommunityShareCount += 1;
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

	/** Signed URL for this page's photo highlight, or '' while it loads. */
	highlightFor(id: string) {
		const session = this.sessionHighlights[id];
		if (session) return session;

		const path = this.entries[id]?.highlightPath;
		if (path && isSupabaseConfigured && !this.highlightUnavailable.has(id)) {
			void this.resolveHighlight(id, path);
		}
		return '';
	}

	/** True when Storage refused to sign this page's photo. */
	highlightFailed(id: string) {
		return this.highlightUnavailable.has(id);
	}

	/** Ask Storage for a fresh photo URL after one expires or fails to load. */
	retryHighlight(id: string) {
		this.highlightUnavailable.delete(id);
		this.clearSessionHighlight(id);
		void this.resolveHighlight(id);
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

	private async resolveHighlight(id: string, path?: string) {
		const targetPath = path ?? this.entries[id]?.highlightPath;
		if (!targetPath || !isSupabaseConfigured) return;
		if (this.sessionHighlights[id] || this.highlightPending.has(id)) return;
		if (this.highlightUnavailable.has(id)) return;

		this.highlightPending.add(id);
		try {
			const { data, error } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(targetPath, SIGNED_URL_TTL);

			if (error || !data?.signedUrl) {
				console.warn('[VidJo] Could not create a signed highlight URL.', {
					path: targetPath,
					message: error?.message ?? 'No signed URL returned'
				});
				this.highlightUnavailable.add(id);
				return;
			}

			this.sessionHighlights[id] = data.signedUrl;
			this.highlightUnavailable.delete(id);
		} catch (error) {
			console.warn('[VidJo] Could not sign a photo highlight.', error);
			captureError(error, { area: 'highlight-sign' });
			this.highlightUnavailable.add(id);
		} finally {
			this.highlightPending.delete(id);
		}
	}

	private videoKey(date: string) {
		return `${this.ownerId}:${date}`;
	}

	private highlightKey(id: string) {
		return `${this.ownerId}:${id}:highlight`;
	}

	private clearSessionHighlight(id: string) {
		const url = this.sessionHighlights[id];
		if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
		delete this.sessionHighlights[id];
	}

	async setVideo(file: File, thumbnail?: Blob | null) {
		if (!file) return;

		const entry = this.entries[this.current];
		if (!entry) return;

		const date = entry.id;
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

	async setHighlight(file: File) {
		const entry = this.entries[this.current];
		if (!file || !entry) return;

		if (file.size > HIGHLIGHT_MAX_BYTES) {
			this.toast('Choose a photo smaller than 8 MB.');
			return;
		}

		const detected = await detectRasterImageMime(file);
		if (!detected) {
			this.toast('Choose a real PNG, JPG, GIF, or WebP photo.');
			return;
		}

		const id = entry.id;
		const ownerId = this.ownerId;
		const previousPath = entry.highlightPath;
		const previewUrl = URL.createObjectURL(file);
		const discardPreview = () => {
			if (this.sessionHighlights[id] === previewUrl) this.clearSessionHighlight(id);
		};

		this.clearSessionHighlight(id);
		this.sessionHighlights[id] = previewUrl;
		this.highlightUnavailable.delete(id);
		this.highlightUploading = true;

		try {
			let uploadedPath = '';
			let uploadedUrl = '';

			if (this.remote) {
				const result = await this.uploadHighlightBlob(file, detected, id);
				uploadedPath = result.path;
				uploadedUrl = result.url;
			}

			if (this.ownerId !== ownerId || this.entries[id] !== entry) {
				discardPreview();
				return;
			}

			entry.highlightPath = uploadedPath;
			entry.highlightName = file.name;
			entry.sample = false;

			if (uploadedPath) {
				this.clearSessionHighlight(id);
				this.sessionHighlights[id] = uploadedUrl;
				void deleteStoredVideo(this.highlightKey(id));
				if (previousPath && previousPath !== uploadedPath) {
					void this.deleteRemoteObjects([previousPath]);
				}
				this.toast('Photo highlight added to this page');
			} else {
				if (previousPath) void this.deleteRemoteObjects([previousPath]);
				const stored = await putStoredVideo(this.highlightKey(id), file);
				this.toast(stored ? 'Photo saved on this device' : 'Photo added for this session');
			}

			track('highlight_added', {
				mode: uploadedPath ? 'cloud' : 'device',
				mime: detected
			});
			this.queueSave(id);
		} finally {
			this.highlightUploading = false;
		}
	}

	async removeHighlight(id = this.current) {
		const entry = this.entries[id];
		if (!entry) return;

		const previousPath = entry.highlightPath;
		this.clearSessionHighlight(id);
		this.highlightUnavailable.delete(id);
		void deleteStoredVideo(this.highlightKey(id));
		entry.highlightPath = '';
		entry.highlightName = '';
		entry.sample = false;
		this.queueSave(id);
		track('highlight_removed');

		if (!previousPath) {
			this.toast('Photo removed');
			return;
		}

		const deleted = await this.deleteRemoteObjects([previousPath]);
		if (!deleted && this.remote) {
			this.toast('Photo removed from this page, but the stored file could not be deleted.');
		} else {
			this.toast('Photo removed');
		}
	}

	private async uploadHighlightBlob(blob: Blob, mime: RasterImageMime, id: string) {
		if (!isSupabaseConfigured || !this.remote || !this.ownerId) {
			return { path: '', url: '' };
		}

		let uploadedPath = '';
		try {
			uploadedPath = `${this.ownerId}/${id}/${Date.now()}-highlight.${HIGHLIGHT_EXT[mime]}`;
			const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(uploadedPath, blob, {
				contentType: mime,
				upsert: true
			});
			if (error) throw error;

			const { data: signedData, error: signError } = await supabase.storage
				.from(VIDEO_BUCKET)
				.createSignedUrl(uploadedPath, SIGNED_URL_TTL);
			if (signError) throw signError;

			return { path: uploadedPath, url: signedData?.signedUrl ?? '' };
		} catch (error) {
			// A file that cannot be signed is unusable, so do not leave it behind.
			if (uploadedPath) void this.deleteRemoteObjects([uploadedPath]);
			console.warn('[VidJo] Photo highlight upload failed.', error);
			captureError(error, { area: 'highlight-upload' });
			return { path: '', url: '' };
		}
	}

	private async hydrateHighlights(seq: number) {
		await Promise.all(
			Object.values(this.entries).map(async (entry) => {
				const blob = await getStoredVideo(this.highlightKey(entry.id));
				if (seq !== this.initSeq) return;

				if (blob) {
					if (entry.highlightPath) {
						void deleteStoredVideo(this.highlightKey(entry.id));
						return;
					}
					if (!this.sessionHighlights[entry.id]) {
						this.sessionHighlights[entry.id] = URL.createObjectURL(blob);
					}
					if (this.remote) void this.uploadLocalHighlight(entry, blob, seq);
					return;
				}

				if (entry.highlightPath) {
					void this.resolveHighlight(entry.id, entry.highlightPath);
				}
			})
		);
	}

	private async uploadLocalHighlight(entry: Entry, blob: Blob, seq: number) {
		const mime = await detectRasterImageMime(blob);
		if (!mime || seq !== this.initSeq) return;

		const { path, url } = await this.uploadHighlightBlob(blob, mime, entry.id);
		if (!path || seq !== this.initSeq || this.entries[entry.id] !== entry) return;

		entry.highlightPath = path;
		if (url) this.sessionHighlights[entry.id] = url;
		await deleteStoredVideo(this.highlightKey(entry.id));
		this.queueSave(entry.id);
		this.toast('Photo synced to your account');
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
		const legacyVideoOwners = new SvelteMap<string, string>();
		for (const entry of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
			if (!legacyVideoOwners.has(entry.date)) legacyVideoOwners.set(entry.date, entry.id);
		}

		await Promise.all(
			entries.map(async (entry) => {
				const key = this.videoKey(entry.id);
				const legacyKey = this.videoKey(entry.date);
				const legacyBlob =
					legacyVideoOwners.get(entry.date) === entry.id ? await getStoredVideo(legacyKey) : null;
				const blob = (await getStoredVideo(key)) || legacyBlob;
				if (seq !== this.initSeq) return;

				if (blob) {
					if (key !== legacyKey) {
						await putStoredVideo(key, blob);
						void deleteStoredVideo(legacyKey);
					}
					if (entry.videoPath) {
						void deleteStoredVideo(key);
					} else {
						if (!entry.videoName) entry.videoName = 'vidjo-video.webm';
						this.sessionVideos[entry.id] = URL.createObjectURL(blob);
						void captureVideoThumbnail(blob).then((thumb) => {
							if (!thumb || seq !== this.initSeq) return;
							if (this.entries[entry.id] !== entry || entry.videoPath) return;
							if (this.sessionThumbs[entry.id]) return;
							this.sessionThumbs[entry.id] = URL.createObjectURL(thumb);
						});
						if (this.remote) void this.uploadLocalVideo(entry, blob, key, seq);
						return;
					}
				}

				if (entry.videoPath) {
					void this.resolveSignedUrl(entry.id, entry.videoPath);
				}
				if (entry.videoThumbPath) {
					void this.resolveThumbnail(entry.id, entry.videoThumbPath);
				}
			})
		);
	}

	private async uploadLocalVideo(entry: Entry, blob: Blob, key: string, seq: number) {
		const thumbPromise = captureVideoThumbnail(blob);
		const { path, url } = await this.uploadVideoBlob(
			blob,
			entry.id,
			entry.videoName || 'vidjo-video.webm'
		);
		if (!path || seq !== this.initSeq) return;

		const thumb = await thumbPromise;
		if (seq !== this.initSeq) return;

		let thumbPath = '';
		if (thumb) {
			const thumbResult = await this.uploadThumbBlob(thumb, entry.id);
			if (seq !== this.initSeq) return;
			thumbPath = thumbResult.path;
			if (thumbResult.url) {
				this.clearSessionThumb(entry.id);
				this.sessionThumbs[entry.id] = thumbResult.url;
			}
		}

		entry.videoPath = path;
		entry.videoThumbPath = thumbPath;
		this.sessionVideos[entry.id] = url;
		await deleteStoredVideo(key);
		this.queueSave(entry.id);
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
