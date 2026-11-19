import { track } from '#lib/analytics';
import { isSupabaseConfigured, supabase } from '#lib/supabase';
import type { MoodKey, Privacy, Profile, StreakInfo } from '#lib/types';
import { auth } from '#lib/state/auth.svelte';
import { cleanDisplayName, normalizeImageUrl } from '#lib/avatar';
import { detectRasterImageMime } from '#lib/imageUpload';
import { captureError } from '#lib/observability';
import { isPlaceholderUsername, validateUsername } from '#lib/username';
import { todayKey } from '#lib/dates';

// Whether `vidjo_streak_for` accepts the local-date argument. Checked once so a
// database that has not run supabase/fix-timezone.sql only logs one 404.
let streakAcceptsLocalDate: boolean | null = null;

export function generateFriendCode(userId: string): string {
	if (!userId) return 'VJ-DEMO01';
	let hash = 0;
	for (let i = 0; i < userId.length; i++) {
		hash = (hash << 5) - hash + userId.charCodeAt(i);
		hash |= 0;
	}
	const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
	let code = '';
	let seed = Math.abs(hash);
	for (let i = 0; i < 6; i++) {
		code += chars[seed % chars.length];
		seed = Math.floor(seed / chars.length) + i * 13 + 7;
	}
	return `VJ-${code}`;
}

const PROFILE_STORAGE_KEY = 'vidjo-profile';
const PREFERENCES_STORAGE_KEY = 'vidjo-profile-preferences';

export type ThemeName = 'classic' | 'sunset' | 'midnight' | 'evergreen' | 'rosewood' | 'harbor';

export type NotebookStyle = 'scrapbook' | 'dark' | 'spread' | 'polaroid';

export function isNotebookStyle(value: unknown): value is NotebookStyle {
	return value === 'scrapbook' || value === 'dark' || value === 'spread' || value === 'polaroid';
}

export interface Preferences {
	accentColor: string;
	theme: ThemeName;
	defaultPrivacy: Privacy;
	allowFriendRequests: boolean;
	clearCacheOnSignOut: boolean;
	paperStyle: 'lined' | 'dotted' | 'grid' | 'plain';
	fontSize: 'sm' | 'base' | 'lg';
	notebookStyle: NotebookStyle;
}

export const DEFAULT_PREFERENCES: Preferences = {
	accentColor: '#51397A',
	theme: 'classic',
	defaultPrivacy: 'private',
	allowFriendRequests: true,
	clearCacheOnSignOut: false,
	paperStyle: 'lined',
	fontSize: 'base',
	notebookStyle: 'scrapbook'
};

class ProfileState {
	profile = $state<Profile | null>(null);
	viewedProfile = $state<Profile | null>(null);
	viewedProfilePosts = $state<
		{
			date: string;
			title: string;
			mood: MoodKey | '';
			hasVideo: boolean;
			privacy: string;
			communityTag: string;
		}[]
	>([]);
	viewedProfileLoading = $state(false);
	/** Aggregate streak for the viewed profile. Null when not shared or unavailable. */
	viewedProfileStreak = $state<StreakInfo | null>(null);
	/** The user id whose profile finished loading (success or failure). */
	viewedProfileFor = $state<string | null>(null);
	private viewedTarget = '';
	loading = $state(false);
	saving = $state(false);
	error = $state('');

	accentColor = $state(DEFAULT_PREFERENCES.accentColor);
	theme = $state<ThemeName>(DEFAULT_PREFERENCES.theme);
	defaultPrivacy = $state<Privacy>(DEFAULT_PREFERENCES.defaultPrivacy);
	allowFriendRequests = $state(DEFAULT_PREFERENCES.allowFriendRequests);
	clearCacheOnSignOut = $state(DEFAULT_PREFERENCES.clearCacheOnSignOut);
	paperStyle = $state<Preferences['paperStyle']>(DEFAULT_PREFERENCES.paperStyle);
	fontSize = $state<Preferences['fontSize']>(DEFAULT_PREFERENCES.fontSize);
	notebookStyle = $state<NotebookStyle>(DEFAULT_PREFERENCES.notebookStyle);

