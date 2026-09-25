import { wasTimed } from '../../lib/verdict/measureReading';
import { verdictFor } from '../../lib/tempo';
import { judgeAggregate } from '../../lib/insights/tendency';
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
  ThumbnailSource,
  UntimedReason,
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
 * These exist so every screen can be developed and driven without a backend.
 * They are the same shape the API adapter produces, so no screen changes when
 * the two are swapped — which is the point of the seam in `sources/index.ts`.
 *
 * The artwork is the repo's own public-domain fixture set from
 * `fixtures/scores/` — each thumbnail is genuinely the piece it claims to be.
 * Provenance and licensing: `fixtures/scores/SOURCES.md`.
 */
interface FixturePiece
  extends Omit<
    Piece,
    | 'lastPracticedAt'
    | 'pages'
    | 'transcriptionStatus'
    | 'transcriptionStage'
    | 'transcriptionError'
    | 'transcriptionAccepted'
    | 'pageImageDiscarded'
  > {
  /**
   * Extra photographed pages, after the one `thumbnail` holds.
   *
   * Omitted by every one-page piece, which is most of them — `toPiece` derives
   * the single-page list from the thumbnail. Declaring it is how a fixture says
   * "this is a part somebody photographed four pages of", which is a state the
   * piece screen had no fixture for and therefore nobody had looked at.
   */
  morePages?: ThumbnailSource[];
  /** Resolved to an ISO timestamp at read time so it never goes stale. */
  practicedDaysAgo: number | null;
  /**
   * Anything about the reading that is not "finished, and accepted by nobody".
   *
   * **A state with no fixture is a state nobody has looked at**, and that has
   * now cost this project twice: a null clef was captioned "Treble clef" for
   * weeks, and the ruled-staff cover drew an 84×154 box of pure padding
   * because no piece here had ever lacked a photograph. `reading` and `failed`
   * were in the same position — they are what a musician sees in the moments
   * *after scanning a page*, which is the most-reached screen the app has for
   * a new user, and neither had ever been on screen in a build anyone can run.
   */
  reading?: Partial<
    Pick<
      Piece,
      | 'transcriptionStatus'
      | 'transcriptionStage'
      | 'transcriptionError'
      | 'transcriptionAccepted'
      | 'pageImageDiscarded'
    >
  >;
}

/**
 * Sample pieces are always finished being read.
 *
 * There is no backend in this build, so there is no worker and nothing to
 * wait for. Filled in here rather than repeated on every fixture, which would
 * be eight copies of a constant.
 */
const TRANSCRIBED = {
  transcriptionStatus: 'done',
  transcriptionStage: null,
  transcriptionError: null,
  // Not accepted: the sample pieces keep their artwork, which is the whole
  // reason a library screen has anything to look at in this build.
  transcriptionAccepted: false,
  pageImageDiscarded: false,
} as const;


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

/**
 * A study long enough for the start-bar picker to have more than one page.
 *
 * **Every other score here is eight bars or fewer**, so the picker's pagination
 * — the thing it was rebuilt for — had no fixture and had never been rendered.
 * Its rules are unit-tested (`pages.ts`, `barPages.ts`), and by this project's
 * own reckoning a state with no fixture is a state nobody has looked at.
 *
 * Continuous eighths, which is what Op. 45 No. 1 actually is: `SOURCES.md`
 * documents `01_simple_printed.jpg` — the photograph already attached to this
 * piece — as reading back thirty-two eighths and nothing else. So this is the
 * right shape for the piece it belongs to rather than filler chosen for length.
 *
 * Standing in for the étude, not claiming to be it note for note, the same way
 * `bass_excerpt.musicxml` stands in for what an OMR engine emits. The figure is
 * a scale run and a broken chord alternating, over the first-position C major a
 * first study stays inside.
 */
function eighth(pitch: string): ScoreNote {
  return { pitch, duration: 'eighth', tied_to_next: false };
}

const FIRST_POSITION_C = [
  'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4',
  'A4', 'B4', 'C5', 'D5', 'E5',
];

const CONTINUOUS_EIGHTHS_SCORE: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'C major',
  tempo_marking: 'Allegro moderato',
  bpm_hint: MARKED_BPM,
  clef: 'treble',
  measures: Array.from({ length: 32 }, (_, bar) => ({
    measure_number: bar + 1,
    notes: Array.from({ length: 8 }, (_, at) => {
      // Alternating bars: a step-wise run, then the same span in thirds. Two
      // shapes rather than one, so a reader can see which bar they are on.
      const from = bar % 5;
      const step = bar % 2 === 0 ? at : at * 2;
      const rising = Math.floor(bar / 2) % 2 === 0;
      const index = rising ? from + step : from + 12 - step;
      return eighth(
        FIRST_POSITION_C[
          Math.max(0, Math.min(FIRST_POSITION_C.length - 1, index))
        ],
      );
    }),
    slurs: [],
  })),
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: 'Fixture score. Not OCR output.',
};

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

/**
 * A reading that is internally consistent and wrong, which is the pair of
 * failures `proposals.ts` exists for.
 *
 * **Neither is visible to any other check on the score screen.** Bar 1 carries
 * C3 — a whole tone below the violin's open G, a note the part cannot play —
 * and the bar still sums to four beats, so the beat check is happy and the
 * engraver draws it without complaint. Bar 2 reads the same A twice and comes
 * out at five, which the beat check *does* catch, and which nothing could
 * previously offer a correction for.
 *
 * Both shapes are taken from what OCR actually does rather than invented: a
 * notehead placed a line too low or under a misread clef, and a notehead read
 * twice. The measured case behind the first is on the live project — a real
 * 25-bar part that came back at exactly 4.00 beats a bar with C3 on a violin.
 *
 * A fixture for the same reason the four above it exist: a state with no
 * fixture is a state nobody looks at, and this build is the one the screens
 * are checked in.
 */
