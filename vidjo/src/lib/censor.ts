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

// Characters that are commonly swapped in for a letter ("sh!t", "f*ck", "b1tch").
// Digits are only used for vowels so plain numbers ("455") never match.
// Keep in sync with `public.vidjo_word_pattern()` in supabase/schema.sql.
const LOOKALIKES: Record<string, string> = {
	a: 'a4@*',
	e: 'e3*',
	i: 'i1!*|',
	o: 'o0*',
	u: 'u*v',
	s: 's$'
};

/**
 * Each letter may be repeated ("sweaaaaars", "shiiiit") or swapped for a
 * lookalike symbol. The word must stand alone, so "class" or "hello" are safe.
 */
function wordPattern(word: string) {
	return word
		.split('')
		.map((letter) => `[${LOOKALIKES[letter] ?? letter}]+`)
		.join('');
}

const OBSCENE_PATTERN = `(?<![a-z0-9])(?:${OBSCENE_WORDS.map(wordPattern).join('|')})(?![a-z0-9])`;

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

// ---------------------------------------------------------------------------
// Usernames
// ---------------------------------------------------------------------------
// Names are short and have no spaces, so they get a stricter check: separators
// are stripped ("f.u.c.k"), lookalikes are swapped back, and repeated letters
// are collapsed ("fuuuck"). Keep in sync with `public.vidjo_is_obscene_name()`.

const NAME_LOOKALIKES: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'8': 'b',
	'@': 'a',
	$: 's',
	'!': 'i'
};

// Strong words are blocked anywhere inside a username. Short or ordinary words
// ("ass", "hell", "damn") are only blocked when they are the whole username.
const STRONG_NAME_STEMS = [
	'fuck',
	'shit',
	'cunt',
	'bitch',
	'pussy',
	'whore',
	'slut',
	'faggot',
	'retard',
	'penis',
	'bastard',
	'asshole',
	'wanker',
	'twat',
	'prick',
	'dickhead',
	'douche',
	'bullshit',
	'motherfucker'
];

function normalizeName(value: string) {
	return value
		.toLowerCase()
		.replace(/[0134578@$!]/g, (char) => NAME_LOOKALIKES[char] ?? char)
		.replace(/[^a-z]/g, '');
}

function collapseRepeats(value: string) {
	return value.replace(/(.)\1+/g, '$1');
}

export function isObsceneName(value: string) {
	const plain = normalizeName(value);
	if (!plain) return false;
	const collapsed = collapseRepeats(plain);

	if (plain.includes('nigg')) return true;

	for (const stem of STRONG_NAME_STEMS) {
		if (plain.includes(stem) || collapsed.includes(collapseRepeats(stem))) return true;
	}

	return OBSCENE_WORDS.some((word) => plain === word || collapsed === collapseRepeats(word));
}
