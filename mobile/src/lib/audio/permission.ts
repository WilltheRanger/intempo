/**
 * The recovery offered after the microphone prompt has been refused.
 *
 * A browser owns site permissions behind its address bar; the app cannot open
 * that panel. Native permissions live in the app's operating-system settings,
 * which React Native can open directly. Keeping the distinction here prevents
 * a recording screen from telling a web user to look for a device setting or
 * leaving a phone user to find Settings unaided.
 *
 * **The one failure the app genuinely cannot fix**, so it stops apologising and
 * gives directions — and a set of directions is a sequence, which is why these
 * are `steps` rather than one comma-spliced sentence. They are followed on a
 * phone with a permissions panel open on top of the app, a line at a time, and
 * this is the only place in the product where a numbered list earns its keep.
 *
 * `message` is the same instructions as one line, built from the parts rather
 * than written twice: it is what a screen reader is given, what
 * `readTakeFailure` carries, and what `device-check.mjs` looks for on a real
 * device. Two copies of this copy is how one of them comes to be wrong.
 */

export interface MicrophoneRecovery {
  /** What is happening, in one clause. */
  headline: string;
  /** What to do, in order. */
  steps: [string, string, string];
  /** The same thing as one sentence — see above. */
  message: string;
  canOpenSettings: boolean;
}

/** "Headline. First, second, then third." */
function asSentence(headline: string, steps: readonly string[]): string {
  const [first, ...rest] = steps;
  const tail = rest.map((step) => step.charAt(0).toLowerCase() + step.slice(1));
  return `${headline} ${first}, ${tail.slice(0, -1).join(', ')}${
    tail.length > 1 ? ', ' : ''
  }then ${tail[tail.length - 1]}.`;
}

export function microphonePermissionRecovery(os: string): MicrophoneRecovery {
  if (os === 'web') {
    const headline = 'Your browser is blocking the microphone.';
    const steps: [string, string, string] = [
      'Open the site controls beside the address',
      'Allow Microphone',
      'Press Start again',
    ];
    return {
      headline,
      steps,
      message: asSentence(headline, steps),
      canOpenSettings: false,
    };
  }

  const headline = 'InTempo needs microphone access.';
  const steps: [string, string, string] = [
    'Open Settings',
    'Allow Microphone for InTempo',
    'Return and press Start again',
  ];
  return {
    headline,
    steps,
    message: asSentence(headline, steps),
    canOpenSettings: true,
  };
}