const MISREAD_SCORE: ScoreJson = {
  ...DEMO_SCORE,
  measures: [
    {
      measure_number: 1,
      notes: ['C3', 'E4', 'F#4', 'G4'].map(quarter),
      slurs: [],
    },
    {
      measure_number: 2,
      notes: ['A4', 'A4', 'G4', 'F#4', 'E4'].map(quarter),
      slurs: [],
    },
    {
      measure_number: 3,
      notes: [{ pitch: 'D4', duration: 'whole', tied_to_next: false }],
      slurs: [],
    },
  ],
  notes_to_human: 'Fixture score. Not OCR output.',
};

/**
 * The same music with the dynamic its page actually prints.
 *
 * **Dynamics are drawn, so one has to be here.** `musicxml.py` has pulled them
 * out since Batch 2 and `ScoreNote.dynamics` has carried them just as long;
 * nothing put them on a stave until now, and a state with no fixture is a
 * state nobody looks at — which has cost this project four times already.
 *
 * The mark is not invented. `fixtures/scores/SOURCES.md` records that the
 * opening staff of Wohlfahrt Op. 45 No. 28 prints an **f**, and the cached
 * reading of that page (`02_medium_printed.jpg`) is the one place in the whole
 * fixture corpus where a dynamic survives OCR — a single `f`, on the first
 * note. This is that note. No. 1's entry in the same file says its line has
 * "no titles or dynamics", which is why the two studies no longer share a
 * score and why nothing was added to No. 1.
 */
const DYNAMIC_SCORE: ScoreJson = {
  ...DEMO_SCORE,
  tempo_marking: 'Allegretto',
  measures: DEMO_SCORE.measures.map((measure, index) =>
    index === 0
      ? {
          ...measure,
          notes: measure.notes.map((note, at) =>
            at === 0 ? { ...note, dynamics: 'f' as const } : note,
          ),
        }
      : measure,
  ),
};

/**
 * The same music, with nothing having read a clef off the page.
 *
 * A real state, not a broken one: `ScoreJson.clef` is nullable because an
 * imported MusicXML file need not state one, `PATCH` accepts an explicit null
 * as an answer, and a page can simply be photographed from the middle of a
 * part. The fixture build had no piece in it, so the screen that handles the
 * case could not be looked at without a live backend — which is how it came to
 * caption the guess "Treble clef" for as long as it did.
 */
const UNREAD_CLEF_SCORE: ScoreJson = { ...DEMO_SCORE, clef: null };

/**
 * A study written across the engraver's whole range, so the glyphs can be *seen*.
 *
 * **Why a second fixture score exists at all.** `DEMO_SCORE` is quarters and a
 * whole note, and every fixture piece shared it — so the sixteenths, the
 * augmentation dots, the flag on a lone eighth and the second beam had unit
 * tests for their geometry and no picture anywhere in the app. A flag curving
 * the wrong way, a dot sitting on a line instead of in the space beside it, or
 * a stub pointing away from its beat all pass every assertion in
 * `engrave.test.ts` and are obvious the moment a musician looks at them.
 *
 * Six bars, each carrying one thing that was previously undrawable:
 *
 * 1. sixteenths in fours — double beams, four groups
 * 2. dotted eighth + sixteenth — the stub, which is the rhythm that was drawn
 *    wrong (two full beams says both notes are sixteenths)
 * 3. a dotted quarter, an eighth alone between rests — the flag — and a flat
 * 4. a triplet, bracketed
 * 5. a half rest
 * 6. a whole note
 *
 * A minor, so the only accidental is the leading note: this engraver draws no
 * key signature, so a piece in D major would print a sharp on every F and the
 * picture would be about accidentals instead of about rhythm.
 *
 * Not a transcription of anything. The Kreutzer study it stands in for is
 * genuinely a page of continuous sixteenths (`fixtures/scores/SOURCES.md`),
 * which is why it is the piece that carries this rather than the Bach.
 */
function note(pitch: string, duration: string): ScoreNote {
  return { pitch, duration, tied_to_next: false } as ScoreNote;
}

function rest(duration: string): ScoreNote {
  return { pitch: 'rest', duration, tied_to_next: false } as ScoreNote;
}

const FINE_VALUES_SCORE: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'A minor',
  tempo_marking: 'Allegro moderato',
  bpm_hint: 84,
  clef: 'treble',
  measures: [
    {
      measure_number: 1,
      notes: ['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G#5', 'A5', 'G#5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G#4'].map(
        (pitch) => note(pitch, 'sixteenth'),
      ),
      slurs: [],
    },
    {
      measure_number: 2,
      notes: [
        note('A4', 'dotted_eighth'),
        note('B4', 'sixteenth'),
        note('C5', 'dotted_eighth'),
        note('D5', 'sixteenth'),
        note('E5', 'quarter'),
        note('D5', 'quarter'),
      ],
      slurs: [],
    },
    {
      measure_number: 3,
      notes: [
        note('C5', 'dotted_quarter'),
        rest('eighth'),
        // A flat, deliberately. Until Bravura landed, `accidentalOf` returned
        // only sharps and this note was engraved as a plain B — a different
        // note, printed as though it were right.
        note('Bb4', 'quarter'),
        rest('eighth'),
        note('A4', 'eighth'),
      ],
      slurs: [],
    },
    {
      measure_number: 4,
      // A triplet, which was dropped entirely until `engrave.ts` could draw the
      // bracket: three eighths with no bracket over them is a bar half again as
      // long as the page says, in the same ink as the bars that are right.
      notes: [
        note('E5', 'triplet_quarter'),
        note('D5', 'triplet_quarter'),
        note('C5', 'triplet_quarter'),
        note('B4', 'quarter'),
        note('A4', 'quarter'),
      ],
      slurs: [],
    },
    {
      measure_number: 5,
      notes: [note('C5', 'half'), rest('half')],
      slurs: [],
    },
    {
      measure_number: 6,
      // **A fermata over the final long note**, which is where most of them
      // are printed. It is here because a fermata is now drawn and a state
      // with no fixture is a state nobody looks at — and because this is the
      // mark that explains the app's own output: `classification.py` refuses
      // to time the note *after* a fermata, so a verdict shows a note it
      // declined to judge and the stave has to say why.
      notes: [{ ...note('A4', 'whole'), fermata: true }],
      slurs: [],
    },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: 'Fixture score. Not OCR output.',
};

