export function isValidEmail(value: string): boolean {
	const clean = value.trim();
	if (!/^[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(clean)) return false;
	const [local, domain] = clean.split('@');
	if (!local || !domain) return false;
	if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
	if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
	return true;
}

export function validateSignupPassword(password: string, confirmation: string): string {
	if (password.length < 6) return 'Use a password with at least 6 characters.';
	if (password !== confirmation) return 'The two passwords do not match.';
	return '';
}
