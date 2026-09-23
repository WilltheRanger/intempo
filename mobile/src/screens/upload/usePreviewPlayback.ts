/**
 * The native half of `usePreviewPlayback.web.ts`: not available yet, the same
 * as `HeldTakePlayer`'s native half. The Upload screen draws no Play control
 * when `available` is false — a control that does nothing is the affordance
 * CLAUDE.md §3 rules out drawing at all.
 */
export function usePreviewPlayback(_audio: Blob | null) {
  return {
    available: false,
    playing: false,
    position: 0,
    duration: null as number | null,
    toggle: async (): Promise<void> => {},
  };
}
