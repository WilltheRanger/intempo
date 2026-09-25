import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronDown } from '../../components/icons';
import { Text } from '../../components/primitives/Text';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';
import type { PieceHistory } from '../../data/sources/types';
import {
  BORDER_WIDTH,
  colors,
  fontFamily,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  spacing,
} from '../../design';
import { formatLastPracticedShort } from '../../lib/format';
import { historyCount } from '../../lib/insights/pieceHistory';
import {
  moreTakesLabel,
  rowDates,
  TAKES_SHOWN,
  takeRowIsVerdict,
  takeRowWords,
} from '../../lib/insights/takeRows';
import type { RootNavigation } from '../../navigation/types';

export interface PracticeHistoryProps {
  history: PieceHistory;
}

/**
 * "Your takes" on a piece: how many and since when, then the takes themselves
 * as rows — when, and what each one's verdict said — newest first.
 *
 * **Rows, not a card with a chart** (the owner, 2026-09-25: the card was
 * "destroying visual hierarchy"). A white box with its own chart sat between
 * the score and Practice and competed with both, and its chart was the old
 * drift line, which a take held slow sends to the floor. The charts live on
 * each take's verdict and on Insights; here a musician finds a take and opens
 * it, and type does that without a container (§3 laws 3 and 8).
 *
 * Three rows, then "See all" in place — the same expand-in-place Insights
 * uses for "See all pieces", with the same turning chevron. Draws nothing for
 * a piece nobody has recorded.
 *
 * **Verdicts lead** (the owner, 2026-09-25, circling this section). It had
 * two headings — "YOUR TAKES" and a 16pt "14 takes since September 13" the
 * size of the rows under it — and its loudest words were three refusals in
 * full ink, running straight on into the rows below. Now: one heading with
 * the count beside it; a reading in ink and a refusal in grey; a day's date
 * said once; and a gap before the piece's own rows, so the two lists read as
 * two.
 */
export function PracticeHistory({ history }: PracticeHistoryProps) {
  const navigation = useNavigation<RootNavigation>();
  const [open, setOpen] = useState(false);
  const count = historyCount(history);

  if (!count) {
    return null;
  }

  const takes = history.recent;
  const shown = open ? takes : takes.slice(0, TAKES_SHOWN);
  const more = moreTakesLabel(history.takes, takes.length);
  const dates = shown.map((take) => formatLastPracticedShort(take.recordedAt));
  const shownDates = rowDates(dates);

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text variant="eyebrow" color="textTertiary" style={styles.caps}>
          Your takes
        </Text>
        <Text variant="metadataSmall" color="textTertiary" style={styles.count}>
          {count}
        </Text>
      </View>

      <View style={styles.rows}>
        {shown.map((take, index) => {
          const words = takeRowWords(take);
          const when = dates[index];
          return (
            <Pressable
              key={take.id}
              onPress={() => navigation.navigate('Verdict', { analysisId: take.id })}
              accessibilityRole="button"
              accessibilityLabel={`Take from ${when}: ${words}`}
              style={({ pressed }) => [styles.take, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="textTertiary" style={styles.when}>
                {shownDates[index] ?? ''}
              </Text>
              <Text
                variant="rowLabel"
                color={takeRowIsVerdict(take) ? 'textPrimary' : 'textSecondary'}
                numberOfLines={1}
                style={styles.words}
              >
                {words}
              </Text>
              <TrailingChevron />
            </Pressable>
          );
        })}
      </View>

      {more ? (
        <Pressable
          onPress={() => setOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text variant="metadata" color="accentText" style={styles.toggleLabel}>
            {open ? 'Show fewer' : more}
          </Text>
          {/* Turned on a wrapper: a transform on the icon itself is lost on web. */}
          <View style={open ? styles.turned : undefined}>
            <ChevronDown
              size={ICON_SIZE.sm}
              strokeWidth={ICON_STROKE_WIDTH}
              color={colors.accentText}
            />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    // The break between this list and the piece's own rows under it — the
    // same hairline-ruled rows, so without it they read as one list.
    marginBottom: spacing['2xl'],
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  caps: {
    textTransform: 'uppercase',
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
  rows: {
    marginTop: spacing.sm,
  },
  take: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 10,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  when: {
    width: 64,
    fontVariant: ['tabular-nums'],
  },
  words: {
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
  },
  toggleLabel: {
    fontFamily: fontFamily.sansMedium,
  },
  turned: {
    transform: [{ rotate: '180deg' }],
  },
  pressed: {
    opacity: 0.55,
  },
});
