import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  LoadingState,
  PageHeader,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { TrailingChevron } from '../../components/primitives/TrailingChevron';
import { usePieceHistory } from '../../data/hooks/useLatestTake';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';
import { TrendPlot } from '../../components/charts/TrendPlot';
import { historyCount } from '../../lib/insights/pieceHistory';
import {
  olderTakesNote,
  takeDateLabel,
  takeRowIsVerdict,
  takeRowTitle,
} from '../../lib/insights/takeRows';
import { rowTempo, takesTrend } from '../../lib/insights/takesTrend';
import { loadStateFor } from '../../lib/loadState';
import type { RootNavigation, RootStackParamList } from '../../navigation/types';
import { useGoBack } from '../../navigation/useGoBack';

/**
 * Every take of one piece, newest first: when, and what its verdict said.
 *
 * **A page of its own, behind a row** (the owner, 2026-09-29: "lets make your
 * takes a different page and kind of like the buttons below. It simplifies the
 * app and makes it more readable"). On the piece's screen the takes were a
 * headed list of three with "See all" under it, set above Digital score,
 * Original pages and Rename — two lists of hairline rows, one on top of the
 * other, with the score and Practice both competing for the same glance. The
 * piece screen now has one list, and "Your takes" is the first row in it.
 *
 * Here every loaded take is shown, so there is no "See all": the page is the
 * "all". When the piece has more takes than were fetched, a line under the
 * rows says so rather than letting twelve pass for forty.
 *
 * **A graph first, because the page's question is "am I getting better?"**
 * (the owner, 2026-09-29): the passage the takes keep naming, take by take,
 * drawn the way the result screen draws a take (`lib/insights/takesTrend.ts`),
 * with one line saying which way it went. The rows under it are when, the
 * take's own title, and the passage's tempo — where six of seven used to read
 * "Bars 5–8 at 10x, not 96 BPM". Every row has its date.
 *
 * A reading is in ink and a refusal in grey; the rows open the take's verdict.
 */
export function PieceTakesScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PieceTakes'>>();
  const goBack = useGoBack({ route: 'PieceDetail', params: { pieceId: params.pieceId } });
  const history = usePieceHistory(params.pieceId);
  const load = loadStateFor({ isError: history.isError, hasData: history.data !== undefined });

  const header = (
    <PageHeader title="Your takes" onBack={goBack} backLabel="Back to the piece" />
  );

  if (load === 'loading') {
    return (
      <ScreenContainer>
        {header}
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (load === 'unavailable' || !history.data) {
    return (
      <ScreenContainer>
        {header}
        <EmptyState fill title="Couldn't load your takes" actionLabel="Back" onActionPress={goBack} />
      </ScreenContainer>
    );
  }

  const takes = history.data.recent;
  const count = historyCount(history.data);

  if (!count || takes.length === 0) {
    return (
      <ScreenContainer>
        {header}
        <EmptyState fill title="No takes yet" />
      </ScreenContainer>
    );
  }

  const older = olderTakesNote(history.data.takes, takes.length);
  const trend = takesTrend(takes);

  return (
    <ScreenContainer>
      {header}
      <Text variant="metadata" color="textTertiary" style={styles.count}>
        {count}
      </Text>

      {trend ? (
        <View
          style={styles.trend}
          accessible
          accessibilityRole="image"
          accessibilityLabel={[trend.title, trend.finding].filter(Boolean).join('. ')}
        >
          <Text variant="caption" color="textTertiary" style={styles.trendTitle}>
            {trend.title}
          </Text>
          <TrendPlot
            data={trend.data}
            height={130}
            ends={{ up: 'faster', down: 'slower' }}
            centreLabel={trend.target === null ? 'on tempo' : String(trend.target)}
          />
          <View style={styles.axis}>
            <Text variant="caption" color="textTertiary">
              {takeDateLabel(takes[takes.length - 1].recordedAt)}
            </Text>
            <Text variant="caption" color="textTertiary">
              {takeDateLabel(takes[0].recordedAt)}
            </Text>
          </View>
          {trend.finding ? (
            <Text variant="body" style={styles.finding}>
              {trend.finding}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.rows}>
        {takes.map((take) => {
          const title = takeRowTitle(take);
          const when = takeDateLabel(take.recordedAt);
          const tempo = rowTempo(take, trend?.passage ?? null);
          return (
            <Pressable
              key={take.id}
              onPress={() => navigation.navigate('Verdict', { analysisId: take.id, from: 'takes' })}
              accessibilityRole="button"
              accessibilityLabel={`Take from ${when}: ${title}${tempo === null ? '' : `, ${tempo} BPM`}`}
              style={({ pressed }) => [styles.take, pressed && styles.pressed]}
            >
              <Text variant="metadataSmall" color="textTertiary" style={styles.when}>
                {when}
              </Text>
              <Text
                variant="rowLabel"
                color={takeRowIsVerdict(take) ? 'textPrimary' : 'textSecondary'}
                numberOfLines={1}
                style={styles.words}
              >
                {title}
              </Text>
              {tempo === null ? null : (
                <Text variant="metadata" color="textSecondary" style={styles.tempo}>
                  {tempo}
                </Text>
              )}
              <TrailingChevron />
            </Pressable>
          );
        })}
      </View>

      {older ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.older}>
          {older}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  count: {
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  trend: {
    marginTop: spacing.xl,
  },
  trendTitle: {
    marginBottom: spacing.sm,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  finding: {
    marginTop: spacing.md,
  },
  tempo: {
    fontVariant: ['tabular-nums'],
  },
  rows: {
    marginTop: spacing.xl,
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  take: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 14,
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  when: {
    width: 84,
    fontVariant: ['tabular-nums'],
  },
  words: {
    flex: 1,
  },
  older: {
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.55,
  },
});