	get username() {
		return this.profile?.username || auth.username || 'friend';
	}

	get displayName() {
		return cleanDisplayName(this.profile?.display_name || auth.displayName, 'Friend');
	}

	get nickname() {
		return this.displayName;
	}

	get bio() {
		return this.profile?.bio || '';
	}

	get avatarUrl() {
		return normalizeImageUrl(this.profile?.avatar_url || auth.avatarUrl || null);
	}

	get bannerUrl() {
		return normalizeImageUrl(this.profile?.banner_url || null);
	}

	get initials() {
		return (this.displayName.trim()[0] || 'V').toUpperCase();
	}

	get friendCode(): string {
		if (this.profile?.friend_code) return this.profile.friend_code;
		const userId = this.profile?.user_id || auth.ownerId;
		return generateFriendCode(userId);
	}

	get memberSince() {
		const value = this.profile?.created_at;
		if (!value) return 'New member';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'New member';
		return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	}

	async init(userId: string) {
		if (!userId) return;
		this.loading = true;
		this.error = '';

		this.loadPreferences(userId);

		// 1. Show a cached profile immediately so the app never flashes empty.
		let cached: Profile | null = null;
		try {
			const local = localStorage.getItem(`${PROFILE_STORAGE_KEY}:${userId}`);
			if (local) {
				cached = JSON.parse(local) as Profile;
				cached.avatar_url = normalizeImageUrl(cached.avatar_url);
				cached.banner_url = normalizeImageUrl(cached.banner_url);
				this.profile = cached;
				this.applyProfile(cached);
			}
		} catch {
			// Ignore local storage errors
		}

		if (isSupabaseConfigured) {
			try {
				const { data, error } = await supabase
					.from('vidjo_profiles')
					.select('*')
					.eq('user_id', userId)
					.maybeSingle();

				if (error) throw error;

				if (data) {
					const remote = data as Profile;

					// Sanitise legacy rows on read too, so a stored `data:image/svg+xml`
					// or `javascript:` value can never reach an image sink.
					remote.avatar_url = normalizeImageUrl(remote.avatar_url);
					remote.banner_url = normalizeImageUrl(remote.banner_url);

					// Older builds copied the Google profile picture into the profile
					// row. Clear it so every account starts with the same initial-letter
					// avatar until the person uploads their own picture.
					const providerPicture = auth.user?.user_metadata?.picture;
					if (
						remote.avatar_url &&
						typeof providerPicture === 'string' &&
						providerPicture &&
						remote.avatar_url === providerPicture
					) {
						remote.avatar_url = null;
						const { error: avatarRepairError } = await supabase
							.from('vidjo_profiles')
							.update({ avatar_url: null })
							.eq('user_id', userId);
						if (avatarRepairError) {
							console.warn(
								'[VidJo] Could not clear the provider profile picture.',
								avatarRepairError
							);
						}
					}

					// Older rows may not have a friend code yet. Preserve the code the
					// user already saw on this device, otherwise generate one.
					if (!remote.friend_code) {
						remote.friend_code = cached?.friend_code || generateFriendCode(userId);
						const { error: repairError } = await supabase
							.from('vidjo_profiles')
							.update({ friend_code: remote.friend_code })
							.eq('user_id', userId);
						if (repairError) {
							console.warn('[VidJo] Could not save the generated friend code.', repairError);
						}
					}

					this.profile = remote;
					this.applyProfile(remote);
					this.persistLocal(userId);
				} else {
					// No profile row yet. This is an unfinished account (for example,
					// someone who just signed in with Google). Do not invent a
					// placeholder profile: the completion screen must ask them to
					// choose a username first. A previously cached, real profile is
					// still usable while the row is being repaired.
					this.profile = cached && !isPlaceholderUsername(cached.username) ? cached : null;
				}
			} catch (err) {
				console.warn('[VidJo] Could not load profile from Supabase, using local fallback.', err);
				if (!this.profile && cached) {
					this.profile = this.localProfile(userId, cached);
				}
			}
		} else if (!this.profile) {
			this.profile = this.localProfile(userId, cached);
		}

		this.persistLocal(userId);
		this.loading = false;
	}

