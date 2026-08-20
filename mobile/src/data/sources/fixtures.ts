import { verdictFor } from '../../lib/tempo';
import type {
  Band,
  Direction,
  MeasureVerdict,
  Musician,
  Piece,
  PieceInsight,
  ScoreJson,
  ScoreNote,
  TakeResult,
} from '../types';
import { PIECE_HAS_RECORDINGS } from './types';
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
 * These exist so every screen can be developed and driven without a backend.
 * They are the same shape the API adapter produces, so no screen changes when
 * the two are swapped — which is the point of the seam in `sources/index.ts`.
 *
 * The artwork is the repo's own public-domain fixture set from
 * `fixtures/scores/` — each thumbnail is genuinely the piece it claims to be.
 * Provenance and licensing: `fixtures/scores/SOURCES.md`.
 */
interface FixturePiece extends Omit<Piece, 'lastPracticedAt'> {
  /** Resolved to an ISO timestamp at read time so it never goes stale. */
  practicedDaysAgo: number | null;
}


/**
 * A short study every fixture piece shares, so playback has real notes to
 * sound before any score has been through OCR.
 *
 * Two bars of D-major quarters and a held note — deliberately plain. It is
 * standing in for a score, not pretending to be a particular one, and a
 * recognisable tune would invite the comparison.
 */
function quarter(pitch: string): ScoreNote {
  return { pitch, duration: 'quarter', tied_to_next: false };
}

/** A plausible study tempo, so the recorder seeds from the piece. */
const MARKED_BPM = 92;

const DEMO_SCORE: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'D major',
  tempo_marking: null,
  bpm_hint: MARKED_BPM,
  clef: 'treble',
  measures: [
    {
      measure_number: 1,
      notes: ['D4', 'E4', 'F#4', 'G4'].map(quarter),
      slurs: [],
    },
    {
      measure_number: 2,
      notes: ['A4', 'G4', 'F#4', 'E4'].map(quarter),
      slurs: [],
    },
    {
      measure_number: 3,
      notes: [{ pitch: 'D4', duration: 'whole', tied_to_next: false }],
      slurs: [],
    },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: 'Fixture score. Not OCR output.',
};

