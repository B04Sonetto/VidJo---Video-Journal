import type { MoodKey } from '#lib/types';

export interface MoodDef {
	k: MoodKey;
	l: string;
	c: string;
	svg: string;
}

export const MOODS: MoodDef[] = [
	{
		k: 'happy',
		l: 'Happy',
		c: '#F6D98B',
		svg: '<svg viewBox="0 0 52 52"><g stroke="#E5A93C" stroke-width="3" stroke-linecap="round"><path d="M26 3v6M26 43v6M3 26h6M43 26h6M10 10l4 4M38 38l4 4M42 10l-4 4M14 38l-4 4"/></g><circle cx="26" cy="26" r="13" fill="#F6C94F" stroke="#C98A1E" stroke-width="2"/><circle cx="21.5" cy="24" r="1.8" fill="#4A2A1A"/><circle cx="30.5" cy="24" r="1.8" fill="#4A2A1A"/><path d="M20.5 29.5q5.5 5 11 0" fill="none" stroke="#4A2A1A" stroke-width="2" stroke-linecap="round"/></svg>'
	},
	{
		k: 'calm',
		l: 'Calm',
		c: '#BFE0C6',
		svg: '<svg viewBox="0 0 52 52"><path d="M26 47V28M26 40q-14-2-15-16 13 0 15 12M26 36q12-1 14-14-12 0-14 11M26 28q-6-6-1-18 7 9 1 18z" fill="#7DB07F" stroke="#3D6B47" stroke-width="2" stroke-linejoin="round"/></svg>'
	},
	{
		k: 'tired',
		l: 'Tired',
		c: '#D9CCF0',
		svg: '<svg viewBox="0 0 52 52"><path d="M34 6a21 21 0 100 40 17 17 0 01-9-20A17 17 0 0134 6z" fill="#C9B8E8" stroke="#6A528F" stroke-width="2.5" stroke-linejoin="round"/><path d="M19 22q2 2 4 0M20 31q3 2 6 0" fill="none" stroke="#3A2A55" stroke-width="2" stroke-linecap="round"/><path d="M40 12l1.2 3 3 1.2-3 1.2L40 20.4l-1.2-3-3-1.2 3-1.2z" fill="#D4A24C"/></svg>'
	},
	{
		k: 'sad',
		l: 'Sad',
		c: '#C3D3F0',
		svg: '<svg viewBox="0 0 52 52"><path d="M14 34a8 8 0 01-1-16 11 11 0 0121-2 9 9 0 012 18z" fill="#8F86C8" stroke="#4A3F8F" stroke-width="2.5" stroke-linejoin="round"/><circle cx="21" cy="25" r="1.8" fill="#1F1A45"/><circle cx="31" cy="25" r="1.8" fill="#1F1A45"/><path d="M22 31q4-3 8 0" fill="none" stroke="#1F1A45" stroke-width="2" stroke-linecap="round"/><path d="M18 40v5M26 40v6M34 40v5" stroke="#6FA3E0" stroke-width="2.5" stroke-linecap="round"/></svg>'
	},
	{
		k: 'stressed',
		l: 'Stressed',
		c: '#E8C3DD',
		svg: '<svg viewBox="0 0 52 52"><path d="M26 3l5 10 11-4-3 11 10 6-10 5 3 11-11-3-5 10-5-10-11 3 3-11-10-5 10-6-3-11 11 4z" fill="#B65A8F" stroke="#6E2A5A" stroke-width="2" stroke-linejoin="round"/><circle cx="21" cy="24" r="2" fill="#2A0F25"/><circle cx="31" cy="24" r="2" fill="#2A0F25"/><path d="M20 32q3-3 6 0t6 0" fill="none" stroke="#2A0F25" stroke-width="2" stroke-linecap="round"/></svg>'
	},
	{
		k: 'angry',
		l: 'Angry',
		c: '#F5C2B4',
		svg: '<svg viewBox="0 0 52 52"><path d="M27 3c2 9 12 13 12 25a13 13 0 01-26 0c0-6 3-9 6-12 0 5 2 7 4 8 0-8 1-14 4-21z" fill="#E8613C" stroke="#9B2D1A" stroke-width="2.2" stroke-linejoin="round"/><path d="M26 26c3 4 7 6 7 11a7 7 0 01-14 0c0-4 4-6 7-11z" fill="#F6B04A"/><path d="M19 27l5 2M33 27l-5 2" stroke="#3A0F08" stroke-width="2.2" stroke-linecap="round"/></svg>'
	},
	{
		k: 'excited',
		l: 'Excited',
		c: '#F7DF9C',
		svg: '<svg viewBox="0 0 52 52"><path d="M26 4l6.3 13.5 14.7 1.7-10.9 10 3 14.5L26 36.4 12.9 43.7l3-14.5-10.9-10 14.7-1.7z" fill="#F6C94F" stroke="#C98A1E" stroke-width="2.2" stroke-linejoin="round"/><circle cx="21.5" cy="24" r="1.7" fill="#4A2A1A"/><circle cx="30.5" cy="24" r="1.7" fill="#4A2A1A"/><path d="M21 29q5 4.5 10 0" fill="none" stroke="#4A2A1A" stroke-width="2" stroke-linecap="round"/></svg>'
	}
];

export const MOOD_BY_KEY = Object.fromEntries(MOODS.map((mood) => [mood.k, mood])) as Record<
	MoodKey,
	MoodDef
>;
