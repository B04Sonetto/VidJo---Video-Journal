export function pad(value: number) {
	return (value < 10 ? '0' : '') + value;
}

export function dateKey(date: Date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDate(value: string) {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, month - 1, day);
}

export const TODAY = dateKey(new Date());

export function uid() {
	return 's' + Math.random().toString(36).slice(2, 9);
}

export function offsetDate(days: number) {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return dateKey(date);
}

export function formatPostDate(date: string) {
	const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseDate(date) : new Date(date);
	return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
