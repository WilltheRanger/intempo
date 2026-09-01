import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { Articulation, Clef } from '../../data/types';
import { colors, fontFamily, MUSIC_EM_IN_SPACES, typography } from '../../design';
import {
  BEAM_THICKNESS_FACTOR,
  engrave,
  type Accidental,
  type NoteValue,
  type StaveItem,
} from '../../lib/notation/engrave';

/**
 * SMuFL codepoints. The standard's own names are the comments.
 *
 * Bravura is subset to exactly these (`tools/subset-bravura.py`), so a glyph
 * added here needs adding there too — otherwise it renders as nothing at all,
 * silently, which is the failure mode a music font has instead of tofu.
 */
const GLYPH = {
  gClef: '\uE050',
  cClef: '\uE05C',
  fClef: '\uE062',
  sharp: '\uE262',
  flat: '\uE260',
  natural: '\uE261',
  doubleSharp: '\uE263',
  doubleFlat: '\uE264',
  augmentationDot: '\uE1E7',
  /** articAccent/Staccato/TenutoAbove and their Below twins. */
  accentAbove: '\uE4A0',
  accentBelow: '\uE4A1',
  staccatoAbove: '\uE4A2',
  staccatoBelow: '\uE4A3',
  tenutoAbove: '\uE4A4',
  tenutoBelow: '\uE4A5',
  /** tuplet0..9 — small and bold-italic, not the time signature's digits. */
  tupletDigit: (n: number) =>
    String(n)
      .split('')
      .map((d) => String.fromCharCode(0xe880 + Number(d)))
      .join(''),
  timeDigit: (n: number) => String(n).split('').map((d) => String.fromCharCode(0xe080 + Number(d))).join(''),
} as const;

/**
 * Every accidental, where there used to be one.
 *
 * `engrave.ts` returned only `'sharp'` because a sharp was the only one that
 * could be drawn by hand — four straight lines. So a B♭ was engraved as a B and
 * an F♯♯ as an F♯: a different note, printed as though it were right. Bravura
 * has all five, and they are the same drawings a printed part uses.
 */
/**
 * The two glyphs each articulation has.
 *
 * **Not one glyph flipped.** Bravura draws the above and below forms
 * separately — an accent points differently and a tenuto sits at a different
 * height — so mirroring in the renderer produces a mark a reader notices as
 * wrong.
 */
const ARTICULATION_GLYPH: Record<Articulation, { above: string; below: string }> = {
  staccato: { above: GLYPH.staccatoAbove, below: GLYPH.staccatoBelow },
  tenuto: { above: GLYPH.tenutoAbove, below: GLYPH.tenutoBelow },
  accent: { above: GLYPH.accentAbove, below: GLYPH.accentBelow },
};

const ACCIDENTAL_GLYPH: Record<NonNullable<Accidental>, string> = {
  sharp: GLYPH.sharp,
  flat: GLYPH.flat,
  natural: GLYPH.natural,
  'double-sharp': GLYPH.doubleSharp,
  'double-flat': GLYPH.doubleFlat,
};

/**
 * Noteheads, and the widths Bravura gives them, in staff spaces.
 *
 * A whole note is **1.688** spaces wide and a half is **1.180** — read out of
 * the font, not estimated. The hand-drawn ellipse these replace used one size
 * for all three, so a whole note was drawn at a half's width: at a glance, the
 * wrong one of the two.
 *
 * The black notehead's half-width, 0.59, is also why the stems have always
 * looked attached — `engrave.ts` has offset them by 0.62 staff spaces since
 * long before there was a font to check it against.
 */
const NOTEHEAD: Record<NoteValue, { glyph: string; halfWidth: number }> = {
  // `noteheadDoubleWhole` — the whole-note oval with a vertical stroke each
  // side. Wider than every other head, which is why the width is measured
  // rather than shared.
  breve: { glyph: '\uE0A0', halfWidth: 1.198 },
  whole: { glyph: '\uE0A2', halfWidth: 0.844 },
  half: { glyph: '\uE0A3', halfWidth: 0.59 },
  quarter: { glyph: '\uE0A4', halfWidth: 0.59 },
  eighth: { glyph: '\uE0A4', halfWidth: 0.59 },
  sixteenth: { glyph: '\uE0A4', halfWidth: 0.59 },
  // Every value from a quarter down is the same black notehead; what separates
  // them is the number of tails. See `TAILS`.
  thirty_second: { glyph: '\uE0A4', halfWidth: 0.59 },
  sixty_fourth: { glyph: '\uE0A4', halfWidth: 0.59 },
};

