import { StyleSheet, View } from 'react-native';

import { BORDER_WIDTH, colors, spacing } from '../../design';
import type { Beat } from '../../lib/metronome';

export interface BeatIndicatorProps {
  beat: Beat | null;
  /** From `beatsPerBar`. Null when the time signature gave us nothing usable. */
  perBar: number | null;
  /**
   * Drawn on a ground that is dark in both appearances.
   *
   * The count-in inverts, and the marks have to invert with it: `borderStrong`
   * on `darkBg` is a hairline nobody can see from a music stand, which is the
   * one place this is read from.
   */
  onDark?: boolean;
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
export function BeatIndicator({ beat, perBar, onDark = false }: BeatIndicatorProps) {
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
            style={[
              styles.mark,
              onDark && styles.markOnDark,
              on &&
                (index === 0 && currentPerBar !== null
                  ? onDark
                    ? styles.downbeatOnDark
                    : styles.downbeat
                  : styles.onbeat),
            ]}
          />
        );
      })}
    </View>
  );
}

const MARK = 12;

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
  markOnDark: {
    borderColor: colors.onDarkFill,
  },
  /**
   * Ivory, because on a dark ground ivory is what ink is on a light one: the
   * strongest value the palette has. The gold on-beat needs no inversion — it
   * is the same accent against either ground and reads on both.
   */
  downbeatOnDark: {
    backgroundColor: colors.onDark,
    borderColor: colors.onDark,
  },
});
