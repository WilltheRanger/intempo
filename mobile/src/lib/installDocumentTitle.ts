/**
 * A phone has no browser tab to name. The web needs
 * `installDocumentTitle.web.ts`.
 */
export interface DocumentTitle {
  /** The navigation state changed. */
  changed(): void;
  dispose(): void;
}

export function installDocumentTitle(): DocumentTitle {
  return { changed() {}, dispose() {} };
}