/**
 * Rests.
 *
 * The hand-drawn versions said what they were: *"calligraphic figures rendered
 * as strokes. They read correctly at the size this draws them and they are not
 * typeset music."* The comment also named the only alternative it had — count
 * them undrawable and leave holes in the bar — which for a part written in
 * quarter rests is most of the bar. A third option exists now.
 */
/** Rests are 1.0–1.3 spaces wide; half of the commonest is close enough to centre them all. */
const REST_HALF_WIDTH = 0.54;

/**
 * The gap from the notehead's edge to the first dot, and between dots.
 *
 * **There can be two.** A double dot adds three quarters of the base value and
 * is how a march is written — the first real page this project has seen is
 * headed *Alla marcia*. This drew `dots > 0 ? one dot : nothing`, so a
 * double-dotted quarter came out as a dotted quarter: 1.5 beats where the page
 * says 1.75, in the same ink as the notes around it that are right. That is
 * exactly the substitution `fromScore` refuses to make with values, and it was
 * happening here with dots.
 */
const DOT_GAP = 0.3;
const DOT_PITCH = 0.42;

/** The dots after a note or rest, laid out from its right-hand edge. */
function dotOffsets(dots: number, halfWidth: number): number[] {
  return Array.from(
    { length: dots },
    (_unused, index) => halfWidth + DOT_GAP + index * DOT_PITCH,
  );
}

const REST_GLYPH: Record<NoteValue, string> = {
  breve: '\uE4E2',
  whole: '\uE4E3',
  half: '\uE4E4',
  quarter: '\uE4E5',
  eighth: '\uE4E6',
  sixteenth: '\uE4E7',
  thirty_second: '\uE4E8',
  sixty_fourth: '\uE4E9',
};

/**
 * Flags, by how many the note carries.
 *
 * **One glyph, not two stacked.** A sixteenth's flag is a single drawing with
 * both hooks in it and the right spacing between them; drawing the eighth's
 * flag twice is an approximation of a shape the font already has.
 */
/**
 * `fermataAbove` — U+E4C0.
 *
 * The only one of the pair this draws: `fermataBelow` is for the lower voice
 * of a two-voice staff, and `engrave.ts` places every fermata above the music.
 * Both are in the subset so a second voice would not need a font change.
 */
const FERMATA_GLYPH = '\uE4C0';

const FLAG_GLYPH: Record<number, { up: string; down: string }> = {
  1: { up: '\uE240', down: '\uE241' },
  2: { up: '\uE242', down: '\uE243' },
  3: { up: '\uE244', down: '\uE245' },
  4: { up: '\uE246', down: '\uE247' },
};

const CLEF_GLYPH: Record<Clef, string> = {
  treble: GLYPH.gClef,
  bass: GLYPH.fClef,
  alto: GLYPH.cClef,
  tenor: GLYPH.cClef,
};

