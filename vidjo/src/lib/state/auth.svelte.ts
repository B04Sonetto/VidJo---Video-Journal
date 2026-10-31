import type { User } from '@supabase/supabase-js';
import { friendlyAuthError } from '#lib/authErrors';
import { isRegisteredUser, UNREGISTERED_ACCOUNT_MESSAGE } from '#lib/authUser';
import { readDeviceId } from '#lib/identity';
import { isSupabaseConfigured, supabase, supabaseKey, supabaseUrl } from '#lib/supabase';
import { profile } from '#lib/state/profile.svelte';

function currentOrigin() {
	return typeof window === 'undefined' ? undefined : window.location.origin;
}

/** Where Supabase should send OAuth / email-link callbacks. */
function callbackUrl(path = '/auth/callback') {
	const origin = currentOrigin();
	return origin ? `${origin}${path}` : undefined;
}

/** Read `?error=...` or `#error=...` left by a failed redirect. */
function redirectErrorFromUrl() {
	if (typeof window === 'undefined') return '';

	try {
		const url = new URL(window.location.href);
		const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
		const description =
			url.searchParams.get('error_description') ||
			hash.get('error_description') ||
			url.searchParams.get('error') ||
			hash.get('error');

		if (!description) return '';

		const decoded = decodeURIComponent(description.replace(/\+/g, ' '));
		return friendlyAuthError(decoded);
	} catch {
		return '';
	}
}

/** True when the URL is a password-recovery redirect that landed on `/`. */
function isRecoveryRedirect() {
	if (typeof window === 'undefined') return false;

	try {
		const url = new URL(window.location.href);
		const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
		return url.searchParams.get('type') === 'recovery' || hash.get('type') === 'recovery';
	} catch {
		return false;
	}
}

export type SignUpResult = {
	error: string;
	/** True when Supabase created the user but still needs the email confirmed. */
	needsConfirmation: boolean;
};

class Auth {
	user = $state<User | null>(null);
	ready = $state(!isSupabaseConfigured);
	providersChecked = $state(!isSupabaseConfigured);
	googleAvailable = $state(false);
	passwordAvailable = $state(true);
	signupAvailable = $state(true);
	emailConfirmRequired = $state(true);
	redirectError = $state('');
	passwordRecovery = $state(false);

	private started = false;
	private unsubscribe: (() => void) | null = null;

	get signedIn() {
		return Boolean(this.user);
	}

	get active() {
		return !isSupabaseConfigured || this.signedIn;
	}

	get ownerId() {
		if (this.user) return this.user.id;
		return isSupabaseConfigured ? '' : readDeviceId();
	}

	get email() {
		return this.user?.email ?? '';
	}

	get username() {
		if (profile.profile?.username) return profile.profile.username;
		const metadata = (this.user?.user_metadata ?? {}) as Record<string, unknown>;
		const username = typeof metadata.username === 'string' ? metadata.username : '';
		const userName = typeof metadata.user_name === 'string' ? metadata.user_name : '';
		return username || userName;
	}

	get displayName() {
		if (profile.profile?.display_name) return profile.profile.display_name;
		const metadata = (this.user?.user_metadata ?? {}) as Record<string, unknown>;
		const fullName = typeof metadata.full_name === 'string' ? metadata.full_name : '';
		const name = typeof metadata.name === 'string' ? metadata.name : '';
		return this.username || fullName || name || this.email.split('@')[0] || 'Friend';
	}

	get initials() {
		return (this.displayName.trim()[0] || 'V').toUpperCase();
	}

	get avatarUrl() {
		if (profile.profile?.avatar_url) return profile.profile.avatar_url;
		const metadata = (this.user?.user_metadata ?? {}) as Record<string, unknown>;
		const avatar = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : '';
		const picture = typeof metadata.picture === 'string' ? metadata.picture : '';
		return avatar || picture;
	}

