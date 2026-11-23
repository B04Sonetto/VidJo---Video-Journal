import { dateKey, parseDate, todayKey } from '#lib/dates';
import type { Entry, StreakInfo } from '#lib/types';

export interface StreakSummary extends StreakInfo {
	/** Every day with a page, used for the calendar heatmap. */
	days: Set<string>;
	/** The days that make up the current run. */
	currentDays: Set<string>;
}

export interface HeatCell {
	date: string;
	counted: boolean;
	current: boolean;
	future: boolean;
	today: boolean;
}

/**
 * True when a page has something worth counting. Sample pages are seeded demo
 * content, so they never earn a streak. Keep this in sync with
 * `journal.isBlank()`, which drives the calendar markers.
 */
export function countsForStreak(entry: Entry | undefined): boolean {
	if (!entry || entry.sample) return false;

	return Boolean(
		entry.saved ||
		entry.communitySlug ||
		entry.mood ||
		entry.title.trim() ||
		entry.mind.trim() ||
		entry.refl.trim() ||
		entry.stickers.length > 0 ||
		entry.videoPath ||
		entry.videoThumbPath ||
		entry.includedFriendIds.length > 0 ||
		entry.excludedFriendIds.length > 0
	);
}

/**
 * Current and best streak for a set of journal entries.
 *
 * A streak stays alive through today until the day ends: if today is blank but
 * yesterday was written, the current run still counts. That matches how the
 * profile has always displayed it, and it avoids a streak dropping to zero at
 * midnight before the user has had a chance to write.
 */
export function summarizeStreak(entries: Record<string, Entry>, today = todayKey()): StreakSummary {
	const days = new Set<string>();

	for (const entry of Object.values(entries)) {
		if (entry.date <= today && countsForStreak(entry)) days.add(entry.date);
	}

	const ordered = [...days].sort();
	let longest = 0;
	let run = 0;
	let previous = '';

	for (const day of ordered) {
		if (previous) {
			const next = parseDate(previous);
			next.setDate(next.getDate() + 1);
			run = dateKey(next) === day ? run + 1 : 1;
		} else {
			run = 1;
		}

		if (run > longest) longest = run;
		previous = day;
	}

	const currentDays = new Set<string>();
	const cursor = parseDate(today);
	if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);

	// Ten years is far beyond any real streak and stops a corrupt date from
	// spinning forever.
	for (let i = 0; i < 3660; i += 1) {
		const key = dateKey(cursor);
		if (!days.has(key)) break;
		currentDays.add(key);
		cursor.setDate(cursor.getDate() - 1);
	}

	return {
		current: currentDays.size,
		longest: Math.max(longest, currentDays.size),
		totalDays: days.size,
		todayCounted: days.has(today),
		days,
		currentDays
	};
}

/**
 * Columns of seven days ending with the current week, newest last. Used for the
 * compact activity heatmap in the calendar.
 */
export function buildHeatmap(
	days: Set<string>,
	currentDays: Set<string>,
	weeks = 8,
	today = todayKey()
): HeatCell[][] {
	const end = parseDate(today);
	const start = new Date(end);
	start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);

	const columns: HeatCell[][] = [];

	for (let week = 0; week < weeks; week += 1) {
		const column: HeatCell[] = [];

		for (let day = 0; day < 7; day += 1) {
			const date = new Date(start);
			date.setDate(start.getDate() + week * 7 + day);
			const key = dateKey(date);

			column.push({
				date: key,
				counted: days.has(key),
				current: currentDays.has(key),
				future: key > today,
				today: key === today
			});
		}

		columns.push(column);
	}

	return columns;
}
