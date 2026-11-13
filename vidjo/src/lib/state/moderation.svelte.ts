import { auth } from '#lib/state/auth.svelte';
import { isSupabaseConfigured, supabase } from '#lib/supabase';

export type ModerationRole = 'user' | 'admin' | 'banned';

export interface ModerationWarning {
	id: string;
	reason: string;
	message: string;
	source_type: string;
	created_at: string;
	acknowledged_at: string | null;
}

interface ModerationStatusResponse {
	user_role?: string | null;
	ban_reason?: string | null;
	banned_at?: string | null;
	warnings?: ModerationWarning[] | null;
}

class ModerationState {
	role = $state<ModerationRole>('user');
	banReason = $state('');
	bannedAt = $state<string | null>(null);
	warnings = $state<ModerationWarning[]>([]);
	checking = $state(false);
	ready = $state(false);
	error = $state('');

	private seq = 0;
	private timer: ReturnType<typeof setInterval> | null = null;

	get banned() {
		return this.role === 'banned';
	}

	get pendingWarnings() {
		return this.warnings.filter((warning) => !warning.acknowledged_at);
	}

	/** The newest warning the member has not dismissed yet. */
	get activeWarning(): ModerationWarning | null {
		return this.pendingWarnings[0] ?? null;
	}

	async init() {
		if (!auth.active) {
			this.reset();
			return;
		}

		if (!isSupabaseConfigured) {
			this.reset();
			this.ready = true;
			return;
		}

		const seq = ++this.seq;
		this.checking = !this.ready;
		this.error = '';

		try {
			const { data, error } = await supabase.rpc('vidjo_moderation_status');
			if (seq !== this.seq) return;
			if (error) throw error;
			this.apply((data ?? {}) as ModerationStatusResponse);
		} catch (err) {
			if (seq !== this.seq) return;
			// A missing RPC before the schema migration should not lock the app.
			console.warn('[VidJo] Could not load moderation status.', err);
			this.error = 'Could not check your account status.';
		} finally {
			if (seq === this.seq) {
				this.checking = false;
				this.ready = true;
			}
		}

		// Do not leave a poller running if the member signed out or switched
		// accounts while the status request was in flight.
		if (seq === this.seq) this.startWatching();
	}

	async refresh() {
		if (!isSupabaseConfigured || !auth.active) return;

		const seq = this.seq;
		try {
			const { data, error } = await supabase.rpc('vidjo_moderation_status');
			if (seq !== this.seq) return;
			if (error) throw error;
			this.apply((data ?? {}) as ModerationStatusResponse);
		} catch (err) {
			console.warn('[VidJo] Could not refresh moderation status.', err);
		}
	}

	async acknowledge(warningId: string) {
		const previous = this.warnings;
		const now = new Date().toISOString();
		this.warnings = this.warnings.map((warning) =>
			warning.id === warningId ? { ...warning, acknowledged_at: now } : warning
		);

		if (!isSupabaseConfigured) return;
		const { error } = await supabase.rpc('vidjo_ack_warning', {
			p_warning_id: warningId
		});

		if (error) {
			console.warn('[VidJo] Could not acknowledge the warning.', error);
			this.warnings = previous;
		}
	}

	reset() {
		this.seq += 1;
		this.stopWatching();
		this.role = 'user';
		this.banReason = '';
		this.bannedAt = null;
		this.warnings = [];
		this.checking = false;
		this.ready = false;
		this.error = '';
	}

	private apply(status: ModerationStatusResponse) {
		const wasBanned = this.role === 'banned';
		this.role =
			status.user_role === 'banned' ? 'banned' : status.user_role === 'admin' ? 'admin' : 'user';
		this.banReason = status.ban_reason || '';
		this.bannedAt = status.banned_at || null;
		this.warnings = Array.isArray(status.warnings) ? status.warnings : [];

		// An admin restored this account while the app was open. Reload so the
		// journal, profile, and social data initialize instead of staying blank.
		if (wasBanned && this.role !== 'banned' && typeof window !== 'undefined') {
			window.location.reload();
		}
	}

	private startWatching() {
		if (this.timer || typeof window === 'undefined') return;

		this.timer = setInterval(() => {
			if (document.visibilityState === 'visible') void this.refresh();
		}, 60_000);

		document.addEventListener('visibilitychange', this.onVisibilityChange);
	}

	private stopWatching() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.onVisibilityChange);
		}
	}

	private onVisibilityChange = () => {
		if (document.visibilityState === 'visible') void this.refresh();
	};
}

export const moderation = new ModerationState();
