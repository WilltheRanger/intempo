import { describe, expect, it } from 'vitest';

import { countInIsOver, countInOutputs, metronomeRuns, takeOutputs } from './countIn';

describe('countInOutputs', () => {
  it('ticks and taps even when the metronome is off', () => {
    // **The whole point.** A count-in is not the metronome feature; it is how
    // a take starts, and starting without one means guessing the downbeat.
    expect(countInOutputs(true)).toEqual({ click: true, haptic: true, emphasis: true });
  });

  it('respects the profile switch for haptics, and only that', () => {
    // Taps off across the app means off here. The count is still audible and
    // still on the screen, so nothing is lost that was not chosen.
    expect(countInOutputs(false)).toEqual({ click: true, haptic: false, emphasis: true });
  });
});

describe('takeOutputs inside a written rest', () => {
  /*
   * **A rest is where the count is easiest to lose**, because there is no
   * sound of your own to hold the place against. A tap is the one output that
   * can help there for free: haptics are not recorded, so nothing about the
   * take changes.
   */
  it('taps through a rest even when the mode would not', () => {
    expect(takeOutputs('visual', true, { resting: true })).toEqual({
      click: false,
      haptic: true,
      emphasis: true,
    });
  });

  it('still obeys the profile switch, which is the musician saying no', () => {
    expect(takeOutputs('visual', false, { resting: true }).haptic).toBe(false);
  });

  /*
   * **The one output a rest must not widen.** The module docstring above is
   * the reason and it holds inside a rest as much as outside: the speaker is
   * open to the microphone, and a click in a bar the score says is silent
   * reads as a note played during a rest. `alignment.py` has to know the
   * metronome was audible before that can be safe, and it does not yet.
   */
  it('does not start clicking out loud just because the bar is silent', () => {
    expect(takeOutputs('visual', true, { resting: true }).click).toBe(false);
    expect(takeOutputs('haptic', true, { resting: true }).click).toBe(false);
    expect(takeOutputs('off', true, { resting: true }).click).toBe(false);
  });

  it('marks the pulse for emphasis only while resting', () => {
    expect(takeOutputs('haptic', true).emphasis).toBe(false);
    expect(takeOutputs('haptic', true, { resting: false }).emphasis).toBe(false);
    expect(takeOutputs('haptic', true, { resting: true }).emphasis).toBe(true);
  });
});

describe('takeOutputs', () => {
  it('clicks during a take only when the musician said headphones', () => {
    // `alignment.py` measures every onset from the first one it detects, so a
    // click over the speaker becomes the note the take is judged against.
    // Nothing here can check for headphones; the mode is the assertion.
    expect(takeOutputs('audio_with_headphones', true).click).toBe(true);
    expect(takeOutputs('haptic', true).click).toBe(false);
    expect(takeOutputs('visual', true).click).toBe(false);
    expect(takeOutputs('off', true).click).toBe(false);
  });

  it('taps during a take only in haptic mode, and only if haptics are on', () => {
    expect(takeOutputs('haptic', true).haptic).toBe(true);
    expect(takeOutputs('haptic', false).haptic).toBe(false);
    expect(takeOutputs('audio_with_headphones', true).haptic).toBe(false);
  });

  it('differs from the count-in for every mode but the audible one', () => {
    // If these ever agree, the count-in has stopped being a count-in.
    for (const mode of ['off', 'visual', 'haptic'] as const) {
      expect(takeOutputs(mode, true)).not.toEqual(countInOutputs(true));
    }
  });
});

describe('metronomeRuns', () => {
  it('runs through a count-in with the metronome off', () => {
    expect(metronomeRuns('off', { countingIn: true, capturing: true })).toBe(true);
  });

  it('stops after the count-in when the metronome is off', () => {
    expect(metronomeRuns('off', { countingIn: false, capturing: true })).toBe(false);
  });

  it('keeps running through the take when the metronome is on', () => {
    expect(metronomeRuns('haptic', { countingIn: false, capturing: true })).toBe(true);
  });

  it('never runs when nothing is being captured', () => {
    expect(metronomeRuns('haptic', { countingIn: true, capturing: false })).toBe(false);
  });
});

describe('when the count is up', () => {
  /*
   * **The trigger for `discardCapturedSoFar()`**, which decides where a
   * musician's file starts. It lived in `RecordScreen.tsx` until now, in the
   * layer this project has no way to render — and eight of the nine findings
   * in the capture-path audit were rules inside a `.tsx`.
   *
   * Every way of getting it wrong is silent. There is no error, no log and no
   * visible difference on the screen; the take simply comes back describing
   * playing that did not happen.
   */
  const FOUR = { countingIn: true, countInBeats: 4 };

  it('is not up on the last beat of the count', () => {
    // One beat early leaves the final click in the capture. It is the loudest
    // thing in the file and the first onset in it, so `alignment.py` anchors
    // the whole take to the metronome instead of to the music.
    expect(countInIsOver({ ...FOUR, beatIndex: 3 })).toBe(false);
  });

  it('is up on the downbeat', () => {
    // Beat N is the downbeat after N count-in beats — 0, 1, 2, 3 are the
    // count, 4 is the first note.
    expect(countInIsOver({ ...FOUR, beatIndex: 4 })).toBe(true);
  });

  it('is up on a beat after the downbeat, not only exactly on it', () => {
    // **`>=`, not `===`.** The index this reads is a rendered value, so two
    // beats can arrive inside one render — a slow frame, a coalesced update, a
    // fast tempo. With `===` the count-in would then never end: the recorder
    // keeps the pre-roll, the screen stays counting, and the musician plays
    // into a take that has not started. Firing late is recoverable; not firing
    // is not.
    expect(countInIsOver({ ...FOUR, beatIndex: 5 })).toBe(true);
    expect(countInIsOver({ ...FOUR, beatIndex: 41 })).toBe(true);
  });

  it('is never up once the take is running', () => {
    // Without this guard it fires on every beat of the take, discarding the
    // music continuously, and the file comes back empty.
    for (const beatIndex of [0, 4, 5, 100]) {
      expect(countInIsOver({ countingIn: false, countInBeats: 4, beatIndex })).toBe(false);
    }
  });

  it('is not up before the clock has said anything', () => {
    // `null` is the state between arming the metronome and its first beat.
    // Reading it as 0 would end a count-in that has not started.
    expect(countInIsOver({ ...FOUR, beatIndex: null })).toBe(false);
  });

  it('follows the metre rather than assuming four', () => {
    // `countInPulses` is the first bar's felt pulses — three in a waltz, two
    // in a march, six in 6/8 read in six. A hard four would count a bar and a
    // third of a waltz before the downbeat.
    expect(countInIsOver({ countingIn: true, countInBeats: 3, beatIndex: 2 })).toBe(false);
    expect(countInIsOver({ countingIn: true, countInBeats: 3, beatIndex: 3 })).toBe(true);
    expect(countInIsOver({ countingIn: true, countInBeats: 6, beatIndex: 5 })).toBe(false);
    expect(countInIsOver({ countingIn: true, countInBeats: 6, beatIndex: 6 })).toBe(true);
  });
});
