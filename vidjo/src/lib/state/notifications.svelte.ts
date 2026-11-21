import { PUBLIC_VAPID_PUBLIC_KEY } from '$app/env/public';
import { isSupabaseConfigured, supabase } from '#lib/supabase';
import { auth } from '#lib/state/auth.svelte';

/**
 * Message notifications.
 *
 * Two delivery paths share this module:
 *  - Foreground: the app is open and the realtime channel sees a new message.
 *    We can show a notification straight away with no server configuration.
 *  - Background: the browser holds a push subscription and Supabase's
 *    `dm-push` Edge Function sends the notification. This only works after
 *    VAPID keys have been configured (see supabase/README.md).
 */
const vapidPublicKey = (PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
const SUBSCRIPTION_TABLE = 'vidjo_push_subscriptions';
const MAX_SEEN_IDS = 200;

type Permission = NotificationPermission | 'unsupported';

export type MessageNotification = {
	messageId: string;
	threadId: string;
	sender: string;
	body: string;
};

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (value.length % 4)) % 4);
	const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
	// Allocate a real ArrayBuffer: pushManager requires a definite ArrayBuffer
	// view, not one that could be backed by a SharedArrayBuffer.
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let index = 0; index < raw.length; index += 1) {
		bytes[index] = raw.charCodeAt(index);
	}
	return bytes;
}

/** `renotify` is widely supported but missing from some DOM lib versions. */
type MessageNotificationOptions = NotificationOptions & { renotify?: boolean };

class Notifications {
	permission = $state<Permission>('unsupported');
	pushEnabled = $state(false);
	busy = $state(false);
	error = $state('');

	private registration: ServiceWorkerRegistration | null = null;
	private seen = new Set<string>();
	private initialized = false;
	private listeningForPermissionChange = false;

	get supported() {
		return typeof window !== 'undefined' && 'Notification' in window;
	}

	get pushConfigured() {
		return Boolean(vapidPublicKey) && isSupabaseConfigured;
	}

	get granted() {
		return this.permission === 'granted';
	}

	/** Called once from the root layout. Safe to call again. */
	init() {
		if (this.initialized || typeof window === 'undefined') return;
		this.initialized = true;

		if (!this.supported) {
			this.permission = 'unsupported';
			return;
		}

		this.permission = Notification.permission;
		void this.connect().then(async (registration) => {
			if (!registration) return;
			try {
				this.pushEnabled = Boolean(await registration.pushManager.getSubscription());
			} catch {
				this.pushEnabled = false;
			}
		});

		if (!this.listeningForPermissionChange) {
			this.listeningForPermissionChange = true;
			// Permission can be changed in browser settings while the app is open.
			document.addEventListener('visibilitychange', () => {
				if (!this.supported) return;
				const current = Notification.permission;
				if (current !== this.permission) {
					this.permission = current;
					if (current !== 'granted') this.pushEnabled = false;
				}
			});
		}
	}

	private async connect(): Promise<ServiceWorkerRegistration | null> {
		if (this.registration) return this.registration;
		if (!('serviceWorker' in navigator)) return null;

		const existing = await navigator.serviceWorker.getRegistration();
		if (existing) {
			this.registration = existing;
			return existing;
		}

		// hooks.client.ts registers the worker on window load in production.
		if (document.readyState !== 'complete') {
			await new Promise<void>((resolve) =>
				window.addEventListener('load', () => resolve(), { once: true })
			);
			this.registration = (await navigator.serviceWorker.getRegistration()) ?? null;
		}
		return this.registration;
	}

	/** Must be called from a user gesture (the Settings button does). */
	async enable() {
		if (!this.supported) {
			this.error = 'This browser does not support notifications.';
			return false;
		}
		if (this.permission === 'denied') {
			this.error = 'Notifications are blocked. Allow them in your browser settings first.';
			return false;
		}

		this.busy = true;
		this.error = '';
		try {
			const result = await Notification.requestPermission();
			this.permission = result;
			if (result !== 'granted') {
				this.error = 'Notification permission was not granted.';
				return false;
			}

			const registration = await this.connect();
			if (!registration) {
				// Foreground notifications still work from the page itself.
				this.pushEnabled = false;
				return true;
			}

			if (!this.pushConfigured || !auth.user) {
				this.pushEnabled = false;
				return true;
			}

			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
			});
			const json = subscription.toJSON();
			if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
				throw new Error('The browser returned an incomplete push subscription.');
			}

			const { error } = await supabase.from(SUBSCRIPTION_TABLE).upsert(
				{
					user_id: auth.user.id,
					endpoint: json.endpoint,
					p256dh: json.keys.p256dh,
					auth: json.keys.auth,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'endpoint' }
			);
			if (error) throw error;

			this.pushEnabled = true;
			return true;
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : 'Could not enable notifications.';
			return false;
		} finally {
			this.busy = false;
		}
	}

	async disable() {
		this.busy = true;
		this.error = '';
		try {
			const registration = await this.connect();
			const subscription = registration ? await registration.pushManager.getSubscription() : null;
			if (subscription) {
				if (isSupabaseConfigured && auth.user) {
					const { error } = await supabase
						.from(SUBSCRIPTION_TABLE)
						.delete()
						.eq('endpoint', subscription.endpoint);
					if (error) throw error;
				}
				await subscription.unsubscribe();
			}
			this.pushEnabled = false;
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : 'Could not turn notifications off.';
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Show a notification while the tab is open. The message id de-duplicates
	 * realtime redeliveries, and the per-thread tag stops notifications piling up.
	 */
	showMessage({ messageId, threadId, sender, body }: MessageNotification) {
		if (!this.granted || !messageId) return;
		if (this.seen.has(messageId)) return;
		this.seen.add(messageId);
		if (this.seen.size > MAX_SEEN_IDS) {
			const oldest = this.seen.values().next().value;
			if (oldest) this.seen.delete(oldest);
		}

		const title = `New message from ${sender}`;
		const options: MessageNotificationOptions = {
			body: body || 'Open VidJo to read it',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: `vidjo-dm-${threadId}`,
			renotify: true,
			data: { url: '/' }
		};

		try {
			if (this.registration) {
				void this.registration.showNotification(title, options).catch(() => {});
			} else {
				new Notification(title, options);
			}
		} catch {
			// A failed notification must never interrupt the message flow.
		}
	}
}

export const notifications = new Notifications();
