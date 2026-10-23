import { describe, expect, it } from 'vitest';

import {
  changesTheTitle,
  formatDocumentTitle,
  titlesTheScreen,
  type ChangedNode,
  type PageChange,
  type TitleCandidate,
} from './documentTitle';

describe('formatDocumentTitle', () => {
  it('keeps a useful product title when there is no screen title', () => {
    expect(formatDocumentTitle()).toBe('InTempo');
    expect(formatDocumentTitle(null)).toBe('InTempo');
    expect(formatDocumentTitle('  ')).toBe('InTempo');
  });

  it('puts the screen first, then the product', () => {
    expect(formatDocumentTitle('Your takes')).toBe('Your takes – InTempo');
  });

  it('reads a title drawn over two lines as one', () => {
    expect(formatDocumentTitle('Sonata No. 1\n in G minor ')).toBe('Sonata No. 1 in G minor – InTempo');
  });

  it('does not say the product twice', () => {
    expect(formatDocumentTitle('InTempo')).toBe('InTempo');
  });
});

describe('titlesTheScreen', () => {
  const root = { id: 'root' };
  const coveredScreen = { id: 'screen' };
  const heading = (
    over: Partial<{ inert: unknown; hidden: boolean; visible: boolean; connected: boolean }> = {},
  ): TitleCandidate => ({
    isConnected: over.connected ?? true,
    closest: (selector: string) =>
      selector === '[inert]' ? (over.inert ?? null) : over.hidden ? {} : null,
    checkVisibility: () => over.visible ?? true,
  });

  it('is the heading of the screen showing', () => {
    expect(titlesTheScreen(heading(), root)).toBe(true);
  });

  it('still is while a sheet makes the whole app inert', () => {
    expect(titlesTheScreen(heading({ inert: root }), root)).toBe(true);
  });

  it('is not the heading of a screen the stack has covered', () => {
    expect(titlesTheScreen(heading({ inert: coveredScreen }), root)).toBe(false);
  });

  it('is not a hidden, invisible or detached heading', () => {
    expect(titlesTheScreen(heading({ hidden: true }), root)).toBe(false);
    expect(titlesTheScreen(heading({ visible: false }), root)).toBe(false);
    expect(titlesTheScreen(heading({ connected: false }), root)).toBe(false);
  });
});

describe('changesTheTitle', () => {
  const HEADINGS = 'h1, h2';

  /** An element, inside a heading or not, holding one or not. */
  const element = (
    over: Partial<{ inHeading: boolean; isHeading: boolean; holdsHeading: boolean }> = {},
  ): ChangedNode => ({
    nodeType: 1,
    parentElement: null,
    closest: () => (over.inHeading || over.isHeading ? {} : null),
    matches: () => over.isHeading ?? false,
    querySelector: () => (over.holdsHeading ? {} : null),
  });
  const text = (parent: ChangedNode): ChangedNode => ({ nodeType: 3, parentElement: parent });
  const change = (
    target: ChangedNode,
    added: ChangedNode[] = [],
    removed: ChangedNode[] = [],
  ): PageChange => ({ target, addedNodes: added, removedNodes: removed });

  it('ignores a drawing added where no heading is', () => {
    // A Library tile: hundreds of SVG nodes appended to a view, none a heading.
    expect(changesTheTitle([change(element(), [element()])], HEADINGS)).toBe(false);
  });

  it('sees the text of a heading change', () => {
    // A rename: React rewrites the text node in place.
    expect(changesTheTitle([change(text(element({ inHeading: true })))], HEADINGS)).toBe(true);
  });

  it('sees a heading’s children replaced', () => {
    expect(changesTheTitle([change(element({ isHeading: true }), [text(element())])], HEADINGS)).toBe(
      true,
    );
  });

  it('sees a screen arrive with its heading, or leave with it', () => {
    const screen = element({ holdsHeading: true });

    expect(changesTheTitle([change(element(), [screen])], HEADINGS)).toBe(true);
    expect(changesTheTitle([change(element(), [], [screen])], HEADINGS)).toBe(true);
  });

  it('sees a heading added on its own', () => {
    expect(changesTheTitle([change(element(), [element({ isHeading: true })])], HEADINGS)).toBe(true);
  });

  it('ignores text changed outside every heading', () => {
    // A timer, a count, a playhead's bar number: frequent, and never the title.
    expect(changesTheTitle([change(text(element()))], HEADINGS)).toBe(false);
  });

  it('looks through the whole batch', () => {
    expect(
      changesTheTitle(
        [change(element(), [element()]), change(text(element({ inHeading: true })))],
        HEADINGS,
      ),
    ).toBe(true);
  });
});
