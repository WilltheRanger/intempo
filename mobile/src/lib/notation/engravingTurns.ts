/**
 * One engraving at a time, in the order they were asked for, with a pause
 * between them in which the screen can answer a tap and paint.
 *
 * **The Library engraved its whole shelf in one piece of work.** Every tile
 * measures itself, and the measurements land together, so all twenty-two
 * engravings ran in a single render and nothing was drawn until the last one
 * was: on a CPU slowed to phone speed, the main thread was blocked for about
 * two seconds on a first visit and one on a relaunch, for a shelf whose first
 * screen shows two tiles (2026-10-23, `docs/subsystems.md`). A long piece is
 * the bulk of it — a tile shows a piece's opening, and the opening is laid out
 * from the whole piece, because the whole piece decides the size it is drawn
 * at.
 *
 * Turns change the order, not the work. The tiles ask in the order they
 * mounted, which is the shelf's own, top first; each is drawn in a task of its
 * own, and a tap or a scroll is answered between two of them rather than after
 * the last. The tiles a musician can see are the first ones drawn.
 *
 * Kept free of React, so the order and the hand-over can be tested without a
 * renderer — there is no React Native testing library here (`DECISIONS.md`,
 * 2026-08-24), and a rule inside a component is a rule nothing checks.
 */
export interface TurnQueue {
  /**
   * Ask for a turn. `grant` is called when it is this caller's — at once, if
   * nobody holds one and nobody is waiting.
   *
   * Returns the way out, for every case: before the grant it withdraws the
   * request, after it it hands the turn on. Calling it twice is harmless, so a
   * caller can give the turn back when its work is done and again when it
   * unmounts without tracking which happened first.
   */
  request(grant: () => void): () => void;
}

/**
 * A queue whose turns are separated by `pause`.
 *
 * `pause` is given the next hand-over to run once the screen has had its
 * chance: in the next task in the app (`useEngravingTurn`), by hand in a test.
 */
export function createTurnQueue(pause: (resume: () => void) => void): TurnQueue {
  const waiting: object[] = [];
  const grants = new Map<object, () => void>();
  let holder: object | null = null;
  let pausing = false;

  function handOver() {
    if (holder !== null || pausing) {
      return;
    }
    const next = waiting.shift();
    if (next === undefined) {
      return;
    }
    holder = next;
    const grant = grants.get(next);
    grants.delete(next);
    grant?.();
  }

  return {
    request(grant) {
      const ticket = {};
      waiting.push(ticket);
      grants.set(ticket, grant);
      handOver();

      let settled = false;
      return () => {
        if (settled) {
          return;
        }
        settled = true;
        const index = waiting.indexOf(ticket);
        if (index >= 0) {
          waiting.splice(index, 1);
          grants.delete(ticket);
          return;
        }
        if (holder === ticket) {
          holder = null;
          pausing = true;
          pause(() => {
            pausing = false;
            handOver();
          });
        }
      };
    },
  };
}
