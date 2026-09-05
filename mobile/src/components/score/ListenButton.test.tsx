import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  focus: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  effects: [] as (() => unknown)[],
}));
// Exercise the real button's navigation lifecycle without requiring a native
// renderer. React Navigation owns focus; we deliver its focus/blur callbacks.
vi.mock('react', () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => unknown) => state.effects.push(effect),
}));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: state.focus }));
vi.mock('react-native', () => ({
  ActivityIndicator: 'spinner',
  Pressable: 'button',
  View: 'view',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('lucide-react-native', () => ({ Pause: 'pause', Play: 'play' }));
vi.mock('../primitives/Text', () => ({ Text: 'text' }));
vi.mock('../../design', () => ({
  BORDER_WIDTH: 1,
  ICON_SIZE: { sm: 16 },
  ICON_STROKE_WIDTH: 1,
  colors: {},
  radii: {},
  spacing: {},
}));
vi.mock('../../data/preferences', () => ({
  usePreferences: () => ({ instrument: 'double_bass' }),
}));
vi.mock('../../lib/haptics', () => ({
  impact: vi.fn(),
  ImpactFeedbackStyle: { Light: 1 },
}));
vi.mock('../../lib/scorePlayer', () => ({ playSchedule: state.play }));
import { ListenButton } from './ListenButton';
import type { ScoreJson } from '../../data/types';
const score = {
  clef: 'bass',
  time_signature: '4/4',
  measures: [
    {
      measure_number: 1,
      notes: [{ pitch: 'E2', duration: 'quarter' }],
      slurs: [],
    },
  ],
  repeats: [],
} as unknown as ScoreJson;
beforeEach(() => {
  vi.clearAllMocks();
  state.effects = [];
  state.play.mockReturnValue({ stop: state.stop, isPlaying: () => true });
});
it('stops playback on blur even while the piece remains mounted', () => {
  const tree = ListenButton({ score, bpm: 60 })!;
  const cleanup = state.focus.mock.calls[0][0]();
  tree.props.children[0].props.onPress();
  expect(state.play.mock.calls[0][1].voice).toBe('double_bass');
  expect(tree.props.children[0].props.accessibilityLabel).toContain(
    'Double bass',
  );
  cleanup();
  expect(state.stop).toHaveBeenCalledOnce();
  cleanup(); // Native unmount can follow blur; the handle has been cleared.
  expect(state.stop).toHaveBeenCalledOnce();
});
it('also stops when the score or instrument effect is cleaned up', () => {
  const tree = ListenButton({ score, bpm: 60 })!;
  const cleanup = state.effects[0]() as () => void;
  tree.props.children[0].props.onPress();
  cleanup();
  expect(state.stop).toHaveBeenCalledOnce();
});
