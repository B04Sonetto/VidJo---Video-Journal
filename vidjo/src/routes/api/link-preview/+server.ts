import { json, type RequestEvent } from '@sveltejs/kit';

/**
 * Fetches Open Graph metadata for a URL so chat messages can render rich
 * link cards. Runs on the server to avoid browser CORS restrictions.
 *
 * This endpoint is unauthenticated by design (message text can contain links
 * from anyone), so it is deliberately locked down: http(s) only, no private
 * or local network targets, small bodies only, short timeouts, and a cache.
 */

type Preview = {
	url: string;
	title: string;
	description: string;
	image: string;
	siteName: string;
};

const MAX_BODY_BYTES = 320_000;
const FETCH_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 300;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

const cache = new Map<string, { value: Preview; expires: number }>();
const hits = new Map<string, { count: number; reset: number }>();

const BLOCKED_HOSTS = new Set([
	'localhost',
	'localhost.localdomain',
	'ip6-localhost',
	'ip6-loopback'
]);

function isBlockedAddress(address: string) {
	const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
	if (ip === '::' || ip === '::1' || ip === '::ffff:0:0' || ip === '::ffff:127.0.0.1') {
		return true;
	}
	if (ip.startsWith('127.')) return true;
	if (ip.startsWith('10.')) return true;
	if (ip.startsWith('192.168.')) return true;
	if (ip.startsWith('169.254.')) return true;
	if (ip.startsWith('0.')) return true;
	if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
	const octets = ip.split('.').map(Number);
	if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false;
	// 100.64.0.0/10 carrier-grade NAT and 172.16.0.0/12 private networks.
	if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
	if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
	return false;
}

function allowedHostname(hostname: string) {
	const host = hostname
		.replace(/^\[|\]$/g, '')
		.toLowerCase()
		.replace(/\.$/, '');
	if (!host || BLOCKED_HOSTS.has(host) || host.endsWith('.localhost')) return false;
	if (host.endsWith('.internal') || host.endsWith('.local')) return false;
	// Literal IP hosts must be checked too; URL.hostname keeps IPv6 brackets.
	if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
		return !isBlockedAddress(host);
	}
	return true;
}

function safeHttpUrl(url: URL) {
	return (
		['http:', 'https:'].includes(url.protocol) &&
		!url.username &&
		!url.password &&
		allowedHostname(url.hostname)
	);
}

function decode(value: string) {
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function attribute(tag: string, name: string) {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
	return match ? decode(match[2]) : '';
}

function metaContent(html: string, keys: string[]) {
	for (const key of keys) {
		const pattern = new RegExp(
			`<meta\\b[^>]*?(?:property|name|itemprop)\\s*=\\s*(["'])${key}\\1[^>]*>`,
			'i'
		);
		const tag = html.match(pattern)?.[0];
		if (tag) {
			const content = attribute(tag, 'content');
			if (content) return content;
		}
	}
	return '';
}

function resolveImage(value: string, base: URL) {
	if (!value) return '';
	try {
		const resolved = new URL(value, base);
		return safeHttpUrl(resolved) ? resolved.href : '';
	} catch {
		return '';
	}
}

function parseHtml(html: string, base: URL): Preview {
	const head = html.slice(0, 300_000);
	const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';

	return {
		url: base.href,
		title: metaContent(head, ['og:title', 'twitter:title']) || decode(titleTag),
		description: metaContent(head, ['og:description', 'twitter:description', 'description']),
		image: resolveImage(
			metaContent(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']),
			base
		),
		siteName: metaContent(head, ['og:site_name', 'application-name'])
	};
}

function rateLimited(key: string) {
	const now = Date.now();
	const entry = hits.get(key);
	if (!entry || now >= entry.reset) {
		hits.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
		if (hits.size > 1000) hits.clear();
		return false;
	}
	entry.count += 1;
	return entry.count > RATE_LIMIT_MAX;
}

export async function POST({ request, getClientAddress }: RequestEvent) {
	if (rateLimited(getClientAddress())) {
		return json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}

	const input = (raw as { url?: unknown } | null)?.url;
	if (typeof input !== 'string' || input.length > 2048) {
		return json({ error: 'Invalid URL.' }, { status: 400 });
	}

	let target: URL;
	try {
		target = new URL(input);
	} catch {
		return json({ error: 'Invalid URL.' }, { status: 400 });
	}

	if (!safeHttpUrl(target)) {
		return json({ error: 'That link cannot be previewed.' }, { status: 400 });
	}

	const key = target.href;
	const cached = cache.get(key);
	if (cached && cached.expires > Date.now()) return json(cached.value);

	try {
		// Follow redirects ourselves so every hop gets the same SSRF checks.
		let current = target;
		let response: Response | undefined;
		for (let hop = 0; hop <= 5; hop += 1) {
			response = await fetch(current, {
				redirect: 'manual',
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers: {
					'user-agent': 'VidJoChatLinkPreview/1.0',
					accept: 'text/html,application/xhtml+xml'
				}
			});

			if (response.status < 300 || response.status >= 400) break;

			const location = response.headers.get('location');
			await response.body?.cancel().catch(() => undefined);
			if (!location || hop === 5) {
				return json({ error: 'That link could not be previewed.' }, { status: 400 });
			}

			let next: URL;
			try {
				next = new URL(location, current);
			} catch {
				return json({ error: 'That link cannot be previewed.' }, { status: 400 });
			}
			if (!safeHttpUrl(next)) {
				return json({ error: 'That link cannot be previewed.' }, { status: 400 });
			}
			current = next;
		}

		if (!response || !response.ok)
			return json({ error: 'Could not load that link.' }, { status: 502 });

		const type = response.headers.get('content-type') ?? '';
		if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
			return json({ error: 'That link is not a web page.' }, { status: 415 });
		}

		const reader = response.body?.getReader();
		if (!reader) return json({ error: 'Could not load that link.' }, { status: 502 });

		const chunks: Uint8Array[] = [];
		let size = 0;
		while (size < MAX_BODY_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
		await reader.cancel().catch(() => undefined);

		const decoder = new TextDecoder('utf-8', { fatal: false });
		let html = '';
		for (const chunk of chunks) html += decoder.decode(chunk, { stream: true });
		html += decoder.decode();

		const value = parseHtml(html, current);
		if (cache.size >= CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest) cache.delete(oldest);
		}
		cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
		return json(value);
	} catch {
		return json({ error: 'Could not load that link.' }, { status: 502 });
	}
}
