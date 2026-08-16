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
        "grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6",
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
    <li className="relative">
      {/* One link for the whole card. The crop and the text used to be two
          separate targets and the text one measured 22px tall. */}
      <Link to={`/scores/${piece.id}/record`} className="press group/card block">
        <div className="aspect-[16/10] overflow-hidden rounded-sm bg-paper-raised ring-1 ring-line transition-shadow duration-200 ease-ios group-hover/card:ring-line-2">
          <SheetCrop seed={piece.id} title={piece.title} composer={piece.composer} />
        </div>
        <h3 className="mt-3 font-serif text-[17px] leading-[1.25] text-ink [text-wrap:balance] group-hover/card:underline">
          {piece.shortTitle ?? piece.title}
        </h3>
        <p className="mt-1 text-[14px] text-ink-soft">{piece.composer}</p>
        <p className="mt-1 text-[13px] tabular-nums text-ink-mute">
          {piece.progress != null
            ? `${Math.round(piece.progress * 100)}%`
            : "Not started"}
        </p>
      </Link>

      {/* Sits over the crop rather than nested in the link — a button inside
          an anchor is invalid and the clicks would fight. */}
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
          className="press absolute right-0 top-0 grid size-11 place-items-center text-ink-faint transition-colors duration-150 hover:text-ink"
        >
          <Star
            size={17}
            weight={favorite ? "fill" : "regular"}
            className={cn(favorite ? "text-amber" : "text-ink-mute")}
          />
        </button>
      )}
    </li>
  );
}
