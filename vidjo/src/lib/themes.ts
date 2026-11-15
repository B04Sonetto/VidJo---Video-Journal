/**
 * Journal themes.
 *
 * The actual palette lives in `src/routes/layout.css` as `html[data-theme='…']`
 * variable overrides. This list is the single source of truth for the pickers,
 * the persisted preference type, and the mobile status-bar colour.
 */
export const THEMES = [
	{
		id: 'classic',
		label: 'Classic Scrapbook',
		short: 'Classic',
		swatch: '#51397A',
		desk: '#1B102B'
	},
	{
		id: 'sunset',
		label: 'Sunset Warmth',
		short: 'Sunset',
		swatch: '#B85C43',
		desk: '#241218'
	},
	{
		id: 'midnight',
		label: 'Midnight Study',
		short: 'Midnight',
		swatch: '#1F3557',
		desk: '#0C1322'
	},
	{
		id: 'evergreen',
		label: 'Evergreen Study',
		short: 'Evergreen',
		swatch: '#2F4A3A',
		desk: '#101A15'
	},
	{
		id: 'rosewood',
		label: 'Rosewood Blush',
		short: 'Rosewood',
		swatch: '#7A3348',
		desk: '#1F1116'
	},
	{
		id: 'harbor',
		label: 'Harbor Mist',
		short: 'Harbor',
		swatch: '#2C4E5E',
		desk: '#0B171C'
	}
] as const;

export type ThemeName = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeName = 'classic';

export function isThemeName(value: unknown): value is ThemeName {
	return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}

/** Theme metadata for an id, falling back to the default theme. */
export function themeMeta(id: string) {
	return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