export interface StaveProps {
  /** Notes, rests and multi-bar rests, in reading order. */
  notes: StaveItem[];
  clef: Clef;
  /**
   * Which ground it is drawn on.
   *
   * `dark` inverts the ink so the same engraving can sit on the warmup panel.
   * Not a theme — it is the one place in the app with a full-bleed dark
   * surface, and the `action*`/`onDark*` pair already exists for exactly that.
   */
  tone?: 'light' | 'dark';
  /**
   * Wrap onto further systems past this width.
   *
   * Give it the space available and the music fills it downwards. Without it
   * the run stays on one system, which is what the Today preview wants.
   */
  maxWidth?: number;
  /**
   * Shrink the engraving, if it needs it, to fit this width.
   *
   * **Different from `maxWidth`, and the Today preview needed this one.**
   * `maxWidth` wraps onto further systems, and the engraver can only break at
   * a barline — so a bar of four notes and a clef comes to 335pt and stays
   * 335pt however small the box is. At 320pt that was drawn inside a 280pt
   * view under `overflow: hidden`: a sixth of the music cut off, through a
   * notehead.
   *
   * Only ever down. A preview that inflated to fill a wide screen would be a
   * different decision from the one this is.
   */
  fitWidth?: number;
  /** Cap the notes drawn, for a preview that only suggests the shape. */
  maxNotes?: number;
  /**
   * Overall size, as a multiple of the base staff.
   *
   * The warmup page draws bigger than the Today preview: one is read from a
   * music stand and the other is glanced at.
   */
  scale?: number;
  /** Stretch systems to fill `maxWidth`. */
  justify?: boolean;
  /**
   * Open each system with a clef and key signature, and the first with the
   * metre — what a printed page does.
   *
   * Off by default. The warmup is a study-book exercise: a bare stave with the
   * note names underneath, and the instrument named beside it. A screen for
   * reading a real piece needs the page's own furniture instead, and
   * `showNoteNames={false}` is the other half of that same choice.
   */
  head?: {
    clef: Clef | null;
    key: { pitch: string; kind: 'sharp' | 'flat' }[];
    time: { beats: number; unit: number } | null;
  };
  /**
   * The beat beams break at, in quarter notes — `staveScoreFor` computes it.
   *
   * A quarter unless said, which is right for the warmup: it authors its own
   * notes in 4/4 and has no time signature to pass.
   */
  beatQuarters?: number;
  /**
   * The score's final barline closes a repeated section — `staveScoreFor`
   * computes it, for the same reason it computes `beatQuarters`.
   */
  closesWithRepeat?: boolean;
  /** First- and second-time ending brackets — `staveScoreFor` computes them. */
  endings?: { label: string; from: number; to: number; closed: boolean }[];
  /**
   * Print each note's letter under the system.
   *
   * On by default: the warmup is an exercise for a student, and the letters
   * teach. Off for reading a real piece, where a letter under every note reads
   * as a beginner's crib.
   *
   * **A caller that turns this off has to state the clef**, because nothing
   * here draws one and the names were carrying that information — the same
   * notehead is a different pitch in alto clef. See `engrave.ts`.
   */
  showNoteNames?: boolean;
  /**
   * Wash the bar that is sounding, for following a playback.
   *
   * A **bar**, not a note. On a phone-sized stave a note-level cursor is a
   * few pixels wide and the eye loses it; the bar is the unit a musician is
   * reading in anyway, and it stays legible from the distance a stand is at.
   * It is also robust to what the engraver cannot draw — a bar whose notes are
   * all sixteenths still highlights, where a note cursor would have nothing to
   * sit on.
   */
  highlightMeasure?: number | null;
  /**
   * Called with a bar's number when it is tapped.
   *
   * **The stave is the bar picker.** A musician chooses where to start by
   * looking at the music, not by reading a number in a list of seventy — and
   * the geometry for this already existed: `measureSpans` is what the playhead
   * wash is drawn from. With this set, each span in `pressableMeasures` gets a
   * transparent target on top of everything else, the full height of the
   * staff plus a space either side, so a bar of sixteenths on a phone is as
   * easy to hit as a bar of whole notes.
   */
  onMeasurePress?: (measureNumber: number) => void;
  /**
   * Which bars accept a tap. Omitted, every bar does.
   *
   * The caller knows which bars actually sound — `startableMeasures` — and a
   * bar of rests has nothing to enter on. Leaving it untappable is more honest
   * than snapping to a neighbour the musician did not choose.
   */
  pressableMeasures?: number[];
}

const LINE_GAP = 9;
const NOTE_GAP = 30;
const LEFT_PAD = 22;
const RIGHT_PAD = 12;
/**
 * Whether a notehead sits on a staff line rather than in a space.
 *
 * An engraver puts an augmentation dot in the space above when the note is on
 * a line, because a dot centred on a line is hard to pick out against it. The
 * staff's lines are `lineGap` apart and the middle line is y=0, so a note is on
 * a line whenever its offset is a whole number of gaps.
 */
function onLine(y: number, lineGap: number): boolean {
  return Math.abs(Math.round(y / lineGap) * lineGap - y) < lineGap * 0.1;
}

/** Half the gap the bracket leaves for its numeral, in staff spaces. */
const TUPLET_NUMBER_HALF_WIDTH = 0.5;
/**
 * The numeral's baseline, relative to the bracket line.
 *
 * Bravura's tuplet digits sit on their baseline like ordinary type, so
 * centring one on the line means dropping the baseline by about half the
 * digit's height.
 */
const TUPLET_NUMBER_LIFT = 0.42;

const STROKE = 1.1;
/**
 * Staff lines are thinner than stems and lighter than noteheads, but they are
 * still ink. Drawn in the border colour they read as a divider rather than as
 * a staff, and the notes float in the middle of nothing.
 */
const STAFF_STROKE = 0.9;
/** Half the height of the little upright strokes on a multi-bar rest's ends. */
const MULTI_REST_SERIF_FACTOR = 0.55;
const MULTI_REST_NUMBER_SIZE = 1.5;

/**
 * Engraved notation, wrapped onto as many systems as it takes.
 *
 * Draws what `engrave` laid out and nothing more. **No clef** — the reasoning is
 * in `engrave.ts`. With `showNoteNames` on, the names under each system carry
 * the information a clef would; with it off, the caller owes the reader that
 * information some other way.
 *
 * The names are SVG text rather than React Native text so they travel with the
 * system they belong to. A row of absolutely positioned labels worked for one
 * stave and would have needed a second layout pass for four. They can be turned
 * off — see `showNoteNames`, and read the obligation that comes with it.
 */
