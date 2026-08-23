import { StyleSheet, View } from 'react-native';

import { Text } from '../primitives/Text';
import { colors, spacing } from '../../design';

export interface UploadProgressProps {
  /** Bytes sent so far. */
  sent: number;
  /** Bytes to send. Zero until the transfer has reported anything. */
  total: number;
  /** An extra line under the bar, or null. */
  note?: string | null;
}

/** Megabytes, to one place — the unit a photograph is thought about in. */
function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/**
 * How much of the photograph has been sent.
 *
 * Counted, not estimated. Every number here comes off the transfer itself, so
 * a stalled upload shows a stalled bar rather than a smooth one — which is the
 * entire point: the failure this replaces was a spinner that looked identical
 * whether the page was moving or the connection had died.
 *
 * A hairline rule, matching the one the reading screen uses (§3 law 6). The
 * size line under it is what tells someone on a slow connection that the app
 * is working and the network is not.
 */
export function UploadProgress({ sent, total, note }: UploadProgressProps) {
  const fraction = total > 0 ? Math.min(1, sent / total) : 0;

  return (
    <View accessibilityRole="progressbar">
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>

      <Text variant="metadataSmall" color="textTertiary" style={styles.size}>
        {total > 0
          ? `${mb(sent)} of ${mb(total)} MB sent`
          : 'Starting the upload…'}
      </Text>

      {note ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 2,
    backgroundColor: colors.border,
  },
  fill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  size: {
    marginTop: spacing.md,
  },
  note: {
    marginTop: spacing.xs,
  },
});
