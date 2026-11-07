import * as Sentry from '@sentry/sveltekit';
import type { Breadcrumb, Event } from '@sentry/sveltekit';

/**
 * Keys that can contain journal text, bios, names, or search terms. Error
 * reports keep the technical context (routes, status codes, buckets) but never
 * the user's writing.
 */
const PRIVATE_KEY_RE =
	/(journal|entry|entries|mind|refl|reflection|title|bio|note|body|content|caption|display_?name|nickname|username|email|search|query)/i;

/**
 * Deny every category of user data the SDK can attach on its own. Invalid
 * values are filtered again in `scrubEvent` and `scrubBreadcrumb`.
 */
export const sentryDataCollection = {
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
};

export function scrubValue(value: unknown, depth = 0): unknown {
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

/**
 * Remove request data and private text before an event leaves the browser or
 * server. Shared by the client and server Sentry setups.
 */
export function scrubEvent<T extends Event>(event: T): T {
	// Cookies, headers, form bodies, and query strings can all carry private
	// content. A stack trace does not need any of them.
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
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
	if (crumb.data) {
		crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
	}
	return crumb;
}

/** Capture an unexpected failure with a small, non-personal context block. */
export function captureError(
	error: unknown,
	context?: Record<string, string | number | boolean | null | undefined>
) {
	Sentry.withScope((scope) => {
		if (context) scope.setContext('vidjo', scrubValue(context) as Record<string, unknown>);
		Sentry.captureException(error);
	});
}
