import { StyleSheet, View } from 'react-native';

/**
 * The dimmed area round a sheet or dialog: a tap on it closes the overlay, and
 * nothing else can reach it.
 *
 * **It was a `Pressable`, and on the web a Pressable always has a tab index.**
 * Given `tabIndex={-1}` it left the Tab order, but it could still be focused
 * from code, and react-native-web's `Modal` focus trap does exactly that: when
 * focus has to land inside the overlay — on opening, and each time Tab or
 * Shift+Tab runs off an end — it focuses the first element in it that will
 * take focus, and this full-screen layer comes first. So every sheet and dialog
 * opened with focus on something `aria-hidden`, which a screen reader reads as
 * nothing, and the cycle through it had one silent stop more than it showed.
 * Measured 2026-10-06 on Piece options, Add piece, Instrument and Sign out.
 *
 * A plain view with the touch responder answers a tap on every platform and
 * has no tab index at all, so the trap passes over it to the overlay's first
 * real control. Cancel, Close and Escape remain the keyboard's ways out.
 */
export function DismissArea({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View
      style={StyleSheet.absoluteFill}
      onStartShouldSetResponder={() => true}
      onResponderRelease={onDismiss}
      accessible={false}
      aria-hidden
    />
  );
}
