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

const OBSCENE_PATTERN = `\\b(${OBSCENE_WORDS.join('|')})\\b`;

// `replace` needs the global flag; a separate non-global regex keeps `.test()`
// stateless (`lastIndex` on a global regex makes repeated calls alternate).
const OBSCENE_REGEX = new RegExp(OBSCENE_PATTERN, 'gi');
const OBSCENE_TEST_REGEX = new RegExp(OBSCENE_PATTERN, 'i');

export function censor(text: string, replacement = '***') {
	return text.replace(OBSCENE_REGEX, replacement);
}

export function isObscene(text: string) {
	return OBSCENE_TEST_REGEX.test(text);
}
