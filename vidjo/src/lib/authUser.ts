import type { User } from '@supabase/supabase-js';

export const UNREGISTERED_ACCOUNT_MESSAGE =
	'No VidJo account is linked to that sign-in. Create an account with your email and password first.';

/**
 * A VidJo member is any account the database has stamped as registered.
 *
 * `app_metadata` is server-controlled (stamped by the `vidjo_mark_registered_user`
 * trigger on `auth.users` insert). `user_metadata` is client-writable via
 * `auth.updateUser()`, so it is only a fallback for accounts marked registered
 * after signup.
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
