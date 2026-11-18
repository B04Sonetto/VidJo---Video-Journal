import { handleErrorWithSentry } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import { resolve } from '$app/paths';
import { PUBLIC_APP_RELEASE, PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENVIRONMENT } from '$app/env/public';
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from '#lib/observability';

// Leaving the DSN empty disables error tracking entirely, so local development
// needs no account. The DSN only allows sending events, so it is safe to expose.
const dsn = (PUBLIC_SENTRY_DSN ?? '').trim();
const reportingEnabled = Boolean(dsn) && import.meta.env.PROD;

// Local development must never report into the production Sentry project.
if (dsn && reportingEnabled) {
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

/**
 * SvelteKit's automatic registration lets a failed `register()` reject
 * unhandled, which turns into a Sentry error (for example when a preview
 * deployment is protected by Vercel SSO and the worker script redirects).
 * Registering here keeps offline support while containing the failure.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	const root = resolve('/');
	const serviceWorkerUrl = `${root.endsWith('/') ? root : `${root}/`}service-worker.js`;

	const register = () => {
		// The generated worker is an ES module, so it must be registered as one.
		void navigator.serviceWorker
			.register(serviceWorkerUrl, { type: 'module' })
			.catch((error: unknown) => {
				console.warn('[pwa] Service worker registration failed.', error);
			});
	};

	if (document.readyState === 'complete') {
		register();
	} else {
		window.addEventListener('load', register, { once: true });
	}
}

// If you have a custom error handler, pass it to `handleErrorWithSentry`.
export const handleError = reportingEnabled ? handleErrorWithSentry() : undefined;
