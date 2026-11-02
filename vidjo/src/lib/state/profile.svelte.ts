import { isSupabaseConfigured, supabase } from '#lib/supabase';
import type { MoodKey, Privacy, Profile } from '#lib/types';
import { auth } from '#lib/state/auth.svelte';

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

type ThemeName = 'classic' | 'sunset' | 'midnight';

interface Preferences {
	accentColor: string;
	theme: ThemeName;
	defaultPrivacy: Privacy;
	allowFriendRequests: boolean;
	clearCacheOnSignOut: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
	accentColor: '#51397A',
	theme: 'classic',
	defaultPrivacy: 'private',
	allowFriendRequests: true,
	clearCacheOnSignOut: false
};

class ProfileState {
	profile = $state<Profile | null>(null);
	viewedProfile = $state<Profile | null>(null);
	viewedProfilePosts = $state<{ date: string; title: string; mood: MoodKey | ''; hasVideo: boolean; privacy: string; communityTag: string }[]>([]);
	viewedProfileLoading = $state(false);
	loading = $state(false);
	saving = $state(false);
	error = $state('');

	accentColor = $state(DEFAULT_PREFERENCES.accentColor);
	theme = $state<ThemeName>(DEFAULT_PREFERENCES.theme);
	defaultPrivacy = $state<Privacy>(DEFAULT_PREFERENCES.defaultPrivacy);
	allowFriendRequests = $state(DEFAULT_PREFERENCES.allowFriendRequests);
	clearCacheOnSignOut = $state(DEFAULT_PREFERENCES.clearCacheOnSignOut);

	get username() {
		return this.profile?.username || auth.username || 'friend';
	}

	get displayName() {
		return this.profile?.display_name || auth.displayName || 'Friend';
	}

	get nickname() {
		return this.displayName;
	}

	get bio() {
		return this.profile?.bio || '';
	}

	get avatarUrl() {
		return this.profile?.avatar_url || auth.avatarUrl || null;
	}

