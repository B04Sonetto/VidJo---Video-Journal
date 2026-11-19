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
	},
	PUBLIC_SENTRY_DSN: {
		public: true,
		description:
			'Sentry-compatible DSN for client error tracking (Sentry or self-hosted GlitchTip). Leave empty to disable.',
		schema: (value) => (value ?? '').trim()
	},
	PUBLIC_SENTRY_ENVIRONMENT: {
		public: true,
		description: 'Optional environment label sent with error reports (e.g. production).',
		schema: (value) => (value ?? '').trim()
	},
	PUBLIC_APP_RELEASE: {
		public: true,
		description: 'Optional release/version string attached to error reports.',
		schema: (value) => (value ?? '').trim()
	},
	PUBLIC_GIPHY_API_KEY: {
		public: true,
		description:
			'Giphy API key used by the message GIF picker. Leave empty to hide GIF search. This key is public by design.',
		schema: (value) => (value ?? '').trim()
	},
	//jazz add this for captcha hehhehee wo ai ni kafei
	PUBLIC_TURNSTILE_SITE_KEY: {
        public: true,
        description: 'Cloudflare Turnstile site key used by the registration CAPTCHA.',
        schema: (value) => (value ?? '').trim()
    },
	SUPABASE_SECRET_KEY: {
		public: false,
		description: 'Supabase secret key used by the server-only username login lookup.',
		schema: (value) => (value ?? '').trim()
	}
});