/**
 * A page headed with a word and no metronome mark — which is most of the
 * repertoire printed before about 1830, and the case the practice tempo used
 * to answer with a flat 80.
 *
 * `bpm_hint` is null because nothing on such a page states a number, and the
 * importer only fills it from a mark it has actually read. What the app does
 * with the word instead is a convention (`lib/tempoMarking.ts`), which is why
 * the Record screen names the marking underneath the number it seeded.
 */
const WORD_MARKED_SCORE: ScoreJson = {
  ...DEMO_SCORE,
  tempo_marking: 'Quasi presto',
  bpm_hint: null,
};

/**
 * A part that changes key twice, so the change is something a screen can be
 * looked at with.
 *
 * Bass clef, in B-flat, turning to G major at bar 5 and to C major at bar 7 —
 * the second change is the one that prints *naturals*, because a change to a
 * key with no accidentals would otherwise print nothing and be invisible.
 * Every pitch is spelled absolutely, the way OCR delivers them: the E-flats and
 * B-flats of the opening print no accidental under the signature, the F sharps
 * after bar 5 print none either, and the F and B naturals after bar 7 need none
 * once the flats and the sharp are cancelled. That is the whole reason the
 * change has to be drawn — read against the opening signature, every one of
 * those bars is a wrong note.
 */
/**
 * A bass study that climbs into tenor clef and comes back down.
 *
 * **The state nobody had looked at.** `Measure.clef` has been in the schema
 * and stamped by the importer for a while; nothing in the app drew it, so a
 * part written this way came out placed entirely against its opening bass
 * clef — every note of the tenor passage a sixth off, drawn as confidently as
 * the ones that were right. There was no fixture with a clef change, which is
 * why it went unseen, and this repository has paid for a missing fixture five
 * times already.
 *
 * The return to bass at bar 5 is not decoration either: it is the case a
 * header comparison silently drops, because bar 5 states the clef the piece
 * opened in.
 *
 * Simandl again, because tenor clef in a double-bass method book is ordinary
 * writing rather than an edge case.
 */
