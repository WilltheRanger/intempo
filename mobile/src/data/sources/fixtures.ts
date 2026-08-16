import { verdictFor } from '../../lib/tempo';
import type {
  Band,
  Direction,
  MeasureVerdict,
  Musician,
  Piece,
  PieceInsight,
} from '../types';
import type {
  InsightsSource,
  MusicianSource,
  PieceSource,
  TakeSource,
  TakeSubmissionSource,
} from './types';

/**
 * Development fixtures.
 *
 * These exist because the backend has no concept of practice progress, a
 * last-practiced timestamp, a "current" piece, or a readable score image (see
 * the Phase 1 audit). The UI is built against the shape those fields will
 * eventually have so that no screen changes when the endpoints land.
 *
 * The artwork is the repo's own public-domain fixture set from
 * `fixtures/scores/` — each thumbnail is genuinely the piece it claims to be.
 * Provenance and licensing: `fixtures/scores/SOURCES.md`.
 */
interface FixturePiece extends Omit<Piece, 'lastPracticedAt'> {
  /** Resolved to an ISO timestamp at read time so it never goes stale. */
  practicedDaysAgo: number | null;
}

const FIXTURE_PIECES: FixturePiece[] = [
  {
    id: 'fixture-bach-bwv1001',
    title: 'Sonata No. 1 in G minor, BWV 1001',
    composer: 'J. S. Bach',
    movement: 'I. Adagio',
    progress: 0.62,
    practicedDaysAgo: 2,
    thumbnail: require('../../../assets/fixtures/04_handwritten_clean.jpg'),
  },
  {
    id: 'fixture-kreutzer-02',
    title: '42 Études ou Caprices, No. 2',
    composer: 'Rodolphe Kreutzer',
    movement: null,
    progress: 0.34,
    practicedDaysAgo: 5,
    thumbnail: require('../../../assets/fixtures/03_complex_printed.jpg'),
  },
  {
    id: 'fixture-wohlfahrt-28',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 28 — Allegretto',
    progress: 0.81,
    practicedDaysAgo: 12,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
  },
  {
    id: 'fixture-wohlfahrt-01',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 1 — Allegro moderato',
    progress: 1,
    practicedDaysAgo: 26,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
  },
  // Appended below so the Today preview — which takes the first three pieces
  // that aren't the featured one — stays exactly as approved. These give the
  // Library screen a repertoire worth scrolling and searching.
  {
    id: 'fixture-mozart-k216',
    title: 'Violin Concerto No. 3 in G major, K. 216',
    composer: 'W. A. Mozart',
    movement: 'I. Allegro',
    progress: 0.45,
    practicedDaysAgo: 8,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
  },
  {
    id: 'fixture-massenet-meditation',
    title: 'Méditation from Thaïs',
    composer: 'Jules Massenet',
    movement: null,
    progress: 0.9,
    practicedDaysAgo: 19,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
  },
  {
    // Just added, never opened: no progress and no practice date. Exercises
    // the "Start practice" label and the empty-progress path.
    id: 'fixture-paganini-24',
    title: 'Caprice No. 24 in A minor, Op. 1',
    composer: 'Niccolò Paganini',
    movement: null,
    progress: null,
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/03_complex_printed.jpg'),
  },
];

function toPiece({ practicedDaysAgo, ...piece }: FixturePiece): Piece {
  if (practicedDaysAgo === null) {
    return { ...piece, lastPracticedAt: null };
  }
  const practicedAt = new Date();
  practicedAt.setDate(practicedAt.getDate() - practicedDaysAgo);
  return { ...piece, lastPracticedAt: practicedAt.toISOString() };
}

export const fixturePieceSource: PieceSource = {
  async listPieces() {
    return FIXTURE_PIECES.map(toPiece);
  },

  async getCurrentPiece() {
    const [mostRecent] = FIXTURE_PIECES;
    return mostRecent ? toPiece(mostRecent) : null;
  },

  async getPiece(id) {
    const match = FIXTURE_PIECES.find((piece) => piece.id === id);
    return match ? toPiece(match) : null;
  },
};

