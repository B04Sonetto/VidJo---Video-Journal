import { createClient } from '@supabase/supabase-js';
import {
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	PUBLIC_SUPABASE_URL
} from '$app/env/public';

export const supabaseUrl = (PUBLIC_SUPABASE_URL ?? '').trim();
export const supabaseKey = (
	PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
	PUBLIC_SUPABASE_ANON_KEY ||
	''
).trim();

export const isSupabaseConfigured = Boolean(
	supabaseUrl &&
	supabaseKey &&
	/^https?:\/\//.test(supabaseUrl) &&
	!supabaseUrl.includes('your-project')
);

/**
 * A placeholder client keeps the rest of the app import-safe when the project
 * has not been connected to Supabase yet. Every call is guarded by
 * `isSupabaseConfigured`, so this client is never actually used.
 */
export const supabase = createClient(
	supabaseUrl || 'https://placeholder.supabase.co',
	supabaseKey || 'placeholder-anon-key',
	{
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true
		}
	}
);

export const VIDEO_BUCKET = 'vidjo-videos';
