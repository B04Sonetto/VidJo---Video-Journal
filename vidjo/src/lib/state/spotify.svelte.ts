import { nav } from '#lib/state/navigation.svelte';

const browser = typeof window !== 'undefined';

export type SpotifyTrack = {
	uri: string;
	id?: string;
	name: string;
	artists: string;
	album?: string;
	image?: string;
	duration_ms?: number;
	url?: string;
};

type SpotifyStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

declare global {
	interface Window {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		Spotify?: any;
		onSpotifyWebPlaybackSDKReady?: () => void;
		__vidjoSpotifySDKPromise?: Promise<void>;
	}
}

function isLikelyPremium(product: string) {
	return (product || '').toLowerCase() === 'premium';
}

class SpotifyState {
	status = $state<SpotifyStatus>('idle');
	connected = $state(false);
	configured = $state(true);
	accountName = $state('');
	accountProduct = $state('');
	accountImage = $state('');
	isPremium = $state(false);

	deviceId = $state('');
	ready = $state(false);
	playing = $state(false);
	position = $state(0);
	duration = $state(0);
	volume = $state(0.7);
	track = $state<SpotifyTrack | null>(null);
	error = $state('');
	notice = $state('');

	panelOpen = $state(false);
	searching = $state(false);
	results = $state<SpotifyTrack[]>([]);
	lastQuery = $state('');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private player: any = null;
	private token: string | null = null;
	private tokenExpiresAt = 0;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private progressTimer: ReturnType<typeof setInterval> | null = null;
	private initPromise: Promise<void> | null = null;

	get canControl() {
		return this.connected && this.ready && !!this.deviceId;
	}

	get needsPremium() {
		return this.connected && this.accountProduct !== '' && !isLikelyPremium(this.accountProduct);
	}

	currentSong() {
		if (!this.track?.uri) return null;
		return {
			uri: this.track.uri,
			name: this.track.name || 'Spotify track',
			artists: this.track.artists || '',
			...(this.track.album ? { album: this.track.album } : {}),
			...(this.track.image ? { image: this.track.image } : {}),
			...(this.track.url ? { url: this.track.url } : {})
		};
	}

	async init() {
		if (!browser) return;
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.doInit();
		return this.initPromise;
	}

	private async doInit() {
		this.status = 'loading';
		await this.refreshConnection(false);
		if (this.connected) {
			await this.ensurePlayer();
		} else {
			this.status = this.configured ? 'idle' : 'unsupported';
		}
	}