/**
 * A freshly provisioned account — free tier, student role, no studio, and no
 * profile photo.
 *
 * That is exactly what `/v1/me` writes on first touch
 * (`backend/app/routers/me.py`), so the Profile screen is developed against
 * the state most accounts are actually in rather than a flattering one. The
 * null photo is the same choice: only OAuth sign-ups have one, so the monogram
 * is what most musicians will see and it should be the state under test.
 */
const FIXTURE_MUSICIAN: Musician = {
  id: 'fixture-musician',
  email: 'you@example.com',
  tier: 'free',
  role: 'student',
  studioId: null,
  avatarUrl: null,
};

export const fixtureMusicianSource: MusicianSource = {
  async getMusician() {
    return FIXTURE_MUSICIAN;
  },
};

/** The window Insights reports on. */
const INSIGHTS_WINDOW_DAYS = 30;

/**
 * Practice history for four of the pieces above.
 *
 * Each entry states what an analysis would actually return: a deviation as a
 * percentage of one beat, and the band the pipeline put it in. The display
 * verdict is derived by `verdictFor`, the same function the API adapter uses,
 * so the fixture cannot claim a verdict the real classifier wouldn't.
 *
 * Bands here follow the checked-in defaults in `backend/config.toml` — on to
 * 5%, slight to 10%, clear rush or drag to 20%. Those are server-tunable, so
 * they are stated per entry rather than recomputed here.
 *
 * The deviations are unflattering on purpose. A fixture where everything is on
 * tempo would exercise none of the vocabulary and would design the screen for
 * the one musician who doesn't need it.
 */
const FIXTURE_SESSIONS: {
  pieceId: string;
  sessions: number;
  /** Positive is ahead of the beat, matching the verdict convention. */
  meanDeviationPct: number;
  band: Band;
}[] = [
  { pieceId: 'fixture-wohlfahrt-28', sessions: 12, meanDeviationPct: 12.4, band: 'rush_drag' },
  { pieceId: 'fixture-bach-bwv1001', sessions: 9, meanDeviationPct: -7.6, band: 'slight' },
  { pieceId: 'fixture-mozart-k216', sessions: 5, meanDeviationPct: 7.2, band: 'slight' },
  { pieceId: 'fixture-kreutzer-02', sessions: 8, meanDeviationPct: 2.8, band: 'on' },
];

function directionFor(deviationPct: number, band: Band): Direction {
  if (band === 'on') {
    return 'on';
  }
  return deviationPct > 0 ? 'rush' : 'drag';
}

function toPieceInsight(entry: (typeof FIXTURE_SESSIONS)[number]): PieceInsight {
  const piece = FIXTURE_PIECES.find(({ id }) => id === entry.pieceId);
  const direction = directionFor(entry.meanDeviationPct, entry.band);
  return {
    pieceId: entry.pieceId,
    title: piece?.title ?? 'Unknown piece',
    composer: piece?.composer ?? null,
    sessions: entry.sessions,
    meanDeviationPct: entry.meanDeviationPct,
    band: entry.band,
    direction,
    verdict: verdictFor(entry.band, direction),
  };
}

export const fixtureInsightsSource: InsightsSource = {
  async getInsights() {
    const pieces = FIXTURE_SESSIONS.map(toPieceInsight).sort(
      (a, b) => Math.abs(b.meanDeviationPct) - Math.abs(a.meanDeviationPct),
    );

    const sessions = pieces.reduce((total, piece) => total + piece.sessions, 0);
    if (sessions === 0) {
      return null;
    }

    // Session-weighted, so a piece practised twice doesn't sway the headline
    // as much as one practised a dozen times.
    const meanDeviationPct =
      pieces.reduce(
        (total, piece) => total + piece.meanDeviationPct * piece.sessions,
        0,
      ) / sessions;

    // The headline band comes from the config defaults, stated once here.
    // When this source is replaced the backend supplies it directly.
    const band: Band =
      Math.abs(meanDeviationPct) <= 5
        ? 'on'
        : Math.abs(meanDeviationPct) <= 10
          ? 'slight'
          : Math.abs(meanDeviationPct) <= 20
            ? 'rush_drag'
            : 'severe';
    const direction = directionFor(meanDeviationPct, band);

    return {
      windowDays: INSIGHTS_WINDOW_DAYS,
      sessions,
      meanDeviationPct,
      band,
      direction,
      verdict: verdictFor(band, direction),
      pieces,
    };
  },
};

