import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidEmail, validateSignupPassword } from '../src/lib/authValidation.ts';

test('email validation trims input and rejects malformed addresses', () => {
	assert.equal(isValidEmail('  person@example.com  '), true);
	assert.equal(isValidEmail('person..name@example.com'), false);
	assert.equal(isValidEmail('person@.example.com'), false);
	assert.equal(isValidEmail('not-an-email'), false);
});

test('signup password validation enforces length and confirmation', () => {
	assert.equal(
		validateSignupPassword('short', 'short'),
		'Use a password with at least 6 characters.'
	);
	assert.equal(
		validateSignupPassword('long-enough', 'different'),
		'The two passwords do not match.'
	);
	assert.equal(validateSignupPassword('long-enough', 'long-enough'), '');
});
