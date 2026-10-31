import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		description: 'Supabase project URL used by the journal.',
		schema: (value) => (value ?? '').trim()
	},
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
		public: true,
		description: 'Supabase publishable (or anon) key used by the journal.',
		schema: (value) => (value ?? '').trim()
	},
	PUBLIC_SUPABASE_ANON_KEY: {
		public: true,
		description: 'Legacy Supabase anon key. Used when no publishable key is set.',
		schema: (value) => (value ?? '').trim()
	}
});
