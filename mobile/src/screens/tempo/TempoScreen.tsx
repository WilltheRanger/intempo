import { useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import {
  BackLink,
  EmptyState,
  LoadingState,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { usePiece } from '../../data/hooks/usePieces';
import { practiceTempo, usePracticeTempos } from '../../data/practiceTempo';
import { BORDER_WIDTH, colors, fontFamily, radii, spacing } from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import { loadStateFor } from '../../lib/loadState';
import {
  clampTempo,
  quickPicks,
  recordTap,
  TAP_RESET_MS,
  tapLabel,
  tappedBpm,
  tempoBounds,
} from '../../lib/record/tapTempo';
import {
  displayTempoBpm,
  quarterBpmFromDisplay,
  tempoUnitLabel,
} from '../../lib/tempo';
import { bpmForMarking } from '../../lib/tempoMarking';
import { useReducedMotion } from '../../lib/useReducedMotion';
import type { RootStackParamList } from '../../navigation/types';
import { useGoBack } from '../../navigation/useGoBack';
import { TempoSlider } from './TempoSlider';

/**
 * Tempo, on its own screen (`redesign/Tempo.dc.html`, 2026-09-23).
 *
 * Record shows the number and comes here to change it. One focal point: the
 * tempo itself, in the largest type in the app, with three ways to move it
 * under it — the bar, tapping the pulse, and the quick picks — in the order a
 * musician reaches for them.
 *
 * **Every change is kept as it happens**, in `practiceTempo`, the shared store
 * Record reads. The prototype carried the number back through
 * `sessionStorage`; here there is nothing to carry. "Done" only goes back,
 * and Back does the same — neither can lose a tempo that was already set.
 *
 * Numbers are in the page's beat unit (`displayTempoBpm`), which is the pulse
 * someone taps and the number the page prints. They are converted to the
 * quarter-note clock only when stored.
 */
export function TempoScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Tempo'>>();
  const goBack = useGoBack({ route: 'Record', params: { pieceId: params.pieceId } });
  const { data: piece, isError } = usePiece(params.pieceId);
  usePracticeTempos();
  const reduceMotion = useReducedMotion();

  const [taps, setTaps] = useState<number[]>([]);
  const pulse = useRef(new Animated.Value(1)).current;
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  if (loadStateFor({ isError, hasData: piece !== undefined }) === 'loading') {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }
  if (!piece) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Couldn't open this piece"
          description="It may have been removed from your library."
          actionLabel="Back"
          onActionPress={goBack}
        />
      </ScreenContainer>
    );
  }

  const unit = piece.score?.tempo_beat_unit ?? null;
  const marking = piece.score?.tempo_marking ?? null;
  // A number printed on the page wins; a word alone ("Allegro") is read as
  // what it usually means, and the screen says that is what happened.
  const wordBpm = piece.markedBpm == null ? bpmForMarking(marking) : null;
  const markedQuarter = piece.markedBpm ?? wordBpm;
  const quarter = practiceTempo.for(params.pieceId, markedQuarter);
  const bpm = displayTempoBpm(quarter, unit);
  const marked = markedQuarter == null ? null : displayTempoBpm(markedQuarter, unit);
  const bounds = tempoBounds(bpm, marked);
  const picks = quickPicks(marked, bounds);
  const unitLabel = tempoUnitLabel(unit);

  function set(next: number) {
    practiceTempo.set(params.pieceId, quarterBpmFromDisplay(clampTempo(next, bounds), unit));
  }

  function tap() {
    impact(ImpactFeedbackStyle.Light);
    const next = recordTap(taps, Date.now());
    setTaps(next);
    const tapped = tappedBpm(next, bounds);
    if (tapped !== null) {
      set(tapped);
    }
    // The count lapses after the same pause that would reset it, so the
    // button goes back to "Tap tempo" rather than claiming to still be
    // listening.
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setTaps([]), TAP_RESET_MS);
    if (!reduceMotion) {
      pulse.setValue(0.92);
      Animated.timing(pulse, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }

  const tapping = taps.length > 0;

  return (
    <ScreenContainer
      scrollable={false}
      footer={<PrimaryButton label="Done" onPress={goBack} />}
    >
      <View style={styles.head}>
        <BackLink label="Back" onPress={goBack} />
        <Text variant="eyebrow" color="textTertiary" style={styles.eyebrow} numberOfLines={1}>
          {piece.title}
        </Text>
        <Text variant="screenTitle" accessibilityRole="header" style={styles.title}>
          Tempo
        </Text>
      </View>

      <View style={styles.readout}>
        <Text style={styles.bpm} accessibilityLiveRegion="polite">
          {bpm}
        </Text>
        <Text style={styles.unit}>{unitLabel}</Text>
      </View>

      <TempoSlider
        bpm={bpm}
        bounds={bounds}
        unitLabel={unitLabel}
        onChange={(next) => {
          setTaps([]);
          set(next);
        }}
      />

      <View style={styles.tapRow}>
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <Pressable
            onPress={tap}
            accessibilityRole="button"
            accessibilityLabel={`${tapLabel(taps.length)}. Tap the beat to set the tempo`}
            style={({ pressed }) => [
              styles.tap,
              tapping && styles.tapOn,
              pressed && !tapping && styles.tapPressed,
            ]}
          >
            <Text
              variant="metadata"
              style={[styles.tapLabel, tapping && styles.onLabel]}
            >
              {tapLabel(taps.length)}
            </Text>
          </Pressable>
        </Animated.View>
      </View>

      {picks.length > 0 ? (
        <View style={styles.picks}>
          {picks.map((pick) => {
            const on = pick.bpm === bpm;
            return (
              <Pressable
                key={pick.key}
                onPress={() => {
                  impact(ImpactFeedbackStyle.Light);
                  setTaps([]);
                  set(pick.bpm);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={`${pick.label} ${unitLabel}`}
                style={({ pressed }) => [
                  styles.pick,
                  on && styles.pickOn,
                  pressed && !on && styles.pickPressed,
                ]}
              >
                <Text
                  variant="metadataSmall"
                  numberOfLines={1}
                  style={[styles.pickLabel, on && styles.onLabel]}
                >
                  {pick.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/*
        Only when it is true: a page that names a tempo in words and prints no
        number. It says where "Marked" came from, which is otherwise a number
        the musician has never seen on their page.
      */}
      {wordBpm !== null && marking ? (
        <Text variant="caption" color="textTertiary" style={styles.note}>
          The page says {marking} and gives no metronome mark. Marked is what that
          usually means.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingTop: spacing.md,
  },
  eyebrow: {
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 6,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 10,
    marginTop: 64,
    marginBottom: 44,
  },
  // The largest number in the app, and the only thing on the screen that
  // size: it is what the screen is for (§3 law 4).
  bpm: {
    fontFamily: fontFamily.serifRegular,
    fontSize: 96,
    lineHeight: 96,
    letterSpacing: -3,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 14,
    letterSpacing: 0.9,
    color: colors.textTertiary,
  },
  tapRow: {
    alignItems: 'center',
    marginTop: 28,
  },
  tap: {
    height: 48,
    paddingHorizontal: 26,
    borderRadius: 24,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
  },
  tapPressed: {
    backgroundColor: colors.surfacePressed,
  },
  tapOn: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  tapLabel: {
    fontFamily: fontFamily.sansMedium,
    fontSize: 15,
  },
  onLabel: {
    color: colors.actionText,
  },
  picks: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 36,
  },
  pick: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickOn: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBg,
  },
  pickPressed: {
    backgroundColor: colors.surfacePressed,
  },
  pickLabel: {
    fontVariant: ['tabular-nums'],
  },
  note: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
