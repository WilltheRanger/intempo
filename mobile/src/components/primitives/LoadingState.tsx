import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../design';
import { Text } from './Text';

export interface LoadingStateProps {
  /** Optional line explaining what is being waited on. */
  label?: string;
  /**
   * `block` fills the space it is given and centres itself in it — the right
   * shape when a whole screen or panel is waiting and there is nothing else on
   * it. `inline` is a row on the left margin, for a wait that is part of a
   * composed screen.
   *
   * **Named rather than inferred from `label`.** Both shapes take one, and a
   * component that changes its alignment because a prop happens to be set is a
   * component whose layout nobody can predict from the call site.
   */
  layout?: 'block' | 'inline';
}

/**
 * Placeholder while content loads.
 *
 * Deliberately minimal. Per-component skeletons are Phase 6 polish; a calm
 * indicator is the right default until then.
 */
export function LoadingState({ label, layout = 'block' }: LoadingStateProps) {
  const inline = layout === 'inline';
  return (
    <View style={inline ? styles.inline : styles.container}>
      <ActivityIndicator color={colors.textTertiary} />
      {label ? (
        <Text
          variant="metadata"
          color="textTertiary"
          style={inline ? styles.inlineLabel : styles.label}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
  },
  /**
   * On the screen's own margin, beside the words it belongs to.
   *
   * `AccountStartupScreen` is the only caller with a label, and centring put a
   * lone spinner on the middle axis between two left-aligned sentences —
   * breaking the one horizontal margin the screen otherwise keeps (§3 law 5)
   * and cutting the caption off from the sentence above it.
   */
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  label: {
    marginTop: spacing.md,
  },
  // The caption wraps; `flex: 1` is what lets it, since a row sizes its
  // children from their content first and an unbroken sentence is one token
  // as far as that is concerned.
  inlineLabel: {
    flex: 1,
  },
});
