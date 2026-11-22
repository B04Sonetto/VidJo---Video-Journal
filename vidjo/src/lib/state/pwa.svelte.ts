import { browser, version } from '$app/env';

const IOS_HINT_KEY = 'vidjo-ios-install-hint-dismissed';
const INSTALL_DISMISSED_KEY = 'vidjo-install-prompt-dismissed';
const UPDATE_DISMISSED_PREFIX = 'vidjo-update-dismissed:';
const UPDATE_INTERVAL = 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	prompt(): Promise<void>;
}

function isStandalone() {
	if (typeof window === 'undefined') return false;
	const media = window.matchMedia('(display-mode: standalone)');
	const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
	return media.matches || iosStandalone === true;
}

function isIosDevice() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	if (/iphone|ipad|ipod/i.test(ua)) return true;
	// iPadOS 13+ reports itself as a Mac, but with touch support.
	return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Install, update and connection state for the PWA shell.
 *
 * SvelteKit registers `/service-worker.js` on window load, so this store waits
 * for that registration instead of registering a second worker. A waiting
 * worker becomes the "update available" state; accepting it posts
 * `SKIP_WAITING` and reloads once the new worker takes control.
 */
class Pwa {
	installAvailable = $state(false);
	installed = $state(false);
	updateAvailable = $state(false);
	offline = $state(false);
	iosHintDismissed = $state(false);
	installDismissed = $state(false);

	private deferredPrompt: BeforeInstallPromptEvent | null = null;
	private registration: ServiceWorkerRegistration | null = null;
	private updateTimer: ReturnType<typeof setInterval> | null = null;
	private cleanupListeners: (() => void) | null = null;
	private pendingUpdateVersion = '';
	private reloadOnControllerChange = false;
	private reloading = false;

	get canInstall() {
		return !this.installed && this.installAvailable;
	}

	get showIosHint() {
		return !this.installed && !this.iosHintDismissed && isIosDevice();
	}

	get showInstallCard() {
		// Installing needs a connection, and the banner should not compete with
		// the offline notice. Dismissal is persistent; install remains available
		// from Settings if the person changes their mind.
		return !this.offline && !this.installDismissed && (this.canInstall || this.showIosHint);
	}

	get showUpdateCard() {
		return this.updateAvailable;
	}

	init() {
		if (!browser || this.cleanupListeners) return () => {};

		this.installed = isStandalone();
		this.offline = !navigator.onLine;

		try {
			this.iosHintDismissed = localStorage.getItem(IOS_HINT_KEY) === '1';
			this.installDismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
		} catch {
			// Storage can be blocked in private windows; the hint just reappears.
		}

		window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
		window.addEventListener('appinstalled', this.onAppInstalled);
		window.addEventListener('online', this.onOnline);
		window.addEventListener('offline', this.onOffline);
		document.addEventListener('visibilitychange', this.onVisibilityChange);

		const media = window.matchMedia('(display-mode: standalone)');
		media.addEventListener('change', this.onDisplayModeChange);

		void this.connect();

		this.cleanupListeners = () => {
			window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
			window.removeEventListener('appinstalled', this.onAppInstalled);
			window.removeEventListener('online', this.onOnline);
			window.removeEventListener('offline', this.onOffline);
			document.removeEventListener('visibilitychange', this.onVisibilityChange);
			media.removeEventListener('change', this.onDisplayModeChange);
			navigator.serviceWorker?.removeEventListener('controllerchange', this.onControllerChange);
			this.registration?.removeEventListener('updatefound', this.onUpdateFound);

			if (this.updateTimer) {
				clearInterval(this.updateTimer);
				this.updateTimer = null;
			}

			this.registration = null;
			this.deferredPrompt = null;
		};

		return this.cleanupListeners;
	}

	private async connect() {
		if (!('serviceWorker' in navigator)) return;

		try {
			let registration = await navigator.serviceWorker.getRegistration();

			// SvelteKit's registration is injected to run on the window `load`
			// event, which may be after the layout mounts.
			if (!registration) {
				await new Promise<void>((resolve) => {
					if (document.readyState === 'complete') {
						resolve();
						return;
					}
					window.addEventListener('load', () => resolve(), { once: true });
				});
				registration = await navigator.serviceWorker.getRegistration();
			}

			if (!registration) return;

			this.registration = registration;
			registration.addEventListener('updatefound', this.onUpdateFound);
			navigator.serviceWorker.addEventListener('controllerchange', this.onControllerChange);
			this.syncWaiting(registration);

			this.updateTimer = setInterval(() => {
				if (navigator.onLine) void registration.update().catch(() => {});
			}, UPDATE_INTERVAL);
		} catch (error) {
			console.warn('[VidJo] Could not connect to the service worker.', error);
		}
	}

