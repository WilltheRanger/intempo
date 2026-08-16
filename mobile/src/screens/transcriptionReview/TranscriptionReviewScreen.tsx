import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NotationPlaceholder } from '../../components/pieces/NotationPlaceholder';
import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { TransportControls } from '../../components/playback/TransportControls';
import {
  Card,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
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
      <PageHeader eyebrow="Transcription" title={title || 'Untitled piece'} />

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
      </Card>

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
