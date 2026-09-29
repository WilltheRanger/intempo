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
import { formatLastPracticedShort } from '../../lib/format';
import { historyCount } from '../../lib/insights/pieceHistory';
import {
  olderTakesNote,
  rowDates,
  takeRowIsVerdict,
  takeRowWords,
} from '../../lib/insights/takeRows';
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
 * A reading is in ink and a refusal in grey; a day's date is said once
 * (`rowDates`); the rows open the take's verdict.
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

  const dates = takes.map((take) => formatLastPracticedShort(take.recordedAt));
  const shownDates = rowDates(dates);
  const older = olderTakesNote(history.data.takes, takes.length);

  return (
    <ScreenContainer>
      {header}
      <Text variant="metadata" color="textTertiary" style={styles.count}>
        {count}
      </Text>

      <View style={styles.rows}>
        {takes.map((take, index) => {
          const words = takeRowWords(take);
          const when = dates[index];
          return (
            <Pressable
              key={take.id}
              onPress={() => navigation.navigate('Verdict', { analysisId: take.id, from: 'takes' })}
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
  rows: {
    marginTop: spacing['2xl'],
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
    width: 64,
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
