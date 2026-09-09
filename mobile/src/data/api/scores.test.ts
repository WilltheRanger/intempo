import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client', () => ({ apiFetch }));

import { listScores } from './scores';

describe('asking for the library without the notation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([]);
  });

  it('says nothing when the notation is wanted, so an older server is unchanged', () => {
    // The parameter defaults to true on the server. Sending `true` explicitly
    // would be harmless there and is still the wrong instinct: a deployment
    // that has never heard of the name is what this has to keep working, and
    // the way to do that is not to mention it. Same rule as `include_result`.
    void listScores({ limit: 5 });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).not.toContain('include_score');
  });

  it('asks the server not to send it, rather than throwing it away here', () => {
    // The saving is the database read and the transfer, not the parse. Asking
    // for it and discarding it would leave the expensive half exactly where it
    // was, which is the whole reason this is a query parameter and not a
    // `delete row.score_json` in the mapper.
    void listScores({ limit: 5, includeScore: false });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toContain('include_score=false');
  });

  it('still carries the page it was asked for', () => {
    void listScores({ limit: 25, offset: 50, includeScore: false });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toContain('limit=25');
    expect(path).toContain('offset=50');
  });
});
