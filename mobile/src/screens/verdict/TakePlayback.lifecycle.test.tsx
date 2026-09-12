import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  focus: vi.fn(), pause: vi.fn(), play: vi.fn(), prepare: vi.fn(),
}));
vi.mock('react', () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: unknown) => fn,
}));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: mock.focus }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: 'https://example.invalid/private.wav' }),
}));
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ pause: mock.pause, play: mock.play }),
  useAudioPlayerStatus: () => ({ isLoaded: true, duration: 10, currentTime: 0 }),
}));
vi.mock('react-native', () => ({ View: 'view', StyleSheet: { create: (x: unknown) => x } }));
// See `ListenButton.test.tsx`: the specifier has to be the one the
// component actually imports.
vi.mock('../../components/icons', () => ({ Pause: 'pause', Play: 'play' }));
vi.mock('../../components/primitives', () => ({
  LoadingState: 'loading', SecondaryButton: 'button', SectionHeader: 'header', Text: 'text',
}));
vi.mock('../../data/sources', () => ({ takeSource: {} }));
vi.mock('../../design', () => ({ BORDER_WIDTH: 1, colors: {}, radii: {}, spacing: {} }));
vi.mock('../../lib/audio/session', () => ({ prepareForPlayback: mock.prepare }));
import { TakePlayback } from './TakePlayback';

beforeEach(() => { vi.clearAllMocks(); mock.prepare.mockResolvedValue(undefined); });

it('pauses an existing recording when navigation blurs a mounted result', () => {
  TakePlayback({ analysisId: 'take' });
  const blur = mock.focus.mock.calls[0][0]();
  blur();
  expect(mock.pause).toHaveBeenCalledOnce();
});

it('does not start delayed playback after leaving the result', async () => {
  let finish!: () => void;
  mock.prepare.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const tree = TakePlayback({ analysisId: 'take' });
  const blur = mock.focus.mock.calls[0][0]();
  // Section -> player -> playback button; invoke the real component handler.
  const button = tree.props.children[1].props.children[2];
  button.props.onPress();
  blur();
  finish();
  await Promise.resolve();
  expect(mock.play).not.toHaveBeenCalled();
});
