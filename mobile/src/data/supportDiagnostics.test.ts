import { describe, expect, it, vi } from 'vitest';

import { checkAppConnection } from './supportDiagnostics';

describe('checkAppConnection', () => {
  it('checks the public service before the signed-in account', async () => {
    const request = vi.fn().mockResolvedValue({});

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'connected',
    });
    expect(request.mock.calls).toEqual([
      ['/v1/health', { authenticated: false }],
      ['/v1/me'],
    ]);
  });

  it('stops at health when the service cannot be reached', async () => {
    const request = vi.fn().mockRejectedValue(new Error('No connection'));

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'service_unreachable',
      message: 'No connection',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an ended session from a service outage', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(
        Object.assign(new Error('Your session has ended.'), { status: 401 }),
      );

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'session_ended',
    });
  });

  it('reports an account failure after health succeeds', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Account service unavailable'));

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'account_unreachable',
      message: 'Account service unavailable',
    });
  });
});
