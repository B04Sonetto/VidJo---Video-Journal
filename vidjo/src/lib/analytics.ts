import { isSupabaseConfigured, supabase } from '#lib/supabase';
import { nav } from '#lib/state/navigation.svelte';

/**
 * Privacy-friendly first-party analytics.
 *
 * The browser only ever sends an event name, the current view, and a tiny set
 * of allowlisted scalar flags. Journal text, titles, bios, names, emails,
 * search terms, IP addresses, and user agents are never sent. The database
 * repeats the allowlist in `vidjo_track_event` so a modified client cannot
 * bypass it.
 */
export type AnalyticsEvent =
	| 'session_start'
	| 'view_changed'
	| 'entry_saved'
	| 'video_added'
	| 'video_removed'
	| 'video_play_failed'
	| 'highlight_added'
	| 'highlight_removed'
	| 'friend_request_sent'
	| 'friend_request_accepted'
	| 'friend_request_declined'
	| 'friend_removed'
	| 'community_joined'
	| 'community_left'
	| 'comment_posted'
	| 'reaction_added'
	| 'profile_updated';

type MetaValue = string | number | boolean;

const ALLOWED_EVENTS = new Set<AnalyticsEvent>([
	'session_start',
	'view_changed',
	'entry_saved',
	'video_added',
	'video_removed',
	'video_play_failed',
	'highlight_added',
	'highlight_removed',
	'friend_request_sent',
	'friend_request_accepted',
	'friend_request_declined',
	'friend_removed',
	'community_joined',
	'community_left',
	'comment_posted',
	'reaction_added',
	'profile_updated'
]);

const ALLOWED_META = new Set([
	'view',
	'privacy',
	'has_video',
	'mood',
	'mode',
	'mime',
	'surface',
	'reason',
	'count'
]);

const MAX_META_LENGTH = 64;

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, MetaValue> {
	const clean: Record<string, MetaValue> = {};
	if (!meta) return clean;

	for (const [key, value] of Object.entries(meta)) {
		if (!ALLOWED_META.has(key)) continue;

		if (typeof value === 'string') {
			const trimmed = value.trim().slice(0, MAX_META_LENGTH);
			if (trimmed) clean[key] = trimmed;
		} else if (typeof value === 'number' && Number.isFinite(value)) {
			clean[key] = value;
		} else if (typeof value === 'boolean') {
			clean[key] = value;
		}
	}

	return clean;
}

/**
 * Record a product event. Fire-and-forget: analytics must never block the
 * journal or surface an error to the user.
 */
export function track(event: AnalyticsEvent, meta?: Record<string, unknown>) {
	if (typeof window === 'undefined' || !isSupabaseConfigured) return;
	if (!ALLOWED_EVENTS.has(event)) return;

	void supabase
		.rpc('vidjo_track_event', {
			p_event: event,
			p_route: nav.view,
			p_meta: sanitizeMeta(meta)
		})
		.then(({ error }) => {
			if (error && import.meta.env.DEV) {
				console.debug('[VidJo] Analytics event skipped:', error.message);
			}
		});
}