const FIXTURE_PIECES: FixturePiece[] = [
  {
    id: 'fixture-bach-bwv1001',
    title: 'Sonata No. 1 in G minor, BWV 1001',
    composer: 'J. S. Bach',
    movement: 'I. Adagio',
    // Recorded minutes ago, so it is both the piece to continue and the piece
    // the sample take belongs to — which is what the API adapter produces,
    // since `getCurrentPiece` resolves through the newest analysis.
    practicedDaysAgo: 0,
    thumbnail: require('../../../assets/fixtures/04_handwritten_clean.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  {
    id: 'fixture-kreutzer-02',
    title: '42 Études ou Caprices, No. 2',
    composer: 'Rodolphe Kreutzer',
    movement: null,
    practicedDaysAgo: 5,
    thumbnail: require('../../../assets/fixtures/03_complex_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  {
    id: 'fixture-wohlfahrt-28',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 28 — Allegretto',
    practicedDaysAgo: 12,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  {
    id: 'fixture-wohlfahrt-01',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 1 — Allegro moderato',
    practicedDaysAgo: 26,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  // Appended below so the Today preview — which takes the first three pieces
  // that aren't the featured one — stays exactly as approved. These give the
  // Library screen a repertoire worth scrolling and searching.
  {
    id: 'fixture-mozart-k216',
    title: 'Violin Concerto No. 3 in G major, K. 216',
    composer: 'W. A. Mozart',
    movement: 'I. Allegro',
    practicedDaysAgo: 8,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  {
    id: 'fixture-massenet-meditation',
    title: 'Méditation from Thaïs',
    composer: 'Jules Massenet',
    movement: null,
    practicedDaysAgo: 19,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
  },
  {
    // Just added, never recorded against. Exercises the "Start practice" label
    // and every path that asks whether a piece has any history.
    id: 'fixture-paganini-24',
    title: 'Caprice No. 24 in A minor, Op. 1',
    composer: 'Niccolò Paganini',
    movement: null,
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/03_complex_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
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

/**
 * Pieces added by hand during this run of the app, newest first.
 *
 * In memory and gone on reload, which is the right lifetime for sample data:
 * persisting them would leave a demo build slowly accumulating a library that
 * looks real, and the fixtures exist precisely so that what's on screen is
 * known. The point is that the Add-manually flow *behaves* correctly — the
 * piece appears in the library, opens, and can be practised against — not
 * that it survives.
 */
const CREATED_PIECES: FixturePiece[] = [];

export const fixturePieceSource: PieceSource = {
  async listPieces() {
    return [...CREATED_PIECES, ...FIXTURE_PIECES].map(toPiece);
  },

  async getCurrentPiece() {
    // The seeded piece, even when something was just added. This mirrors
    // `apiPieceSource`, where the piece to continue comes from the newest
    // *analysis* and only falls back to the newest score when there are no
    // analyses at all — and the fixtures do have a take.
    const [mostRecent] = FIXTURE_PIECES;
    return mostRecent ? toPiece(mostRecent) : null;
  },

  async getPiece(id) {
    const match = find(id);
    return match ? toPiece(match) : null;
  },

  async createPiece(input) {
    const created: FixturePiece = {
      id: `manual-${CREATED_PIECES.length + 1}-${input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)}`,
      title: input.title,
      composer: input.composer,
      movement: input.movement,
      practicedDaysAgo: null,
      // No photograph was taken, so there is nothing to show. `ScoreThumbnail`
      // draws its ruled staff for a null source, which is the truthful image
      // for a piece that has no page behind it.
      thumbnail: null,
      markedBpm: input.bpm,
      // No notes: this flow collects a title and a tempo, not a transcription.
      // `warmupScore`-style playback and the analysis pipeline both need
      // measures, so a piece added this way can be practised with the
      // metronome but not analysed — the same limitation the backend has.
      score: {
        clef: input.clef,
        time_signature: input.timeSignature,
        key_signature: null,
        tempo_marking: null,
        bpm_hint: input.bpm,
        measures: [],
        repeats: [],
        ocr_confidence: 0,
        notes_to_human: '',
      },
    };
    CREATED_PIECES.unshift(created);
    return toPiece(created);
  },

  async updatePiece(id, input) {
    const match = find(id);
    if (!match) {
      throw new Error('That piece is no longer in your library.');
    }
    match.title = input.title;
    match.composer = input.composer;
    match.movement = input.movement;
    return toPiece(match);
  },

  async deletePiece(id) {
    // The same refusal the backend gives, for the same reason. Letting the
    // sample data delete a piece the real one would keep would make the demo
    // wrong about a rule that protects practice history — and it is the only
    // way to exercise that path without a live database.
    if (FIXTURE_SESSIONS.some((session) => session.pieceId === id)) {
      throw new Error(PIECE_HAS_RECORDINGS);
    }
    for (const list of [CREATED_PIECES, FIXTURE_PIECES]) {
      const index = list.findIndex((piece) => piece.id === id);
      if (index >= 0) {
        list.splice(index, 1);
        return;
      }
    }
    throw new Error('That piece is no longer in your library.');
  },
};

/** Across both lists — added this session, and seeded. */
function find(id: string): FixturePiece | undefined {
  return [...CREATED_PIECES, ...FIXTURE_PIECES].find((piece) => piece.id === id);
}

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
  // Two of three used, so the quota is visible in the sample data rather than
  // only appearing at the moment someone is refused.
  usage: {
    used: 2,
    limit: 3,
    remaining: 1,
    resets_at: nextMonthStart(),
  },
  avatarUrl: null,
};

/** The first instant of next month, UTC — where the server's quota resets. */
function nextMonthStart(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
}

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
    return buildFixtureTake();
  },

  // One take in the fixture set, so the latest is that one.
  async getLatestTake() {
    return buildFixtureTake();
  },
};

/** The sample take, built fresh so `recordedAt` is always recent. */
function buildFixtureTake(): TakeResult {
  const piece = FIXTURE_PIECES.find(({ id }) => id === 'fixture-bach-bwv1001');
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
    pieceId: 'fixture-bach-bwv1001',
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
}

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
