/**
 * Capture a small JPEG poster from a video file entirely in the browser.
 *
 * This is deliberately best-effort: a poster is a nice-to-have, so any
 * failure (unsupported codec, blocked autoplay, slow seek, memory pressure)
 * resolves to `null` and the video is uploaded without one.
 */

const CAPTURE_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 5000;

function waitForMediaEvent(
	video: HTMLVideoElement,
	event: 'loadeddata' | 'seeked',
	timeoutMs: number
): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			video.removeEventListener(event, onEvent);
			video.removeEventListener('error', onError);
		};

		const onEvent = () => {
			cleanup();
			resolve();
		};

		const onError = () => {
			cleanup();
			reject(new Error('The browser could not read this video.'));
		};

		const timer = setTimeout(() => {
			cleanup();
			reject(new Error('Timed out while reading the video.'));
		}, timeoutMs);

		video.addEventListener(event, onEvent, { once: true });
		video.addEventListener('error', onError, { once: true });
	});
}

export async function captureVideoThumbnail(
	file: Blob,
	maxWidth = 640,
	quality = 0.72
): Promise<Blob | null> {
	if (typeof document === 'undefined' || file.size === 0) return null;

	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.preload = 'auto';
	video.muted = true;
	video.playsInline = true;

	try {
		const loaded = waitForMediaEvent(video, 'loadeddata', CAPTURE_TIMEOUT_MS);
		video.src = url;
		video.load();
		await loaded;

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const target = duration > 0 ? Math.min(1, duration / 2) : 0.1;

		if (target > 0) {
			const seeked = waitForMediaEvent(video, 'seeked', SEEK_TIMEOUT_MS);
			video.currentTime = target;
			await seeked;
		}

		const sourceWidth = video.videoWidth || maxWidth;
		const sourceHeight = video.videoHeight || Math.round(maxWidth * (9 / 16));
		const width = Math.max(1, Math.min(maxWidth, sourceWidth));
		const height = Math.max(1, Math.round(width * (sourceHeight / sourceWidth)));

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext('2d');
		if (!context) return null;

		context.drawImage(video, 0, 0, width, height);

		return await new Promise<Blob | null>((resolve) => {
			canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
		});
	} catch (error) {
		console.debug('[VidJo] Could not capture a video thumbnail.', error);
		return null;
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(url);
	}
}