	async init() {
		if (this.started) return;
		this.started = true;

		if (!isSupabaseConfigured) {
			this.ready = true;
			this.providersChecked = true;
			return;
		}

		this.redirectError = redirectErrorFromUrl();
		const recoveryRedirect = isRecoveryRedirect();

		const { data } = supabase.auth.onAuthStateChange((event, session) => {
			const allowed = this.acceptUser(session?.user ?? null);
			this.ready = true;
			if (!allowed) {
				// Defer so we never call another auth method inside this callback.
				setTimeout(() => void supabase.auth.signOut(), 0);
			}
			if (event === 'PASSWORD_RECOVERY') this.passwordRecovery = true;
		});
		this.unsubscribe = () => data.subscription.unsubscribe();

		let rejected = false;

		try {
			const { data: sessionData, error } = await supabase.auth.getSession();
			if (error && !this.redirectError) {
				this.redirectError = friendlyAuthError(error.message);
			}
			rejected = !this.acceptUser(sessionData.session?.user ?? this.user);
		} catch (error) {
			console.warn('[VidJo] Could not restore the Supabase session.', error);
		} finally {
			this.ready = true;
			if (recoveryRedirect) this.passwordRecovery = true;
			if (rejected) void supabase.auth.signOut();
		}

		void this.checkProviders();
	}

	destroy() {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.started = false;
	}

	clearRedirectError() {
		this.redirectError = '';
	}

	/**
	 * Only accounts created through the email signup flow may open the journal.
	 * OAuth-only accounts are signed out so they cannot reach the app; the RLS
	 * policies in `supabase/schema.sql` also reject them at the database layer.
	 */
	private acceptUser(user: User | null) {
		if (user && !isRegisteredUser(user)) {
			this.user = null;
			this.redirectError = UNREGISTERED_ACCOUNT_MESSAGE;
			return false;
		}

		this.user = user;
		return true;
	}

	async sendCode(email: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { error } = await supabase.auth.signInWithOtp({
			email,
			options: {
				// Codes are for existing accounts only. New users must complete
				// the username/email/password signup form first.
				shouldCreateUser: false,
				emailRedirectTo: callbackUrl()
			}
		});

		if (!error) return '';

		if (error.status === 429) {
			return 'Too many attempts. Wait a minute, then try again.';
		}

		// Obfuscate non-existent account errors so an observer cannot tell
		// if an email exists from the application's response.
		if (/signups not allowed|user not found|signup disabled/i.test(error.message)) {
			return '';
		}

		return friendlyAuthError(error.message);
	}

	async resendSignup(email: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { error } = await supabase.auth.resend({
			type: 'signup',
			email,
			options: { emailRedirectTo: callbackUrl() }
		});

		if (!error) return '';

		if (error.status === 429) {
			return 'Too many attempts. Wait a minute, then try again.';
		}

		return friendlyAuthError(error.message);
	}

	async verifyCode(email: string, token: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		// New addresses get the "Confirm signup" email (type `signup`), while
		// returning addresses get the "Magic Link" email (type `email`). Try the
		// magic-link type first, then fall back to signup so both templates work
		// with the same six-digit input.
		let lastMessage = 'That code did not match. Check it, or send a fresh one.';

		for (const type of ['email', 'signup'] as const) {
			const { data, error } = await supabase.auth.verifyOtp({
				email,
				token,
				type
			});

			if (!error) {
				if (data.session?.user && !this.acceptUser(data.session.user)) {
					void supabase.auth.signOut();
					return UNREGISTERED_ACCOUNT_MESSAGE;
				}
				return '';
			}

			lastMessage = error.message;

			// Stop retrying on things that are not a type mismatch.
			if (
				error.status === 429 ||
				error.status === 0 ||
				/rate limit|too many|fetch|network/i.test(error.message)
			) {
				break;
			}
		}

		return friendlyAuthError(lastMessage);
	}

