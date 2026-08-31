/**
 * The name shown in a browser tab.
 *
 * React Navigation derives a title from the focused route by default. Signed
 * out, InTempo renders the auth gate outside a navigator, so there is no
 * focused route and the default formatter writes the string "undefined" into
 * the tab. The product name is useful in every state and never depends on a
 * route, so keep it stable.
 */
export function formatDocumentTitle(): string {
  return 'InTempo';
}
