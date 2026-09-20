/** Supabase's minimum. Checked here so a short password fails before a round trip. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Deliberately loose. The address is verified by whether the confirmation mail
 * arrives, not by a regular expression — the elaborate ones reject valid
 * addresses, and this only exists to catch a missing @ before a round trip.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthMode = 'signIn' | 'signUp' | 'reset' | 'magicLink';

/** Modes that send a link to an address rather than taking a password. */
const LINK_MODES: ReadonlySet<AuthMode> = new Set<AuthMode>(['reset', 'magicLink']);

export function needsPassword(mode: AuthMode): boolean {
  return !LINK_MODES.has(mode);
}

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** The first thing wrong with the form, or null when it's ready to send. */
export function validate(
  mode: AuthMode,
  email: string,
  password: string,
): string | null {
  if (!email.trim()) {
    return 'Enter your email address.';
  }
  if (!isEmail(email)) {
    return "That doesn't look like an email address.";
  }
  if (!needsPassword(mode)) {
    return null;
  }
  if (!password) {
    return 'Enter your password.';
  }
  if (mode === 'signUp' && password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** The first thing wrong with a new password, or null. */
export function validateNewPassword(
  password: string,
  repeated: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== repeated) {
    return "Those two passwords don't match.";
  }
  return null;
}

/**
 * Supabase's errors in a musician's words.
 *
 * Only the ones worth rewording are mapped; anything else is passed through
 * rather than flattened into "Something went wrong", which would hide the one
 * detail that lets someone fix it themselves.
 */
export function describeAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.toLowerCase();

  if (message.includes('invalid login credentials')) {
    return "That email and password don't match an account.";
  }
  if (message.includes('email not confirmed')) {
    return 'Confirm your email address first. Check your inbox for the link.';
  }
  if (message.includes('user already registered')) {
    return 'There is already an account with that address. Sign in instead.';
  }
  if (message.includes('same as the old password')) {
    return 'That is already your password. Choose a different one.';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return "Couldn't reach the server. Check your connection.";
  }
  return raw;
}