	private localProfile(userId: string, cached: Profile | null): Profile {
		return {
			user_id: userId,
			username: cached?.username || auth.username || 'guest_student',
			display_name: cached?.display_name || auth.displayName || 'Guest Student',
			bio: cached?.bio || '',
			avatar_url: normalizeImageUrl(cached?.avatar_url || auth.avatarUrl || null),
			banner_url: normalizeImageUrl(cached?.banner_url || null),
			user_role: cached?.user_role || 'user',
			friend_code: cached?.friend_code || generateFriendCode(userId),
			accent_color: this.accentColor,
			theme: this.theme,
			default_privacy: this.defaultPrivacy,
			allow_friend_requests: this.allowFriendRequests,
			created_at: cached?.created_at || new Date().toISOString(),
			updated_at: new Date().toISOString()
		};
	}

	private applyProfile(value: Profile) {
		if (value.accent_color) this.accentColor = value.accent_color;
		if (value.theme) this.theme = value.theme;
		if (value.default_privacy) this.defaultPrivacy = value.default_privacy;
		if (typeof value.allow_friend_requests === 'boolean') {
			this.allowFriendRequests = value.allow_friend_requests;
		}
	}

	private loadPreferences(userId: string) {
		try {
			const raw = localStorage.getItem(`${PREFERENCES_STORAGE_KEY}:${userId}`);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<Preferences>;
			if (typeof parsed.accentColor === 'string') this.accentColor = parsed.accentColor;
			if (
				parsed.theme === 'classic' ||
				parsed.theme === 'sunset' ||
				parsed.theme === 'midnight' ||
				parsed.theme === 'evergreen' ||
				parsed.theme === 'rosewood' ||
				parsed.theme === 'harbor'
			) {
				this.theme = parsed.theme;
			}
			if (
				parsed.defaultPrivacy === 'private' ||
				parsed.defaultPrivacy === 'friends' ||
				parsed.defaultPrivacy === 'community'
			) {
				this.defaultPrivacy = parsed.defaultPrivacy;
			}
			if (typeof parsed.allowFriendRequests === 'boolean') {
				this.allowFriendRequests = parsed.allowFriendRequests;
			}
			if (typeof parsed.clearCacheOnSignOut === 'boolean') {
				this.clearCacheOnSignOut = parsed.clearCacheOnSignOut;
			}
			if (
				parsed.paperStyle === 'lined' ||
				parsed.paperStyle === 'dotted' ||
				parsed.paperStyle === 'grid' ||
				parsed.paperStyle === 'plain'
			) {
				this.paperStyle = parsed.paperStyle;
			}
			if (parsed.fontSize === 'sm' || parsed.fontSize === 'base' || parsed.fontSize === 'lg') {
				this.fontSize = parsed.fontSize;
			}
			if (isNotebookStyle(parsed.notebookStyle)) {
				this.notebookStyle = parsed.notebookStyle;
			}
		} catch {
			// Ignore storage errors
		}
	}

	private persistLocal(userId: string) {
		try {
			if (this.profile) {
				localStorage.setItem(`${PROFILE_STORAGE_KEY}:${userId}`, JSON.stringify(this.profile));
			}
			const preferences: Preferences = {
				accentColor: this.accentColor,
				theme: this.theme,
				defaultPrivacy: this.defaultPrivacy,
				allowFriendRequests: this.allowFriendRequests,
				clearCacheOnSignOut: this.clearCacheOnSignOut,
				paperStyle: this.paperStyle,
				fontSize: this.fontSize,
				notebookStyle: this.notebookStyle
			};
			localStorage.setItem(`${PREFERENCES_STORAGE_KEY}:${userId}`, JSON.stringify(preferences));
		} catch {
			// Ignore storage write issues
		}
	}

