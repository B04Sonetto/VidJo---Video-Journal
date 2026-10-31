import type { User } from '@supabase/supabase-js';

export const UNREGISTERED_ACCOUNT_MESSAGE =
	'No VidJo account is linked to that sign-in. Create an account with your email and password first, then use Google with the same email.';

/**
 * A VidJo member is an account created through the email/password signup flow.
 * Supabase sets `app_metadata.provider` when the account is created and does not
 * let a signed-in user change `app_metadata`, so OAuth-only accounts (including
 * ones that later add an email identity or password) stay locked out.
 *
 * The database uses a `vidjo_registered` marker stamped at signup time instead
 * of re-deriving membership, which is even stricter. Both checks agree for
 * normal accounts; see `public.vidjo_is_member()` in `supabase/schema.sql`.
 */
export function isRegisteredUser(user: User | null | undefined) {
	if (!user) return false;

	const metadata = user.app_metadata ?? {};
	return metadata.provider === 'email' || metadata.vidjo_registered === true;
}
