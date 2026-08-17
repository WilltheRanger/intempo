import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import {
  Avatar,
  EmptyState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
} from '../../components/primitives';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLatestTake } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import type { Piece } from '../../data/types';
import { spacing } from '../../design';
import { formatLastPracticedShort } from '../../lib/format';
import { getGreeting } from '../../lib/greeting';
import { formatTendency } from '../../lib/tempo';
import { suggestionsFor } from '../../lib/today';
import type { TabScreenNavigation } from '../../navigation/types';
import { PracticeCard } from './PracticeCard';
import { TodayRow } from './TodayRow';

const AVATAR_SIZE = 36;

/**
 * Tappable box around the mark.
 *
 * Bigger than the mark, and pulled back in by the difference so the header row
 * keeps the height the greeting gives it — a taller row would push the whole
 * screen down. `hitSlop` would have done this too, but only on device: it has
 * no effect under react-native-web, so the target couldn't be verified in the
 * one place this build can be driven. A real box behaves the same everywhere.
 */
const AVATAR_TARGET = 48;
const AVATAR_INSET = (AVATAR_TARGET - AVATAR_SIZE) / 2;

/**
 * Today: the piece to pick back up, then a few reasons to look elsewhere.
 *
 * **The card is a card again**, and it is the only one on the screen. A piece,
 * its tempo and the action that starts it are one object and earn the box
 * (§3 law 3); what follows are separate suggestions, so they get rules instead.
 *
 * **What is not here is the library preview.** Three rows of the Library tab
 * once sat at the bottom of this screen, which made its lower two-thirds a
 * copy of a destination one tap away. The rows below are not that: each names
 * a piece *and the reason it is being raised* — drifting from the beat,
 * untouched for a month, the take you just finished. A row without a reason
 * would be a list, and a list belongs in the Library.
 *
 * Every block hides itself when its data is absent, so a new account with one
 * piece and no analyses sees a card and nothing else — which is the truth
 * about a new account rather than a screen full of empty furniture.
 */
export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const currentPiece = useCurrentPiece();
  const library = useLibrary();
  const insights = useInsights();
  const latestTake = useLatestTake();
  const me = useMe();

  // The working tempo is local and per piece, so this subscribes rather than
  // reading once — changing it on the Record screen has to show here.
  usePracticeTempos();

  async function refresh() {
    await Promise.all([
      currentPiece.refetch(),
      library.refetch(),
      insights.refetch(),
      latestTake.refetch(),
      me.refetch(),
    ]);
  }

  const piece = currentPiece.data ?? null;

  // Straight to a take. `Practice` remains the score-reading shell; what
  // someone means by "continue practicing" is recording one.
  function openPractice(target: Piece) {
    navigation.navigate('Record', { pieceId: target.id });
  }

  const take = latestTake.data ?? null;

  const { attention, neglected } = suggestionsFor({
    pieces: library.data ?? [],
    insights: insights.data ?? null,
    excludeIds: [piece?.id ?? null, take?.pieceId ?? null],
  });

  const summary = insights.data ?? null;

  const avatar = me.data ? (
    <Pressable
      onPress={() => navigation.navigate('Profile')}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
    >
      <Avatar source={me.data.avatarUrl} size={AVATAR_SIZE} />
    </Pressable>
  ) : null;

  const header = <PageHeader title={getGreeting()} action={avatar} />;

  if (currentPiece.isPending) {
    return (
      <ScreenContainer>
        {header}
        <ContinueSkeleton />
      </ScreenContainer>
    );
  }

  if (currentPiece.isError) {
    return (
      <ScreenContainer onRefresh={refresh}>
        {header}
        <EmptyState
          title="Couldn't load your pieces"
          description="Check your connection and pull to try again."
        />
      </ScreenContainer>
    );
  }

  if (!piece) {
    return (
      <ScreenContainer onRefresh={refresh}>
        {header}
        <EmptyState
          title="Nothing to practice yet"
          description="Photograph a piece of sheet music and it will show up here."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer onRefresh={refresh}>
      {header}

      <SectionHeader label="Continue practicing" />
      <PracticeCard
        piece={piece}
        workingBpm={practiceTempo.for(piece.id, piece.markedBpm)}
        onContinue={() => openPractice(piece)}
      />

      {take ? (
        <FadeIn index={0}>
          <View style={styles.section}>
            <SectionHeader label="Last take" />
            <TodayRow
              title={take.pieceTitle}
              // The pipeline's own sentence, shown verbatim exactly as the
              // verdict screen shows it. Nothing here re-words a finding.
              detail={`${formatLastPracticedShort(take.recordedAt) ?? 'Just now'}  ·  ${take.headline}`}
              detailLines={3}
              onPress={() => navigation.navigate('Verdict', { analysisId: take.id })}
              last
            />
          </View>
        </FadeIn>
      ) : null}

      {attention || neglected ? (
        <FadeIn index={1}>
          <View style={styles.section}>
            <SectionHeader label="Also worth a look" />
            {attention ? (
              <TodayRow
                title={attention.title}
                detail={attention.detail}
                onPress={() =>
                  navigation.navigate('PieceDetail', { pieceId: attention.pieceId })
                }
                last={!neglected}
              />
            ) : null}
            {neglected ? (
              <TodayRow
                title={neglected.title}
                detail={neglected.detail}
                onPress={() =>
                  navigation.navigate('PieceDetail', { pieceId: neglected.pieceId })
                }
                last
              />
            ) : null}
          </View>
        </FadeIn>
      ) : null}

      {summary ? (
        <FadeIn index={2}>
          <View style={styles.section}>
            <SectionHeader label={`Last ${summary.windowDays} days`} />
            <TodayRow
              title={formatTendency(summary.verdict)}
              detail={
                summary.sessions === 1 ? '1 session' : `${summary.sessions} sessions`
              }
              onPress={() => navigation.navigate('Insights')}
              last
            />
          </View>
        </FadeIn>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR_TARGET,
    height: AVATAR_TARGET,
    margin: -AVATAR_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    // No vertical nudge: the row centres the mark on the greeting's line box,
    // and the greeting's ink — cap of "G" down to the tail of "g" — is centred
    // in that box to within a fifth of a point. Measured off the rendered
    // type, not the font metrics.
  },
  pressed: {
    opacity: 0.6,
  },
  section: {
    marginTop: spacing['3xl'],
  },
});
