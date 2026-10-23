import { useCallback, useEffect, useRef, useState } from 'react';

import { createTurnQueue } from '../../lib/notation/engravingTurns';

/**
 * Hand the next turn over in a task of its own.
 *
 * Between two tasks the browser answers whatever input is waiting and paints
 * if a frame is due, so a tap is never queued behind the rest of the shelf —
 * and several small tiles can still land in one frame. Waiting for a paint
 * after every tile was tried first: it drew the first two tiles as soon, but
 * spent a frame of style, layout and paint on each of twenty-two tiles, and
 * the shelf finished 1.4 seconds later than it had in one block.
 */
function nextTask(resume: () => void) {
  setTimeout(resume, 0);
}

/** One queue for the app: the tiles of every shelf take turns with each other. */
const turns = createTurnQueue(nextTask);

/**
 * Wait for a turn to engrave while `asks` is true (`engravingTurns.ts`).
 *
 * Returns whether the caller may engrave now, and the function to call once
 * what it engraved is on screen — from an effect, so the hand-over follows the
 * commit that drew it rather than the render that computed it.
 *
 * A caller that has had its turn keeps it: a later engraving of the same tile,
 * at a new width after a rotation, is drawn at once, as every engraving used
 * to be. And a caller that stops asking — unmounted, collapsed to no width
 * while its tab is hidden, or answered from the cache — gives back whatever it
 * holds, so a place in the queue is never kept by something that will not
 * use it.
 */
export function useEngravingTurn(asks: boolean): [mayEngrave: boolean, drawn: () => void] {
  const [granted, setGranted] = useState(false);
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!asks || granted || release.current !== null) {
      return;
    }
    release.current = turns.request(() => setGranted(true));
  }, [asks, granted]);

  useEffect(() => {
    if (!asks) {
      release.current?.();
      release.current = null;
    }
  }, [asks]);

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );

  const drawn = useCallback(() => {
    release.current?.();
  }, []);

  return [granted || !asks, drawn];
}
