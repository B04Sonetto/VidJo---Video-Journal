const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Avatars can be real image URLs, preset emoji, or nothing at all. Users often
 * paste Pinterest/Google URLs without a protocol, so normalise them before they
 * ever reach an `<img src>`.
 */
export function normalizeImageUrl(value: string | null | undefined): string | null {
	if (!value) return null;

	const trimmed = value.trim();
	if (!trimmed) return null;

	// Preset emoji avatars are stored in `avatar_url` and must stay as-is.
	if (isEmojiAvatar(trimmed)) return trimmed;

	if (trimmed.startsWith('//')) return `https:${trimmed}`;

	if (/^https?:\/\//i.test(trimmed)) {
		// Mixed-content images silently fail on the HTTPS deployment.
		return trimmed.replace(/^http:\/\//i, 'https://');
	}

	if (/^data:image\//i.test(trimmed)) return trimmed;

	// Bare domains such as `i.pinimg.com/736x/...` were being treated as
	// relative paths, which is what produced the broken `://i.pinimg.com` image.
	if (/^(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
		return `https://${trimmed}`;
	}

	return trimmed;
}

export function isEmojiAvatar(value: string | null | undefined): boolean {
	if (!value) return false;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 12) return false;
	if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/')) return false;

	try {
		return /^(?:\p{Extended_Pictographic}|\u200d|\ufe0f|\ufe0e|[\u{1f3fb}-\u{1f3ff}])+$/u.test(
			trimmed
		);
	} catch {
		// Older engines without Unicode property escapes: fall back to a length
		// check so preset avatars still render instead of a broken image.
		return trimmed.length <= 4;
	}
}

/** Never show a raw user id or pasted image URL where a human name belongs. */
export function cleanDisplayName(value: string | null | undefined, fallback = 'VidJo student') {
	const trimmed = (value ?? '').trim();
	if (!trimmed || UUID_RE.test(trimmed)) return fallback;
	if (/^(?:https?:\/\/|www\.|data:image\/)/i.test(trimmed)) return fallback;
	if (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(trimmed)) return fallback;
	if (/^(?:[\w-]+\.)+[a-z]{2,}\//i.test(trimmed)) return fallback;
	return trimmed;
}

export function avatarInitial(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed || UUID_RE.test(trimmed)) return 'V';
	return trimmed[0].toUpperCase();
}

export function isUuid(value: string | null | undefined): boolean {
	return Boolean(value && UUID_RE.test(value));
}