	async signInWithGoogle() {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		if (!this.providersChecked) await this.checkProviders();

		if (!this.googleAvailable) {
			return 'Google sign-in is not enabled in this Supabase project yet. Enable the Google provider under Authentication → Providers.';
		}

		const { error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: callbackUrl(),
				queryParams: { prompt: 'select_account' }
			}
		});

		return error ? friendlyAuthError(error.message) : '';
	}

	async signOut() {
		if (!isSupabaseConfigured) return;

		try {
			await supabase.auth.signOut();
		} finally {
			this.user = null;
			this.redirectError = '';
			profile.reset();
		}
	}

	async signInWithEmail(email: string, password: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { data, error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) {
			if (error.status === 429) {
				return 'Too many attempts. Wait a minute, then try again.';
			}
			return friendlyAuthError(error.message);
		}

		if (data.session?.user) {
			if (!this.acceptUser(data.session.user)) {
				void supabase.auth.signOut();
				return UNREGISTERED_ACCOUNT_MESSAGE;
			}
		}
		return '';
	}

	async signUp(email: string, password: string, username = ''): Promise<SignUpResult> {
		if (!isSupabaseConfigured) {
			return { error: 'Sign-in is not configured for this build.', needsConfirmation: false };
		}

		const cleanUsername = username.trim();
		if (cleanUsername) {
			const check = await profile.checkUsernameAvailable(cleanUsername);
			if (!check.available) {
				return {
					error: check.error || 'That username is already taken. Please choose another.',
					needsConfirmation: false
				};
			}
		}

		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: cleanUsername ? { username: cleanUsername, full_name: cleanUsername } : undefined,
				emailRedirectTo: callbackUrl()
			}
		});

		if (error) {
			const message =
				error.status === 429
					? 'Too many attempts. Wait a minute, then try again.'
					: friendlyAuthError(error.message);
			return { error: message, needsConfirmation: false };
		}

		if (data.session?.user) {
			if (!this.acceptUser(data.session.user)) {
				void supabase.auth.signOut();
				return { error: UNREGISTERED_ACCOUNT_MESSAGE, needsConfirmation: false };
			}
			return { error: '', needsConfirmation: false };
		}

		// Supabase also returns an empty user for an address that already exists
		// when email confirmation is on. Showing "check your inbox" is the safest
		// response in both cases.
		return {
			error: '',
			needsConfirmation: Boolean(data.user) && this.emailConfirmRequired
		};
	}

	async resetPassword(email: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: callbackUrl('/auth/reset')
		});

		if (!error) return '';

		if (error.status === 429) {
			return 'Too many attempts. Wait a minute, then try again.';
		}

		return friendlyAuthError(error.message);
	}

	async updatePassword(password: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { error } = await supabase.auth.updateUser({ password });

		if (!error) return '';

		if (error.status === 429) {
			return 'Too many attempts. Wait a minute, then try again.';
		}

		return friendlyAuthError(error.message);
	}

	async updateEmail(newEmail: string) {
		if (!isSupabaseConfigured) return 'Sign-in is not configured for this build.';

		const { error } = await supabase.auth.updateUser({
			email: newEmail
		});

		if (!error) return '';

		if (error.status === 429) {
			return 'Too many attempts. Wait a minute, then try again.';
		}

		return friendlyAuthError(error.message);
	}

	private async checkProviders() {
		if (!supabaseUrl || !supabaseKey) {
			this.providersChecked = true;
			return;
		}

		try {
			const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
				headers: { apikey: supabaseKey }
			});
			if (!response.ok) return;

			const settings = (await response.json()) as {
				external?: Record<string, boolean>;
				disable_signup?: boolean;
				mailer_autoconfirm?: boolean;
			};

			const external = settings.external ?? {};
			// Supabase does not expose a separate "password sign-in" flag. The
			// email provider powers both passwords and magic links.
			const emailEnabled = external.email !== false;

			this.passwordAvailable = emailEnabled;
			this.googleAvailable = Boolean(external.google);
			this.signupAvailable = settings.disable_signup !== true;
			this.emailConfirmRequired = settings.mailer_autoconfirm !== true;
		} catch {
			// Provider discovery is a nice-to-have; never block sign-in on it.
		} finally {
			this.providersChecked = true;
		}
	}
}

export const auth = new Auth();
