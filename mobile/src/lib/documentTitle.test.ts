import { describe, expect, it } from 'vitest';

import { formatDocumentTitle } from './documentTitle';

describe('formatDocumentTitle', () => {
  it('keeps a useful product title when no navigation route is mounted', () => {
    expect(formatDocumentTitle()).toBe('InTempo');
  });
});