	async refreshConnection(openPanelOnConnect = false) {
		if (!browser) return;
		// A callback error is shown by handleCallbackParams(). The status check
		// that runs on mount resolves afterwards and used to wipe that message,
		// so keep an existing error unless this is an explicit reconnect.
		const preserveError = Boolean(this.error);
		try {
			const res = await fetch('/auth/spotify/token', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			this.configured = data?.configured !== false;
			this.connected = Boolean(data?.connected && data?.access_token);
			if (this.connected) {
				this.setToken(data.access_token, data.expires_in || 3600);
				await this.loadProfile();
				if (preserveError && this.connected) this.error = '';
				if (openPanelOnConnect) this.panelOpen = true;
				this.status = this.status === 'idle' ? 'loading' : this.status;
			} else {
				this.clearSession(false, !preserveError);
				this.status = this.configured ? 'idle' : 'unsupported';
			}
		} catch {
			this.error = preserveError ? this.error : 'Could not check Spotify connection.';
			this.status = 'error';
		}
	}

	private setToken(token: string, expiresIn: number) {
		this.token = token;
		this.tokenExpiresAt = Date.now() + Math.max(30, expiresIn - 60) * 1000;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(
			() => {
				void this.refreshConnection(false);
			},
			Math.max(30, expiresIn - 120) * 1000
		);
	}

	private async loadProfile() {
		try {
			const res = await fetch('/api/spotify/me', { cache: 'no-store' });
			if (!res.ok) return;
			const data = await res.json().catch(() => ({}));
			this.accountName = data?.name || '';
			this.accountProduct = data?.product || '';
			this.accountImage = data?.image || '';
			this.isPremium = isLikelyPremium(this.accountProduct);
		} catch {
			// Non-fatal; playback can still work if token is valid.
		}
	}

	async ensurePlayer() {
		if (!browser || !this.connected) return;
		if (this.player) return;
		try {
			await this.loadSdk();
		} catch {
			this.status = 'error';
			this.error = 'Could not load Spotify player. Check your connection and try again.';
			return;
		}
		if (!window.Spotify?.Player) {
			this.status = 'unsupported';
			this.error = 'Spotify Web Playback SDK is not available in this browser.';
			return;
		}

		this.player = new window.Spotify.Player({
			name: 'VidJo Player',
			getOAuthToken: async (cb: (token: string) => void) => {
				const token = await this.getValidToken();
				if (token) cb(token);
			},
			volume: this.volume
		});

		this.player.addListener('ready', ({ device_id }: { device_id: string }) => {
			this.deviceId = device_id;
			this.ready = true;
			this.status = 'ready';
			this.error = '';
		});

		this.player.addListener('not_ready', () => {
			this.ready = false;
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.player.addListener('player_state_changed', (state: any) => {
			if (!state) {
				this.playing = false;
				return;
			}
			const current = state.track_window?.current_track;
			this.playing = !state.paused;
			this.position = state.position || 0;
			this.duration = state.duration || current?.duration_ms || 0;
			if (current) {
				this.track = {
					uri: current.uri,
					id: current.id,
					name: current.name,
					artists: (current.artists || [])
						.map((a: { name?: string }) => a.name || '')
						.filter(Boolean)
						.join(', '),
					album: current.album?.name || '',
					image: current.album?.images?.[0]?.url || '',
					duration_ms: current.duration_ms || state.duration || 0,
					url: current.uri?.startsWith('spotify:track:')
						? `https://open.spotify.com/track/${current.uri.split(':').pop()}`
						: undefined
				};
			}
			this.startProgressLoop();
		});

		const onError = (msg: string) => (payload: { message?: string } | undefined) => {
			const detail = payload?.message || msg;
			this.error = detail;
			this.notice = '';
			if (/premium/i.test(String(detail))) {
				this.error = 'Spotify Premium is required to play music in VidJo with this account.';
			}
		};

		this.player.addListener(
			'initialization_error',
			onError('Could not initialize Spotify player.')
		);
		this.player.addListener(
			'authentication_error',
			onError('Spotify authentication failed. Reconnect Spotify.')
		);
		this.player.addListener(
			'account_error',
			onError('Spotify Premium is required for in-app playback.')
		);
		this.player.addListener('playback_error', onError('Playback error.'));

		const connected = await this.player.connect();
		if (!connected) {
			this.status = 'error';
			this.error = 'Could not activate the VidJo Spotify player. Try reloading or reconnecting.';
		}
	}

	private async loadSdk() {
		if (window.Spotify?.Player) return;
		if (window.__vidjoSpotifySDKPromise) return window.__vidjoSpotifySDKPromise;

		window.__vidjoSpotifySDKPromise = new Promise<void>((resolve, reject) => {
			const existing = document.querySelector(
				'script[data-spotify-sdk="1"]'
			) as HTMLScriptElement | null;
			if (existing && window.Spotify?.Player) {
				resolve();
				return;
			}

			const prev = window.onSpotifyWebPlaybackSDKReady;
			window.onSpotifyWebPlaybackSDKReady = () => {
				prev?.();
				resolve();
			};

			if (!existing) {
				const script = document.createElement('script');
				script.src = 'https://sdk.scdn.co/spotify-player.js';
				script.async = true;
				script.dataset.spotifySdk = '1';
				script.onerror = () => reject(new Error('sdk_load_failed'));
				document.body.appendChild(script);
			}

			setTimeout(() => {
				if (window.Spotify?.Player) resolve();
			}, 8000);
		});

		return window.__vidjoSpotifySDKPromise;
	}

	private async getValidToken() {
		if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
		await this.refreshConnection(false);
		return this.token;
	}

	async connect() {
		if (!browser) return;
		if (!this.configured) {
			this.error =
				'Spotify is not configured on the server. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, then redeploy.';
			this.panelOpen = true;
			return;
		}
		this.error = '';
		this.notice = '';
		// Full top-level navigation to the server auth route. Carry the current
		// route and tab so the user lands back where they pressed Connect.
		const returnUrl = new URL(window.location.href);
		returnUrl.searchParams.set('vj_view', nav.view);
		if (nav.view === 'friends') returnUrl.searchParams.set('vj_friends_tab', nav.friendsTab);
		if (nav.view === 'profile') returnUrl.searchParams.set('vj_profile_tab', nav.profileTab);
		const returnTo = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
		// The service worker bypasses /auth/* so the OAuth redirect is not intercepted.
		window.location.assign(`/auth/spotify/login?returnTo=${encodeURIComponent(returnTo)}`);
	}

	async disconnect() {
		try {
			await fetch('/auth/spotify/disconnect', { method: 'POST' });
		} finally {
			this.clearSession(true);
			this.status = this.configured ? 'idle' : 'unsupported';
			this.notice = 'Spotify disconnected.';
		}
	}

	private clearSession(clearNotice = false, clearError = true) {
		this.connected = false;
		this.accountName = '';
		this.accountProduct = '';
		this.accountImage = '';
		this.isPremium = false;
		this.ready = false;
		this.deviceId = '';
		this.playing = false;
		this.position = 0;
		this.duration = 0;
		this.track = null;
		this.token = null;
		this.tokenExpiresAt = 0;
		if (!clearNotice) this.notice = '';
		if (clearError) this.error = '';
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.stopProgressLoop();
		if (this.player) {
			try {
				this.player.disconnect?.();
			} catch {
				/* player may already be disconnected */
			}
		}
		this.player = null;
	}

	private startProgressLoop() {
		if (this.progressTimer) return;
		this.progressTimer = setInterval(() => {
			if (this.playing && this.duration > 0) {
				this.position = Math.min(this.duration, this.position + 1000);
			}
		}, 1000);
	}

	private stopProgressLoop() {
		if (this.progressTimer) clearInterval(this.progressTimer);
		this.progressTimer = null;
	}

	togglePanel() {
		this.panelOpen = !this.panelOpen;
		if (this.panelOpen) void this.init();
	}

	openPanel() {
		this.panelOpen = true;
		void this.init();
	}

	private getTrackId(track: { id?: string; uri?: string } | null | undefined) {
		if (!track) return '';
		if (track.id) return track.id;
		if (track.uri?.startsWith('spotify:track:')) return track.uri.split(':').pop() || '';
		return '';
	}

	private async fetchRecommendedTracks(
		seed: SpotifyTrack,
		count = 5,
		opts: { surfaceErrors?: boolean } = {}
	): Promise<SpotifyTrack[]> {
		const seedId = this.getTrackId(seed);
		const seedUri = seed.uri || '';
		const primaryArtist = (seed.artists || '').split(',')[0]?.trim() || '';
		if (!seedId && !seedUri && !seed.name && !primaryArtist) return [];
		const limit = Math.max(1, Math.min(Math.trunc(count) || 5, 10));
		try {
			const parts = [`limit=${encodeURIComponent(String(limit))}`];
			if (seedId) parts.push(`seed_track=${encodeURIComponent(seedId)}`);
			if (seedUri) parts.push(`seed_uri=${encodeURIComponent(seedUri)}`);
			if (seed.name) parts.push(`seed_name=${encodeURIComponent(seed.name)}`);
			if (primaryArtist) parts.push(`seed_artist=${encodeURIComponent(primaryArtist)}`);
			const res = await fetch(`/api/spotify/recommendations?${parts.join('&')}`, {
				cache: 'no-store'
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) {
				this.connected = false;
				if (opts.surfaceErrors) {
					const msg = typeof data?.message === 'string' ? data.message : '';
					this.error = msg || 'Spotify session expired. Reconnect to keep listening.';
				}
				return [];
			}
			if (res.status === 429) {
				if (opts.surfaceErrors) {
					const msg = typeof data?.message === 'string' ? data.message.trim() : '';
					this.error =
						msg && !/invalid limit/i.test(msg)
							? msg
							: 'Spotify is rate limiting requests. Try again shortly.';
				}
				return [];
			}
			if (!res.ok) {
				if (opts.surfaceErrors) {
					const msg = typeof data?.message === 'string' ? data.message.trim() : '';
					// "Invalid limit" can bubble up from upstream Spotify params in edge cases;
					// don't surface it as a blocking error so fallback strategies can continue.
					if (res.status === 404) {
						this.error =
							'Could not load a recommended track (recommendations service unavailable).';
					} else if (msg && !/invalid limit/i.test(msg)) {
						this.error = msg;
					}
				}
				return [];
			}
			if (!Array.isArray(data?.tracks)) return [];
			return (data.tracks as SpotifyTrack[]).filter(
				(t) => t?.uri && t.uri !== seed.uri && t.uri !== seedUri
			);
		} catch {
			if (opts.surfaceErrors && !this.error) {
				this.error = 'Could not load a recommended track right now.';
			}
			return [];
		}
	}

	async search(query: string) {
		const q = query.trim();
		this.lastQuery = q;
		if (!q) {
			this.results = [];
			return;
		}
		this.searching = true;
		this.error = '';
		try {
			const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`, {
				cache: 'no-store'
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) {
				this.connected = false;
				const msg = typeof data?.message === 'string' ? data.message : '';
				this.error = msg || 'Reconnect Spotify to search and play tracks.';
				this.results = [];
				return;
			}
			if (!res.ok) {
				const msg = typeof data?.message === 'string' ? data.message : '';
				if (data?.error === 'rate_limited') {
					this.error = msg || 'Spotify is rate limiting requests. Try again shortly.';
				} else if (data?.error === 'spotify_error') {
					this.error = msg
						? `Spotify search failed: ${msg}`
						: `Could not search Spotify right now (${data?.status || res.status}).`;
				} else if (data?.error === 'search_failed') {
					this.error = msg || 'Could not search Spotify right now.';
				} else {
					this.error = msg || 'Could not search Spotify right now.';
				}
				return;
			}
			this.results = Array.isArray(data?.tracks) ? data.tracks : [];
		} catch {
			this.error = 'Could not search Spotify right now. Check your connection and try again.';
		} finally {
			this.searching = false;
		}
	}

	async playTrack(track: SpotifyTrack) {
		this.error = '';
		this.notice = '';
		if (!this.connected) {
			await this.connect();
			return;
		}
		await this.ensurePlayer();
		if (!this.deviceId) {
			this.error = 'Player is still starting up. Give it a moment, then try again.';
			return;
		}
		if (this.needsPremium) {
			this.error = 'This Spotify account is not Premium. In-app playback requires Premium.';
			return;
		}

		try {
			// Start with a queue (seed + recommendations) so skipping/continuing
			// playback can keep going instead of going quiet after one song.
			let uris = [track.uri];
			try {
				const recs = await this.fetchRecommendedTracks(track, 8);
				const extra = recs
					.map((t) => t.uri)
					.filter((u): u is string => Boolean(u) && u !== track.uri);
				if (extra.length) uris = [track.uri, ...extra.slice(0, 8)];
			} catch {
				// fall back to single-track playback
			}

			const res = await fetch('/api/spotify/play', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ device_id: this.deviceId, uris })
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) {
				this.connected = false;
				this.error = 'Spotify session expired. Reconnect to keep listening.';
				return;
			}
			if (res.status === 403) {
				const msg = typeof data?.message === 'string' ? data.message : '';
				this.error = msg || 'Spotify Premium is required for in-app playback on this account.';
				return;
			}
			if (!res.ok) {
				const msg = typeof data?.message === 'string' ? data.message : '';
				this.error =
					data?.error === 'device_not_found'
						? msg || 'VidJo player device not ready yet. Try again in a moment.'
						: msg || 'Could not start playback.';
				return;
			}
			this.track = track;
			this.position = 0;
			this.duration = track.duration_ms || this.duration;
			this.playing = true;
			this.panelOpen = true;
			this.notice = `Playing ${track.name}`;
		} catch {
			this.error = 'Could not start playback.';
		}
	}

	async playUri(uri: string) {
		const stub: SpotifyTrack = { uri, name: 'Spotify track', artists: '' };
		await this.playTrack(stub);
	}

	async togglePlay() {
		if (!this.player) return;
		try {
			await this.player.togglePlay();
		} catch {
			this.error = 'Could not toggle playback.';
		}
	}

	private async playRecommendedFrom(seed: SpotifyTrack | null | undefined): Promise<boolean> {
		if (!seed?.uri && !seed?.id && !seed?.name && !seed?.artists) return false;
		try {
			const primary = seed as SpotifyTrack;
			const attempts: SpotifyTrack[] = [primary];
			const primaryArtist = (primary.artists || '').split(',')[0]?.trim() || '';
			if (primaryArtist || primary.name) {
				attempts.push({
					uri: primary.uri || '',
					id: primary.id || '',
					name: '',
					artists: primaryArtist
				});
			}
			if (primary.name) {
				attempts.push({
					uri: primary.uri || '',
					id: primary.id || '',
					name: primary.name,
					artists: ''
				});
			}
			// Final generic fallbacks so "next" can keep playing even if similarity lookup fails.
			attempts.push({ uri: '', id: '', name: "today's top hits", artists: '' });
			attempts.push({ uri: '', id: '', name: 'popular', artists: '' });
			attempts.push({ uri: '', id: '', name: 'top hits', artists: '' });

			for (const attempt of attempts) {
				const recs = await this.fetchRecommendedTracks(attempt, 8, {
					surfaceErrors: true
				});
				const nextTrack = recs.find((t) => t.uri && t.uri !== primary.uri);
				if (nextTrack) {
					await this.playTrack(nextTrack);
					return true;
				}
				// "Invalid limit" can come from transient upstream quirks; don't let it block fallbacks.
				if (this.error && /invalid limit/i.test(this.error)) this.error = '';
				// If auth/rate-limit was surfaced, don't loop into noisy fallbacks.
				if (this.error) break;
			}

			// If an upstream "invalid limit" slipped through, clear it and try direct search fallbacks.
			if (this.error && /invalid limit/i.test(this.error)) this.error = '';

			// Last-resort: use search endpoint directly to pick any different playable track.
			if (!this.error && this.connected) {
				const queries = Array.from(
					new Set(
						["today's top hits", 'viral hits', 'top hits', 'popular', primaryArtist].filter(Boolean)
					)
				);
				for (const q of queries) {
					try {
						const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`, {
							cache: 'no-store'
						});
						const data = await res.json().catch(() => ({}));
						if (res.status === 401) {
							this.connected = false;
							const msg = typeof data?.message === 'string' ? data.message.trim() : '';
							this.error = msg || 'Spotify session expired. Reconnect to keep listening.';
							return false;
						}
						if (res.status === 429) {
							const msg = typeof data?.message === 'string' ? data.message.trim() : '';
							this.error =
								msg && !/invalid limit/i.test(msg)
									? msg
									: 'Spotify is rate limiting requests. Try again shortly.';
							return false;
						}
						if (!res.ok) {
							const msg = typeof data?.message === 'string' ? data.message : '';
							if (msg && /invalid limit/i.test(msg)) continue;
							continue;
						}
						if (!Array.isArray(data?.tracks)) continue;
						const nextTrack = (data.tracks as SpotifyTrack[]).find(
							(t) => t?.uri && t.uri !== primary.uri
						);
						if (nextTrack) {
							await this.playTrack(nextTrack);
							return true;
						}
					} catch {
						// try next query
					}
				}
			}
		} catch {
			// ignore
		}
		return false;
	}

