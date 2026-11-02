import type { Entry } from '#lib/types';
import { offsetDate, uid } from '#lib/dates';

export function sampleEntries(): Entry[] {
	const dates = {
		rain: offsetDate(-4),
		demo: offsetDate(-2),
		late: offsetDate(-1)
	};

	return [
		{
			date: dates.rain,
			mood: 'calm',
			title: 'Rain on the roof',
			mind: 'Stayed in and listened to the rain all afternoon. I made tea and finally cleaned my desk. It is strange how quiet can feel so full.',
			refl: 'Slow days count too.',
			privacy: 'private',
			saved: true,
			sample: true,
			videoPath: '',
			videoName: '',
			communitySlug: '',
			stickers: [
				{ id: uid(), type: 'cloud', page: 'R', x: 82, y: 12, size: 96, rot: 8 },
				{ id: uid(), type: 'sakura', page: 'L', x: 84, y: 88, size: 70, rot: -10 },
				{ id: uid(), type: 'tape1', page: 'L', x: 50, y: 20, size: 120, rot: -3 }
			]
		},
		{
			date: dates.demo,
			mood: 'excited',
			title: 'Demo day went well',
			mind: 'We showed the whole project to the class and nothing crashed. Everyone laughed at the right parts. I could not stop smiling on the ride home.',
			refl: 'Practice more out loud next time.',
			privacy: 'friends',
			saved: true,
			sample: true,
			videoPath: '',
			videoName: '',
			communitySlug: '',
			stickers: [
				{ id: uid(), type: 'star', page: 'L', x: 14, y: 90, size: 84, rot: -12 },
				{ id: uid(), type: 'yay', page: 'R', x: 78, y: 13, size: 110, rot: 6 },
				{ id: uid(), type: 'cat', page: 'L', x: 86, y: 86, size: 92, rot: 7 }
			]
		},
		{
			date: dates.late,
			mood: 'tired',
			title: 'Late night',
			mind: 'Stayed up too long fixing one tiny bug. It worked at 2 AM and I felt a little silly and a lot relieved.',
			refl: 'Sleep first, debug later.',
			privacy: 'private',
			saved: true,
			sample: true,
			videoPath: '',
			videoName: '',
			communitySlug: '',
			stickers: [
				{ id: uid(), type: 'moon', page: 'R', x: 84, y: 10, size: 90, rot: 12 },
				{ id: uid(), type: 'zzz', page: 'L', x: 84, y: 92, size: 96, rot: -6 }
			]
		}
	];
}
