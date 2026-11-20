import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyAuthError } from '../src/lib/authErrors.ts';

test('database signup failures point to the signup fix and Supabase logs', () => {
	assert.match(
		friendlyAuthError('Database error saving new user'),
		/apply the latest VidJo signup fix/
	);
	assert.match(friendlyAuthError('Database error saving new user'), /Supabase database logs/);
});
