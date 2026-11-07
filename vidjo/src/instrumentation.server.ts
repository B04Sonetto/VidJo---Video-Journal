import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_APP_RELEASE, PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENVIRONMENT } from '$app/env/public';
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from './lib/observability';

// The same public DSN is used by the browser; an empty value disables reporting.
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
