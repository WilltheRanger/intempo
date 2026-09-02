/**
 * The recovery offered after the microphone prompt has been refused.
 *
 * A browser owns site permissions behind its address bar; the app cannot open
 * that panel. Native permissions live in the app's operating-system settings,
 * which React Native can open directly. Keeping the distinction here prevents
 * a recording screen from telling a web user to look for a device setting or
 * leaving a phone user to find Settings unaided.
 */
export function microphonePermissionRecovery(os: string): {
  message: string;
  canOpenSettings: boolean;
} {
  if (os === 'web') {
    return {
      message:
        'Your browser is blocking the microphone. Open the site controls beside the address, allow Microphone, then press Start again.',
      canOpenSettings: false,
    };
  }

  return {
    message:
      'InTempo needs microphone access. Open Settings, allow Microphone for InTempo, then return and press Start again.',
    canOpenSettings: true,
  };
}
