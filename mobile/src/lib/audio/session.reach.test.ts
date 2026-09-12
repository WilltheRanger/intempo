import { describe, expect, it } from 'vitest';

/**
 * Every path that makes a sound asks for the audio session first.
 *
 * **The half of `session.ts`'s own docstring that nothing checked.** It says:
 * *"What can be checked here is that it is called on every path that makes a
 * sound, and that it cannot throw."* The siblings beside this file hold the
 * second half. This holds the first, and it is the one that rots — a claim
 * about every call site is true on the day it is written and silently false
 * the next time somebody adds a player.
 *
 * **What goes wrong when it is false.** An unconfigured iOS session obeys the
 * ring/silent switch, and on web Safari applies the same switch to Web Audio.
 * A musician with the switch flipped — most musicians, in most practice rooms
 * — presses Listen and hears nothing. Nothing throws, nothing logs, and the
 * screen behaves exactly as it should: the button flips to Stop, the schedule
 * plays through, the label flips back. **There is no audio device in this
 * container and none in CI**, so no test, no screenshot and no walk can hear
 * the difference. A source check is the only thing that can.
 *
 * Held **both ways**, the way `NOT_WIRED` is: a new player with no session
 * call fails, and so does an entry in `EXCUSED` for a file that has since
 * grown one. An exclusion list whose reasons rot is precisely what
 * `fixtures/timeline/parity.json` was.
 */

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

/** The whole app. `'../../**'` from here is `src/**`, this directory included. */
const globbed: Record<string, string> = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Keyed by path from the repository's `src/`, not from this directory.
 *
 * Vite hands back the shortest relative path it can, so the same corpus
 * arrives as `./session.ts`, `../metronome/click.ts` and `../../App.tsx` —
 * three shapes for one tree, and a list of exclusions written in them is
 * unreadable and moves the day this file does. Resolved once, here.
 */
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

/**
 * Constructing one of these is making a sound.
 *
 * **Construction rather than `.play()`**, and the difference matters: `.play()`
 * is a common enough name to match a video, an animation or a stub, while
 * every one of these names an audio source and nothing else. All five sound
 * paths in the app construct something on this list, so the looser marker
 * would buy nothing and cost a growing list of exclusions.
 *
 * `createBufferSource` and `new Audio` are here for a path that does not exist
 * yet: they are the two other ways a browser is made to make a noise, and the
 * point of this file is the call site nobody has written.
 */
const SOUND_SOURCES = [
  'AudioModule.AudioPlayer',
  'createAudioPlayer(',
  'useAudioPlayer(',
  'createOscillator(',
  'createBufferSource(',
  'new Audio(',
];

/** What the module under test is called at every call site. */
const ASKS_FOR_THE_SESSION = 'prepareForPlayback';

/**
 * Files that mention the session and make no sound, with the reason.
 *
 * Checked in both directions below, so a file that has since gained a player
 * cannot sit here reading as an excuse.
 */
const EXCUSED: Record<string, string> = {
  'src/App.tsx':
    'The boot call. It configures the session once at launch, before any ' +
    'screen exists to play anything — the players re-assert it because a take ' +
    'takes the session away, not because this one is missing.',
  'src/lib/audio/session.ts': 'The module itself.',
  'src/lib/audio/session.web.ts': 'The module itself, on web.',
  'src/lib/audioRecorder.web.ts':
    'The one caller that asks for the *other* category. A take needs '
    + "`play-and-record`, because WebKit refuses capture outright while the "
    + 'page is declared `playback` — which is what boot declares, and what '
    + 'made every take on an iPhone fail. It makes no sound itself: it opens '
    + 'a capture graph with no output, and hands `playback` back when the '
    + 'take ends.',
};

/** Test files are not the app; a stub of a player is not a player. */
function isSource(path: string): boolean {
  return !/\.test\.tsx?$/.test(path) && !path.endsWith('.d.ts');
}

function makesSound(source: string): boolean {
  return SOUND_SOURCES.some((marker) => source.includes(marker));
}

function asksForTheSession(source: string): boolean {
  return source.includes(ASKS_FOR_THE_SESSION);
}

const sources = Object.entries(files).filter(([path]) => isSource(path));

describe('the corpus this reads', () => {
  it('found the app', () => {
    // A glob that matches nothing passes every assertion below. This is what
    // `navigationReachability.test.ts` learned the expensive way.
    expect(sources.length).toBeGreaterThan(100);
  });

  it('found the sound paths there are', () => {
    // Five, today: the two players, the two metronomes, and the take playback
    // on the verdict screen. Named rather than counted, so a path that
    // *disappears* is as loud as one that appears — a player deleted in a
    // refactor and rebuilt somewhere else is exactly how this check would come
    // to be guarding nothing.
    const playing = sources.filter(([, source]) => makesSound(source)).map(([p]) => p);

    expect(playing.sort()).toEqual([
      'src/lib/metronome/click.ts',
      'src/lib/metronome/click.web.ts',
      'src/lib/scorePlayer.ts',
      'src/lib/scorePlayer.web.ts',
      'src/screens/verdict/TakePlayback.tsx',
    ]);
  });
});

describe('every path that makes a sound', () => {
  it('asks for the audio session', () => {
    const silent = sources
      .filter(([, source]) => makesSound(source) && !asksForTheSession(source))
      .map(([path]) => path);

    expect(silent,
      'these construct an audio source and never call prepareForPlayback, so ' +
        'they play nothing on a phone whose ring switch is off',
    ).toEqual([]);
  });
});

describe('the excuse list', () => {
  it('holds nothing that has since grown a player', () => {
    const playing = Object.keys(EXCUSED).filter(
      (path) => files[path] !== undefined && makesSound(files[path]),
    );

    expect(playing,
      'these are excused as making no sound and now make one; drop their entries',
    ).toEqual([]);
  });

  it('holds nothing that has stopped mentioning the session', () => {
    // The other direction. A reason kept for a file that no longer touches
    // the session reads as live coverage of something nobody is doing.
    const gone = Object.keys(EXCUSED).filter(
      (path) => files[path] === undefined || !asksForTheSession(files[path]),
    );

    expect(gone, 'nothing here mentions the session any more').toEqual([]);
  });

  it('is the only reason a file may mention the session without playing', () => {
    const unexplained = sources
      .filter(
        ([path, source]) =>
          asksForTheSession(source) && !makesSound(source) && !(path in EXCUSED),
      )
      .map(([path]) => path);

    expect(unexplained,
      'these ask for the session and make no sound; either they play something ' +
        'this file cannot see — add its constructor to SOUND_SOURCES — or they ' +
        'need an entry in EXCUSED saying why',
    ).toEqual([]);
  });
});