	async checkUsernameAvailable(candidate: string): Promise<{ available: boolean; error?: string }> {
		const clean = candidate.trim();
		const validation = validateUsername(clean);
		if (validation) return { available: false, error: validation };

		// Current user's own username is always valid for them
		if (this.profile && this.profile.username.toLowerCase() === clean.toLowerCase()) {
			return { available: true };
		}

		if (!isSupabaseConfigured) {
			return { available: true };
		}

		try {
			const { data, error } = await supabase.rpc('is_username_available', { uname: clean });
			if (error) {
				console.warn('[VidJo] Username check failed RPC, falling back to table query.', error);
				const { data: existing, error: queryError } = await supabase
					.from('vidjo_profiles')
					.select('username')
					.ilike('username', clean)
					.maybeSingle();

				if (queryError) {
					return { available: false, error: 'Could not check that username. Try again.' };
				}
				return { available: !existing };
			}

			return { available: Boolean(data) };
		} catch {
			return { available: false, error: 'Could not check that username. Try again.' };
		}
	}

	async uploadImage(
		file: File,
		type: 'avatar' | 'banner'
	): Promise<{ url: string | null; error: string | null }> {
		if (!isSupabaseConfigured) return { url: null, error: 'Supabase is not configured.' };

		const allowedTypes: Record<string, string> = {
			'image/jpeg': 'jpg',
			'image/png': 'png',
			'image/webp': 'webp',
			'image/gif': 'gif'
		};

		if (file.size > 5 * 1024 * 1024) {
			return { url: null, error: 'Images must be 5 MB or smaller.' };
		}

		// Trust the bytes, not the browser-supplied MIME type. A file renamed to
		// `.png` or a spoofed `file.type` must not get into the public bucket.
		const detectedType = await detectRasterImageMime(file);
		if (!detectedType || !allowedTypes[detectedType]) {
			return { url: null, error: 'Choose a PNG, JPG, GIF, or WebP image.' };
		}

		const userId = this.profile?.user_id || auth.ownerId;
		if (!userId) return { url: null, error: 'No user ID available.' };

		const fileExt = allowedTypes[detectedType];
		const fileName = `${Date.now()}.${fileExt}`;
		const folder = type === 'avatar' ? 'avatars' : 'banners';
		// Storage policies require the first path segment to be the owner's user
		// id (`(storage.foldername(name))[1] = auth.uid()::text`).
		const path = `${userId}/${folder}/${fileName}`;

		const { error: uploadError } = await supabase.storage.from('vidjo-images').upload(path, file, {
			cacheControl: '3600',
			contentType: detectedType,
			upsert: false
		});

		if (uploadError) {
			captureError(new Error(uploadError.message), { area: 'profile-image-upload', type });
			return { url: null, error: uploadError.message };
		}

		const { data: urlData } = supabase.storage.from('vidjo-images').getPublicUrl(path);
		return { url: urlData.publicUrl ?? null, error: null };
	}

