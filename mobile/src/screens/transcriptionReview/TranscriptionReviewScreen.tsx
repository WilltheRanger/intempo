import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NotationPlaceholder } from '../../components/pieces/NotationPlaceholder';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { TransportControls } from '../../components/playback/TransportControls';
import {
  Card,
  EmptyState,
  IconButton,
  Input,
  MetadataRow,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  SegmentedControl,
  Text,
} from '../../components/primitives';
import { useCapturedPages } from '../../data/captureSession';
import { buildDraft } from '../../data/sources/transcriptionDraft';
import { spacing } from '../../design';
import type { RootNavigation } from '../../navigation/types';

/** Mock playback pace: one measure per beat-ish interval. */
const MOCK_MS_PER_MEASURE = 550;

/**
 * Fixed height for the comparison frame.
 *
 * Both views occupy exactly this box so switching between them changes the
 * content and nothing else — a frame that resizes defeats the comparison.
 */
const COMPARE_HEIGHT = 220;

/**
 * Saving isn't wired to storage, so the flow lands on the library fixture the
 * draft describes rather than inventing a piece that exists nowhere.
 */
const SAVED_PIECE_ID = 'fixture-wohlfahrt-28';

type ScoreView = 'notation' | 'original';

const VIEW_OPTIONS = [
  { value: 'notation' as const, label: 'Notation' },
  { value: 'original' as const, label: 'Original' },
];

/**
 * Frontend-only review of a transcription.
 *
 * Everything here is scaffolding: the notation is structural, playback moves a
 * marker rather than making sound, and the detected details come from a
 * fixture. What it establishes is the shape of the screen — correcting what
 * was detected, and checking the result against the page it came from.
 */
export function TranscriptionReviewScreen() {
  const navigation = useNavigation<RootNavigation>();
  const pages = useCapturedPages();
  const draft = useMemo(() => buildDraft(pages.length), [pages.length]);

  // Detected values are a starting point, not a result — every one of them is
  // editable, because OCR gets composer names and movement titles wrong.
  const [title, setTitle] = useState(draft.title);
  const [composer, setComposer] = useState(draft.composer);
  const [movement, setMovement] = useState(draft.movement ?? '');

  const [editingDetails, setEditingDetails] = useState(false);
  const [view, setView] = useState<ScoreView>('notation');
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
      <PageHeader
        title="Review transcription"
        onBack={() => navigation.goBack()}
        backLabel="Back to pages"
      />

      {editingDetails ? (
        <Card style={styles.details}>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Composition title"
            serif
          />
          <Input
            label="Composer"
            value={composer}
            onChangeText={setComposer}
            placeholder="Composer"
            style={styles.field}
          />
          <Input
            label="Movement"
            value={movement}
            onChangeText={setMovement}
            placeholder="Optional"
            style={styles.field}
          />
          <SecondaryButton
            label="Done"
            onPress={() => setEditingDetails(false)}
            style={styles.field}
          />
        </Card>
      ) : (
        // Detected metadata reads as a summary, not a form. The fields are one
        // tap away for the cases OCR gets wrong, which is what this screen is
        // for — but they don't dominate it until they're needed.
        <View style={styles.summary}>
          <View style={styles.summaryText}>
            <Text variant="pieceTitle" numberOfLines={2}>
              {title || 'Untitled piece'}
            </Text>
            <MetadataRow
              variant="metadataSmall"
              items={[composer, movement]}
              style={styles.summaryMeta}
            />
          </View>

          <Pressable
            onPress={() => setEditingDetails(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit detected details"
            hitSlop={spacing.md}
            style={({ pressed }) => (pressed ? styles.editPressed : undefined)}
          >
            <Text variant="sectionAction" color="accent">
              Edit
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.pageNav}>
        <IconButton
          icon={ChevronLeft}
          label="Previous page"
          onPress={() => goToPage(pageIndex - 1)}
          disabled={pageIndex === 0}
        />
        <Text variant="sectionLabel" color="textSecondary">
          Page {pageIndex + 1} of {pages.length}
        </Text>
        <IconButton
          icon={ChevronRight}
          label="Next page"
          onPress={() => goToPage(pageIndex + 1)}
          disabled={pageIndex >= pages.length - 1}
        />
      </View>

      <Card>
        <SegmentedControl
          label="Score view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />

        <View style={styles.compare}>
          {view === 'notation' ? (
            <NotationPlaceholder measures={measures} currentMeasure={measure} />
          ) : (
            <ScoreThumbnail
              source={pages[pageIndex]?.source ?? null}
              style={styles.original}
            />
          )}
        </View>

        <Text
          variant="metadataSmall"
          color="textTertiary"
          style={styles.measureReadout}
        >
          Measure {measure} of {measures}
        </Text>

        <View style={styles.transport}>
          <TransportControls
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((playing) => !playing)}
            onPrevious={() => setMeasure((m) => Math.max(1, m - 1))}
            onNext={() => setMeasure((m) => Math.min(measures, m + 1))}
            previousDisabled={measure === 1}
            nextDisabled={measure >= measures}
          />
        </View>
      </Card>

      <PrimaryButton
        label="Save piece"
        onPress={() =>
          navigation.navigate('PieceDetail', { pieceId: SAVED_PIECE_ID })
        }
        style={styles.save}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  details: {
    marginTop: spacing.md,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  summaryText: {
    flexShrink: 1,
  },
  summaryMeta: {
    marginTop: spacing.xs,
  },
  editPressed: {
    opacity: 0.6,
  },
  field: {
    marginTop: spacing.lg,
  },
  pageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  compare: {
    height: COMPARE_HEIGHT,
    marginTop: spacing.lg,
    justifyContent: 'center',
  },
  original: {
    width: '100%',
    height: '100%',
  },
  measureReadout: {
    marginTop: spacing.lg,
  },
  transport: {
    marginTop: spacing.md,
  },
  save: {
    marginTop: spacing['2xl'],
  },
});
