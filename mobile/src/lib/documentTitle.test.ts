import { describe, expect, it } from 'vitest';

import { formatDocumentTitle, titlesTheScreen, type TitleCandidate } from './documentTitle';

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
