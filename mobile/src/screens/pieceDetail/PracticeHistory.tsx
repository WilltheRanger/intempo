import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SessionTrendChart } from '../../components/charts/SessionTrendChart';
import { ChevronDown } from '../../components/icons';
import { Text } from '../../components/primitives/Text';
import type { PieceHistory } from '../../data/sources/types';
import { BORDER_WIDTH, colors, fontFamily, MIN_TOUCH_TARGET, radii, spacing, ICON_SIZE, ICON_STROKE_WIDTH } from '../../design';
import { formatLastPracticedShort, joinMetadata } from '../../lib/format';
import { historyLabel } from '../../lib/insights/pieceHistory';
import { sessionTrendFrom } from '../../lib/insights/sessionTrend';
import { formatVerdict } from '../../lib/tempo';
import type { RootNavigation } from '../../navigation/types';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';

export interface PracticeHistoryProps {
  history: PieceHistory;
}

/**
 * "Your takes" on a piece (`redesign/PieceDetail.dc.html`): how many and
 * since when, the takes as a line one point each, and "See takes".
 *
 * **"See takes" opens the list here rather than going somewhere.** The
 * prototype gives it no destination and the app has no takes screen; a link
 * that opened the latest take would be a control whose name promises a list
 * and delivers one item. So it lays the takes out under the chart, newest
 * first, each opening its verdict — the same expand-in-place Insights uses for
 * "See all pieces", with the same turning chevron.
 *
 * Draws nothing for a piece nobody has recorded.
 */
export function PracticeHistory({ history }: PracticeHistoryProps) {
  const navigation = useNavigation<RootNavigation>();
  const [open, setOpen] = useState(false);
  const label = historyLabel(history);
  const trend = sessionTrendFrom(history.recent, history.recent[0]?.tolerance ?? null);
  const takes = history.recent.filter((take) => take.failure === null);

  if (!label) {
    return null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text variant="eyebrow" color="textTertiary" style={styles.caps}>
          Your takes
        </Text>
        {takes.length > 0 ? (
          <Pressable
            onPress={() => setOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            aria-expanded={open}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Text variant="metadataSmall" color="accentText" style={styles.toggleLabel}>
              {open ? 'Hide takes' : 'See takes'}
            </Text>
            <View style={open ? styles.turned : undefined}>
              <ChevronDown size={ICON_SIZE.sm} strokeWidth={ICON_STROKE_WIDTH} color={colors.accentText} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <Text variant="body" style={styles.count}>
        {label}
      </Text>

      {/*
        Only once there is a shape to draw: `sessionTrendFrom` returns null
        below two takes, because an axis with one point on it reads as a claim
        about drift where the count above it reads as "not enough yet".
      */}
      {trend ? (
        <SessionTrendChart
          trend={trend}
          compact
          height={84}
          // Numbered from the piece's whole history, so the right-hand end is
          // the take the count above it ends on.
          firstTake={Math.max(1, history.takes - trend.points.length + 1)}
          accessibilityLabel={`Your last ${trend.points.length} takes of this piece, one point each`}
          style={styles.chart}
        />
      ) : null}

      {open ? (
        <View style={styles.takes}>
          {takes.map((take) => (
            <Pressable
              key={take.id}
              onPress={() => navigation.navigate('Verdict', { analysisId: take.id })}
              accessibilityRole="button"
              accessibilityLabel={`Take from ${formatLastPracticedShort(take.recordedAt)}: ${take.targetBpm} BPM, ${formatVerdict(take.verdict)}`}
              style={({ pressed }) => [styles.take, pressed && styles.pressed]}
            >
              <Text variant="sectionLabel" color="textPrimary" style={styles.takeDate}>
                {formatLastPracticedShort(take.recordedAt)}
              </Text>
              <Text variant="metadataSmall" color="textSecondary" numberOfLines={1} style={styles.takeFacts}>
                {joinMetadata([`${take.targetBpm} BPM`, formatVerdict(take.verdict)])}
              </Text>
              <TrailingChevron />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  caps: {
    textTransform: 'uppercase',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
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
  count: {
    marginTop: -6,
  },
  chart: {
    marginTop: spacing.md,
  },
  takes: {
    marginTop: spacing.md,
  },
  take: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  takeDate: {
    width: 64,
  },
  takeFacts: {
    flex: 1,
  },
});