export function Stave({
  notes,
  clef,
  tone = 'light',
  maxWidth,
  fitWidth,
  maxNotes,
  scale = 1,
  justify = false,
  beatQuarters,
  closesWithRepeat,
  endings,
  head,
  showNoteNames = true,
  highlightMeasure = null,
  onMeasurePress,
  pressableMeasures,
}: StaveProps) {
  const dark = tone === 'dark';
  const ink = dark ? colors.actionText : colors.textPrimary;
  const rule = dark ? colors.onDarkMuted : colors.textSecondary;
  const label = dark ? colors.onDarkMuted : colors.textTertiary;

  const engraveAt = (at: number) =>
    engrave(notes, clef, {
      lineGap: LINE_GAP * at,
      noteGap: NOTE_GAP * at,
      leftPad: LEFT_PAD * at,
      rightPad: RIGHT_PAD * at,
      maxWidth,
      maxNotes,
      justify,
      beatQuarters,
      closesWithRepeat,
      endings,
      head,
      // Also stops the layout reserving the row's height, so hiding the names
      // doesn't leave a band of empty space under every system.
      nameRow: showNoteNames,
    });

  const measured = engraveAt(scale);
  /**
   * One corrective pass, and it lands exactly.
   *
   * Every geometry constant here is multiplied by the scale and nothing else,
   * so the engraved width is linear in it: measuring once and dividing gives
   * the scale that fits, rather than converging on it.
   */
  const fitted =
    fitWidth && measured.width > fitWidth
      ? scale * (fitWidth / measured.width)
      : scale;
  const lineGap = LINE_GAP * fitted;
  const layout = fitted === scale ? measured : engraveAt(fitted);

  // A SMuFL em is four staff spaces, so this is the one number every glyph needs.
  const musicSize = lineGap * MUSIC_EM_IN_SPACES;
  const beamNode = lineGap * BEAM_THICKNESS_FACTOR;
  const stroke = STROKE * fitted;

  return (
    <Svg
      width={layout.width}
      height={layout.height}
      accessibilityRole="image"
      // Not described. With names on, a screen reader spelling out fifteen note
      // letters is noise and the exercise is named above; with them off there is
      // no text here to read at all. Either way the screen carries the piece's
      // name, clef and tempo in real text, which is the useful alternative.
      accessible={false}
    >
      {layout.systems.map((system, systemIndex) => (
        <G key={`system-${systemIndex}`}>
          {/* Behind everything, so the notes stay the darkest thing on the
              staff. A wash rather than an outline: an outlined bar reads as
              something selected and waiting to be acted on, and this is a
              position, not a selection. */}
          {highlightMeasure !== null
            ? system.measureSpans
                .filter((span) => span.measureNumber === highlightMeasure)
                .map((span, index) => (
                  <Rect
                    key={`playhead-${index}`}
                    x={span.from}
                    y={system.staffLines[0] - lineGap}
                    width={span.to - span.from}
                    height={lineGap * 6}
                    // **The accent, at a tint.** §3 law 5: ochre marks active
                    // states and progress — which is exactly what a playhead
                    // is — and must never become a surface. Low opacity is how
                    // it can be both: a wash the eye reads as "here", not a
                    // gold panel competing with the notes.
                    fill={dark ? colors.actionText : colors.accent}
                    opacity={dark ? 0.16 : 0.14}
                  />
                ))
            : null}

          {system.staffLines.map((y, index) => (
            <Line
              key={`staff-${index}`}
              x1={0}
              y1={y}
              x2={system.width}
              y2={y}
              stroke={rule}
              strokeWidth={STAFF_STROKE * fitted}
            />
          ))}

          {system.barlines.map((barline, index) => {
            const { x, repeat } = barline;
            const top = system.staffLines[0];
            const bottom = system.staffLines[4];
            const thick = lineGap * 0.4;
            // **The last barline of the last system ends the piece**, and a
            // printed part says so with a thin line and a thick one. Drawn
            // rather than set from the font because it is two rectangles whose
            // width follows the staff, and Bravura's barline glyphs are sized
            // for a staff drawn at the font's own scale.
            const ends =
              systemIndex === layout.systems.length - 1 &&
              index === system.barlines.length - 1;

            const thin = (at: number) => (
              <Line
                x1={at}
                y1={top}
                x2={at}
                y2={bottom}
                stroke={rule}
                strokeWidth={STAFF_STROKE * 1.2 * fitted}
              />
            );
            const heavy = (at: number) => (
              <Rect x={at} y={top} width={thick} height={bottom - top} fill={rule} />
            );
            /*
              The two dots of a repeat sign, in the second and third spaces —
              either side of the middle line, which is where an engraver puts
              them on a five-line staff whatever the clef.
            */
            const dots = (at: number) => (
              <>
                <Circle cx={at} cy={top + lineGap * 1.5} r={lineGap * 0.18} fill={rule} />
                <Circle cx={at} cy={top + lineGap * 2.5} r={lineGap * 0.18} fill={rule} />
              </>
            );

            if (repeat) {
              // `:||` closes: dots, thin, heavy, reading left to right into the
              // barline. `||:` opens: heavy, thin, dots, reading out of it.
              // `both` is the two back to back sharing one heavy rule, which is
              // how a section ending where the next begins is printed.
              const gap = lineGap * 0.34;
              const closes = repeat === 'end' || repeat === 'both';
              const opens = repeat === 'start' || repeat === 'both';
              return (
                <G key={`bar-${index}`}>
                  {closes ? dots(x - thick - gap * 2.2) : null}
                  {closes ? thin(x - thick - gap) : null}
                  {heavy(x - thick / 2)}
                  {opens ? thin(x + thick / 2 + gap) : null}
                  {opens ? dots(x + thick / 2 + gap * 2.2) : null}
                </G>
              );
            }

            if (!ends) {
              return <G key={`bar-${index}`}>{thin(x)}</G>;
            }
            return (
              <G key={`bar-${index}`}>
                {thin(x - thick - lineGap * 0.4)}
                {heavy(x - thick)}
              </G>
            );
          })}

          {/*
            **The page's own furniture, drawn from Bravura.**

            `engrave.ts` refused to draw a clef and gave the right reason — a
            hand-approximated treble clef is the first thing a musician notices
            and the last thing they forgive. That is answered rather than
            accepted: these are the reference SMuFL drawings, the same ones
            MuseScore prints, subset to 22 KB.

            **Sized in staff spaces.** A SMuFL em is four staff spaces by
            definition, so `fontSize = 4 * lineGap` renders every glyph at
            exactly the right size for this staff, at any scale, with no
            per-glyph fudge factor. That is the whole reason notation is a font
            here rather than a set of paths.
          */}
          {system.head.clef && clef ? (
            <SvgText
              x={system.head.clef.x}
              y={system.head.clef.y}
              fill={ink}
              fontSize={musicSize}
              fontFamily={fontFamily.music}
            >
              {CLEF_GLYPH[clef]}
            </SvgText>
          ) : null}

          {system.head.key.map((accidental, index) => (
            <SvgText
              key={`key-${index}`}
              x={accidental.x}
              y={accidental.y}
              fill={ink}
              fontSize={musicSize}
              fontFamily={fontFamily.music}
            >
              {ACCIDENTAL_GLYPH[accidental.kind]}
            </SvgText>
          ))}

          {system.head.time ? (
            <G>
              {/* Numerator and denominator sit centred on the second and fourth
                  lines, which is where the two halves of a printed metre go —
                  each digit's own centre is its baseline in a SMuFL font. */}
              <SvgText
                x={system.head.time.x}
                y={system.staffLines[1]}
                fill={ink}
                fontSize={musicSize}
                fontFamily={fontFamily.music}
              >
                {GLYPH.timeDigit(system.head.time.beats)}
              </SvgText>
              <SvgText
                x={system.head.time.x}
                y={system.staffLines[3]}
                fill={ink}
                fontSize={musicSize}
                fontFamily={fontFamily.music}
              >
                {GLYPH.timeDigit(system.head.time.unit)}
              </SvgText>
            </G>
          ) : null}

          {system.multiRests.map((block, index) => (
            <G key={`multirest-${index}`}>
              <Rect
                x={block.x}
                y={block.y - block.halfHeight}
                width={block.width}
                height={block.halfHeight * 2}
                fill={rule}
              />
              {/* The end serifs. Without them the block is a dash; with them
                  it is the symbol a musician has counted since school. */}
              {[block.x, block.x + block.width].map((x, side) => (
                <Line
                  key={`serif-${side}`}
                  x1={x}
                  y1={block.y - lineGap * MULTI_REST_SERIF_FACTOR}
                  x2={x}
                  y2={block.y + lineGap * MULTI_REST_SERIF_FACTOR}
                  stroke={rule}
                  strokeWidth={stroke * 1.4}
                />
              ))}
              <SvgText
                x={block.x + block.width / 2}
                y={block.numberY}
                fill={label}
                fontFamily={fontFamily.sansMedium}
                fontSize={lineGap * MULTI_REST_NUMBER_SIZE}
                textAnchor="middle"
              >
                {block.bars}
              </SvgText>
            </G>
          ))}

          {/* **Rests are ink, the block is not**, and the split is deliberate.
              A rest is a note-sized mark and drawing it in the staff-line
              colour made it a speck of dust — measured on the first render,
              where the hierarchy came out notes, number, staff, *then* rests.
              The multi-bar block is large enough that full ink would make it
              the first thing seen on the page, which is the wrong subject. */}
          {system.rests.map((rest, index) => (
            <G key={`rest-${index}`}>
            <SvgText
              // A rest glyph's origin is on the staff line it belongs to and
              // its own left edge, so it is centred here by half its width.
              // `engrave.ts` already decides *which* line: a whole rest hangs
              // below the second from the top, a half stands on the middle
              // one, and drawn the same way round every bar of rest in the app
              // would be a beat wrong to anyone who reads music.
              x={rest.x - lineGap * REST_HALF_WIDTH}
              y={rest.y}
              fill={ink}
              fontSize={musicSize}
              fontFamily={fontFamily.music}
            >
              {REST_GLYPH[rest.value]}
            </SvgText>
            {dotOffsets(rest.dots, REST_HALF_WIDTH).map((offset, dot) => (
              <SvgText
                key={`dot-${dot}`}
                x={rest.x + lineGap * offset}
                y={rest.y - (onLine(rest.y, lineGap) ? lineGap / 2 : 0)}
                fill={ink}
                fontSize={musicSize}
                fontFamily={fontFamily.music}
              >
                {GLYPH.augmentationDot}
              </SvgText>
            ))}
            </G>
          ))}

          {system.notes.map((note, index) => (
            <G key={`note-${index}`}>
              {note.ledgers.map((y, ledger) => (
                <Line
                  key={`ledger-${ledger}`}
                  x1={note.x - lineGap * (NOTEHEAD[note.value].halfWidth + 0.28)}
                  y1={y}
                  x2={note.x + lineGap * (NOTEHEAD[note.value].halfWidth + 0.28)}
                  y2={y}
                  stroke={ink}
                  strokeWidth={stroke}
                />
              ))}

              {note.accidental ? (
                <SvgText
                  x={note.accidentalX}
                  y={note.y}
                  fill={ink}
                  fontSize={musicSize}
                  fontFamily={fontFamily.music}
                >
                  {ACCIDENTAL_GLYPH[note.accidental]}
                </SvgText>
              ) : null}

              {/*
                **The rest of the chord.** Drawn before the stem so the stem
                crosses them, exactly as it does the principal, and after the
                ledger lines, which are already the union across every head.

                A double stop is not decoration on a string part — the demo
                fixture is Bach's G minor Sonata, whose first bar is a four-note
                chord — and one notehead where the page has four is the thing
                this whole module refuses to do.
              */}
              {note.chord.map((head, member) => (
                <G key={`chord-${member}`}>
                  {head.accidental ? (
                    <SvgText
                      x={head.accidentalX}
                      y={head.y}
                      fill={ink}
                      fontSize={musicSize}
                      fontFamily={fontFamily.music}
                    >
                      {ACCIDENTAL_GLYPH[head.accidental]}
                    </SvgText>
                  ) : null}
                  <SvgText
                    x={head.x - lineGap * NOTEHEAD[note.value].halfWidth}
                    y={head.y}
                    fill={ink}
                    fontSize={musicSize}
                    fontFamily={fontFamily.music}
                  >
                    {NOTEHEAD[note.value].glyph}
                  </SvgText>
                </G>
              ))}

              {note.stem ? (
                <Line
                  x1={note.stem.x}
                  y1={note.stem.from}
                  x2={note.stem.x}
                  y2={note.stem.to}
                  stroke={ink}
                  strokeWidth={stroke * 1.2}
                />
              ) : null}

              {/* Drawn from the left edge, because that is where text is
                  drawn from; the baseline runs through the notehead's own
                  vertical centre, which is what `note.y` is. */}
              <SvgText
                x={note.x - lineGap * NOTEHEAD[note.value].halfWidth}
                y={note.y}
                fill={ink}
                fontSize={musicSize}
                fontFamily={fontFamily.music}
              >
                {NOTEHEAD[note.value].glyph}
              </SvgText>

              {/*
                **Staccato, tenuto, accent.** Read off the page since Batch 2
                and drawn nowhere until now. A staccato dot is not decoration:
                it changes what you play, and a page that omits it teaches the
                passage wrong.

                Two glyphs per mark, above and below, because they are not
                mirror images in Bravura — flipping one in the renderer is
                visibly a reversed mark.
              */}
              {note.articulation ? (
                <SvgText
                  x={note.articulation.x}
                  y={note.articulation.y}
                  fill={ink}
                  fontSize={musicSize}
                  fontFamily={fontFamily.music}
                >
                  {ARTICULATION_GLYPH[note.articulation.kind][
                    note.articulation.above ? 'above' : 'below'
                  ]}
                </SvgText>
              ) : null}

              {/*
                **Flags, for a note no beam picked up.** Beams are only drawn
                over runs of two or more, so a lone eighth — one between rests,
                or the last of a bar — was a filled notehead on a plain stem,
                which is a *quarter*. It read as twice its length with nothing
                to say otherwise.

                Drawn from the stem tip, curving back towards the notehead, and
                stacked downwards for a sixteenth's second flag.
              */}
              {note.stem && FLAG_GLYPH[note.flags] ? (
                // The origin of a flag glyph is the stem's own end, so this is
                // the one mark on the staff that needs no offset at all.
                <SvgText
                  x={note.stem.x}
                  y={note.stem.to}
                  fill={ink}
                  fontSize={musicSize}
                  fontFamily={fontFamily.music}
                >
                  {note.stemUp
                    ? FLAG_GLYPH[note.flags].up
                    : FLAG_GLYPH[note.flags].down}
                </SvgText>
              ) : null}

              {/*
                The augmentation dot: half the note's value again. Sits after
                the head, and lifts into the space above when the note is on a
                line — where an engraver puts it, because a dot centred on a
                line is hard to see against it.
              */}
              {dotOffsets(note.dots, NOTEHEAD[note.value].halfWidth).map(
                (offset, dot) => (
                  <SvgText
                    key={`dot-${dot}`}
                    x={note.x + lineGap * offset}
                    y={note.y - (onLine(note.y, lineGap) ? lineGap / 2 : 0)}
                    fill={ink}
                    fontSize={musicSize}
                    fontFamily={fontFamily.music}
                  >
                    {GLYPH.augmentationDot}
                  </SvgText>
                ),
              )}

              {showNoteNames ? (
                <SvgText
                  x={note.x}
                  y={system.nameY}
                  fill={label}
                  fontSize={typography.metadataSmall.fontSize * fitted}
                  fontFamily={fontFamily.sansRegular}
                  textAnchor="middle"
                >
                  {note.name}
                </SvgText>
              ) : null}
            </G>
          ))}

          {/*
            **Tuplet brackets.** Three eighths under a bracket marked 3 are a
            triplet; the same three without it are three eighths, which is a
            bar half again as long. `fromScore` dropped every tuplet until this
            existed, and it was right to — the notehead alone states the wrong
            rhythm in the same ink as the notes that are right.

            The bracket breaks for its numeral rather than running under it: a
            line through the digit is what an engraver never draws, and it is
            the tell that the number is an afterthought.
          */}
          {/*
            **Slurs — the bowing.** A Kreutzer étude without them is a page a
            string player cannot bow, and `spans.ts` has been keeping
            `measure.slurs` correct through every edit while nothing drew them.

            A quadratic Bézier, stroked and not filled: a real engraver's slur
            tapers from the ends to the middle, which needs two curves and a
            fill. A single stroked arc of even weight is the honest simpler
            thing — it says exactly what a slur says and does not pretend to be
            calligraphy.
          */}
          {/*
            **Ties.** Drawn like a slur because they are the same shape, kept in
            their own array because they are not the same thing: a slur phrases
            notes, a tie says two noteheads are one sound. The app has folded
            ties in playback since `scheduleScore` was written and drawn nothing
            on the page, so a held note read as two attacks.
          */}
          {system.ties.map((tie, index) => (
            <Path
              key={`tie-${index}`}
              d={`M ${tie.from.x} ${tie.from.y} Q ${tie.control.x} ${tie.control.y} ${tie.to.x} ${tie.to.y}`}
              stroke={ink}
              strokeWidth={stroke * 1.3}
              strokeLinecap="round"
              fill="none"
            />
          ))}

          {system.slurs.map((slur, index) => (
            <Path
              key={`slur-${index}`}
              d={`M ${slur.from.x} ${slur.from.y} Q ${slur.control.x} ${slur.control.y} ${slur.to.x} ${slur.to.y}`}
              stroke={ink}
              strokeWidth={stroke * 1.3}
              strokeLinecap="round"
              fill="none"
            />
          ))}

          {/*
            **Ending brackets — the other half of a repeat.** The repeat signs
            went in without them, which told a musician to go back and said
            nothing about playing a different bar the second time.

            The number is set in the app's own label face rather than from
            Bravura: an engraver prints it in a plain roman, and the font's
            tuplet digits are small bold italics meant for a different job.
          */}
          {system.endings.map((ending, index) => (
            <G key={`ending-${index}`}>
              <Line
                x1={ending.from}
                y1={ending.y}
                x2={ending.to}
                y2={ending.y}
                stroke={rule}
                strokeWidth={stroke}
              />
              <Line
                x1={ending.from}
                y1={ending.y}
                x2={ending.from}
                y2={ending.y + ending.hook}
                stroke={rule}
                strokeWidth={stroke}
              />
              {ending.closesRight ? (
                <Line
                  x1={ending.to}
                  y1={ending.y}
                  x2={ending.to}
                  y2={ending.y + ending.hook}
                  stroke={rule}
                  strokeWidth={stroke}
                />
              ) : null}
              <SvgText
                x={ending.from + lineGap * 0.5}
                y={ending.labelY}
                fill={label}
                fontSize={ending.labelSize}
                fontFamily={typography.metadataSmall.fontFamily}
              >
                {ending.label}
              </SvgText>
            </G>
          ))}

          {/*
            Dynamics, in the font's own letters rather than in italic type.
            `p`, `m`, `f`, `s` and `z` are drawings in a music font for the
            same reason a clef is: they have a settled weight and slant that a
            bold italic sans does not reproduce. Centred on the notehead using
            the advance widths measured out of Bravura, so nothing here has to
            measure text at render time.
          */}
          {system.dynamics.map((mark, index) => (
            <SvgText
              key={`dynamic-${index}`}
              x={mark.x - mark.width / 2}
              y={mark.y}
              fill={ink}
              fontSize={musicSize}
              fontFamily={fontFamily.music}
            >
              {mark.glyphs}
            </SvgText>
          ))}

          {/*
            Fermatas.

            **`fermataAbove` only.** Bravura's below-staff form is a separate
            glyph rather than a flip, and it is for the lower voice of a
            two-voice staff — which this engraver does not have. Drawing the
            above form under a note would be a mark pointing the wrong way,
            the same mistake the articulation glyphs exist in pairs to avoid.
          */}
          {system.notes.map((note, index) =>
            note.fermata ? (
              <SvgText
                key={`fermata-${index}`}
                x={note.fermata.x}
                y={note.fermata.y}
                fill={ink}
                fontSize={musicSize}
                fontFamily={fontFamily.music}
              >
                {FERMATA_GLYPH}
              </SvgText>
            ) : null,
          )}

          {system.tuplets.map((tuplet, index) => {
            const half = lineGap * TUPLET_NUMBER_HALF_WIDTH;
            return (
              <G key={`tuplet-${index}`}>
                <Line
                  x1={tuplet.from}
                  y1={tuplet.y + tuplet.hook}
                  x2={tuplet.from}
                  y2={tuplet.y}
                  stroke={ink}
                  strokeWidth={stroke}
                />
                <Line
                  x1={tuplet.from}
                  y1={tuplet.y}
                  x2={tuplet.numberX - half}
                  y2={tuplet.y}
                  stroke={ink}
                  strokeWidth={stroke}
                />
                <Line
                  x1={tuplet.numberX + half}
                  y1={tuplet.y}
                  x2={tuplet.to}
                  y2={tuplet.y}
                  stroke={ink}
                  strokeWidth={stroke}
                />
                <Line
                  x1={tuplet.to}
                  y1={tuplet.y}
                  x2={tuplet.to}
                  y2={tuplet.y + tuplet.hook}
                  stroke={ink}
                  strokeWidth={stroke}
                />
                <SvgText
                  x={tuplet.numberX}
                  // The numeral sits centred on the bracket's line, which is
                  // why the line breaks for it.
                  y={tuplet.y + lineGap * TUPLET_NUMBER_LIFT}
                  fill={ink}
                  fontSize={musicSize}
                  fontFamily={fontFamily.music}
                  textAnchor="middle"
                >
                  {GLYPH.tupletDigit(tuplet.count)}
                </SvgText>
              </G>
            );
          })}

          {system.beams.map((beam, index) => (
            // **One line per beam, and the engraver decided where it goes.**
            // This used to stack `beam.count` lines across the whole run,
            // which draws a dotted eighth followed by a sixteenth as two
            // sixteenths. Which notes carry which beam is notation, not
            // drawing, so it lives in `engrave.ts` with the rest of it.
            <Line
              key={`beam-${index}`}
              x1={beam.from}
              y1={beam.y}
              x2={beam.to}
              y2={beam.y}
              stroke={ink}
              strokeWidth={beamNode}
            />
          ))}

          {/* Last, so they are on top of every mark and receive the tap.
              `transparent` rather than `none`: SVG hit-tests painted area, and
              a fill of `none` is not painted, so it would draw nothing *and*
              catch nothing. */}
          {onMeasurePress
            ? system.measureSpans
                .filter(
                  (span) =>
                    !pressableMeasures ||
                    pressableMeasures.includes(span.measureNumber),
                )
                .map((span) => (
                  <Rect
                    key={`target-${span.measureNumber}`}
                    x={span.from}
                    y={system.staffLines[0] - lineGap}
                    width={span.to - span.from}
                    height={lineGap * 6}
                    fill="transparent"
                    onPress={() => onMeasurePress(span.measureNumber)}
                  />
                ))
            : null}
        </G>
      ))}
    </Svg>
  );
}


