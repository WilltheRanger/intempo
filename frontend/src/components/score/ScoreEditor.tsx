import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

import { cn } from "../../lib/cn";
import type { Duration, Note, ScoreJson } from "../../lib/score";
import { DURATIONS, DURATION_LABEL, DURATION_SHORT, isValidPitch } from "../../lib/score";

type Selected = { m: number; n: number } | null;

/** Editable measure/note view. Tap a note to fix its pitch or duration. */
export function ScoreEditor({
  score,
  onChange,
}: {
  score: ScoreJson;
  onChange: (next: ScoreJson) => void;
}) {
  const [selected, setSelected] = useState<Selected>(null);

  function patchNote(m: number, n: number, patch: Partial<Note>) {
    const measures = score.measures.map((measure, mi) =>
      mi !== m
        ? measure
        : {
            ...measure,
            notes: measure.notes.map((note, ni) =>
              ni !== n ? note : { ...note, ...patch },
            ),
          },
    );
    onChange({ ...score, measures });
  }

  function deleteNote(m: number, n: number) {
    const measures = score.measures.map((measure, mi) =>
      mi !== m
        ? measure
        : { ...measure, notes: measure.notes.filter((_, ni) => ni !== n) },
    );
    onChange({ ...score, measures });
    setSelected(null);
  }

  function addNote(m: number) {
    const measures = score.measures.map((measure, mi) =>
      mi !== m
        ? measure
        : {
            ...measure,
            notes: [...measure.notes, { pitch: "C4", duration: "quarter" as Duration }],
          },
    );
    onChange({ ...score, measures });
    setSelected({ m, n: score.measures[m].notes.length });
  }

  return (
    <div className="flex flex-col gap-3">
      {score.measures.map((measure, mi) => (
        <div
          key={mi}
          className="rounded-lg border border-line bg-paper-raised p-3 shadow-hair"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
              Measure {measure.measure_number}
            </span>
            <button
              onClick={() => addNote(mi)}
              className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-amber-deep transition-colors duration-200 ease-ios hover:bg-paper-warm"
            >
              <Plus size={13} strokeWidth={1.5} /> note
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {measure.notes.map((note, ni) => {
              const active = selected?.m === mi && selected?.n === ni;
              const invalid = note.pitch !== "rest" && !isValidPitch(note.pitch);
              return (
                <button
                  key={ni}
                  onClick={() => setSelected(active ? null : { m: mi, n: ni })}
                  className={cn(
                    "flex min-w-[52px] flex-col items-center rounded-md border px-2 py-1.5 transition-colors duration-200 ease-ios",
                    active
                      ? "border-amber bg-amber-soft"
                      : "border-line bg-paper-warm hover:border-line-2",
                    invalid && "border-verdict-bad",
                  )}
                >
                  <span className="text-sm font-medium text-ink">
                    {note.pitch === "rest" ? "rest" : note.pitch}
                  </span>
                  <span className="text-[10px] text-ink-mute">
                    {DURATION_SHORT[note.duration]}
                  </span>
                </button>
              );
            })}
            {measure.notes.length === 0 && (
              <span className="py-1.5 text-sm text-ink-faint">No notes</span>
            )}
          </div>

          {selected?.m === mi && measure.notes[selected.n] && (
            <NoteEditor
              note={measure.notes[selected.n]}
              onPatch={(patch) => patchNote(mi, selected.n, patch)}
              onDelete={() => deleteNote(mi, selected.n)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function NoteEditor({
  note,
  onPatch,
  onDelete,
}: {
  note: Note;
  onPatch: (patch: Partial<Note>) => void;
  onDelete: () => void;
}) {
  const isRest = note.pitch === "rest";
  const invalid = !isRest && !isValidPitch(note.pitch);

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-line bg-paper-warm p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">
            Pitch
          </span>
          <input
            value={isRest ? "" : note.pitch}
            disabled={isRest}
            placeholder="e.g. D3, F#4"
            onChange={(e) => onPatch({ pitch: e.target.value.trim() })}
            className={cn(
              "h-9 w-28 rounded-md border bg-paper-raised px-2.5 text-sm text-ink focus:outline-none focus:shadow-[0_0_0_2px_var(--amber-soft)] disabled:opacity-50",
              invalid ? "border-verdict-bad" : "border-line focus:border-amber",
            )}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">
            Duration
          </span>
          <select
            value={note.duration}
            onChange={(e) => onPatch({ duration: e.target.value as Duration })}
            className="h-9 rounded-md border border-line bg-paper-raised px-2 text-sm text-ink focus:border-amber focus:outline-none"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {DURATION_LABEL[d]}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={onDelete}
          aria-label="Delete note"
          className="flex h-9 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-verdict-bad transition-colors duration-200 ease-ios hover:bg-paper-raised"
        >
          <Trash2 size={15} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-ink-soft">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isRest}
            onChange={(e) => onPatch({ pitch: e.target.checked ? "rest" : "C4" })}
          />
          Rest
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(note.tied_to_next)}
            onChange={(e) => onPatch({ tied_to_next: e.target.checked })}
          />
          Tied to next
        </label>
      </div>
      {invalid && (
        <p className="text-xs text-verdict-bad">
          Pitch must be “rest” or a note like D3, F#4, or Bb2.
        </p>
      )}
    </div>
  );
}
