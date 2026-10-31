import { STICKER_BY_KEY } from '#lib/data/stickers';
import { sampleEntries } from '#lib/data/samples';
import { TODAY, uid } from '#lib/dates';
import { peekDeviceId } from '#lib/identity';
import { isSupabaseConfigured, supabase, VIDEO_BUCKET } from '#lib/supabase';
import { viewport } from '#lib/state/viewport.svelte';
import {
	clearStoredVideos,
	clearStoredVideosForOwner,
	deleteStoredVideo,
	deleteStoredVideos,
	getStoredVideo,
	putStoredVideo
} from '#lib/videoStore';
import type { Entry, EntryRow, MoodKey, PaperStyle, Privacy, Side, Sticker } from '#lib/types';

const STORAGE_PREFIX = 'vidjo-journal-v3';
const LEGACY_STORAGE_KEY = 'vidjo-journal-v2';
const CLAIMED_KEY = 'vidjo-claimed-by';
const PAPER_KEY = 'vidjo-paper';

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

/** Fill in missing fields from older cached entries, including legacy video URLs. */
function normalizeEntry(raw: Partial<Entry> & { date: string; videoUrl?: string }): Entry {
	return {
		date: raw.date,
		mood: raw.mood ?? '',
		title: raw.title ?? '',
		mind: raw.mind ?? '',
		refl: raw.refl ?? '',
		privacy: raw.privacy ?? 'private',
		stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
		saved: Boolean(raw.saved),
		sample: Boolean(raw.sample),
		videoPath: raw.videoPath || legacyVideoPath(raw.videoUrl),
		videoName: raw.videoName ?? ''
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

export function blankEntry(date: string): Entry {
	return {
		date,
		mood: '',
		title: '',
		mind: '',
		refl: '',
		privacy: 'private',
		stickers: [],
		saved: false,
		sample: false,
		videoPath: '',
		videoName: ''
	};
}

function rowToEntry(row: EntryRow): Entry {
	return {
		date: row.entry_date,
		mood: row.mood ?? '',
		title: row.title ?? '',
		mind: row.mind ?? '',
		refl: row.refl ?? '',
		privacy: row.privacy ?? 'private',
		stickers: Array.isArray(row.stickers) ? row.stickers : [],
		saved: Boolean(row.saved),
		sample: Boolean(row.sample),
		videoPath: row.video_path || legacyVideoPath(row.video_url),
		videoName: row.video_name ?? ''
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
		stickers: entry.stickers.map((sticker) => ({ ...sticker })),
		saved: entry.saved,
		sample: entry.sample,
		video_path: entry.videoPath || null,
		video_url: null,
		video_name: entry.videoName || null
	};
}

class Journal {
	entries = $state<Record<string, Entry>>({});
	paper = $state<PaperStyle>('lined');
	current = $state(TODAY);
	side = $state<Side>('L');
	selected = $state<string | null>(null);
	lastPage = $state<Side>('R');
	sessionVideos = $state<Record<string, string>>({});

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
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;
	private initSeq = 0;
	private signedUrlPending = new Set<string>();

	get currentEntry(): Entry {
		return this.entries[this.current] as Entry;
	}

	get sortedDates(): string[] {
		return Object.keys(this.entries).sort();
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
					// First run for this account: seed the sample pages.
					const seeds = sampleEntries();
					const { error: insertError } = await supabase
						.from('vidjo_entries')
						.insert(seeds.map((entry) => entryToRow(ownerId, entry)));

					if (seq !== this.initSeq) return;
					if (insertError) throw insertError;

					this.entries = Object.fromEntries(seeds.map((entry) => [entry.date, entry]));
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
					this.entries = Object.fromEntries(sampleEntries().map((entry) => [entry.date, entry]));
				}
			}
		} else if (Object.keys(this.entries).length === 0) {
			this.entries = Object.fromEntries(sampleEntries().map((entry) => [entry.date, entry]));
		}

		if (seq !== this.initSeq) return;
		this.persistLocal();

		if (!this.entries[TODAY]) {
			this.entries[TODAY] = blankEntry(TODAY);
		}

		this.current = TODAY;
		this.side = 'L';
		this.selected = null;
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
		this.current = TODAY;
		this.side = 'L';
		this.selected = null;
		this.lastPage = 'R';
		this.pending.clear();
		this.signedUrlPending.clear();

		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		for (const url of Object.values(this.sessionVideos)) {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		}
		this.sessionVideos = {};
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
					const saved = JSON.parse(raw) as { entries?: Record<string, Partial<Entry> & { date: string }> };
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
		if (!this.remote || !this.ownerId || this.pending.size === 0) return;

		const dates = [...this.pending];
		this.pending.clear();

		const rows = dates
			.map((date) => this.entries[date])
			.filter((entry): entry is Entry => Boolean(entry))
			.map((entry) => entryToRow(this.ownerId, entry));

		if (rows.length === 0) return;

		this.syncing = true;
		const { error } = await supabase
			.from('vidjo_entries')
			.upsert(rows, { onConflict: 'owner_id,entry_date' });
		this.syncing = false;

		if (error) {
			console.warn('[VidJo] Could not sync to Supabase.', error);
			this.remote = false;
			this.toast('Could not sync — your page is saved on this device');
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

	isBlank(entry: Entry) {
		return (
			!entry.mood &&
			!entry.title &&
			!entry.mind &&
			!entry.refl &&
			entry.stickers.length === 0 &&
			!entry.videoPath &&
			!this.videoFor(entry.date)
		);
	}

	leaveCurrentIfBlank() {
		const entry = this.entries[this.current];
		if (!entry) return;
		if (this.current !== TODAY && this.isBlank(entry)) {
			delete this.entries[this.current];
			this.persistLocal();
			void this.removeRemote(this.current);
		}
	}

	ensureEntry(date: string) {
		if (!this.entries[date]) this.entries[date] = blankEntry(date);
		return this.entries[date];
	}

	updateCurrent(patch: Partial<Entry>) {
		const entry = this.entries[this.current];
		if (!entry) return;
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

	setPrivacy(privacy: Privacy) {
		const entry = this.entries[this.current];
		if (!entry) return;
		entry.privacy = privacy;
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
		this.toast('Saved to your journal');
	}

	videoFor(date: string) {
		const session = this.sessionVideos[date];
		if (session) return session;

		const path = this.entries[date]?.videoPath;
		if (path && isSupabaseConfigured) {
			void this.resolveSignedUrl(date, path);
		}
		return '';
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
			if (!error && data?.signedUrl) {
				this.sessionVideos[date] = data.signedUrl;
			}
		} catch (err) {
			console.warn('[VidJo] Could not create signed URL for', targetPath, err);
		} finally {
			this.signedUrlPending.delete(date);
		}
	}

	private videoKey(date: string) {
		return `${this.ownerId}:${date}`;
	}

	async setVideo(file: File) {
		if (!file) return;

		const entry = this.entries[this.current];
		if (!entry) return;

		const date = this.current;
		const ownerId = this.ownerId;
		const previousPath = entry.videoPath;

		this.uploading = true;
		this.clearSessionVideo(date);

		try {
			let uploadedPath = '';
			let uploadedUrl = '';
			let bucketMissing = false;

			if (this.remote) {
				const result = await this.uploadVideoBlob(file, date, file.name);
				uploadedPath = result.path;
				uploadedUrl = result.url;
				bucketMissing = result.bucketMissing;
			}

			if (this.ownerId !== ownerId || this.entries[date] !== entry) return;

			if (uploadedPath) {
				entry.videoPath = uploadedPath;
				entry.videoName = file.name;
				this.sessionVideos[date] = uploadedUrl;
				await deleteStoredVideo(this.videoKey(date));
				this.toast('Video added to this page');
			} else {
				entry.videoPath = '';
				entry.videoName = file.name;
				this.sessionVideos[date] = URL.createObjectURL(file);
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

			if (previousPath && previousPath !== entry.videoPath) {
				void this.deleteRemoteVideo(previousPath);
			}
			entry.sample = false;
			this.queueSave(date);
		} finally {
			this.uploading = false;
		}
	}

	removeVideo() {
		const entry = this.entries[this.current];
		if (!entry) return;

		const date = this.current;
		const previousPath = entry.videoPath;

		this.clearSessionVideo(date);
		void deleteStoredVideo(this.videoKey(date));
		entry.videoPath = '';
		entry.videoName = '';
		entry.sample = false;
		this.queueSave(date);
		if (previousPath) void this.deleteRemoteVideo(previousPath);
	}

	private clearSessionVideo(date: string) {
		const url = this.sessionVideos[date];
		if (!url) return;
		if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		delete this.sessionVideos[date];
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
						if (this.remote) void this.uploadLocalVideo(entry, blob, key, seq);
						return;
					}
				}

				if (entry.videoPath) {
					void this.resolveSignedUrl(entry.date, entry.videoPath);
				}
			})
		);
	}

	private async uploadLocalVideo(entry: Entry, blob: Blob, key: string, seq: number) {
		const { path, url } = await this.uploadVideoBlob(
			blob,
			entry.date,
			entry.videoName || 'vidjo-video.webm'
		);
		if (!path || seq !== this.initSeq) return;

		entry.videoPath = path;
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
				contentType: blob.type || 'video/webm',
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
			return { path: '', url: '', bucketMissing: /bucket/i.test(message) };
		}
	}

	private async deleteRemoteVideo(pathOrUrl: string) {
		if (!pathOrUrl || !isSupabaseConfigured || !this.ownerId) return;

		let path = pathOrUrl;
		if (path.includes('http://') || path.includes('https://')) {
			path = legacyVideoPath(pathOrUrl);
		}
		if (!path) return;

		try {
			await supabase.storage.from(VIDEO_BUCKET).remove([path]);
		} catch (error) {
			console.warn('[VidJo] Could not remove the old video.', error);
		}
	}

	findSticker(id: string) {
		return this.entries[this.current]?.stickers.find((sticker) => sticker.id === id);
	}

	addSticker(type: string, extra: Partial<Sticker> = {}) {
		const entry = this.entries[this.current];
		if (!entry) return;

		const definition = STICKER_BY_KEY[type];
		const page = viewport.single ? this.side : this.lastPage;

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
		this.selected = sticker.id;
		this.lastPage = page;
		this.queueSave(this.current);
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
		if (this.selected === id) this.selected = null;
		this.commit();
	}

	selectSticker(id: string | null) {
		this.selected = id;
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