	get bannerUrl() {
		return this.profile?.banner_url || null;
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
					// Seed profile from auth metadata if the database row does not exist.
					const initialUsername = auth.username || `user_${userId.slice(0, 8)}`;
					const initialName = auth.displayName || initialUsername;

					const newProfile: Profile = {
						user_id: userId,
						username: initialUsername,
						display_name: initialName,
						bio: '',
						avatar_url: auth.avatarUrl || null,
						banner_url: null,
						user_role: 'user',
						friend_code: cached?.friend_code || generateFriendCode(userId),
						accent_color: this.accentColor,
						theme: this.theme,
						default_privacy: this.defaultPrivacy,
						allow_friend_requests: this.allowFriendRequests,
						created_at: cached?.created_at || new Date().toISOString(),
						updated_at: new Date().toISOString()
					};

					const { error: seedError } = await supabase
						.from('vidjo_profiles')
						.upsert(newProfile, { onConflict: 'user_id' });
					if (seedError) throw seedError;

					this.profile = newProfile;
					this.persistLocal(userId);
				}
			} catch (err) {
				console.warn('[VidJo] Could not load profile from Supabase, using local fallback.', err);
				if (!this.profile) {
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
			avatar_url: cached?.avatar_url || auth.avatarUrl || null,
			banner_url: cached?.banner_url || null,
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
			if (parsed.theme === 'classic' || parsed.theme === 'sunset' || parsed.theme === 'midnight') {
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
				clearCacheOnSignOut: this.clearCacheOnSignOut
			};
			localStorage.setItem(`${PREFERENCES_STORAGE_KEY}:${userId}`, JSON.stringify(preferences));
		} catch {
			// Ignore storage write issues
		}
	}

	async checkUsernameAvailable(candidate: string): Promise<{ available: boolean; error?: string }> {
		const clean = candidate.trim().toLowerCase();
		if (!clean) return { available: false, error: 'Enter a username' };
		if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(clean)) {
			return {
				available: false,
				error: '2–24 characters (letters, numbers, _, ., -)'
			};
		}

		// Current user's own username is always valid for them
		if (this.profile && this.profile.username.toLowerCase() === clean) {
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

				if (queryError) return { available: true };
				return { available: !existing };
			}
		return { available: Boolean(data) };
	} catch {
		return { available: true };
	}
	}

	async uploadImage(file: File, type: 'avatar' | 'banner'): Promise<{ url: string | null; error: string | null }> {
		if (!isSupabaseConfigured) return { url: null, error: 'Supabase is not configured.' };
		const userId = this.profile?.user_id || auth.ownerId;
		if (!userId) return { url: null, error: 'No user ID available.' };

		const fileExt = file.name.split('.').pop() ?? 'jpg';
		const fileName = `${userId}/${Date.now()}.${fileExt}`;
		const folder = type === 'avatar' ? 'avatars' : 'banners';
		const path = `${folder}/${fileName}`;

		const { error: uploadError } = await supabase.storage.from('vidjo-images').upload(path, file, {
			cacheControl: '3600',
			upsert: false
		});

		if (uploadError) {
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

		if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(cleanUsername)) {
			return { error: 'Username must be 2–24 letters, numbers, dots, dashes, or underscores.' };
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
			const { available } = await this.checkUsernameAvailable(cleanUsername);
			if (!available) {
				return { error: 'This username is already taken by another student.' };
			}
		}

		this.saving = true;
		const userId = this.profile?.user_id || auth.ownerId;

		const updated: Profile = {
			user_id: userId,
			username: cleanUsername,
			display_name: cleanDisplayName,
			bio: cleanBio,
			avatar_url: patch.avatar_url,
			banner_url: patch.banner_url,
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
						avatar_url: patch.avatar_url,
						banner_url: patch.banner_url
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

		if (userId) this.persistLocal(userId);
		return { error: '' };
	}

	async loadViewedProfile(userId: string) {
		if (!userId || userId === auth.ownerId) {
			this.viewedProfile = null;
			this.viewedProfilePosts = [];
			return;
		}
		this.viewedProfileLoading = true;
		this.viewedProfile = null;
		this.viewedProfilePosts = [];

		if (isSupabaseConfigured) {
			try {
				const [{ data: profileData, error: profileError }, { data: entries, error: entriesError }] =
					await Promise.all([
						supabase
							.from('vidjo_profiles')
							.select('*')
							.eq('user_id', userId)
							.maybeSingle(),
						supabase
							.from('vidjo_entries')
							.select('*')
							.eq('owner_id', userId)
							.eq('privacy', 'community')
							.order('entry_date', { ascending: false })
							.limit(50)
					]);

				if (profileError) throw profileError;
				if (entriesError) throw entriesError;

				if (profileData) {
					this.viewedProfile = profileData as Profile;
				}

				this.viewedProfilePosts = ((entries ?? []) as { entry_date: string; title: string | null; mood: MoodKey | null; privacy: string | null; community_slug: string | null; video_path: string | null }[]).map(
					(row) => ({
						date: row.entry_date,
						title: row.title || 'Community entry',
						mood: (row.mood as MoodKey | '') || '',
						hasVideo: Boolean(row.video_path),
						privacy: row.privacy || 'community',
						communityTag: row.community_slug ? '#Community' : ''
					})
				);
			} catch (err) {
				console.warn('[VidJo] Could not load viewed profile.', err);
			}
		}

		this.viewedProfileLoading = false;
	}

	reset() {
		this.profile = null;
		this.viewedProfile = null;
		this.viewedProfilePosts = [];
		this.loading = false;
		this.saving = false;
		this.error = '';
		this.accentColor = DEFAULT_PREFERENCES.accentColor;
		this.theme = DEFAULT_PREFERENCES.theme;
		this.defaultPrivacy = DEFAULT_PREFERENCES.defaultPrivacy;
		this.allowFriendRequests = DEFAULT_PREFERENCES.allowFriendRequests;
		this.clearCacheOnSignOut = DEFAULT_PREFERENCES.clearCacheOnSignOut;
	}
}

export const profile = new ProfileState();
