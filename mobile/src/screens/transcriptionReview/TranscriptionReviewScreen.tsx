import { useNavigation } from '@react-navigation/native';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import {
  Card,
  EmptyState,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { useCapturedPages } from '../../data/captureSession';
import { buildDraft } from '../../data/sources/transcriptionDraft';
import {
  colors,
  disabledOpacity,
  ICON_SIZE,
  ICON_STROKE_WIDTH,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../design';
import type { RootNavigation } from '../../navigation/types';
import { NotationPlaceholder } from './NotationPlaceholder';

/** Mock playback pace: one measure per beat-ish interval. */
const MOCK_MS_PER_MEASURE = 550;

/**
 * Frontend-only review of a transcription.
 *
 * Everything here is scaffolding: the notation is structural, playback moves a
 * marker rather than making sound, and the metadata comes from a fixture. The
 * point is to judge the shape of the screen — how page and measure navigation
 * sit next to playback, and how the original page stays reachable.
 */
export function TranscriptionReviewScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const draft = buildDraft(pages.length);

  const [pageIndex, setPageIndex] = useState(0);
  const [measure, setMeasure] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const measures = draft.measuresPerPage[pageIndex] ?? 0;

  useEffect(() => {
    if (!isPlaying || measures === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setMeasure((current) => (current >= measures ? 1 : current + 1));
    }, MOCK_MS_PER_MEASURE);
    return () => clearTimeout(timer);
  }, [isPlaying, measure, measures]);

  function goToPage(next: number) {
    setPageIndex(next);
    setMeasure(1);
    setIsPlaying(false);
  }

  if (pages.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          title="Nothing to review"
          description="Capture and transcribe a score first."
          actionLabel="Back"
          onActionPress={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader eyebrow="Transcription" title={draft.title} />

      <Text variant="composer" color="textSecondary">
        {draft.composer}
      </Text>
      {draft.movement ? (
        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.movement}
        >
          {draft.movement}
        </Text>
      ) : null}

      <View style={styles.pageNav}>
        <NavButton
          icon={ChevronLeft}
          label="Previous page"
          onPress={() => goToPage(pageIndex - 1)}
          disabled={pageIndex === 0}
        />
        <Text variant="sectionLabel" color="textSecondary">
          Page {pageIndex + 1} of {pages.length}
        </Text>
        <NavButton
          icon={ChevronRight}
          label="Next page"
          onPress={() => goToPage(pageIndex + 1)}
          disabled={pageIndex >= pages.length - 1}
        />
      </View>

      <Card>
        <Text variant="sectionLabel" color="textSecondary">
          Notation
        </Text>

        <View style={styles.notation}>
          <NotationPlaceholder measures={measures} currentMeasure={measure} />
        </View>

        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.measureReadout}
        >
          Measure {measure} of {measures}
        </Text>

        <View style={styles.transport}>
          <NavButton
            icon={SkipBack}
            label="Previous measure"
            onPress={() => setMeasure((m) => Math.max(1, m - 1))}
            disabled={measure === 1}
          />
          <Pressable
            onPress={() => setIsPlaying((playing) => !playing)}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            accessibilityState={{ selected: isPlaying }}
            style={({ pressed }) => [
              styles.playButton,
              pressed && styles.playPressed,
            ]}
          >
            {isPlaying ? (
              <Pause
                size={ICON_SIZE.md}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
              />
            ) : (
              <Play
                size={ICON_SIZE.md}
                strokeWidth={ICON_STROKE_WIDTH}
                color={colors.actionText}
              />
            )}
          </Pressable>
          <NavButton
            icon={SkipForward}
            label="Next measure"
            onPress={() => setMeasure((m) => Math.min(measures, m + 1))}
            disabled={measure >= measures}
          />
        </View>
      </Card>

      <Card style={styles.sourceCard}>
        <Text variant="sectionLabel" color="textSecondary">
          Original page
        </Text>
        <ScoreThumbnail
          source={pages[pageIndex]?.source ?? null}
          style={styles.source}
        />
      </Card>

      <PrimaryButton
        label="Save piece"
        onPress={() => navigation.navigate('PieceDetail')}
        style={styles.save}
      />
    </ScreenContainer>
  );
}

interface NavButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function NavButton({ icon: Icon, label, onPress, disabled }: NavButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.navButton,
        pressed && !disabled && styles.navPressed,
        disabled && styles.navDisabled,
      ]}
    >
      <Icon
        size={ICON_SIZE.md}
        strokeWidth={ICON_STROKE_WIDTH}
        color={disabled ? colors.textTertiary : colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  movement: {
    marginTop: spacing.xs,
  },
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  notation: {
    marginTop: spacing.lg,
  },
  measureReadout: {
    marginTop: spacing.lg,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.md,
  },
  navButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  navPressed: {
    backgroundColor: colors.surfacePressed,
  },
  navDisabled: {
    opacity: disabledOpacity,
  },
  playButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: colors.actionBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPressed: {
    backgroundColor: colors.actionBgPressed,
  },
  sourceCard: {
    marginTop: spacing.md,
  },
  source: {
    width: '100%',
    aspectRatio: 1.5,
    marginTop: spacing.md,
  },
  save: {
    marginTop: spacing['2xl'],
  },
});
