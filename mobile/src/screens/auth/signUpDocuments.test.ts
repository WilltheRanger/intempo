import { describe, expect, it } from 'vitest';

import { DOCUMENTS } from '../../lib/legal';
import { SIGN_UP_DOCUMENTS } from './signUpDocuments';

describe('documents available before account creation', () => {
  it('offers both the privacy policy and the terms', () => {
    expect(SIGN_UP_DOCUMENTS.map((document) => document.id)).toEqual([
      'terms',
      'privacy',
    ]);
  });

  it('opens the same current documents the signed-in Profile shows', () => {
    for (const link of SIGN_UP_DOCUMENTS) {
      expect(DOCUMENTS[link.id]).toBeDefined();
      expect(DOCUMENTS[link.id].sections.length).toBeGreaterThan(0);
    }
  });
});
