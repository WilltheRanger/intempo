import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  focus: vi.fn(), pause: vi.fn(), play: vi.fn(), prepare: vi.fn(), seek: vi.fn(),
  /** The pan responder config the component builds, captured on render. */
  pan: { current: null as null | Record<string, (event: unknown) => void> },
}));
vi.mock('react', () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: unknown) => fn,
  // The scrubber's pan responder is built once and held. Called straight
  // through here, like `useCallback` above: this file calls the component as a
  // plain function, so a hook that memoises has nothing to memoise across.
  useMemo: (fn: () => unknown) => fn(),
  // The web key handler is attached in an effect, which a component called
  // as a plain function never runs; the keys are `scrub.test.ts`'s.
  useEffect: () => {},
}));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: mock.focus }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ pause: mock.pause, play: mock.play, seekTo: mock.seek }),
  useAudioPlayerStatus: () => ({ isLoaded: true, duration: 10, currentTime: 0 }),
}));
vi.mock('react-native', () => ({
  View: 'view',
  Pressable: 'pressable',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (x: unknown) => x },
  // The track takes a finger. `create` is called at render, so it has to
  // return something with `panHandlers` to spread.
  PanResponder: {
    create: (config: Record<string, (event: unknown) => void>) => {
      mock.pan.current = config;
      return { panHandlers: {} };
    },
  },
}));
// See `ListenButton.test.tsx`: the specifier has to be the one the
// component actually imports.
vi.mock('../../components/icons', () => ({ Pause: 'pause', Play: 'play' }));
vi.mock('../../components/primitives', () => ({ Text: 'text' }));
vi.mock('../../design', () => ({
  BORDER_WIDTH: 1,
  ICON_SIZE: { md: 20 },
  ICON_STROKE_WIDTH: 2,
  MIN_TOUCH_TARGET: 44,
  colors: {},
  radii: {},
  spacing: {},
}));
vi.mock('../../lib/audio/session', () => ({ prepareForPlayback: mock.prepare }));
import { ScrubPlayer } from './ScrubPlayer';

beforeEach(() => { vi.clearAllMocks(); mock.prepare.mockResolvedValue(undefined); });

it('pauses an existing recording when navigation blurs a mounted result', () => {
  ScrubPlayer({ uri: 'https://example.invalid/private.wav' });
  const blur = mock.focus.mock.calls[0][0]();
  blur();
  expect(mock.pause).toHaveBeenCalledOnce();
});

/**
 * The rail is drawn as something you can move, so it has to move — §3.
 *
 * `lib/verdict/scrub.ts` tests the arithmetic. What no test of a pure function
 * can see is whether the component ever hands the answer to the player, which
 * is the half that was missing for as long as the track was drawn: measured
 * width in, touch position through the responder, seconds out to `seekTo`.
 */
it('seeks the player when the track is touched', () => {
  const tree = ScrubPlayer({ uri: 'https://example.invalid/private.wav' });
  // Row -> rail -> the track, whose layout sets the width the touch is read
  // against. Without it every touch reads as position zero.
  const track = tree.props.children[1].props.children[0];
  track.props.onLayout({ nativeEvent: { layout: { width: 120 } } });

  mock.pan.current!.onPanResponderGrant({ nativeEvent: { locationX: 60 } });

  // Halfway along a 120pt track, on a ten-second recording.
  expect(mock.seek).toHaveBeenCalledWith(5);
});

/**
 * A touch before the layout has been measured must not rewind the take.
 *
 * This is the test that caught it. `scrubFraction` returned zero for an
 * unmeasured track — reasonable-sounding, and zero is the start of the
 * recording, so the guard was a rewind.
 */
it('does not seek on a track it has not measured', () => {
  ScrubPlayer({ uri: 'https://example.invalid/private.wav' });
  mock.pan.current!.onPanResponderGrant({ nativeEvent: { locationX: 60 } });
  expect(mock.seek).not.toHaveBeenCalled();
});

it('does not start delayed playback after leaving the result', async () => {
  let finish!: () => void;
  mock.prepare.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const tree = ScrubPlayer({ uri: 'https://example.invalid/private.wav' });
  const blur = mock.focus.mock.calls[0][0]();
  // Row -> the play button; invoke the real component handler.
  const button = tree.props.children[0];
  button.props.onPress();
  blur();
  finish();
  await Promise.resolve();
  expect(mock.play).not.toHaveBeenCalled();
});
