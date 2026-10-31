export interface StickerDef {
	k: string;
	n: string;
	s: number;
	flat?: boolean;
	svg: string;
}

function face(x: number, y: number, gap = 8) {
	const ink = '#3A2230';
	return (
		`<circle cx="${x - gap}" cy="${y}" r="2.6" fill="${ink}"/>` +
		`<circle cx="${x + gap}" cy="${y}" r="2.6" fill="${ink}"/>` +
		`<path d="M${x - 3.5} ${y + 5}q3.5 3.5 7 0" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` +
		`<circle cx="${x - gap - 5}" cy="${y + 5}" r="3" fill="#F29B8B" opacity=".65"/>` +
		`<circle cx="${x + gap + 5}" cy="${y + 5}" r="3" fill="#F29B8B" opacity=".65"/>`
	);
}

function svg(inner: string) {
	return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

export const STICKERS: StickerDef[] = [
	{
		k: 'star',
		n: 'Smiling star',
		s: 90,
		svg: svg(
			'<path d="M40 6l9.5 20 22 2.6-16.2 15 4.2 21.7L40 54.6 20.5 65.3l4.2-21.7L8.5 28.6l22-2.6z" fill="#F6C94F" stroke="#B9801C" stroke-width="3" stroke-linejoin="round"/>' +
				face(40, 36, 8)
		)
	},
	{
		k: 'moon',
		n: 'Crescent moon',
		s: 90,
		svg: svg(
			'<path d="M51 9a31.5 31.5 0 100 60 25.5 25.5 0 01-13.5-30A25.5 25.5 0 0151 9z" fill="#C9B8E8" stroke="#6A528F" stroke-width="3" stroke-linejoin="round"/><path d="M62 18l1.8 4.6 4.6 1.8-4.6 1.8L62 30.8l-1.8-4.6-4.6-1.8 4.6-1.8z" fill="#F0C873"/><path d="M58 52l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#F0C873"/><path d="M22 30q3 3 6 0M22 46q3 3 6 0" fill="none" stroke="#3A2A55" stroke-width="2.2" stroke-linecap="round"/>'
		)
	},
	{
		k: 'onigiri',
		n: 'Onigiri',
		s: 90,
		svg: svg(
			'<path d="M40 10q9 0 15 11l15 32q5 13-8 15H18q-13-2-8-15L25 21q6-11 15-11z" fill="#FFFDF7" stroke="#6B5A8A" stroke-width="3" stroke-linejoin="round"/><path d="M22 54h36l5 9q2 6-5 6H22q-7 0-5-6z" fill="#2A2438"/>' +
				face(40, 38, 8)
		)
	},
	{
		k: 'cat',
		n: 'Cat',
		s: 94,
		svg: svg(
			'<path d="M14 42L12 12l22 12zM66 42l2-30-22 12z" fill="#FFF1DD" stroke="#8A6A5A" stroke-width="3" stroke-linejoin="round"/><path d="M17 34l-1-13 10 6zM63 34l1-13-10 6z" fill="#F6B8C0"/><ellipse cx="40" cy="46" rx="29" ry="23" fill="#FFF1DD" stroke="#8A6A5A" stroke-width="3"/>' +
				face(40, 45, 11) +
				'<path d="M38 50l2 2 2-2z" fill="#E08A8A"/><path d="M12 48l-8-2M12 54l-8 3M68 48l8-2M68 54l8 3" stroke="#8A6A5A" stroke-width="2" stroke-linecap="round"/>'
		)
	},
	{
		k: 'sakura',
		n: 'Cherry blossom',
		s: 84,
		svg: svg(
			'<g fill="#F7B6C8" stroke="#D96C8E" stroke-width="2.5" stroke-linejoin="round"><ellipse cx="40" cy="21" rx="12" ry="17"/><ellipse cx="40" cy="21" rx="12" ry="17" transform="rotate(72 40 40)"/><ellipse cx="40" cy="21" rx="12" ry="17" transform="rotate(144 40 40)"/><ellipse cx="40" cy="21" rx="12" ry="17" transform="rotate(216 40 40)"/><ellipse cx="40" cy="21" rx="12" ry="17" transform="rotate(288 40 40)"/></g><circle cx="40" cy="40" r="6" fill="#F6C94F" stroke="#B9801C" stroke-width="2"/>'
		)
	},
	{
		k: 'ghost',
		n: 'Ghost',
		s: 88,
		svg: svg(
			'<path d="M16 68V36a24 24 0 0148 0v32l-8-6-8 6-8-6-8 6-8-6z" fill="#fff" stroke="#6A528F" stroke-width="3" stroke-linejoin="round"/><ellipse cx="32" cy="38" rx="3" ry="4" fill="#2A1B3D"/><ellipse cx="48" cy="38" rx="3" ry="4" fill="#2A1B3D"/><circle cx="26" cy="46" r="3.4" fill="#F29B8B" opacity=".6"/><circle cx="54" cy="46" r="3.4" fill="#F29B8B" opacity=".6"/><ellipse cx="40" cy="48" rx="3" ry="3.4" fill="#2A1B3D"/>'
		)
	},
	{
		k: 'heart',
		n: 'Heart',
		s: 80,
		svg: svg(
			'<path d="M40 68S10 50 10 30a15 15 0 0130-6 15 15 0 0130 6c0 20-30 38-30 38z" fill="#F28CA8" stroke="#B93A63" stroke-width="3" stroke-linejoin="round"/><path d="M20 28q2-7 9-7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M62 10l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#F0C873"/>'
		)
	},
	{
		k: 'dango',
		n: 'Dango',
		s: 84,
		svg: svg(
			'<path d="M40 4v72" stroke="#B88A55" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="20" r="15" fill="#F7B6C8" stroke="#D96C8E" stroke-width="3"/><circle cx="40" cy="42" r="15" fill="#FFFDF7" stroke="#8F86C8" stroke-width="3"/><circle cx="40" cy="64" r="15" fill="#A9D4B8" stroke="#5E9873" stroke-width="3"/><circle cx="35" cy="42" r="1.8" fill="#3A2230"/><circle cx="45" cy="42" r="1.8" fill="#3A2230"/><path d="M37.5 46q2.5 2.5 5 0" fill="none" stroke="#3A2230" stroke-width="1.8" stroke-linecap="round"/>'
		)
	},
	{
		k: 'mushroom',
		n: 'Mushroom',
		s: 88,
		svg: svg(
			'<path d="M28 44h24v20q0 8-12 8t-12-8z" fill="#FFF3E3" stroke="#8A6A5A" stroke-width="3" stroke-linejoin="round"/><path d="M8 46a32 28 0 0164 0z" fill="#E8613C" stroke="#9B2D1A" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="32" r="5" fill="#fff"/><circle cx="46" cy="24" r="4" fill="#fff"/><circle cx="58" cy="36" r="4.5" fill="#fff"/><circle cx="36" cy="55" r="1.8" fill="#3A2230"/><circle cx="44" cy="55" r="1.8" fill="#3A2230"/>'
		)
	},
	{
		k: 'potion',
		n: 'Potion',
		s: 84,
		svg: svg(
			'<rect x="33" y="6" width="14" height="10" rx="3" fill="#B88A55" stroke="#7A5530" stroke-width="2.5"/><path d="M34 16v14L17 56a12 12 0 0010 18h26a12 12 0 0010-18L46 30V16z" fill="#F3ECFA" stroke="#6A528F" stroke-width="3" stroke-linejoin="round"/><path d="M20 54h40l2 4a10 10 0 01-9 14H27a10 10 0 01-9-14z" fill="#8B6FD0"/><circle cx="34" cy="58" r="3" fill="#C9B8E8"/><circle cx="46" cy="64" r="2.2" fill="#C9B8E8"/><path d="M60 14l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#F0C873"/>'
		)
	},
	{
		k: 'sparkle',
		n: 'Gold sparkle',
		s: 70,
		svg: svg(
			'<path d="M40 6l8 26 26 8-26 8-8 26-8-26-26-8 26-8z" fill="#F0C873" stroke="#B9801C" stroke-width="3" stroke-linejoin="round"/>'
		)
	},
	{
		k: 'cloud',
		n: 'Cloud',
		s: 100,
		svg: svg(
			'<path d="M22 60a15 15 0 01-2-30 19 19 0 0136-4 16 16 0 0110 34z" fill="#fff" stroke="#8F86C8" stroke-width="3" stroke-linejoin="round"/>' +
				face(40, 46, 9)
		)
	},
	{
		k: 'yay',
		n: 'Yay bubble',
		s: 100,
		svg: svg(
			'<path d="M12 14h56a8 8 0 018 8v22a8 8 0 01-8 8H44l-10 14-2-14H12a8 8 0 01-8-8V22a8 8 0 018-8z" fill="#fff" stroke="#6A528F" stroke-width="3" stroke-linejoin="round"/><text x="40" y="41" text-anchor="middle" font-family="Gaegu,cursive" font-weight="700" font-size="22" fill="#51397A">yay!</text>'
		)
	},
	{
		k: 'zzz',
		n: 'Zzz bubble',
		s: 100,
		svg: svg(
			'<path d="M12 14h56a8 8 0 018 8v22a8 8 0 01-8 8H44l-10 14-2-14H12a8 8 0 01-8-8V22a8 8 0 018-8z" fill="#E4D8F6" stroke="#6A528F" stroke-width="3" stroke-linejoin="round"/><text x="40" y="41" text-anchor="middle" font-family="Gaegu,cursive" font-weight="700" font-size="22" fill="#51397A">zzz</text>'
		)
	},
	{
		k: 'tape1',
		n: 'Lavender washi tape',
		s: 130,
		flat: true,
		svg: svg(
			'<rect x="2" y="28" width="76" height="24" fill="#C9B8E8" fill-opacity=".88"/><path d="M12 28v24M24 28v24M36 28v24M48 28v24M60 28v24M72 28v24" stroke="#fff" stroke-opacity=".5" stroke-width="4"/>'
		)
	},
	{
		k: 'tape2',
		n: 'Gold washi tape',
		s: 130,
		flat: true,
		svg: svg(
			'<rect x="2" y="28" width="76" height="24" fill="#F0C873" fill-opacity=".9"/><g fill="#fff" fill-opacity=".75"><circle cx="14" cy="40" r="3"/><circle cx="30" cy="40" r="3"/><circle cx="46" cy="40" r="3"/><circle cx="62" cy="40" r="3"/></g>'
		)
	}
];

export const STICKER_BY_KEY = Object.fromEntries(
	STICKERS.map((sticker) => [sticker.k, sticker])
) as Record<string, StickerDef>;
