import type { User } from '@supabase/supabase-js';

export const UNREGISTERED_ACCOUNT_MESSAGE =
	'No VidJo account is linked to that sign-in. Create an account with your email and password first.';

/**
 * A VidJo member is an account created through the email/password signup flow
 * or an OAuth account that has completed profile setup.
 *
 * `app_metadata` is server-controlled (stamped by the `vidjo_mark_registered_user`
 * trigger on `auth.users` insert). `user_metadata` is client-writable via
 * `auth.updateUser()`, so we check it as a fallback for accounts marked
 * registered after signup (e.g. OAuth users who just completed their profile).
 */
export function isRegisteredUser(user: User | null | undefined) {
	if (!user) return false;

	const appMeta = user.app_metadata ?? {};
	const userMeta = user.user_metadata ?? {};

	return (
		appMeta.provider === 'email' ||
		appMeta.vidjo_registered === true ||
		userMeta.vidjo_registered === true
	);
}
