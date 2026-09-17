/**
 * The session could not be read — which is not the same as there not being one.
 *
 * Its own module, with no imports, so the API client can tell this error from
 * every other one with `instanceof` in a test that has not had to stand in for
 * `auth/session` and everything React Native it pulls behind it. A stand-in
 * class passes an `instanceof` test that the shipped code fails.
 *
 * Thrown rather than returned as null because null is what every caller reads
 * as "signed out": `apiFetch` signs the musician out on it, before it sends
 * anything. That is right when the store answered and had nothing, and wrong
 * when the store did not answer. See `sessionStore` for the measurement.
 */
export class SessionUnreadableError extends Error {
  constructor() {
    super('Could not read the stored session.');
    this.name = 'SessionUnreadableError';
  }
}
