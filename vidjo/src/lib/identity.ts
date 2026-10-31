const OWNER_KEY = 'vidjo-owner-id';

/** Read the device id without creating one. Used while claiming old data. */
export function peekDeviceId() {
	try {
		return localStorage.getItem(OWNER_KEY);
	} catch {
		return null;
	}
}

/** Read (or create) the anonymous device id used before sign-in existed. */
export function readDeviceId() {
	const existing = peekDeviceId();
	if (existing) return existing;

	try {
		const id = crypto.randomUUID();
		localStorage.setItem(OWNER_KEY, id);
		return id;
	} catch {
		return 'device-' + Math.random().toString(36).slice(2, 10);
	}
}