	async next() {
		if (!this.player) return;
		this.error = '';
		const seedFromTrack = this.track;
		try {
			const state = await this.player.getCurrentState?.();
			const currentSdkTrack = state?.track_window?.current_track;
			const nextTracks = state?.track_window?.next_tracks || [];
			const seed: SpotifyTrack = {
				uri: currentSdkTrack?.uri || this.track?.uri || '',
				id: currentSdkTrack?.id || this.track?.id,
				name: currentSdkTrack?.name || this.track?.name || 'Current track',
				artists:
					(currentSdkTrack?.artists || [])
						.map((a: { name?: string }) => a?.name || '')
						.filter(Boolean)
						.join(', ') ||
					this.track?.artists ||
					'',
				album: currentSdkTrack?.album?.name || this.track?.album || '',
				image: currentSdkTrack?.album?.images?.[0]?.url || this.track?.image || '',
				duration_ms: currentSdkTrack?.duration_ms || this.track?.duration_ms || 0
			};

			// If the SDK reports no queued next track (or state unavailable), keep listening
			// with a recommendation so "next" doesn't go silent.
			const hasKnownQueuedNext = Boolean(state) && nextTracks.length > 0;
			if (!hasKnownQueuedNext) {
				if (await this.playRecommendedFrom(seed)) return;
				// If we couldn't read state, still try the SDK as a last attempt.
				if (state && !this.error && this.connected) {
					this.error = 'Could not find a recommended track to play next.';
					return;
				}
			}

			await this.player.nextTrack();
		} catch {
			if (await this.playRecommendedFrom(seedFromTrack)) return;
			if (!this.error && this.connected) {
				this.error = 'Could not skip track.';
			}
		}
	}

