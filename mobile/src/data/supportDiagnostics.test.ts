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
      ['/v1/ready', { authenticated: false }],
      ['/v1/me'],
    ]);
  });

  it('does not call a partly configured deployment connected', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok' })
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed (503)'), {
          status: 503,
          detail: {
            ready: false,
            blocking: ['migration 013', 'migration 014', 'migration 015'],
          },
        }),
      );

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'service_unready',
      message: '3 required parts of the practice service are not ready.',
    });
    expect(request.mock.calls).toEqual([
      ['/v1/health', { authenticated: false }],
      ['/v1/ready', { authenticated: false }],
    ]);
  });

  it('keeps deployment internals out of an unready message', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok' })
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed (503)'), {
          status: 503,
          detail: { ready: false, blocking: ['apply migration 015_*.sql'] },
        }),
      );

    const report = await checkAppConnection(request);

    expect(report).toEqual({
      kind: 'service_unready',
      message: 'One required part of the practice service is not ready.',
    });
    expect(JSON.stringify(report)).not.toContain('migration');
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
      .mockResolvedValueOnce({ ready: true })
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
      .mockResolvedValueOnce({ ready: true })
      .mockRejectedValueOnce(new Error('Account service unavailable'));

    await expect(checkAppConnection(request)).resolves.toEqual({
      kind: 'account_unreachable',
      message: 'Account service unavailable',
    });
  });
});