	async saveProfile(patch: {
		username: string;
		display_name: string;
		bio: string;
		avatar_url: string | null;
		banner_url: string | null;
	}): Promise<{ error: string }> {
		const cleanUsername = patch.username.trim();
		const cleanDisplayName = patch.display_name.trim();
		const cleanBio = patch.bio.trim();
		const rawAvatar = patch.avatar_url?.trim() ?? '';
		const rawBanner = patch.banner_url?.trim() ?? '';
		const cleanAvatar = normalizeImageUrl(rawAvatar);
		const cleanBanner = normalizeImageUrl(rawBanner);

		if (rawAvatar && !cleanAvatar) {
			return {
				error: 'Profile pictures must be a PNG, JPG, GIF, or WebP image, or a preset avatar.'
			};
		}

		if (rawBanner && !cleanBanner) {
			return { error: 'Profile banners must be a PNG, JPG, GIF, or WebP image.' };
		}

		const usernameError = validateUsername(cleanUsername);
		if (usernameError) {
			return { error: usernameError };
		}

		if (!cleanDisplayName) {
			return { error: 'Nickname cannot be empty.' };
		}

		if (cleanDisplayName.length > 32) {
			return { error: 'Nickname must be 32 characters or fewer.' };
		}

		if (cleanBio.length > 200) {
			return { error: 'Bio must be under 200 characters.' };
		}

		if (!this.profile || this.profile.username.toLowerCase() !== cleanUsername.toLowerCase()) {
			const check = await this.checkUsernameAvailable(cleanUsername);
			if (!check.available) {
				return { error: check.error || 'This username is already taken by another student.' };
			}
		}

		this.saving = true;
		const userId = this.profile?.user_id || auth.ownerId;

		const updated: Profile = {
			user_id: userId,
			username: cleanUsername,
			display_name: cleanDisplayName,
			bio: cleanBio,
			avatar_url: cleanAvatar,
			banner_url: cleanBanner,
			user_role: this.profile?.user_role || 'user',
			friend_code: this.profile?.friend_code || generateFriendCode(userId),
			accent_color: this.accentColor,
			theme: this.theme,
			default_privacy: this.defaultPrivacy,
			allow_friend_requests: this.allowFriendRequests,
			created_at: this.profile?.created_at || new Date().toISOString(),
			updated_at: new Date().toISOString()
		};

		if (isSupabaseConfigured) {
			try {
				const { error: profileError } = await supabase
					.from('vidjo_profiles')
					.upsert(updated, { onConflict: 'user_id' });

				if (profileError) throw profileError;

				// Keep auth metadata in sync so a fresh sign-in shows the same names.
				await supabase.auth.updateUser({
					data: {
						username: cleanUsername,
						user_name: cleanUsername,
						nickname: cleanDisplayName,
						full_name: cleanDisplayName,
						display_name: cleanDisplayName,
						bio: cleanBio,
						avatar_url: cleanAvatar,
						banner_url: cleanBanner
					}
				});
			} catch (err) {
				this.saving = false;
				const message = err instanceof Error ? err.message : String(err);
				return { error: `Could not save profile: ${message}` };
			}
		}

		this.profile = updated;
		if (userId) this.persistLocal(userId);
		this.saving = false;
		track('profile_updated');
		return { error: '' };
	}

	async savePreferences(): Promise<{ error: string }> {
		const userId = this.profile?.user_id || auth.ownerId;
		if (this.profile) {
			this.profile.accent_color = this.accentColor;
			this.profile.theme = this.theme;
			this.profile.default_privacy = this.defaultPrivacy;
			this.profile.allow_friend_requests = this.allowFriendRequests;
			this.profile.updated_at = new Date().toISOString();
		}

		// Always keep the full preference set on this device. Paper style, text
		// size, and the sign-out cache choice are device-level settings, so they
		// must survive even when the profile row cannot be updated.
		if (userId) this.persistLocal(userId);

		if (isSupabaseConfigured && userId) {
			const { error } = await supabase
				.from('vidjo_profiles')
				.update({
					accent_color: this.accentColor,
					theme: this.theme,
					default_privacy: this.defaultPrivacy,
					allow_friend_requests: this.allowFriendRequests,
					updated_at: new Date().toISOString()
				})
				.eq('user_id', userId);

			if (error) {
				return { error: error.message };
			}
		}

		return { error: '' };
	}

