import { describe, expect, it } from 'vitest';

/**
 * Every path that opens the microphone asks for the capture category first.
 *
 * **The complement of `session.reach.test.ts`, and the load-bearing half.**
 * That file holds "everything that makes a sound asks for the session", which
 * protects a phone whose ring switch is off. This one holds the other
 * direction, and it protects something worse: WebKit refuses capture outright
 * while the page is declared `playback`, **for the life of the document**, and
 * `App.tsx` declares exactly that at boot so the app is audible.
 *
 * That is the failure that cost six diagnoses over two days — see the
 * recording path in `docs/subsystems.md`. The fix is that capture re-declares
 * `play-and-record` immediately before it opens the microphone, which is what
 * makes any number of playback calls harmless: the metronome, the score
 * player, and now the held-take control on the record screen itself all leave
 * `playback` behind, and the next take replaces it.
 *
 * **So the invariant is on the capture side, and nothing checked it.** Add a
 * second `getUserMedia` anywhere — a level meter, a tuner, a second recorder
 * — and every take after it fails on iOS, silently, with an error name whose
 * obvious reading is something else entirely.
 *
 * **No browser in this container can catch it.** `navigator.audioSession` does
 * not exist in Chromium, so the walk and the sweeps pass on a build that
 * cannot record on any iPhone; and the WebKit `docs/subsystems.md` points at
 * is not installed here — `/opt/pw-browsers` holds Chromium and ffmpeg only.
 * A source check is what is left.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

const globbed: Record<string, string> = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Keyed from `src/`, the way `session.reach.test.ts` resolves them. */
const files: Record<string, string> = Object.fromEntries(
  Object.entries(globbed).map(([key, source]) => {
    const at = ['src', 'lib', 'audio'];
    for (const segment of key.split('/')) {
      if (segment === '..') {
        at.pop();
      } else if (segment !== '.') {
        at.push(segment);
      }
    }
    return [at.join('/'), source];
  }),
);

/** Opening the microphone. The camera's own call is `video`-only and excused. */
const OPENS_THE_MICROPHONE = 'getUserMedia(';
const ASKS_FOR_THE_CATEGORY = 'prepareForCapture';

/**
 * Files that really open a microphone and are excused from declaring first.
 *
 * **Empty, and that is the finding.** With comments stripped there is exactly
 * one call site in the app — `audioRecorder.web.ts` — and it declares the
 * category. The first draft of this list had five entries and every one of
 * them was a file that merely *discusses* `getUserMedia` in prose: the session
 * module quoting the WebKit guard, `microphoneFailure` reading the error a
 * refused capture threw, the `AudioContext` four wrong fixes went to, the
 * scanner's video permission, and the reload button's note about what a reload
 * does not fix. An excuse for a rule a file does not trip reads as coverage.
 *
 * Kept rather than deleted, with three checks over it, so a genuine exception
 * has somewhere to go and cannot rot once it is there.
 */
const EXCUSED: Record<string, string> = {};

/**
 * The modules that *define* `prepareForCapture`.
 *
 * They mention it by definition, so the reverse check below would read them as
 * excuses that have rotted. `session.reach.test.ts` handles the same case with
 * its "The module itself" entries; this is that, made explicit because here it
 * is the reverse direction that trips over it.
 */
const DEFINES_IT = new Set([
  'src/lib/audio/session.ts',
  'src/lib/audio/session.web.ts',
]);

/**
 * Comments out, before anything is matched. Same reason as the sibling file:
 * a check that reads its own prose as evidence is checking documentation.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function isSource(path: string): boolean {
  return !/\.test\.tsx?$/.test(path) && !path.endsWith('.d.ts');
}

const sources = Object.entries(files).filter(([path]) => isSource(path));

describe('the corpus this reads', () => {
  it('found the app', () => {
    expect(sources.length).toBeGreaterThan(100);
  });
});

describe('every path that opens the microphone', () => {
  it('declares the capture category first', () => {
    const unguarded = sources
      .filter(
        ([path, source]) =>
          withoutComments(source).includes(OPENS_THE_MICROPHONE) &&
          !withoutComments(source).includes(ASKS_FOR_THE_CATEGORY) &&
          EXCUSED[path] === undefined,
      )
      .map(([path]) => path);

    expect(
      unguarded,
      'these open a capture and never call prepareForCapture, so every take '
        + 'after one of them is refused on iOS for the life of the page',
    ).toEqual([]);
  });
});

describe('the excuse list', () => {
  it('holds nothing that has since grown a capture', () => {
    const guarded = Object.keys(EXCUSED).filter(
      (path) =>
        files[path] !== undefined &&
        !DEFINES_IT.has(path) &&
        withoutComments(files[path]).includes(ASKS_FOR_THE_CATEGORY),
    );

    expect(
      guarded,
      'these are excused as opening nothing and now declare the capture '
        + 'category; drop their entries',
    ).toEqual([]);
  });

  it('names only files that exist', () => {
    // An entry for a deleted file is an excuse that reads as coverage.
    expect(Object.keys(EXCUSED).filter((path) => files[path] === undefined)).toEqual([]);
  });

  it('names only files the check would otherwise catch', () => {
    // **The third way an excuse list rots**, and the one the sibling file does
    // not check: an entry for a file that never matched. Comments are stripped
    // before matching, so a file that merely *discusses* `getUserMedia` is not
    // a call site and does not need excusing — and an entry for one reads as
    // coverage of a rule it was never subject to.
    const idle = Object.keys(EXCUSED).filter(
      (path) =>
        files[path] !== undefined &&
        !withoutComments(files[path]).includes(OPENS_THE_MICROPHONE),
    );

    expect(
      idle,
      'these are excused from a rule they do not trip; drop their entries',
    ).toEqual([]);
  });
});
