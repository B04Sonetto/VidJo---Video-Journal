import { isObsceneName } from '#lib/censor';

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 10;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{2,10}$/;
export const USERNAME_RULE = '2–10 letters, numbers, dots, dashes, or underscores';

/** Returns an error message, or an empty string when the username is acceptable. */
export function validateUsername(value: string): string {
	const clean = value.trim();
	if (!clean) return 'Enter a username.';
	if (clean.length > USERNAME_MAX) return `Usernames can be at most ${USERNAME_MAX} characters.`;
	if (!USERNAME_PATTERN.test(clean)) return `Use ${USERNAME_RULE}.`;
	if (isObsceneName(clean)) return 'That username is not allowed. Please choose another.';
	return '';
}

/**
 * Placeholder names the database assigns before a person picks their own:
 * `u_` + 8 hex characters (current) or `user_` + 8 hex characters (older builds).
 */
export function isPlaceholderUsername(value: string | null | undefined) {
	return /^(?:u|user)_[0-9a-f]{8}$/i.test((value ?? '').trim());
}
