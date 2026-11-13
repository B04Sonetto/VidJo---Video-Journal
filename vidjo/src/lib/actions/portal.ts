/**
 * Render a modal overlay on <body> instead of inside the page tree.
 *
 * The journal is scaled with a CSS transform. For any descendant, `position:
 * fixed` resolves against that transformed box, not the viewport, so overlays
 * get clipped, scaled, and can leave page controls visible behind them.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);

	return {
		destroy() {
			node.remove();
		}
	};
}