	private syncWaiting(registration: ServiceWorkerRegistration) {
		if (registration.waiting && navigator.serviceWorker.controller) {
			void this.showUpdateFor(registration.waiting);
		}
	}

	private async workerVersion(worker: ServiceWorker) {
		return new Promise<string>((resolve) => {
			const channel = new MessageChannel();
			const timeout = setTimeout(() => {
				channel.port1.close();
				resolve(`${worker.scriptURL}:${version}`);
			}, 1500);
			channel.port1.onmessage = (event: MessageEvent<{ version?: unknown }>) => {
				clearTimeout(timeout);
				channel.port1.close();
				resolve(
					typeof event.data?.version === 'string'
						? event.data.version
						: `${worker.scriptURL}:${version}`
				);
			};
			worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
		});
	}

	private async showUpdateFor(worker: ServiceWorker) {
		const updateVersion = await this.workerVersion(worker);
		if (this.registration?.waiting !== worker && this.registration?.installing !== worker) return;
		this.pendingUpdateVersion = updateVersion;
		let dismissed = false;
		try {
			dismissed = localStorage.getItem(`${UPDATE_DISMISSED_PREFIX}${updateVersion}`) === '1';
		} catch {
			// Without storage, dismiss for this page session only.
		}
		this.updateAvailable = !dismissed;
	}

	private onBeforeInstallPrompt = (event: Event) => {
		const prompt = event as BeforeInstallPromptEvent;
		prompt.preventDefault();
		this.deferredPrompt = prompt;
		this.installAvailable = true;
	};

	private onAppInstalled = () => {
		this.installed = true;
		this.installAvailable = false;
		this.deferredPrompt = null;
	};

	private onOnline = () => {
		this.offline = false;
	};

	private onOffline = () => {
		this.offline = true;
	};

	private onVisibilityChange = () => {
		if (document.visibilityState === 'visible' && navigator.onLine) {
			void this.registration?.update().catch(() => {});
		}
	};

	private onDisplayModeChange = () => {
		this.installed = isStandalone();
	};

	private onUpdateFound = () => {
		const installing = this.registration?.installing;
		if (!installing) return;

		installing.addEventListener('statechange', () => {
			if (installing.state === 'installed' && navigator.serviceWorker.controller) {
				void this.showUpdateFor(installing);
			}
		});
	};

	private onControllerChange = () => {
		if (!this.reloadOnControllerChange || this.reloading) return;
		this.reloading = true;
		window.location.reload();
	};

	/** Ask the browser to install VidJo. Returns the user's choice. */
	async promptInstall() {
		const prompt = this.deferredPrompt;
		if (!prompt) return 'unavailable' as const;

		this.deferredPrompt = null;
		this.installAvailable = false;

		try {
			await prompt.prompt();
			const choice = await prompt.userChoice;
			if (choice.outcome === 'accepted') this.installed = true;
			return choice.outcome;
		} catch {
			return 'unavailable' as const;
		}
	}

	dismissInstall() {
		this.installDismissed = true;
		try {
			localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
		} catch {
			// The prompt stays dismissed for this page session.
		}
	}

	dismissIosHint() {
		this.iosHintDismissed = true;
		try {
			localStorage.setItem(IOS_HINT_KEY, '1');
		} catch {
			// The hint simply appears again next time.
		}
	}

	dismissUpdate() {
		this.updateAvailable = false;
		if (!this.pendingUpdateVersion) return;
		try {
			localStorage.setItem(
				`${UPDATE_DISMISSED_PREFIX}${this.pendingUpdateVersion}`,
				'1'
			);
		} catch {
			// The update stays dismissed for this page session.
		}
	}

	applyUpdate() {
		const registration = this.registration;
		const waiting = registration?.waiting;

		// The update can be announced while the new worker is still installing.
		// Wait for it to reach `installed`, then activate it.
		if (!waiting && registration?.installing) {
			registration.installing.addEventListener('statechange', (event) => {
				const worker = event.target as ServiceWorker;
				if (worker.state === 'installed') this.activateWaitingWorker();
			});
			return;
		}

		if (!waiting) {
			window.location.reload();
			return;
		}

		this.activateWaitingWorker();
	}

	private activateWaitingWorker() {
		const waiting = this.registration?.waiting;
		if (!waiting) {
			window.location.reload();
			return;
		}

		this.reloadOnControllerChange = true;
		waiting.postMessage({ type: 'SKIP_WAITING' });

		// If the browser never fires `controllerchange`, a reload is still the
		// right outcome because the new worker has already been told to activate.
		setTimeout(() => {
			if (this.reloadOnControllerChange && !this.reloading) {
				this.reloading = true;
				window.location.reload();
			}
		}, 3000);
	}
}

export const pwa = new Pwa();
