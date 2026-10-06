/**
 * A reply that arrived and that this build of the app cannot read.
 *
 * Two ways in, one meaning. A successful response whose body is not JSON — an
 * HTML error page from a proxy, a host's placeholder — and a JSON body in a
 * shape `responseSchemas.ts` refuses. Both mean the request reached a server
 * and got an answer, so **the connection is the one thing known to be fine**,
 * and both used to reach the musician as "Check your connection and try
 * again": the first as a bare `SyntaxError`, the second as a plain `Error`,
 * and `describeLoadError` sends anything it does not recognise to the
 * connection. The real cause is usually a backend deployed ahead of or behind
 * the app, which settles on its own, so the sentence says to wait.
 *
 * `what` names the response for whoever is debugging; it was only ever
 * removed from the sentence.
 */
export const REPLY_UNREADABLE =
  "The server sent something this version of the app can't read. Try again shortly.";

export class UnreadableReplyError extends Error {
  constructor(
    readonly what: string,
    readonly cause?: unknown,
  ) {
    super(REPLY_UNREADABLE);
    this.name = 'UnreadableReplyError';
  }
}
