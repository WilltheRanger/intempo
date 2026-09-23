import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { Beat } from '../../lib/metronome';

export interface BeatIndicatorProps {
  beat: Beat | null;
  /** From `beatsPerBar`. Null when the time signature gave us nothing usable. */
  perBar: number | null;
  /**
   * `count` is the count-in's row (`redesign/RecordCountIn.dc.html`): larger,
   * filled marks, the beat being counted in ink and the rest in the spent
   * tone — read from a music stand, so it is one mark that stands out rather
   * than a pattern to decode. The count-in used to be dark and this used to
   * be `onDark`; the redesign draws it light (2026-09-23).
   */
  variant?: 'take' | 'count';
}

/**
 * The visual metronome: the bar, with the beat you're on filled.
 *
 * A row of marks rather than one thing flashing, because a flash tells you
 * *that* a beat happened and this has to tell you *which*. Someone glancing up
 * mid-phrase needs to find their place in the bar, not just be reminded there
 * is a pulse.
 *
 * Filled marks the current beat; the fill is ink on the downbeat and gold
 * elsewhere. Gold is what this app uses for an active state, and ink is the
 * strongest value it has — so "one" is the one that reads darkest from across
 * a music stand, without introducing a second colour system to say so.
 *
 * Nothing animates. The beat is a discrete event and a transition would put
 * the visible change *after* it, which is precisely the error being measured.
 */
export function BeatIndicator({ beat, perBar, variant = 'take' }: BeatIndicatorProps) {
  // A planned beat names the shape of its own bar, so the row can change from
  // four marks to two at a 4/4 → 6/8 boundary without restarting the clock.
  // Explicit null means this bar's meter is unreadable; do not fall back to the
  // previous bar's shape.
  const currentPerBar =
    beat && beat.pulsesPerBar !== undefined ? beat.pulsesPerBar : perBar;
  // No usable time signature: one mark that alternates, which still carries
  // the pulse even though it can't carry the count.
  const marks = currentPerBar ?? 1;
  const current = beat === null ? null : (beat.beatInBar ?? beat.index % 2);

  return (
    <View
      style={styles.row}
      // Named once, never per beat. A live region here would announce a
      // position twice a second for the length of a take, which is unusable —
      // and a musician who can't see this has the haptic and audio modes,
      // which are the same metronome through a channel that suits them.
      accessibilityLabel="Visual metronome"
      testID="beat-indicator"
    >
      {Array.from({ length: marks }, (_, index) => {
        const on = current === index;
        return (
          <View
            key={index}
            style={
              variant === 'count'
                ? [styles.count, on && styles.countOn]
                : [
                    styles.mark,
                    on &&
                      (index === 0 && currentPerBar !== null
                        ? styles.downbeat
                        : styles.onbeat),
                  ]
            }
          />
        );
      })}
    </View>
  );
}

const MARK = 12;
const COUNT_MARK = 14;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    // Matches the metronome toggle it replaces, so turning the take on doesn't
    // shift the tempo block above it.
    minHeight: 44,
  },
  mark: {
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
  },
  onbeat: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  downbeat: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  count: {
    width: COUNT_MARK,
    height: COUNT_MARK,
    borderRadius: COUNT_MARK / 2,
    // `borderStrong` is the redesign's "spent or disabled" tone: a beat that
    // is not the one being counted.
    backgroundColor: colors.borderStrong,
    // 12pt apart, where the take's row is 8.
    marginHorizontal: (12 - spacing.sm) / 2,
  },
  countOn: {
    backgroundColor: colors.textPrimary,
  },
});
