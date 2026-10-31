/**
 * Turns the raw GoTrue/Supabase error strings into messages a person can act on.
 * Keep this dependency-free so both the auth store and the callback pages can
 * use it without importing the reactive store.
 */
export function friendlyAuthError(message: string) {
	const lower = message.toLowerCase();

	if (
		lower.includes('rate limit') ||
		lower.includes('too many') ||
		lower.includes('security purposes') ||
		lower.includes('only request this after')
	) {
		return 'Too many attempts. Wait a minute, then try again.';
	}
	if (
		lower.includes('email not confirmed') ||
		lower.includes('not confirmed') ||
		lower.includes('email not verified')
	) {
		return 'Please confirm your email first. Check your inbox for the confirmation link or code.';
	}
	if (
		lower.includes('user already') ||
		lower.includes('already registered') ||
		lower.includes('already taken') ||
		lower.includes('email already')
	) {
		return 'An account with that email already exists. Try signing in instead.';
	}
	if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
		return 'That email or password did not match. Check both and try again.';
	}
	if (
		lower.includes('token has expired') ||
		lower.includes('expired or is invalid') ||
		lower.includes('otp expired') ||
		lower.includes('invalid token')
	) {
		return 'That code has expired or is not valid. Send a fresh one and try again.';
	}
	if (lower.includes('code verifier')) {
		return 'This link was opened in a different browser or device. Request a new email on the device where you want to sign in.';
	}
	if (lower.includes('auth session missing') || lower.includes('session not found')) {
		return 'That link has expired. Request a new email and try again.';
	}
	if (lower.includes('signups not allowed for otp')) {
		// Keep this neutral so the screen does not confirm whether an email is
		// registered (Supabase reveals that through this error).
		return 'Codes only work for existing accounts. Check the address, or use Create an account first.';
	}
	if (lower.includes('create your vidjo account with email')) {
		// Surfaced by the Before User Created hook when Google/social sign-in
		// tries to create an account that never registered with email.
		return 'Google sign-in only works for accounts created with email and password. Create an email account first, then use Google with the same address.';
	}
	if (lower.includes('database error saving new user')) {
		return 'Could not create that account. Use the email/password signup form, then try Google again.';
	}
	if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
		return 'New accounts are paused in Supabase. Try an existing email, or enable signups.';
	}
	if (lower.includes('password should be at least') || lower.includes('weak password')) {
		return 'Use a password with at least 6 characters.';
	}
	if (lower.includes('failed to fetch') || lower.includes('network')) {
		return 'Could not reach Supabase. Check your connection and try again.';
	}
	if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
		return 'That sign-in provider is not enabled in Supabase yet.';
	}
	if (lower.includes('access_denied') || lower.includes('access denied')) {
		return 'Google sign-in was cancelled or blocked. Try again.';
	}

	return message;
}
