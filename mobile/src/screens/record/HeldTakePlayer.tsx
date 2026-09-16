import type { SecondaryButton } from '../../components/primitives';

export interface HeldTakePlayerProps {
  /** A URL for the take being held — see `lib/audio/heldTake.ts`. */
  url: string;
  style?: Parameters<typeof SecondaryButton>[0]['style'];
}

/**
 * Nothing, on a native build.
 *
 * `heldTakeUrl` answers null there — `expo-audio`'s native source resolves file
 * paths rather than object URLs, and writing the take to a temporary file first
 * is a real piece of work rather than something to fake a button over. So this
 * is never rendered, and it exists so the import resolves and the screen does
 * not have to know which platform it is on.
 *
 * `HeldTakePlayer.web.tsx` is the real one.
 */
export function HeldTakePlayer(_props: HeldTakePlayerProps) {
  return null;
}