/**
 * One analysed take, shaped exactly as `result_json` would arrive.
 *
 * Measures are stated drag-positive, the pipeline's own convention, and
 * flipped here the same way the API adapter flips them — so a sign error in
 * the app shows up against the fixture rather than only against a live take.
 *
 * The shape it describes: steady at the top of the page, rushing through the
 * middle, recovering at the end. That is the commonest real fault and the one
 * the trend line exists to show.
 */
const FIXTURE_MEASURES: { measure: number; notes: number; dragPct: number; band: Band }[] = [
  { measure: 1, notes: 4, dragPct: -1.2, band: 'on' },
  { measure: 2, notes: 4, dragPct: -2.8, band: 'on' },
  { measure: 3, notes: 4, dragPct: -4.4, band: 'on' },
  { measure: 4, notes: 4, dragPct: -7.9, band: 'slight' },
  { measure: 5, notes: 4, dragPct: -11.6, band: 'rush_drag' },
  { measure: 6, notes: 4, dragPct: -14.8, band: 'rush_drag' },
  { measure: 7, notes: 4, dragPct: -16.2, band: 'rush_drag' },
  { measure: 8, notes: 4, dragPct: -12.1, band: 'rush_drag' },
  { measure: 9, notes: 4, dragPct: -8.4, band: 'slight' },
  { measure: 10, notes: 4, dragPct: -5.1, band: 'slight' },
  { measure: 11, notes: 4, dragPct: -2.2, band: 'on' },
  { measure: 12, notes: 4, dragPct: 1.6, band: 'on' },
];

const FIXTURE_TAKE_ID = 'fixture-take-1';

export const fixtureTakeSource: TakeSource = {
  async getTake(analysisId) {
    if (analysisId !== FIXTURE_TAKE_ID) {
      return null;
    }
    const piece = FIXTURE_PIECES.find(
      ({ id }) => id === 'fixture-wohlfahrt-28',
    );
    const measures: MeasureVerdict[] = FIXTURE_MEASURES.map((m) => {
      const direction: Direction =
        m.band === 'on' ? 'on' : m.dragPct < 0 ? 'rush' : 'drag';
      return {
        measure: m.measure,
        noteCount: m.notes,
        // Negated, exactly as the API adapter negates the wire value.
        deviationPct: -m.dragPct,
        band: m.band,
        direction,
        verdict: verdictFor(m.band, direction),
      };
    });

    const recordedAt = new Date();
    recordedAt.setMinutes(recordedAt.getMinutes() - 4);

    return {
      id: FIXTURE_TAKE_ID,
      pieceId: 'fixture-wohlfahrt-28',
      pieceTitle: piece?.title ?? 'Unknown piece',
      composer: piece?.composer ?? null,
      recordedAt: recordedAt.toISOString(),
      targetBpm: 96,
      status: 'ok',
      // The pipeline writes this sentence; the screen shows it verbatim.
      headline: 'You rushed across measures 5 to 8, then pulled it back.',
      direction: 'rush',
      verdict: verdictFor('rush_drag', 'rush'),
      lowConfidence: false,
      measures,
      trend: measures.map((m) => m.deviationPct),
      missedNotes: 1,
      extraNotes: 0,
    };
  },
};

/** The take the practice flow lands on while the app runs on fixtures. */
export const FIXTURE_TAKE_ID_FOR_FLOW = FIXTURE_TAKE_ID;

/** How long the fixture pretends the pipeline took. */
const MOCK_ANALYSIS_MS = 2200;

/**
 * The fixture submission: throws the audio away and returns the sample take.
 *
 * The recording itself was real — the microphone, the WAV, the duration are
 * all genuine, which is what makes the permission and capture paths testable
 * without a backend. Only the destination is fake.
 *
 * It waits, because a result that lands instantly would hide the one bit of
 * the flow that has to feel considered.
 */
export const fixtureTakeSubmissionSource: TakeSubmissionSource = {
  async submit() {
    await new Promise((resolve) => setTimeout(resolve, MOCK_ANALYSIS_MS));
    return FIXTURE_TAKE_ID_FOR_FLOW;
  },
};
