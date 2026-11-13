// Keep this list in sync with `public.vidjo_censor_text()` in supabase/schema.sql.
// Comments are masked on the server; shared page text is masked when it is read
// by someone else. Private journal text and video audio are never censored.
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
	'douche',
	'douchebag',
	'dumbass',
	'faggot',
	'fuck',
	'fucked',
	'fucker',
	'fucking',
	'hell',
	'idiot',
	'jerk',
	'moron',
	'motherfucker',
	'nigger',
	'nigga',
	'penis',
	'piss',
	'prick',
	'pussy',
	'retard',
	'shit',
	'shitty',
	'slut',
	'tard',
	'twat',
	'wanker',
	'whore'
];

const OBSCENE_PATTERN = `\\b(${OBSCENE_WORDS.join('|')})\\b`;

// `replace` needs the global flag; a separate non-global regex keeps `.test()`
// stateless (`lastIndex` on a global regex makes repeated calls alternate).
const OBSCENE_REGEX = new RegExp(OBSCENE_PATTERN, 'gi');
const OBSCENE_TEST_REGEX = new RegExp(OBSCENE_PATTERN, 'i');

/** Mask profanity in text that other members can read. */
export function censor(text: string, replacement = '***') {
	return text.replace(OBSCENE_REGEX, replacement);
}

export function isObscene(text: string) {
	return OBSCENE_TEST_REGEX.test(text);
}