const CLEF_CHANGE_SCORE: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'C major',
  tempo_marking: 'Moderato',
  bpm_hint: 66,
  clef: 'bass',
  measures: [
    {
      measure_number: 1,
      notes: [note('G2', 'quarter'), note('C3', 'quarter'), note('E3', 'quarter'), note('G3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 2,
      notes: [note('C4', 'half'), note('B3', 'quarter'), note('A3', 'quarter')],
      slurs: [],
    },
    {
      // Into tenor for the high passage, which is what the clef is for.
      measure_number: 3,
      clef: 'tenor',
      notes: [note('G3', 'quarter'), note('C4', 'quarter'), note('E4', 'quarter'), note('G4', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 4,
      notes: [note('A4', 'half'), note('G4', 'half')],
      slurs: [],
    },
    {
      // And back down. Bar 5 states the clef the piece opened in.
      measure_number: 5,
      clef: 'bass',
      notes: [note('E3', 'quarter'), note('C3', 'quarter'), note('G2', 'quarter'), note('C3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 6,
      notes: [note('C3', 'whole')],
      slurs: [],
    },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: 'Fixture score. Not OCR output.',
};

const KEY_CHANGE_SCORE: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'Bb major',
  tempo_marking: 'Andante',
  bpm_hint: 72,
  clef: 'bass',
  measures: [
    {
      measure_number: 1,
      notes: [note('Bb2', 'quarter'), note('D3', 'quarter'), note('F3', 'quarter'), note('Bb3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 2,
      notes: [note('Eb3', 'half'), note('D3', 'quarter'), note('C3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 3,
      notes: [note('Bb2', 'eighth'), note('C3', 'eighth'), note('D3', 'eighth'), note('Eb3', 'eighth'), note('F3', 'half')],
      slurs: [],
    },
    {
      measure_number: 4,
      notes: [note('F3', 'half'), note('F2', 'half')],
      slurs: [],
    },
    {
      measure_number: 5,
      key_signature: 'G major',
      notes: [note('G2', 'quarter'), note('B2', 'quarter'), note('D3', 'quarter'), note('F#3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 6,
      notes: [note('G3', 'half'), note('F#3', 'quarter'), note('E3', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 7,
      key_signature: 'C major',
      notes: [note('E3', 'quarter'), note('F3', 'quarter'), note('G3', 'quarter'), note('B2', 'quarter')],
      slurs: [],
    },
    {
      measure_number: 8,
      notes: [note('C3', 'whole')],
      slurs: [],
    },
  ],
  repeats: [],
  ocr_confidence: 0.96,
  notes_to_human: '',
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
    markedBpm: 84,
    // The one piece with fine values in it — see `FINE_VALUES_SCORE`.
    score: FINE_VALUES_SCORE,
  },
  {
    id: 'fixture-wohlfahrt-28',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 28 — Allegretto',
    practicedDaysAgo: 12,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: DYNAMIC_SCORE,
  },
  {
    id: 'fixture-wohlfahrt-01',
    title: '60 Studies for the Violin, Op. 45',
    composer: 'Franz Wohlfahrt',
    movement: 'No. 1 — Allegro moderato',
    practicedDaysAgo: 26,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    /**
     * **The one multi-page part in the library**, because a scan of more than
     * one page had no fixture and so nobody had looked at it.
     *
     * The piece screen's own row says "The pages this piece was read from" and
     * drew a single image; with every fixture one page long, that read as
     * correct. A thirty-two bar study is exactly the length that runs to three
     * pages in a real part.
     */
    morePages: [
      require('../../../assets/fixtures/02_medium_printed.jpg'),
      require('../../../assets/fixtures/03_complex_printed.jpg'),
    ],
    markedBpm: MARKED_BPM,
    // The long one — see `CONTINUOUS_EIGHTHS_SCORE`. This piece carries the
    // photograph the corpus reads back as continuous eighths, so it is where a
    // thirty-two-bar study belongs.
    score: CONTINUOUS_EIGHTHS_SCORE,
  },
  // Appended below so the Today preview — which takes the first three pieces
  // that aren't the featured one — stays exactly as approved. These give the
  // Library screen a repertoire worth scrolling and searching.
  {
    id: 'fixture-key-change-study',
    title: 'Study in B♭, turning to G',
    composer: 'Franz Simandl',
    movement: 'New Method for the Double Bass',
    practicedDaysAgo: 33,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    markedBpm: 72,
    // The one piece whose key changes — see `KEY_CHANGE_SCORE`.
    score: KEY_CHANGE_SCORE,
  },
  {
    id: 'fixture-clef-change-study',
    title: 'Study climbing into tenor clef',
    composer: 'Franz Simandl',
    movement: 'New Method for the Double Bass',
    practicedDaysAgo: 34,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    markedBpm: 66,
    // The one piece whose clef changes — see `CLEF_CHANGE_SCORE`.
    score: CLEF_CHANGE_SCORE,
  },
  {
    /**
     * The piece the proof-reading screen has something to say about.
     *
     * See `MISREAD_SCORE`: a note the violin cannot play in a bar that adds up,
     * and a bar that reads a note twice. Without it the check ships with only
     * its empty state reachable in the build the screens are looked at in.
     */
    id: 'fixture-misread-reading',
    title: 'Sonata in G minor, HWV 364a',
    composer: 'G. F. Handel',
    movement: 'I. Larghetto',
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
    markedBpm: MARKED_BPM,
    score: MISREAD_SCORE,
  },
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
    // The one piece whose clef nobody read — see `UNREAD_CLEF_SCORE`.
    score: UNREAD_CLEF_SCORE,
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
    // No metronome mark on the page — see `WORD_MARKED_SCORE`.
    markedBpm: null,
    score: WORD_MARKED_SCORE,
  },
  {
    /**
     * **A piece whose photograph is gone, which is the ordinary end state.**
     *
     * `POST /v1/scores/:id/accept` discards the page once a musician has
     * confirmed the reading — deliberately, and it is the only thing that
     * does. So a library that has been used for a while is mostly pieces that
     * look like this, and until now **not one fixture did**: every cover in
     * every sweep came from a photograph, and the fallback path was never on
     * screen.
     *
     * That gap has already cost this project once. `UNREAD_CLEF_SCORE` a few
     * hundred lines up exists because the same was true of a null clef — "the
     * fixture build had no piece in it, so the screen that handles the case
     * could not be looked at without a live backend, which is how it came to
     * caption the guess *Treble clef* for as long as it did." The owner
     * reported this one too: a deleted photograph "creates some really large
     * box for that piece."
     *
     * The composer is one `canonical` knows, so this is also the piece that
     * will show a portrait the day `PORTRAITS` has one.
     */
    id: 'fixture-brahms-sonata-1',
    title: 'Violin Sonata No. 1 in G major, Op. 78',
    composer: 'Johannes Brahms',
    movement: 'I. Vivace ma non troppo',
    practicedDaysAgo: 3,
    thumbnail: null,
    markedBpm: MARKED_BPM,
    score: DEMO_SCORE,
    // The photograph is gone *because* the reading was accepted. Saying so
    // keeps the two facts from disagreeing — the score screen stops asking a
    // musician to confirm a reading they have already confirmed.
    reading: { transcriptionAccepted: true, pageImageDiscarded: true },
  },
  {
    /**
     * **A page still being read**, which is where a musician lands the moment
     * they finish a scan — the most-reached screen the app has for someone
     * new, and one no fixture had ever put on screen.
     *
     * The stage is one the worker really writes (`fixtures/stages/parity.json`
     * is the contract) and it is the one with measured progress inside it, so
     * this exercises the stave counter rather than only the static bar.
     */
    id: 'fixture-reading-in-progress',
    title: 'Sonata in A minor, D. 385',
    composer: 'Franz Schubert',
    movement: null,
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/02_medium_printed.jpg'),
    markedBpm: null,
    score: null,
    reading: {
      transcriptionStatus: 'reading',
      transcriptionStage: 'Reading stave 3 of 7',
    },
  },
  {
    /**
     * **A three-page scan, mid-read**, which is the state the queue under the
     * bar exists for and which no fixture could produce.
     *
     * `Reading page 2 of 3` is a stage the worker really writes
     * (`fixtures/stages/parity.json` is the contract) and it is the only one
     * that says which page is in hand — so it is the only one that can put
     * "Waiting for page 2" on screen. Every other reading fixture is one page
     * long, and `pageStates` returns null for those by design, which means the
     * whole block was unreachable in the build this project actually looks at.
     *
     * Three pages rather than two: two makes "read / reading" and never shows a
     * page waiting behind another, which is the fact the queue was added to
     * state.
     */
    id: 'fixture-reading-multipage',
    title: 'Partita No. 2 in D minor, BWV 1004',
    composer: 'J. S. Bach',
    movement: 'Allemanda',
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    morePages: [
      require('../../../assets/fixtures/02_medium_printed.jpg'),
      require('../../../assets/fixtures/03_complex_printed.jpg'),
    ],
    markedBpm: null,
    score: null,
    reading: {
      transcriptionStatus: 'reading',
      transcriptionStage: 'Reading page 2 of 3',
    },
  },
  {
    /**
     * **A page accepted and not yet started**, which is every second page of
     * every multi-page scan: the server reads a bounded number at once, so a
     * three-page part spends most of its wait here.
     *
     * The fourth `transcription_status` and the only one no fixture had. It is
     * not a cosmetic variant of `reading`: the panel prints a different
     * sentence for it — *"Waiting for another page to finish"*, chosen because
     * "Getting ready" described the app rather than what is happening — and
     * `QUEUED_PROGRESS` puts the bar at 5% rather than in the reading band.
     * A sentence and a bar position nobody had seen together.
     *
     * `transcriptionStage` is **null**, which is what makes it queued: the
     * worker has said nothing yet. Giving it a stage would render as `reading`
     * with a different status word and check nothing.
     */
    id: 'fixture-reading-queued',
    title: 'Six Suites for Solo Cello, BWV 1010',
    composer: 'J. S. Bach',
    movement: 'Sarabande',
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/01_simple_printed.jpg'),
    markedBpm: null,
    score: null,
    reading: {
      transcriptionStatus: 'queued',
      transcriptionStage: null,
    },
  },
  {
    /**
     * **A page the reader could not make sense of.**
     *
     * The reason is one `_FAILURE_REASONS` actually produces, and it is the
     * one written for a musician rather than for a server log — the whole
     * point of that table. A fixture that invented its own wording would be
     * checking a screen against a sentence the product never sends.
     */
    id: 'fixture-reading-failed',
    title: 'Concerto in A minor, Op. 3 No. 6',
    composer: 'Antonio Vivaldi',
    movement: null,
    practicedDaysAgo: null,
    thumbnail: require('../../../assets/fixtures/04_handwritten_clean.jpg'),
    markedBpm: null,
    score: null,
    reading: {
      transcriptionStatus: 'failed',
      transcriptionError:
        'A flatter, better-lit shot of the page usually fixes it.',
    },
  },
];

function toPiece({
  practicedDaysAgo,
  reading,
  morePages,
  ...piece
}: FixturePiece): Piece {
  const state = { ...TRANSCRIBED, ...reading };
  // A piece whose photograph was discarded has no pages to show, which is the
  // same thing the API says about it — the thumbnail is already null there.
  const pages = piece.thumbnail
    ? [piece.thumbnail, ...(morePages ?? [])]
    : [];
  if (practicedDaysAgo === null) {
    return { ...piece, ...state, pages, lastPracticedAt: null };
  }
  const practicedAt = new Date();
  practicedAt.setDate(practicedAt.getDate() - practicedDaysAgo);
  return {
    ...piece,
    ...state,
    pages,
    lastPracticedAt: practicedAt.toISOString(),
  };
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

/**
 * Whether the sample data describes an account with **nothing in it**.
 *
 * **The state every single musician meets first, and the one no build has.**
 * Today, Library and Insights have only ever been seen populated — a library,
 * a take, thirty days of trend — because that is what these fixtures hold.
 * CLAUDE.md names it as the sixth time a state with nothing to render it cost
 * this project a real bug: on 2026-09-02 Today was found telling a new
 * musician *"Nothing to practice yet"* directly above a fully built daily
 * warmup it was hiding from them.
 *
 * Its own answer was *"five one-line edits to `fixtures.ts` … then `git
 * checkout --` the file"*, which is a ritual with a revert in it, and a revert
 * somebody has to remember is how `.env` gets committed. This is the same five
 * edits with the remembering taken out.
 *
 * **Build-time and text-substituted.** `process.env.EXPO_PUBLIC_…` is written
 * out in full because Expo replaces the literal expression; a destructured or
 * computed lookup reads an empty object in the bundle, which is the trap
 * `environment.ts` documents. Unset, this constant folds to `false` and every
 * branch below it is dead code.
 *
 * It can do nothing to a live build: `sources/index.ts` reaches this module
 * only when no backend was configured. The worst it can do is make a *sample*
 * build look empty, which is what it is for.
 */
const EMPTY_ACCOUNT: boolean = process.env.EXPO_PUBLIC_FIXTURES === 'empty';

export const fixturePieceSource: PieceSource = {
  async listPieces() {
    if (EMPTY_ACCOUNT) {
      return [];
    }
    return [...CREATED_PIECES, ...FIXTURE_PIECES].map(toPiece);
  },

  async getCurrentPiece() {
    if (EMPTY_ACCOUNT) {
      return null;
    }
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
    for (const list of [CREATED_PIECES, FIXTURE_PIECES]) {
      const index = list.findIndex((piece) => piece.id === id);
      if (index >= 0) {
        list.splice(index, 1);
        // Match the live endpoint: deleting a piece also deletes the practice
        // history whose meaning depends on that piece.
        for (let session = FIXTURE_SESSIONS.length - 1; session >= 0; session -= 1) {
          if (FIXTURE_SESSIONS[session].pieceId === id) {
            FIXTURE_SESSIONS.splice(session, 1);
          }
        }
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
  // A name and an instrument, and **onboarded**. The fixture build has to
  // develop the app that comes *after* the question, because that is where
  // almost all of it is — the onboarding screen has its own fixture below.
  displayName: 'Alex',
  instrument: 'violin',
  onboarded: true,
  // Consent always starts off. The fixture must not silently retain pages.
  trainingConsent: false,
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
 * Practice history for five of the pieces above.
 *
 * Each entry states what an analysis would actually return: two deviations as
 * percentages of one beat. The band, direction and display verdict are all
 * derived by the same functions the API adapter uses, so the fixture cannot
 * claim a verdict the real classifier wouldn't — it used to restate the band
 * per entry and reimplement the thresholds below, which was a third copy of
 * numbers that live in `backend/config.toml`.
 *
 * The deviations are unflattering on purpose. A fixture where everything is on
 * tempo would exercise none of the vocabulary and would design the screen for
 * the one musician who doesn't need it.
 *
 * **`fixture-paganini-24` is the piece that wanders**, and it is here because
 * a state with no fixture is a state nobody has looked at. Its bias sits inside
 * tolerance and its distance from the beat does not — the case where naming a
 * direction is false and "On tempo" is worse, and the only case in which the
 * bar draws both ways. Everything else in this list drifts one way, so the two
 * readings sit side by side in one build.
 */
const FIXTURE_SESSIONS: {
  pieceId: string;
  sessions: number;
  /** Positive is ahead of the beat, matching the verdict convention. */
  meanDeviationPct: number;
  /** Distance from the beat either way — never below `|meanDeviationPct|`. */
  spreadPct: number;
}[] = [
  { pieceId: 'fixture-wohlfahrt-28', sessions: 12, meanDeviationPct: 12.4, spreadPct: 13.1 },
  { pieceId: 'fixture-paganini-24', sessions: 6, meanDeviationPct: 1.4, spreadPct: 11.8 },
  { pieceId: 'fixture-bach-bwv1001', sessions: 9, meanDeviationPct: -7.6, spreadPct: 8.4 },
  { pieceId: 'fixture-mozart-k216', sessions: 5, meanDeviationPct: 7.2, spreadPct: 8.0 },
  { pieceId: 'fixture-kreutzer-02', sessions: 8, meanDeviationPct: 2.8, spreadPct: 3.1 },
];

/**
 * The thresholds the fixtures were "judged" by: the shipped defaults from
 * `backend/config.toml`.
 *
 * Stated rather than left null so the demo exercises the same path live takes
 * do. A null here would mean every chart in development ran on the fallback in
 * `lib/tempo.ts`, and a bug in reading the real numbers would only surface
 * against a server.
 */
const FIXTURE_TOLERANCE = {
  rushing_inner_pct: 5,
  rushing_mid_pct: 10,
  rushing_outer_pct: 20,
  dragging_inner_pct: 5,
  dragging_mid_pct: 10,
  dragging_outer_pct: 20,
} as const;

function toPieceInsight(entry: (typeof FIXTURE_SESSIONS)[number]): PieceInsight {
  const piece = FIXTURE_PIECES.find(({ id }) => id === entry.pieceId);
  return {
    pieceId: entry.pieceId,
    title: piece?.title ?? 'Unknown piece',
    composer: piece?.composer ?? null,
    sessions: entry.sessions,
    meanDeviationPct: entry.meanDeviationPct,
    spreadPct: entry.spreadPct,
    ...judgeAggregate(entry.meanDeviationPct, FIXTURE_TOLERANCE),
    tolerance: FIXTURE_TOLERANCE,
  };
}

export const fixtureInsightsSource: InsightsSource = {
  async getInsights() {
    if (EMPTY_ACCOUNT) {
      return null;
    }
    // Furthest from the beat first, the same ordering the API adapter uses —
    // and not by bias, which buried the piece that wanders at the bottom of a
    // list whose first row is what Today reads.
    const pieces = FIXTURE_SESSIONS.map(toPieceInsight).sort(
      (a, b) => b.spreadPct - a.spreadPct,
    );

    const sessions = pieces.reduce((total, piece) => total + piece.sessions, 0);
    if (sessions === 0) {
      return null;
    }

    // Session-weighted, so a piece practised twice doesn't sway the headline
    // as much as one practised a dozen times.
    const weighted = (pick: (piece: PieceInsight) => number) =>
      pieces.reduce((total, piece) => total + pick(piece) * piece.sessions, 0) /
      sessions;
    const meanDeviationPct = weighted((piece) => piece.meanDeviationPct);

    return {
      windowDays: INSIGHTS_WINDOW_DAYS,
      sessions,
      meanDeviationPct,
      spreadPct: weighted((piece) => piece.spreadPct),
      // Classified by the same functions the API adapter uses, against the
      // thresholds this source reports. This block used to reimplement them
      // inline, which made the fixtures a place a threshold could be wrong
      // without any test noticing.
      ...judgeAggregate(meanDeviationPct, FIXTURE_TOLERANCE),
      tolerance: FIXTURE_TOLERANCE,
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
/**
 * The sample take's bars.
 *
 * The last two carry a **written tempo change**, which is not decoration: it
 * is the only way that state can be looked at without a live backend and a
 * page that prints a `rit.`. `UNREAD_CLEF_SCORE` a few hundred lines up exists
 * for exactly this reason and says so — the case with no fixture is the case
 * that ships wrong, which is how the app came to caption a guessed clef
 * "Treble clef" for as long as it did.
 *
 * `dragPct` on those two is deliberately large. The pipeline reports the real
 * deviation for a bar under a change while forcing its `band` to `on`, and
 * that combination is what the screen used to render as a long bar labelled
 * "On the beat".
 */
const FIXTURE_MEASURES: {
  measure: number;
  notes: number;
  dragPct: number;
  band: Band;
  underTempoChange?: boolean;
  uneven?: boolean;
  /** Zero for a bar nothing in which was timed — a held chord, an ornament. */
  timedNotes?: number;
  /** Which of the three it was, when the whole bar went unjudged. */
  untimedReason?: UntimedReason;
  /** The tempo the bar was played at, against the take's 96. */
  bpm?: number;
}[] = [
  { measure: 1, notes: 4, dragPct: -1.2, band: 'on', bpm: 97 },
  { measure: 2, notes: 4, dragPct: -2.8, band: 'on', bpm: 98 },
  { measure: 3, notes: 4, dragPct: -4.4, band: 'on', bpm: 99 },
  { measure: 4, notes: 4, dragPct: -7.9, band: 'slight', bpm: 100 },
  { measure: 5, notes: 4, dragPct: -11.6, band: 'rush_drag', bpm: 104 },
  { measure: 6, notes: 4, dragPct: -14.8, band: 'rush_drag', bpm: 106 },
  { measure: 7, notes: 4, dragPct: -16.2, band: 'rush_drag', bpm: 105 },
  { measure: 8, notes: 4, dragPct: -12.1, band: 'rush_drag', bpm: 102 },
  { measure: 9, notes: 4, dragPct: -8.4, band: 'slight', bpm: 99 },
  { measure: 10, notes: 4, dragPct: -5.1, band: 'slight', bpm: 98 },
  { measure: 11, notes: 4, dragPct: 22.4, band: 'on', bpm: 88, underTempoChange: true },
  {
    measure: 12,
    bpm: 82,
    notes: 4,
    dragPct: 31.8,
    band: 'on',
    underTempoChange: true,
    uneven: true,
  },
  // **A fermata, not a tempo change.** The final chord is held: the mark says
  // its length is not written down at all, so nothing in the bar can be timed
  // against the page. The second way a bar goes unjudged, and the one that
  // read "On tempo" until the pipeline started reporting `timed_note_count`.
  {
    measure: 13,
    notes: 1,
    dragPct: 64.0,
    band: 'on',
    timedNotes: 0,
    untimedReason: 'fermata',
  },
];

const FIXTURE_TAKE_ID = 'fixture-take-1';

/**
 * The three ways a take can end without a verdict, reachable by id alone.
 *
 * **`VerdictScreen` has four states and one of them had a fixture.** It
 * branches on `failure` — twice, because recoverable and unrecoverable are
 * different sentences and different buttons — then on a `status` that is not
 * `ok`, and only then draws the verdict. Three of those four had never been on
 * a screen, on what CLAUDE.md calls the payoff of the whole app.
 *
 * **Reachable by id and by nothing else**, which is the point rather than an
 * oversight. `buildFixtureTake`'s own comment gives the reason and it still
 * holds: a failed run is a live outcome, and putting one in front of somebody
 * browsing the sample build would describe a recording they never made. So
 * `getLatestTake` and `getRecentTakes` — what Today and Insights read — go on
 * returning the successful take alone, and these exist for a sweep to open.
 *
 * The sentences are the pipeline's own, read off `analyze()` rather than
 * written here: silence really answers with the first, and a take that cannot
 * be matched to its score with the second. A fixture that invented its wording
 * would check the screen against a sentence the product never sends.
 */
const FIXTURE_TAKE_STATES: Record<string, Partial<TakeResult>> = {
  'fixture-take-failed': {
    failure: { recoverable: true, reason: 'internal_error' },
  },
  'fixture-take-unrecoverable': {
    failure: { recoverable: false, reason: 'audio_unavailable' },
  },
  'fixture-take-silent': {
    status: 'no_onsets',
    headline: 'No sound reached the microphone. Is it muted?',
  },
  /**
   * **A passage, not a whole page** — which is what practice looks like and
   * what the pipeline has measured since `align_dtw` learned subsequence
   * matching (`test_fragment_alignment.py`). The verdict screen names the bars
   * for a take that did not open the page, and with every fixture starting at
   * bar 1 that branch was unreachable in the build the screens are looked at
   * in.
   *
   * Not a failure, unlike the four below it — it is in this table because the
   * table is what `getTake` can reach by id. The measures are the successful
   * take's, renumbered to start at nine.
   */
  'fixture-take-passage': {
    headline:
      'Steady, with a push at the end.',
  },
  'fixture-take-unmatched': {
    status: 'alignment_failed',
    headline: 'Only 18 of 76 notes came through. Move the mic closer.',
  },
};

export const fixtureTakeSource: TakeSource = {
  async getTake(analysisId) {
    const state = FIXTURE_TAKE_STATES[analysisId];
    if (state) {
      const take = buildFixtureTake();
      if (!take) {
        return null;
      }
      const base =
        analysisId === 'fixture-take-passage' ? asPassageFrom(take, 9) : take;
      return { ...base, id: analysisId, ...state };
    }
    if (analysisId !== FIXTURE_TAKE_ID) {
      return null;
    }
    return buildFixtureTake();
  },

  // One take in the fixture set, so the latest is that one.
  async getLatestTake() {
    return EMPTY_ACCOUNT ? null : buildFixtureTake();
  },

  async getRecentTakes(limit = 3) {
    if (EMPTY_ACCOUNT) {
      return [];
    }
    const take = buildFixtureTake();
    if (!take || limit <= 0) {
      return [];
    }

    // **A practice history, not one take repeated.** Insights draws a line
    // through these now, and one point is not a trend -- against the fixtures
    // build the chart simply never appeared, so nothing about it could be
    // screenshotted, walked or swept. The real `getRecentTakes` pages
    // `analyses` and returns as many as it is asked for.
    //
    // The shape is a musician getting better and having one bad night: drift
    // shrinking session by session, with an outlier a week back. Derived from
    // the real take by scaling its own trend, so every point on the chart is
    // the same measurement the verdict screen draws, rather than a second set
    // of numbers invented here.
    const DRIFT = [1, 0.82, 1.45, 0.71, 0.6, 0.44, 0.38];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const recordedAt = Date.parse(take.recordedAt);

    return DRIFT.slice(0, limit).map((scale, index) => ({
      ...take,
      // index 0 is the real take; the rest are older, one every three days.
      id: index === 0 ? take.id : `${take.id}-session-${index}`,
      recordedAt: new Date(recordedAt - index * 3 * DAY_MS).toISOString(),
      trend: take.trend.map((value) => value * scale),
    }));
  },

  /**
   * The sample piece's practice behind it.
   *
   * Built from `getRecentTakes`, which already shapes a plausible run of
   * sessions — drift shrinking week by week with one bad night — so the card
   * and the Insights chart are drawing the same history rather than two that
   * disagree. Only the piece this fixture take belongs to has any: every other
   * piece in the sample library returns nothing, which is also what the card
   * has to handle for a piece nobody has recorded yet.
   */
  async getPieceHistory(pieceId, window = 6) {
    const recent = (await fixtureTakeSource.getRecentTakes(12)).filter(
      (take) => take.pieceId === pieceId,
    );
    if (recent.length === 0) {
      return { takes: 0, since: null, recent: [] };
    }
    return {
      takes: recent.length,
      since: recent[recent.length - 1].recordedAt,
      recent: recent.slice(0, Math.max(1, window)),
    };
  },

  // The sample result was never recorded or uploaded. Hiding playback is more
  // honest than playing a canned clip and calling it the musician's take.
  async getRecordingUrl() {
    return null;
  },
};

/**
 * The sample take, renumbered to start partway into the page.
 *
 * A passage take differs from a whole-page one in exactly one way the screen
 * can see: its first measure is not bar 1. Shifting the numbers is therefore
 * the whole of it, and it keeps the deviations, the bands and the trend that
 * every other check on this screen reads — a hand-written second take would be
 * a second set of numbers to keep in step with the first.
 */
function asPassageFrom(take: TakeResult, first: number): TakeResult {
  const shift = first - (take.measures[0]?.measure ?? 1);
  return {
    ...take,
    measures: take.measures.map((measure) => ({
      ...measure,
      measure: measure.measure + shift,
    })),
  };
}

/** The sample take, built fresh so `recordedAt` is always recent. */
function buildFixtureTake(): TakeResult | null {
  const piece = FIXTURE_PIECES.find(({ id }) => id === 'fixture-bach-bwv1001');
  if (!piece) {
    return null;
  }
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
      underTempoChange: m.underTempoChange === true,
      uneven: m.uneven === true,
      timedNoteCount: m.timedNotes ?? m.notes,
      untimedReason: m.untimedReason ?? null,
      playedBpm: m.bpm ?? null,
    };
  });

  const recordedAt = new Date();
  recordedAt.setMinutes(recordedAt.getMinutes() - 4);

  return {
    id: FIXTURE_TAKE_ID,
    recordingAvailable: false,
    pieceId: 'fixture-bach-bwv1001',
    pieceTitle: piece?.title ?? 'Unknown piece',
    composer: piece?.composer ?? null,
    recordedAt: recordedAt.toISOString(),
    targetBpm: 96,
    /**
     * The sample take carries a finding, because a fixtures build is the only
     * place this line can be looked at — `preflight --full` and the a11y sweep
     * both run against fixtures, and a screen element that never appears there
     * is a screen element no gate has ever seen.
     *
     * A note-value finding rather than a tempo one on purpose: it is the
     * longest of the four sentences and the one whose layout is worth
     * checking at 390pt.
     */
    finding: {
      kind: 'note_value' as const,
      text: 'Your sixteenth notes ran ahead.',
      weight: 2.0,
    },
    // The sample take always succeeds. A failed run is a live-only outcome —
    // fabricating one here would put a "we couldn't read that" screen in front
    // of someone browsing the demo, describing a recording they never made.
    failure: null,
    status: 'ok',
    // The pipeline writes this sentence; the screen shows it verbatim. It
    // names the bars whose `bpm` above is off 96 (`_longest_bar_run`), at
    // their tempo together — so the sample reads as the server would say it.
    headline: 'You rushed bars 5–8 by 8 BPM.',
    direction: 'rush',
    verdict: verdictFor('rush_drag', 'rush'),
    lowConfidence: false,
    measures,
    // Only the timed bars — which is what the pipeline now sends too:
    // `rolling_trend` excludes notes under a written change, the same
    // exclusion slur-interior notes already had. A fixture that disagreed with
    // the wire would be a demo of a screen the product does not have.
    trend: measures.filter(wasTimed).map((m) => m.deviationPct),
    tolerance: FIXTURE_TOLERANCE,
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
  async submit(_input, options) {
    // **Walks the same legs the real runner does, compressed.** A fixtures
    // build is what every check in this repository drives and what a
    // screenshot is taken from, so a wait screen that only ever showed the
    // generic line here would be a wait screen whose stage labels nothing has
    // ever seen. The shares mirror `waitProgress`: `listening` is most of it.
    const legs: Array<[string, number]> = [
      ['fetching', 0.1],
      ['checking', 0.1],
      ['decoding', 0.1],
      ['listening', 0.6],
      ['saving', 0.1],
    ];
    for (const [stage, share] of legs) {
      options?.onStage?.(stage);
      await new Promise((resolve) =>
        setTimeout(resolve, MOCK_ANALYSIS_MS * share),
      );
    }
    return FIXTURE_TAKE_ID_FOR_FLOW;
  },
};
