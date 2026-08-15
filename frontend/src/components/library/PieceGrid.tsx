import { Link } from "react-router-dom";
import { Star } from "@phosphor-icons/react";

import { cn } from "../../lib/cn";
import { SheetCrop } from "../sheet/SheetCrop";
import type { LibraryPiece } from "../../lib/demo";

/**
 * The library grid. Each card is a sheet-music crop with a three-level
 * hierarchy under it: title (primary, serif), composer (secondary), then
 * practice status. Card chrome is a hairline border and nothing else, so the
 * music is the loudest thing on the screen.
 */
export function PieceGrid({
  pieces,
  favorites,
  onToggleFavorite,
  limitOnMobile,
}: {
  pieces: LibraryPiece[];
  favorites?: Set<string>;
  onToggleFavorite?: (id: string) => void;
  /** Show only the first four below `md`, so a phone isn't a long scroll. */
  limitOnMobile?: boolean;
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-x-5 gap-y-6 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6",
        limitOnMobile && "max-md:[&>li:nth-child(n+5)]:hidden",
      )}
    >
      {pieces.map((p) => (
        <PieceCard
          key={p.id}
          piece={p}
          favorite={favorites ? favorites.has(p.id) : p.favorite}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </ul>
  );
}

function PieceCard({
  piece,
  favorite,
  onToggleFavorite,
}: {
  piece: LibraryPiece;
  favorite: boolean;
  onToggleFavorite?: (id: string) => void;
}) {
  return (
    <li className="group flex flex-col">
      <Link
        to={`/scores/${piece.id}/record`}
        className="press block overflow-hidden rounded-sm bg-paper-raised ring-1 ring-line transition-shadow duration-200 ease-ios hover:ring-line-2"
      >
        <div className="aspect-[16/10]">
          <SheetCrop seed={piece.id} title={piece.title} composer={piece.composer} />
        </div>
      </Link>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[15px] leading-[1.3] text-ink">
            <Link to={`/scores/${piece.id}/record`} className="hover:underline">
              {piece.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">{piece.composer}</p>
          <p className="mt-1 text-[12px] text-ink-mute">
            {piece.progress != null
              ? `${Math.round(piece.progress * 100)}% · ${piece.lastPracticed}`
              : "Not started"}
          </p>
        </div>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(piece.id)}
            aria-pressed={favorite}
            aria-label={
              favorite
                ? `Remove ${piece.title} from favourites`
                : `Add ${piece.title} to favourites`
            }
            className="press -mr-1 -mt-0.5 shrink-0 p-1 text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            <Star
              size={15}
              weight={favorite ? "fill" : "regular"}
              className={cn(favorite && "text-amber")}
            />
          </button>
        )}
      </div>
    </li>
  );
}
