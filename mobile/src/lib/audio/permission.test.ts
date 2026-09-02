import { describe, expect, it } from 'vitest';

import { microphonePermissionRecovery } from './permission';
import recordScreenSource from '../../screens/record/RecordScreen?raw';

describe('microphone permission recovery', () => {
  it('points a browser to the permission attached to the site', () => {
    const recovery = microphonePermissionRecovery('web');

    expect(recovery.canOpenSettings).toBe(false);
    expect(recovery.message).toMatch(/browser/i);
    expect(recovery.message).toMatch(/site controls/i);
    expect(recovery.message).toMatch(/microphone/i);
    expect(recovery.message).not.toMatch(/device settings/i);
  });

  it.each(['ios', 'android'])('offers the real Settings route on %s', (os) => {
    const recovery = microphonePermissionRecovery(os);

    expect(recovery.canOpenSettings).toBe(true);
    expect(recovery.message).toMatch(/open settings/i);
    expect(recovery.message).toMatch(/press start again/i);
  });

  it('wires the native recovery to the operating-system settings screen', () => {
    expect(recordScreenSource).toContain('Linking.openSettings()');
    expect(recordScreenSource).toContain('label="Open microphone settings"');
    expect(recordScreenSource).toContain("Platform.OS !== 'web'");
  });
});
