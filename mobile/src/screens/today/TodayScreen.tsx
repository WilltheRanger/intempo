import { useNavigation } from '@react-navigation/native';
import { Play } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Avatar,
  EmptyState,
  PrimaryButton,
  ScreenContainer,
  Skeleton,
  Text,
} from '../../components/primitives';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { CONTROL_HEIGHT, radii, spacing } from '../../design';
import { getGreeting } from '../../lib/greeting';
import type { TabScreenNavigation } from '../../navigation/types';
import { ContinuePanel } from './ContinuePanel';

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
 * Today: the one piece to pick back up, and why.
 *
 * **What this screen is not, any more.** It used to lead with a greeting and
 * then show a featured card followed by three rows of the library — which made
 * its bottom two-thirds an exact copy of the top of the Library tab, three
 * rows shorter. A preview of a destination that is one tap away is the clearest
 * case of §3 law 10 there is, so it's gone.
 *
 * The greeting moved to the eyebrow and the piece took the title. That is the
 * hierarchy the screen always wanted: "Good morning" is context, the piece is
 * the content, and at 36pt against 26pt the salutation was outranking the only
 * thing on the screen anyone came for.
 *
 * The action is pinned to the footer rather than sitting inside a card. It is
 * the single thing this screen exists to start, and §3 law 7 puts the primary
 * action in the thumb's reach.
 */
export function TodayScreen() {
  const navigation = useNavigation<TabScreenNavigation<'Today'>>();
  const currentPiece = useCurrentPiece();
  const insights = useInsights();
  const me = useMe();

  // The working tempo is local and per piece, so this subscribes rather than
  // reading once — changing it on the Record screen has to show here.
  usePracticeTempos();

  async function refresh() {
    await Promise.all([currentPiece.refetch(), insights.refetch(), me.refetch()]);
  }

  const piece = currentPiece.data ?? null;

  // Straight to a take. `Practice` remains the score-reading shell; what
  // someone means by "continue practicing" is recording one.
  function openPractice() {
    if (piece) {
      navigation.navigate('Record', { pieceId: piece.id });
    }
  }

  // This piece's own recent practice, out of the aggregate the Insights tab
  // already fetches. Absent until the pipeline has analysed something, which
  // is the normal state for a new account rather than an error.
  const insight =
    piece && insights.data
      ? (insights.data.pieces.find((entry) => entry.pieceId === piece.id) ?? null)
      : null;

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

  /*
    The greeting is the eyebrow in every state, never a 36pt title in one and
    a 14pt line in another. It was the latter, and the effect was a heading
    that shrank to a third of its size the moment the pieces arrived — the
    exact jump the skeleton below exists to prevent.
  */
  const greeting = (
    // Its own row, rather than the avatar sharing the title's row as
    // `PageHeader` would have it. A 36pt title long enough to wrap — which
    // most classical titles are — left the mark floating in the middle of the
    // second line and squeezed the text to three-quarter width.
    <View style={styles.greetingRow}>
      <Text variant="metadata" color="textTertiary">
        {getGreeting()}
      </Text>
      {avatar}
    </View>
  );

  if (currentPiece.isPending) {
    return (
      // A placeholder for the action too. Without one the footer appears from
      // nothing and the whole screen shifts up as it lands.
      <ScreenContainer
        footer={<Skeleton height={CONTROL_HEIGHT} radius={radii.md} />}
      >
        <View style={styles.header}>{greeting}</View>
        <ContinueSkeleton />
      </ScreenContainer>
    );
  }

  if (currentPiece.isError) {
    return (
      <ScreenContainer onRefresh={refresh}>
        <View style={styles.header}>{greeting}</View>
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
        <View style={styles.header}>{greeting}</View>
        <EmptyState
          title="Nothing to practice yet"
          description="Photograph a piece of sheet music and it will show up here."
        />
      </ScreenContainer>
    );
  }

  const workingBpm = practiceTempo.for(piece.id, piece.markedBpm);

  return (
    <ScreenContainer
      onRefresh={refresh}
      footer={
        <PrimaryButton
          label="Continue practice"
          icon={Play}
          onPress={openPractice}
        />
      }
    >
      <View style={styles.header}>
        {greeting}

        <Text variant="screenTitle">{piece.title}</Text>

        {piece.composer ? (
          <Text variant="composer" color="textSecondary" style={styles.composer}>
            {piece.composer}
          </Text>
        ) : null}

        {piece.movement ? (
          <Text variant="metadata" color="textTertiary" style={styles.movement}>
            {piece.movement}
          </Text>
        ) : null}
      </View>

      <ContinuePanel piece={piece} insight={insight} workingBpm={workingBpm} />
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
  },
  pressed: {
    opacity: 0.6,
  },
  header: {
    // The same breathing room after the safe-area inset that `PageHeader`
    // gives every other screen, so Today's title sits on the same line as
    // Library's and Insights' when you switch tabs.
    paddingTop: spacing.lg,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  composer: {
    marginTop: spacing.xs,
  },
  movement: {
    marginTop: spacing.xs,
  },
});