	async loadViewedProfile(userId: string) {
		if (!userId || userId === auth.ownerId) {
			this.viewedProfile = null;
			this.viewedProfilePosts = [];
			this.viewedProfileStreak = null;
			return;
		}
		this.viewedTarget = userId;
		this.viewedProfileFor = null;
		this.viewedProfileLoading = true;
		this.viewedProfile = null;
		this.viewedProfilePosts = [];
		this.viewedProfileStreak = null;

		if (isSupabaseConfigured) {
			try {
				// Older databases only know the one-argument `vidjo_streak_for`.
				// Try the local-date version first so the friend's streak is right
				// outside UTC, then fall back instead of hiding the strip.
				const streakRequest = (async () => {
					if (streakAcceptsLocalDate !== false) {
						const { data, error } = await supabase.rpc('vidjo_streak_for', {
							target: userId,
							p_today: todayKey()
						});
						if (!error) {
							streakAcceptsLocalDate = true;
							return data;
						}
						streakAcceptsLocalDate = false;
					}
					const legacy = await supabase.rpc('vidjo_streak_for', { target: userId });
					return legacy.data;
				})();

				const [
					{ data: profileData, error: profileError },
					{ data: entries, error: entriesError },
					streakData
				] = await Promise.all([
					supabase.from('vidjo_profiles').select('*').eq('user_id', userId).maybeSingle(),
					supabase
						.from('vidjo_entries')
						.select('*')
						.eq('owner_id', userId)
						.eq('privacy', 'community')
						.order('entry_date', { ascending: false })
						.limit(50),
					streakRequest
				]);

				if (profileError) throw profileError;
				if (entriesError) throw entriesError;

				// A newer profile was requested while this one loaded; drop this result.
				if (this.viewedTarget !== userId) return;

				if (profileData) {
					const viewed = profileData as Profile;
					viewed.avatar_url = normalizeImageUrl(viewed.avatar_url);
					viewed.banner_url = normalizeImageUrl(viewed.banner_url);
					this.viewedProfile = viewed;
				}

				this.viewedProfilePosts = (
					(entries ?? []) as {
						entry_date: string;
						title: string | null;
						mood: MoodKey | null;
						privacy: string | null;
						community_slug: string | null;
						video_path: string | null;
					}[]
				).map((row) => ({
					date: row.entry_date,
					title: row.title || 'Community entry',
					mood: (row.mood as MoodKey | '') || '',
					hasVideo: Boolean(row.video_path),
					privacy: row.privacy || 'community',
					communityTag: row.community_slug ? '#Community' : ''
				}));

				const streak = streakData as Partial<StreakInfo> | null;
				if (streak && typeof streak.current === 'number') {
					this.viewedProfileStreak = {
						current: streak.current,
						longest: streak.longest ?? streak.current,
						totalDays: streak.totalDays ?? 0,
						todayCounted: Boolean(streak.todayCounted)
					};
				}
			} catch (err) {
				console.warn('[VidJo] Could not load viewed profile.', err);
			}
		}

		if (this.viewedTarget !== userId) return;
		this.viewedProfileFor = userId;
		this.viewedProfileLoading = false;
	}

	reset() {
		this.profile = null;
		this.viewedProfile = null;
		this.viewedProfilePosts = [];
		this.viewedProfileStreak = null;
		this.loading = false;
		this.saving = false;
		this.error = '';
		this.accentColor = DEFAULT_PREFERENCES.accentColor;
		this.theme = DEFAULT_PREFERENCES.theme;
		this.defaultPrivacy = DEFAULT_PREFERENCES.defaultPrivacy;
		this.allowFriendRequests = DEFAULT_PREFERENCES.allowFriendRequests;
		this.clearCacheOnSignOut = DEFAULT_PREFERENCES.clearCacheOnSignOut;
		this.paperStyle = DEFAULT_PREFERENCES.paperStyle;
		this.fontSize = DEFAULT_PREFERENCES.fontSize;
		this.notebookStyle = DEFAULT_PREFERENCES.notebookStyle;
	}
}

export const profile = new ProfileState();
