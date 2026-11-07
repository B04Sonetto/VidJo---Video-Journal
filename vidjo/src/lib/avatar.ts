const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Older builds stored the preset icon name in `avatar_url` instead of emoji.
 * Map those names forward so existing profiles render and stay selectable.
 */
const LEGACY_PRESET_AVATARS: Record<string, string> = {
	sparkles: '✨',
	spark: '🎨',
	book: '📚',
	music: '🎵',
	rocket: '🚀',
	cat: '🐱',
	leaf: '🌱',
	video: '🎬'
};

export function legacyPresetAvatar(value: string | null | undefined): string | null {
	if (!value) return null;
	return LEGACY_PRESET_AVATARS[value.trim().toLowerCase()] ?? null;
}

/**
 * Only raster image formats are allowed. SVG can contain scripts, so it must
 * never reach an image sink, even though `<img>` usually blocks SVG scripts.
 */
const SAFE_RASTER_DATA_URL_RE =
	/^data:image\/(?:png|jpe?g|pjpeg|x-png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)(?:;[a-z0-9=._-]+)*,/i;

const SVG_EXTENSION_RE = /\.svgz?(?:[?#].*)?$/i;

function normalizeHttpUrl(value: string): string | null {
	// Mixed-content images silently fail on the HTTPS deployment.
	const upgraded = value.replace(/^http:\/\//i, 'https://');

	try {
		const parsed = new URL(upgraded);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
		if (SVG_EXTENSION_RE.test(parsed.pathname)) return null;
		// Use the parsed href so quotes, spaces, and control characters are
		// percent-encoded before the value ever reaches an attribute.
		return parsed.href;
	} catch {
		return null;
	}
}

/**
 * Avatars can be real image URLs, preset emoji, or nothing at all. Users often
 * paste Pinterest/Google URLs without a protocol, so normalise them before they
 * ever reach an `<img src>`.
 *
 * Anything that is not an emoji, an http(s) image URL, or a raster `data:` URI
 * is rejected. This closes the `data:image/svg+xml` / `javascript:` sinks that
 * allowed a profile picture to execute script.
 */
export function normalizeImageUrl(value: string | null | undefined): string | null {
	if (!value) return null;

	const trimmed = value.trim();
	if (!trimmed) return null;

	// Preset emoji avatars are stored in `avatar_url` and must stay as-is.
	if (isEmojiAvatar(trimmed)) return trimmed;

	const legacyPreset = legacyPresetAvatar(trimmed);
	if (legacyPreset) return legacyPreset;

	if (trimmed.startsWith('//')) return normalizeHttpUrl(`https:${trimmed}`);

	if (/^https?:\/\//i.test(trimmed)) return normalizeHttpUrl(trimmed);

	if (/^data:/i.test(trimmed)) {
		return SAFE_RASTER_DATA_URL_RE.test(trimmed) ? trimmed : null;
	}

	// Bare domains such as `i.pinimg.com/736x/...` were being treated as
	// relative paths, which is what produced the broken `://i.pinimg.com` image.
	if (/^(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
		return normalizeHttpUrl(`https://${trimmed}`);
	}

	return null;
}

export type ImageTransformOptions = {
	width?: number;
	height?: number;
	quality?: number;
	resize?: 'cover' | 'contain' | 'fill';
};

const PUBLIC_STORAGE_MARKER = '/storage/v1/object/public/';
const RENDER_STORAGE_MARKER = '/storage/v1/render/image/public/';

function applyImageTransform(url: URL, transform: ImageTransformOptions) {
	const setDimension = (key: 'width' | 'height', value: number | undefined) => {
		if (!value) return;
		url.searchParams.set(key, String(Math.min(2500, Math.max(1, Math.round(value)))));
	};

	setDimension('width', transform.width);
	setDimension('height', transform.height);
	if (transform.resize) url.searchParams.set('resize', transform.resize);
	if (transform.quality) {
		url.searchParams.set(
			'quality',
			String(Math.min(100, Math.max(20, Math.round(transform.quality))))
		);
	}
}

/**
 * Supabase Storage can resize and re-encode public-bucket images at the CDN
 * edge. Only `/storage/v1/object/public/...` URLs are rewritten to the
 * `/storage/v1/render/image/public/...` endpoint; emoji presets, local data
 * URIs, and third-party images pass through unchanged.
 */
export function transformedImageUrl(
	value: string | null | undefined,
	transform: ImageTransformOptions
): string | null {
	if (!value || isEmojiAvatar(value)) return value ?? null;
	if (!/^https?:\/\//i.test(value)) return value;

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return value;
	}

	const isRender = parsed.pathname.includes(RENDER_STORAGE_MARKER);
	const isPublicObject = parsed.pathname.includes(PUBLIC_STORAGE_MARKER);
	if (!isRender && !isPublicObject) return value;

	if (isPublicObject) {
		parsed.pathname = parsed.pathname.replace(PUBLIC_STORAGE_MARKER, RENDER_STORAGE_MARKER);
	}

	applyImageTransform(parsed, transform);
	return parsed.href;
}

/** Square avatar variant. 256px covers the largest avatar at 2x DPI. */
export function optimizedAvatarUrl(value: string | null | undefined, size = 256): string | null {
	return transformedImageUrl(value, {
		width: size,
		height: size,
		resize: 'cover',
		quality: 80
	});
}

/** Wide profile-banner variant. The hero is at most ~1100 CSS px wide. */
export function optimizedBannerUrl(value: string | null | undefined, width = 1600): string | null {
	return transformedImageUrl(value, {
		width,
		height: Math.round(width * 0.3),
		resize: 'cover',
		quality: 80
	});
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
