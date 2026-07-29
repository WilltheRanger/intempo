import { useRef, useState } from "react";
import { ImageSquare } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";

/**
 * Primary capture input: a file picker with `capture="environment"`, which
 * opens the rear camera on mobile and a file dialog on desktop (the spec's
 * recommended one-liner). Drag-and-drop supported on desktop.
 */
export function ImageUploader({
  onSelect,
}: {
  onSelect: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onSelect(file);
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center transition-colors duration-200 ease-ios",
        dragging
          ? "border-amber bg-amber-soft"
          : "border-line-2 bg-paper-raised hover:bg-paper-warm",
      )}
    >
      <span className="grid size-14 place-items-center rounded-full bg-amber-soft text-amber-deep">
        <ImageSquare size={24} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium text-ink">
          Take or choose a photo
        </span>
        <span className="text-sm text-ink-mute">
          Point at a page of sheet music, or drop an image here.
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
    </button>
  );
}
