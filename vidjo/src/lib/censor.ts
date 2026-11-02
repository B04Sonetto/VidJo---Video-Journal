const OBSCENE_WORDS = [
	'arse',
	'ass',
	'asshole',
	'bastard',
	'bitch',
	'bullshit',
	'crap',
	'cunt',
	'damn',
	'dick',
	'dickhead',
	'dumbass',
	'faggot',
	'hell',
	'idiot',
	'jerk',
	'moron',
	'nigger',
	'nigga',
	'penis',
	'piss',
	'prick',
	'pussy',
	'shit',
	'slut',
	'tard',
	'twat',
	'wanker'
];

const OBSCENE_REGEX = new RegExp(`\\b(${OBSCENE_WORDS.join('|')})\\b`, 'gi');

export function censor(text: string, replacement = '***') {
	return text.replace(OBSCENE_REGEX, replacement);
}

export function isObscene(text: string) {
	return OBSCENE_REGEX.test(text);
}
