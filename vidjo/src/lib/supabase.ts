import { createClient } from '@supabase/supabase-js';
import {
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	PUBLIC_SUPABASE_URL,
	PUBLIC_TURNSTILE_SITE_KEY
} from '$app/env/public';
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

export const supabaseUrl = (PUBLIC_SUPABASE_URL ?? '').trim();
export const turnstileSiteKey = (PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
export const supabaseKey = (
	PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
	PUBLIC_SUPABASE_ANON_KEY ||
	''
).trim();

/**
 * `createClient` throws for anything that is not a valid HTTP(S) URL, so a
 * malformed env value must never reach it. Returns the normalized URL or null.
 */
function parseHttpUrl(value: string): string | null {
	if (!value) return null;

	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

const validSupabaseUrl = parseHttpUrl(supabaseUrl);

export const isSupabaseConfigured = Boolean(
	validSupabaseUrl && supabaseKey && !supabaseUrl.includes('your-project')
);

/**
 * A placeholder client keeps the rest of the app import-safe when the project
 * has not been connected to Supabase yet (or the configured URL is invalid).
 * Every call is guarded by `isSupabaseConfigured`, so this client is never
 * actually used.
 */
export const supabase = createClient(
	validSupabaseUrl ?? PLACEHOLDER_URL,
	supabaseKey || PLACEHOLDER_KEY,
	{
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true
		}
	}
);

export const VIDEO_BUCKET = 'vidjo-videos';
