/**
 * Detect a raster image by its magic bytes instead of trusting `File.type`.
 * The MIME type supplied by the browser (or a crafted client) can be spoofed,
 * so uploads are rejected unless the bytes are a real PNG/JPEG/GIF/WebP.
 */
export type RasterImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export async function detectRasterImageMime(blob: Blob): Promise<RasterImageMime | null> {
	let bytes: Uint8Array;

	try {
		bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
	} catch {
		return null;
	}

	if (bytes.length >= 8) {
		const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		if (pngSignature.every((value, index) => bytes[index] === value)) return 'image/png';
	}

	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}

	if (bytes.length >= 6) {
		const header = String.fromCharCode(...bytes.slice(0, 6));
		if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
	}

	if (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	) {
		return 'image/webp';
	}

	return null;
}
