import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/session', () => ({
  getAccessToken: () => Promise.resolve('token'),
  signOut: async () => {},
}));

import { postCorrections } from './corrections';

/**
 * What the server is sent when a musician answers "What did you hear?".
 *
 * The body was `JSON.stringify`-ed here and again in `apiFetch`, so the API
 * received a JSON string, refused it as invalid (422), and the prompt said
 * "Something went wrong at our end" on every tap. `verdict_corrections` was
 * still empty for every account the day the owner first tried it.
 */
describe('postCorrections', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the corrections as a JSON object, encoded once', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: init.body });
        return new Response('[]', { status: 201 });
      }),
    );

    await postCorrections('de5493f3-5267-4046-a24b-d6a623ba116c', [
      { measure_number: 22, app_verdict: 'dragging', user_verdict: 'dragging' },
    ]);

    const post = sent.find(({ url }) => url.endsWith('/corrections'));
    expect(post).toBeDefined();
    expect(JSON.parse(post!.body as string)).toEqual({
      corrections: [
        { measure_number: 22, app_verdict: 'dragging', user_verdict: 'dragging' },
      ],
    });
  });
});
