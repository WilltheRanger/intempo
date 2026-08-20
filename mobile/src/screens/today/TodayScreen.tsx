import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import { FadeIn } from '../../components/motion';
import {
  Avatar,
  EmptyState,
  PageHeader,
  ScreenContainer,
  SectionHeader,
  Text,
} from '../../components/primitives';
import { ContinueSkeleton } from '../../components/skeletons';
import { useInsights } from '../../data/hooks/useInsights';
import { useLatestTake } from '../../data/hooks/useLatestTake';
import { useMe } from '../../data/hooks/useMe';
import { useCurrentPiece, useLibrary } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { usePreferences } from '../../data/preferences';
import type { Piece } from '../../data/types';
import { describeLoadError } from '../../data/api/describeError';
import { spacing } from '../../design';
import { getGreeting } from '../../lib/greeting';
import { factFor } from '../../lib/facts';
import { formatTendency } from '../../lib/tempo';
import { suggestionsFor } from '../../lib/today';
import type { TabScreenNavigation } from '../../navigation/types';
import { WarmupPanel } from './WarmupPanel';
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
 * The order is deliberate: the two things to play first — the piece you are on
 * and the warmup — then the fact, then the two blocks you read rather than act
 * on. The last two are doors to other screens, so they belong at the foot of
 * this one.
 *
 * **What is not here is the library preview.** Three rows of the Library tab
 * once sat at the bottom of this screen, which made its lower two-thirds a
 * copy of a destination one tap away. The rows below are not that: each names
 * a piece *and the reason it is being raised*. A row without a reason would be
 * a list, and a list belongs in the Library.
 *
 * **Nor is there a "Last take" section any more.** `getCurrentPiece` resolves
 * through the newest analysis, so the piece being continued and the piece last
 * recorded are the same piece by construction — the section was a second copy
 * of the card. Its one piece of information, the pipeline's verdict sentence,
 * moved onto the card where it belongs.
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
  // Likewise the instrument: switching it in the profile has to change the
  // excerpt on the way back, not on the next cold start.
  const { instrument } = usePreferences();

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

  // Straight to a take: what someone means by "continue practicing" is
  // recording one. Reading the score without recording is `PieceScore`,
  // reached from the piece itself.
  function openPractice(target: Piece) {
    navigation.navigate('Record', { pieceId: target.id });
  }

  const take = latestTake.data ?? null;
  const fact = factFor();

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
          description={describeLoadError(currentPiece.error)}
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
        // Only when it is genuinely this piece's take. Against the API it
        // always is; a fixture or a deleted score could disagree, and a
        // verdict about a different piece on this card would be a lie.
        lastTakeHeadline={take && take.pieceId === piece.id ? take.headline : null}
        onContinue={() => openPractice(piece)}
      />

      {/*
        Straight after the piece you are working. Both are things to play, so
        they belong together — the fact below them is the only block on the
        screen that asks nothing of you, and it reads better once the playing
        is done.
      */}
      <FadeIn index={0}>
        <View style={styles.section}>
          <SectionHeader label="Warmup" />
          <WarmupPanel
            instrument={instrument}
            onStart={() => navigation.navigate('Warmup')}
          />
        </View>
      </FadeIn>

      {/*
        Label, lead, detail — the shape stays; the lead is sans now.

        On this screen `pieceTitle` renders five times and three of them name
        something you can play: the warmup above and the two suggestions below.
        A serif lead put the fact in the repertoire's voice while sitting in
        the middle of that run — and five of the twenty-four leads in
        `facts.ts` are outright names of things ("The Chaconne", "Il Cannone",
        "The wolf tone"), so on those days the block was indistinguishable from
        a suggestion row.

        Nothing here is misaligned; the geometry was checked and is exact. It
        is the *meaning* of a style that was wrong, which is why it read as off
        without being locatable. The block is a footnote by its own docstring,
        and sans is it saying so (§3 law 4).
      */}
      <FadeIn index={1}>
        <View style={styles.section}>
          <SectionHeader label="Did you know" />
          <Text variant="body">{fact.lead}</Text>
          <Text
            variant="metadataSmall"
            color="textSecondary"
            style={styles.factText}
          >
            {fact.text}
          </Text>
        </View>
      </FadeIn>

      {attention || neglected ? (
        <FadeIn index={2}>
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
        <FadeIn index={3}>
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
  factText: {
    marginTop: 2,
  },
  section: {
    // One step tighter than it was. At 32pt the blocks read as separate pages
    // of a document rather than as parts of one screen — which is most of what
    // made this feel like a web page.
    marginTop: spacing['2xl'],
  },
});
