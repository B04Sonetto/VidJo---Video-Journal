import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_APP_RELEASE, PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENVIRONMENT } from '$app/env/public';
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from './lib/observability';

// The same public DSN is used by the browser; an empty value disables reporting.
const dsn = (PUBLIC_SENTRY_DSN ?? '').trim();

// Local development must never report into the production Sentry project: the
// dashboard would otherwise show Windows paths and dev-only failures as
// production issues. Errors are still visible in the terminal and browser.
if (dsn && import.meta.env.PROD) {
	Sentry.init({
		dsn,
		environment: PUBLIC_SENTRY_ENVIRONMENT || 'production',
		release: PUBLIC_APP_RELEASE || undefined,
		tracesSampleRate: 0,
		maxBreadcrumbs: 30,
		dataCollection: sentryDataCollection,
		ignoreErrors: [/ResizeObserver loop/i, /Failed to register a ServiceWorker/i],
		beforeSend: scrubEvent,
		beforeBreadcrumb: scrubBreadcrumb
	});
}
