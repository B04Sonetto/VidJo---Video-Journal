import { handleErrorWithSentry } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_APP_RELEASE, PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENVIRONMENT } from '$app/env/public';
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from '#lib/observability';

// Leaving the DSN empty disables error tracking entirely, so local development
// needs no account. The DSN only allows sending events, so it is safe to expose.
const dsn = (PUBLIC_SENTRY_DSN ?? '').trim();

if (dsn) {
	Sentry.init({
		dsn,
		environment: PUBLIC_SENTRY_ENVIRONMENT || (import.meta.env.PROD ? 'production' : 'development'),
		release: PUBLIC_APP_RELEASE || undefined,
		tracesSampleRate: 0,
		maxBreadcrumbs: 30,
		dataCollection: sentryDataCollection,
		ignoreErrors: [/ResizeObserver loop/i],
		beforeSend: scrubEvent,
		beforeBreadcrumb: scrubBreadcrumb
	});
}

// If you have a custom error handler, pass it to `handleErrorWithSentry`.
export const handleError = dsn ? handleErrorWithSentry() : undefined;
