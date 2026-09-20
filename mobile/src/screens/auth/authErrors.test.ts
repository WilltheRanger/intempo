import { describe, expect, it } from 'vitest';

import {
  describeAuthError,
  isEmail,
  MIN_PASSWORD_LENGTH,
  needsPassword,
  validate,
  validateNewPassword,
} from './authErrors';

/**
 * What a musician is told when they cannot get in.
 *
 * Ninety-two lines of pure copy on the first screen of the app, with no tests.
 * Every sentence here is one somebody reads at the moment they are already
 * stuck, and each of the decisions below is one a reasonable-looking edit would
 * undo.
 */

describe('validating the form before a round trip', () => {
  it('names the first thing wrong, not all of them', () => {
    // A form that reports three faults at once makes someone fix three things
    // before finding out whether the first was the problem.
    expect(validate('signIn', '', '')).toBe('Enter your email address.');
    expect(validate('signIn', 'not-an-address', '')).toBe(
      "That doesn't look like an email address.",
    );
    expect(validate('signIn', 'a@b.test', '')).toBe('Enter your password.');
  });

  it('asks for no password where none is used', () => {
    // A reset and a magic link send a link to an address. Asking for a
    // password would be asking for the thing the musician came here because
    // they do not have.
    expect(needsPassword('reset')).toBe(false);
    expect(needsPassword('magicLink')).toBe(false);
    expect(validate('reset', 'a@b.test', '')).toBeNull();
    expect(validate('magicLink', 'a@b.test', '')).toBeNull();
  });

  it('enforces the length on sign-up and not on sign-in', () => {
    // **The asymmetry is the point.** An account made before this minimum
    // existed — or under a different one — still has to be able to sign in.
    // Applying the rule to sign-in locks that person out of their own library
    // with a message about a password that is, in fact, their password.
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);

    expect(validate('signUp', 'a@b.test', short)).toContain(
      String(MIN_PASSWORD_LENGTH),
    );
    expect(validate('signIn', 'a@b.test', short)).toBeNull();
  });

  it('lets a ready form through', () => {
    expect(validate('signIn', 'a@b.test', 'password')).toBeNull();
    expect(validate('signUp', ' a@b.test ', 'password')).toBeNull();
  });
});

describe('the address check', () => {
  it('is deliberately loose', () => {
    // The address is verified by whether the mail arrives. Elaborate patterns
    // reject valid addresses — this exists to catch a missing @ before a round
    // trip, and nothing more.
    expect(isEmail('a@b.test')).toBe(true);
    expect(isEmail('  a@b.test  ')).toBe(true);
    expect(isEmail("o'brien+tag@sub.domain.example")).toBe(true);
  });

  it('still catches the mistakes it exists for', () => {
    expect(isEmail('nobody')).toBe(false);
    expect(isEmail('no@at')).toBe(false);
    expect(isEmail('two spaces@b.test')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});

describe('choosing a new password', () => {
  it('checks the length before the match', () => {
    // Two short passwords that agree are still too short, and saying so is
    // more useful than "those don't match" — which would be false.
    expect(validateNewPassword('abc', 'abc')).toContain(
      String(MIN_PASSWORD_LENGTH),
    );
  });

  it('catches a mistyped repeat', () => {
    expect(validateNewPassword('a-long-enough-one', 'a-long-enough-two')).toBe(
      "Those two passwords don't match.",
    );
  });

  it('accepts a long enough pair', () => {
    expect(validateNewPassword('correct-horse', 'correct-horse')).toBeNull();
  });
});

describe('the provider’s errors, reworded', () => {
  it('rewrites the ones worth rewriting', () => {
    expect(describeAuthError(new Error('Invalid login credentials'))).toBe(
      "That email and password don't match an account.",
    );
    expect(describeAuthError(new Error('Email not confirmed'))).toBe(
      'Confirm your email address first. Check your inbox for the link.',
    );
    expect(describeAuthError(new Error('Over email rate limit'))).toBe(
      'Too many attempts. Wait a minute and try again.',
    );
  });

  it('matches whatever case the provider sent', () => {
    // Supabase has changed the capitalisation of these strings before, and a
    // match that depended on it would silently stop rewriting — falling back
    // to the raw message, which is the failure that looks like nothing.
    expect(describeAuthError(new Error('INVALID LOGIN CREDENTIALS'))).toBe(
      "That email and password don't match an account.",
    );
  });

  it('passes an unmapped message through rather than flattening it', () => {
    // The module says why: "Something went wrong" hides the one detail that
    // lets someone fix it themselves. A message this file has never seen is
    // still the provider telling them something.
    expect(describeAuthError(new Error('Signups not allowed for this instance'))).toBe(
      'Signups not allowed for this instance',
    );
  });

  it('survives something that is not an Error at all', () => {
    // `catch` gives whatever was thrown. A rejected promise carrying a string
    // must not become "[object Object]" or crash the screen that renders it.
    expect(describeAuthError('Invalid login credentials')).toBe(
      "That email and password don't match an account.",
    );
    expect(describeAuthError(null)).toBe('null');
  });
});
