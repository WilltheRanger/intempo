import type { MetronomeMode } from '../../data/types';

/**
 * What can be checked before a take, and what honestly cannot.
 *
 * The Pre-flight frame turns the one-time tips interstitial into live state:
 * rather than telling a musician three things to remember, tell them what is
 * true of *this* take right now. The rule lives here rather than in the screen
 * because `CLAUDE.md` §3 asks for that, and because "does this warn when it
 * should" is exactly the kind of thing that is wrong in one direction for a
 * month without anyone noticing.
 *
 * **The microphone is deliberately not one of these.** Reading a live level
 * needs an open stream, and opening one prompts for permission — which
 * `PracticeSetup` has always refused to do here, because the system prompt
 * belongs to Start, after a musician has been told why the microphone is
 * needed. A check that costs the thing it is checking is not a check. What is
 * reported instead is what the *last* take heard, which needs nothing.
 */

export type CheckTone = 'ok' | 'warn';

export interface PreflightCheck {
  id: 'bleed' | 'start' | 'microphone';
  tone: CheckTone;
  title: string;
  detail: string;
  /** Present when the musician can resolve it from this screen. */
  action?: { label: string; to: 'startBar' | 'metronome' };
}

export interface PreflightInput {
  metronomeMode: MetronomeMode;
  /** The bar the take will start from. */
  startFrom: number;
  /** The first bar that actually sounds — `startableMeasures`' first entry. */
  firstSoundingBar: number;
  /** Whether the previous take on this device heard anything at all. */
  lastTakeHeardSound: boolean | null;
}

/**
 * Whether the metronome will end up inside the recording.
 *
 * Audio-with-headphones is the only mode that plays aloud, and its name is a
 * promise the app cannot keep: it has no way to know headphones are plugged
 * in. So it is named as the risk it is rather than trusted.
 */
export function speakerBleed(mode: MetronomeMode): PreflightCheck {
  if (mode === 'audio_with_headphones') {
    return {
      id: 'bleed',
      tone: 'warn',
      title: 'The metronome will play out loud',
      detail:
        'Without headphones the microphone hears every click, and each one looks '
        + 'like a note you played. Use headphones, or switch to visual or haptic.',
      action: { label: 'Change it', to: 'metronome' },
    };
  }
  return {
    id: 'bleed',
    tone: 'ok',
    title: 'Nothing will play out loud',
    detail:
      mode === 'off'
        ? 'The metronome is off, so only your playing reaches the microphone.'
        : 'The metronome is silent, so only your playing reaches the microphone.',
  };
}

/**
 * Whether the take is about to start on bars that have nothing in them.
 *
 * The commonest silent waste of an analysis: a part whose first six bars are
 * rest, recorded from bar 1, so the take opens with six bars of a room. This
 * is the check the app could always have made and never did.
 */
export function startBar({
  startFrom,
  firstSoundingBar,
}: Pick<PreflightInput, 'startFrom' | 'firstSoundingBar'>): PreflightCheck {
  if (startFrom < firstSoundingBar) {
    const bars = firstSoundingBar - startFrom;
    return {
      id: 'start',
      tone: 'warn',
      title: `Starting ${bars} ${bars === 1 ? 'bar' : 'bars'} before the first note`,
      detail:
        `Bar ${firstSoundingBar} is where this part begins. Starting at ${startFrom} `
        + 'records the rest as well, and a long silence is harder to line up, not easier.',
      action: { label: `Start at bar ${firstSoundingBar}`, to: 'startBar' },
    };
  }
  return {
    id: 'start',
    tone: 'ok',
    title: `Starting at bar ${startFrom}`,
    detail:
      startFrom === firstSoundingBar
        ? 'The first bar with a note in it.'
        : 'Counted in for one full bar before it.',
  };
}

/**
 * What the last take heard — the only thing about the microphone that is
 * knowable without asking for it.
 *
 * `null` on a device that has not recorded yet, which is not a warning: there
 * is nothing wrong, there is simply nothing to report.
 */
export function microphone(heard: boolean | null): PreflightCheck | null {
  if (heard === null) return null;
  return heard
    ? {
        id: 'microphone',
        tone: 'ok',
        title: 'The microphone worked last time',
        detail: 'Your last take on this device had sound in it.',
      }
    : {
        id: 'microphone',
        tone: 'warn',
        title: 'Your last take came back silent',
        detail:
          'Check the microphone is not muted or covered before you play this one.',
      };
}

/** Every check that applies, warnings first — a musician reads the top. */
export function preflight(input: PreflightInput): PreflightCheck[] {
  const checks = [
    microphone(input.lastTakeHeardSound),
    startBar(input),
    speakerBleed(input.metronomeMode),
  ].filter((check): check is PreflightCheck => check !== null);

  return [
    ...checks.filter((check) => check.tone === 'warn'),
    ...checks.filter((check) => check.tone === 'ok'),
  ];
}

/** Whether anything here is worth a musician's attention before they play. */
export function hasWarning(checks: PreflightCheck[]): boolean {
  return checks.some((check) => check.tone === 'warn');
}