	async previous() {
		if (!this.player) return;
		try {
			await this.player.previousTrack();
		} catch {
			this.error = 'Could not go to previous track.';
		}
	}

	async seek(ms: number) {
		if (!this.player) return;
		const clamped = Math.max(0, Math.min(this.duration || 0, Math.floor(ms)));
		try {
			await this.player.seek(clamped);
			this.position = clamped;
		} catch {
			// ignore
		}
	}

	async setVolume(value: number) {
		const v = Math.max(0, Math.min(1, value));
		this.volume = v;
		if (!this.player) return;
		try {
			await this.player.setVolume(v);
		} catch {
			// ignore
		}
	}

	formatTime(ms: number) {
		const total = Math.max(0, Math.floor(ms / 1000));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	handleCallbackParams(url: URL) {
		if (!browser) return;
		const connected = url.searchParams.get('spotify');
		const err = url.searchParams.get('spotify_error');
		if (!connected && !err) return;

		if (connected === 'connected') {
			this.notice = 'Spotify connected. Your VidJo player is ready.';
			this.panelOpen = true;
			void this.refreshConnection(true).then(() => this.ensurePlayer());
		} else if (err) {
			const map: Record<string, string> = {
				access_denied: 'Spotify connection was cancelled.',
				not_configured: 'Spotify is not configured on the server yet.',
				invalid_state: 'Spotify sign-in could not be verified. Try connecting again.',
				state_mismatch: 'Spotify sign-in could not be verified. Try connecting again.'
			};
			this.error = map[err] || err;
			this.panelOpen = true;
		}

		url.searchParams.delete('spotify');
		url.searchParams.delete('spotify_error');
		const next = `${url.pathname}${url.search}${url.hash}`;
		history.replaceState(history.state, '', next || '/');
	}
}

export const spotify = new SpotifyState();
