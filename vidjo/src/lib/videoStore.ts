const DB_NAME = 'vidjo-media';
const STORE = 'videos';
const VERSION = 1;

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase() {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	if (database) return database;

	database = new Promise<IDBDatabase | null>((resolve) => {
		const request = indexedDB.open(DB_NAME, VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});

	return database;
}

export async function putStoredVideo(key: string, blob: Blob) {
	const db = await openDatabase();
	if (!db) return false;

	return new Promise<boolean>((resolve) => {
		const transaction = db.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).put(blob, key);
		transaction.oncomplete = () => resolve(true);
		transaction.onerror = () => resolve(false);
		transaction.onabort = () => resolve(false);
	});
}

export async function getStoredVideo(key: string) {
	const db = await openDatabase();
	if (!db) return null;

	return new Promise<Blob | null>((resolve) => {
		const transaction = db.transaction(STORE, 'readonly');
		const request = transaction.objectStore(STORE).get(key);
		request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
		request.onerror = () => resolve(null);
	});
}

export async function deleteStoredVideo(key: string) {
	const db = await openDatabase();
	if (!db) return;

	await new Promise<void>((resolve) => {
		const transaction = db.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).delete(key);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
}

export async function deleteStoredVideos(keys: string[]) {
	const db = await openDatabase();
	if (!db || keys.length === 0) return;

	await new Promise<void>((resolve) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		for (const key of keys) {
			store.delete(key);
		}
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
}

export async function clearStoredVideos() {
	const db = await openDatabase();
	if (!db) return;

	await new Promise<void>((resolve) => {
		const transaction = db.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).clear();
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
}

export async function clearStoredVideosForOwner(ownerId: string) {
	const db = await openDatabase();
	if (!db || !ownerId) return;

	await new Promise<void>((resolve) => {
		const transaction = db.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		const request = store.openKeyCursor();

		request.onsuccess = () => {
			const cursor = request.result;
			if (cursor) {
				const key = String(cursor.key);
				if (key.startsWith(`${ownerId}:`)) {
					store.delete(cursor.key);
				}
				cursor.continue();
			}
		};

		transaction.oncomplete = () => resolve();
		transaction.onerror = () => resolve();
		transaction.onabort = () => resolve();
	});
}
