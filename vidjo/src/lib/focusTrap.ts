const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function isVisible(element: HTMLElement) {
	if (element.hidden) return false;
	if (element.getAttribute('aria-hidden') === 'true') return false;
	if (element.closest('[aria-hidden="true"]')) return false;
	if (element.getClientRects().length === 0) return false;
	return getComputedStyle(element).visibility !== 'hidden';
}

function topDialog() {
	const dialogs = Array.from(
		document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
	);

	for (let index = dialogs.length - 1; index >= 0; index -= 1) {
		if (isVisible(dialogs[index])) return dialogs[index];
	}

	return null;
}

/**
 * Keep keyboard focus inside the topmost open dialog.
 *
 * Every modal in the app marks itself with `role="dialog"` and
 * `aria-modal="true"`, so one document-level listener can cover them all,
 * including nested confirmations, without per-modal wiring.
 */
export function initFocusTrap() {
	if (typeof document === 'undefined') return () => {};

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;

		const dialog = topDialog();
		if (!dialog) return;

		const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement as HTMLElement | null;
		const inside = active !== null && dialog.contains(active);

		if (event.shiftKey) {
			if (!inside || active === first) {
				event.preventDefault();
				last.focus();
			}
			return;
		}

		if (!inside || active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	document.addEventListener('keydown', onKeydown, true);

	return () => document.removeEventListener('keydown', onKeydown, true);
}
