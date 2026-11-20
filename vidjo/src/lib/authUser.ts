import type { SupabaseClient, User } from '@supabase/supabase-js';

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

export type RegisteredCheck = {
	/** The account to use, or null when it is not a registered member. */
	user: User | null;
	/** True when Supabase could not be reached, so a null user is not a verdict. */
	unreachable: boolean;
};

/**
 * `isRegisteredUser` reads the user cached with the session. That snapshot can
 * be older than the stamp in the database (for example a Google account created
 * or backfilled after the session was stored), and rejecting it signs the person
 * out on the next full page load, such as when returning from Spotify. Before
 * treating an account as unregistered, ask Supabase for the live user.
 */
export async function checkRegisteredUser(
	client: SupabaseClient,
	user: User | null | undefined
): Promise<RegisteredCheck> {
	if (!user) return { user: null, unreachable: false };
	if (isRegisteredUser(user)) return { user, unreachable: false };

	try {
		const { data, error } = await client.auth.getUser();
		if (error) {
			const unreachable =
				error.status === 0 ||
				error.name === 'AuthRetryableFetchError' ||
				/failed to fetch|network/i.test(error.message);
			return { user: null, unreachable };
		}
		if (data.user && isRegisteredUser(data.user)) {
			return { user: data.user, unreachable: false };
		}
		return { user: null, unreachable: false };
	} catch {
		return { user: null, unreachable: true };
	}
}
