import { friendlyAuthError } from '#lib/authErrors';
import { isRegisteredUser, UNREGISTERED_ACCOUNT_MESSAGE } from '#lib/authUser';
import { isSupabaseConfigured, supabase } from '#lib/supabase';

export type AuthCallbackResult = {
	ok: boolean;
	error: string;
};

function readRedirectError() {
	if (typeof window === 'undefined') return '';

	const url = new URL(window.location.href);
	const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
	const description =
		url.searchParams.get('error_description') ||
		hash.get('error_description') ||
		url.searchParams.get('error') ||
		hash.get('error');

	if (!description) return '';

	try {
		return friendlyAuthError(decodeURIComponent(description.replace(/\+/g, ' ')));
	} catch {
		return description;
	}
}

/**
 * Finishes either an OAuth login or an email-link callback. The Supabase client
 * usually parses the URL by itself (implicit flow); the explicit code exchange
 * covers projects configured for PKCE.
 */
export async function completeAuthCallback(): Promise<AuthCallbackResult> {
	if (!isSupabaseConfigured) {
		return { ok: false, error: 'Sign-in is not configured for this build.' };
	}

	const redirectError = readRedirectError();
	if (redirectError) return { ok: false, error: redirectError };

	const url = new URL(window.location.href);
	const code = url.searchParams.get('code');
	const flowId = url.searchParams.get('sb_flow_id') ?? undefined;

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(
			code,
			flowId ? { flowId } : undefined
		);

		// If the client already exchanged the code during initialization this can
		// report an "already used" error; fall through to getSession() instead of
		// failing a valid login.
		if (error) {
			const { data } = await supabase.auth.getSession();
			if (!data.session) return { ok: false, error: friendlyAuthError(error.message) };
		}
	}

	const { data, error } = await supabase.auth.getSession();
	if (error) return { ok: false, error: friendlyAuthError(error.message) };
	if (data.session) {
		if (!isRegisteredUser(data.session.user)) {
			await supabase.auth.signOut();
			return { ok: false, error: UNREGISTERED_ACCOUNT_MESSAGE };
		}

		return { ok: true, error: '' };
	}

	return {
		ok: false,
		error: 'That sign-in link is invalid or has expired. Go back and request a new one.'
	};
}
