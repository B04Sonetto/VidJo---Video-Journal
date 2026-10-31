import { isSupabaseConfigured, supabase } from '#lib/supabase';
import type { Profile } from '#lib/types';
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
		seed = Math.floor(seed / chars.length) + (i * 13) + 7;
	}
	return `VJ-${code}`;
}

const PROFILE_STORAGE_KEY = 'vidjo-profile';

class ProfileState {
	profile = $state<Profile | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state('');

	get username() {
		return this.profile?.username || auth.username || 'friend';
	}

	get displayName() {
		return this.profile?.display_name || auth.displayName || 'Friend';
	}

	get bio() {
		return this.profile?.bio || '';
	}

	get avatarUrl() {
		return this.profile?.avatar_url || auth.avatarUrl || null;
	}

	get initials() {
		return (this.displayName.trim()[0] || 'V').toUpperCase();
	}

	get friendCode(): string {
		if (this.profile?.friend_code) return this.profile.friend_code;
		const userId = this.profile?.user_id || auth.ownerId;
		return generateFriendCode(userId);
	}

	async init(userId: string) {
		if (!userId) return;
		this.loading = true;
		this.error = '';

		// 1. Try local storage cache first
		try {
			const cached = localStorage.getItem(`${PROFILE_STORAGE_KEY}:${userId}`);
			if (cached) {
				this.profile = JSON.parse(cached) as Profile;
			}
		} catch {
			// Ignore local storage errors
		}

		// 2. Fetch from Supabase if connected
		if (isSupabaseConfigured) {
			try {
				const { data, error } = await supabase
					.from('vidjo_profiles')
					.select('*')
					.eq('user_id', userId)
					.maybeSingle();

				if (error) throw error;

				if (data) {
					this.profile = data as Profile;
					this.persistLocal(userId);
				} else {
					// Seed profile from auth metadata if row doesn't exist yet
					const initialUsername = auth.username || `user_${userId.slice(0, 8)}`;
					const initialName = auth.displayName || initialUsername;
					const initialAvatar = auth.avatarUrl || null;

					const newProfile: Profile = {
						user_id: userId,
						username: initialUsername,
						display_name: initialName,
						bio: '',
						avatar_url: initialAvatar,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					};

					await supabase.from('vidjo_profiles').upsert(newProfile);
					this.profile = newProfile;
					this.persistLocal(userId);
				}
			} catch (err) {
				console.warn('[VidJo] Could not load profile from Supabase, using local fallback.', err);
				if (!this.profile) {
					this.profile = {
						user_id: userId,
						username: auth.username || `user_${userId.slice(0, 8)}`,
						display_name: auth.displayName || 'Friend',
						bio: '',
						avatar_url: auth.avatarUrl || null,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					};
				}
			}
		} else if (!this.profile) {
			this.profile = {
				user_id: userId,
				username: 'guest_student',
				display_name: 'Guest Student',
				bio: 'Documenting daily moments on this device ✨',
				avatar_url: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			};
		}

		this.loading = false;
	}

	private persistLocal(userId: string) {
		if (!this.profile) return;
		try {
			localStorage.setItem(`${PROFILE_STORAGE_KEY}:${userId}`, JSON.stringify(this.profile));
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
				// Fallback to table query
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

	async saveProfile(patch: {
		username: string;
		display_name: string;
		bio: string;
		avatar_url: string | null;
	}): Promise<{ error: string }> {
		const cleanUsername = patch.username.trim();
		const cleanDisplayName = patch.display_name.trim();
		const cleanBio = patch.bio.trim();

		if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(cleanUsername)) {
			return { error: 'Username must be 2–24 letters, numbers, dots, dashes, or underscores.' };
		}

		if (!cleanDisplayName) {
			return { error: 'Display name cannot be empty.' };
		}

		if (cleanBio.length > 200) {
			return { error: 'Bio must be under 200 characters.' };
		}

		// Check availability if username is changing
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
			friend_code: this.profile?.friend_code || generateFriendCode(userId),
			created_at: this.profile?.created_at || new Date().toISOString(),
			updated_at: new Date().toISOString()
		};

		if (isSupabaseConfigured) {
			try {
				const { error: profileError } = await supabase
					.from('vidjo_profiles')
					.upsert(updated, { onConflict: 'user_id' });

				if (profileError) throw profileError;

				// Also sync with auth user metadata so session reflects it
				await supabase.auth.updateUser({
					data: {
						username: cleanUsername,
						user_name: cleanUsername,
						full_name: cleanDisplayName,
						display_name: cleanDisplayName,
						bio: cleanBio,
						avatar_url: patch.avatar_url
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

	reset() {
		this.profile = null;
		this.loading = false;
		this.saving = false;
		this.error = '';
	}
}

export const profile = new ProfileState();

