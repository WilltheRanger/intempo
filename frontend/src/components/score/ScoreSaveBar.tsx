import { Button } from "../ui/Button";

/** Sticky bottom bar: name the piece and save the edits. */
export function ScoreSaveBar({
  title,
  onTitleChange,
  canSave,
  saving,
  onSave,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-4 border-t border-line bg-paper/90 px-5 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Name this piece"
          aria-label="Piece title"
          className="h-11 flex-1 rounded-md border border-line bg-paper-raised px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-amber focus:shadow-[0_0_0_2px_var(--amber-soft)] focus:outline-none"
        />
        <Button onClick={onSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
