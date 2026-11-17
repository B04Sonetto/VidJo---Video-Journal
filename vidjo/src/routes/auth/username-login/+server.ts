
import { json, type RequestEvent } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY
} from '$app/env/public';
import { SUPABASE_SECRET_KEY } from '$app/env/private';

export async function POST({ request }: RequestEvent) {
	try {
		const { username, password } = await request.json();

		if (
			typeof username !== 'string' ||
			typeof password !== 'string' ||
			!username.trim() ||
			!password ||
			username.trim().length > 10 ||
			!/^[a-zA-Z0-9_.-]{2,10}$/.test(username.trim())
		) {
			return json(
				{ error: 'Invalid username or password.' },
				{ status: 400 }
			);
		}

		if (!SUPABASE_SECRET_KEY || !PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
			return json(
				{ error: 'Server configuration error.' },
				{ status: 500 }
			);
		}

		// Server-only client for looking up the account
		const admin = createClient(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SECRET_KEY,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false
				}
			}
		);

		const { data: profile, error: profileError } = await admin
			.from('vidjo_profiles')
			.select('user_id')
			.ilike('username', username.trim())
			.maybeSingle();

		if (profileError || !profile) {
			return json(
				{ error: 'Invalid username or password.' },
				{ status: 401 }
			);
		}

		const { data: account, error: accountError } =
			await admin.auth.admin.getUserById(profile.user_id);

		const email = account.user?.email;

		if (accountError || !email) {
			return json(
				{ error: 'Invalid username or password.' },
				{ status: 401 }
			);
		}

		// Authenticate using the user's password
		const loginClient = createClient(
			PUBLIC_SUPABASE_URL,
			PUBLIC_SUPABASE_PUBLISHABLE_KEY,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false
				}
			}
		);

		const { data, error } = await loginClient.auth.signInWithPassword({
			email,
			password
		});

		if (error || !data.session) {
			return json(
				{ error: 'Invalid username or password.' },
				{ status: 401 }
			);
		}

		// Return session tokens, never the user's email
		return json({
			access_token: data.session.access_token,
			refresh_token: data.session.refresh_token
		});
	} catch {
		return json(
			{ error: 'Invalid request.' },
			{ status: 400 }
		);
	}
}
