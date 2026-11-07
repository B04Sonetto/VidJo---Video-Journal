import { PUBLIC_APP_RELEASE, PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENVIRONMENT } from '$app/env/public';

/**
 * Sentry-compatible error tracking. Works with Sentry Cloud and self-hosted
 * GlitchTip because both speak the same SDK protocol. Leaving the DSN empty
 * disables everything, so local development needs no account.
 */
const dsn = (PUBLIC_SENTRY_DSN ?? '').trim();

type SentryModule = typeof import('@sentry/browser');

let sentry: SentryModule | null = null;
let starting: Promise<void> | null = null;

/**
 * Keys that can contain journal text, bios, names, or search terms. Error
 * reports keep the technical context (routes, status codes, buckets) but never
 * the user's writing.
 */
const PRIVATE_KEY_RE =
	/(journal|entry|entries|mind|refl|reflection|title|bio|note|body|content|caption|display_?name|nickname|username|email|search|query)/i;

function scrubValue(value: unknown, depth = 0): unknown {
	if (depth > 4) return '[Filtered]';
	if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

	if (value && typeof value === 'object') {
		const clean: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			clean[key] = PRIVATE_KEY_RE.test(key) ? '[Filtered]' : scrubValue(item, depth + 1);
		}
		return clean;
	}

	return value;
}

export function initErrorTracking() {
	if (sentry || starting || !dsn || typeof window === 'undefined') return;

	starting = import('@sentry/browser')
		.then((Sentry) => {
			Sentry.init({
				dsn,
				environment:
					PUBLIC_SENTRY_ENVIRONMENT || (import.meta.env.PROD ? 'production' : 'development'),
				release: PUBLIC_APP_RELEASE || undefined,
				dataCollection: {
					userInfo: false,
					cookies: false,
					httpHeaders: false,
					httpBodies: [],
					urlQueryParams: false,
					graphQL: { document: false, variables: false },
					genAI: { inputs: false, outputs: false },
					mcp: { inputs: false, outputs: false },
					databaseQueryData: false,
					queues: false,
					stackFrameVariables: false
				},
				tracesSampleRate: 0,
				maxBreadcrumbs: 30,
				ignoreErrors: [/ResizeObserver loop/i],
				beforeSend(event) {
					// The SDK can attach cookies, headers, form bodies, and query
					// strings. None of those are needed for a client-side stack trace.
					event.request = undefined;
					if (event.user) event.user = { id: event.user.id };
					if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
					if (event.contexts) {
						event.contexts = scrubValue(event.contexts) as typeof event.contexts;
					}
					if (event.tags) event.tags = scrubValue(event.tags) as Record<string, string>;
					if (event.breadcrumbs) {
						event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
							...crumb,
							data: crumb.data ? (scrubValue(crumb.data) as Record<string, unknown>) : undefined
						}));
					}
					return event;
				},
				beforeBreadcrumb(crumb) {
					if (crumb.data) {
						crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
					}
					return crumb;
				}
			});

			sentry = Sentry;
		})
		.catch(() => {
			// Error reporting must never break the journal.
		})
		.finally(() => {
			starting = null;
		});
}

/** Capture an unexpected failure with a small, non-personal context block. */
export function captureError(
	error: unknown,
	context?: Record<string, string | number | boolean | null | undefined>
) {
	if (!sentry) return;

	sentry.withScope((scope) => {
		if (context) scope.setContext('vidjo', scrubValue(context) as Record<string, unknown>);
		sentry?.captureException(error);
	});
}
