import { Pressable, StyleSheet, View } from 'react-native';

import { Check } from '../../components/icons';
import { BottomSheet } from '../../components/overlays/BottomSheet';
import { Text } from '../../components/primitives';
import { BORDER_WIDTH, colors, ICON_SIZE } from '../../design';
import { impact, ImpactFeedbackStyle } from '../../lib/haptics';
import type { StartOption } from '../../lib/record/startOptions';

/**
 * "Start from": the named places a take can begin, then the way to pick any
 * other bar (`redesign/RecordReady.dc.html`).
 *
 * The options are `startOptions` — from the piece's last take, never guessed.
 * A tick marks the one the current start bar matches. The last row, "Choose on
 * the score", closes the sheet onto the music, where a tap on any bar sets the
 * start; that row is the way out, so the sheet draws no ✕ (`showClose`).
 */
export function StartFromSheet({
  visible,
  options,
  startFrom,
  onPick,
  onClose,
  onChoose,
  chooseHint = 'Tap any bar above',
}: {
  visible: boolean;
  options: StartOption[];
  startFrom: number;
  onPick: (bar: number) => void;
  onClose: () => void;
  /**
   * What "Choose on the score" does. On Record the score is right there, so
   * it only closes the sheet onto it (the default). A screen with no score on
   * it opens a bar picker instead, and says so in `chooseHint`.
   */
  onChoose?: () => void;
  chooseHint?: string;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Start from" showClose={false}>
      {options.map((option) => {
        const on = option.bar === startFrom;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              impact(ImpactFeedbackStyle.Light);
              onPick(option.bar);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            accessibilityLabel={`${option.label}, bar ${option.bar}`}
            style={({ pressed }) => [styles.option, styles.divided, pressed && styles.pressed]}
          >
            <View style={styles.text}>
              <Text variant="body" style={styles.label}>
                {option.label}
              </Text>
              <Text variant="caption" color="textTertiary" style={styles.sub}>
                Bar {option.bar}
              </Text>
            </View>
            {on ? <Check size={ICON_SIZE.md} strokeWidth={2} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
      <Pressable
        onPress={onChoose ?? onClose}
        accessibilityRole="button"
        accessibilityLabel={`Choose on the score. ${chooseHint}`}
        style={({ pressed }) => [styles.option, pressed && styles.pressed]}
      >
        <View style={styles.text}>
          <Text variant="body" style={styles.label}>
            Choose on the score
          </Text>
          <Text variant="caption" color="textTertiary" style={styles.sub}>
            {chooseHint}
          </Text>
        </View>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  divided: {
    borderBottomWidth: BORDER_WIDTH,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  // 15pt, between `metadata` and `body`: the prototype's row size.
  label: {
    fontSize: 15,
    lineHeight: 20,
  },
  sub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
