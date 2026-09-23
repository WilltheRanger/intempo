import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { BORDER_WIDTH, colors, disabledOpacity, spacing } from '../../design';
import { ROW_PADDING_VERTICAL } from '../rowMetrics';
import { Text } from './Text';

/**
 * react-native-web reads `activeThumbColor` for the "on" thumb and leaves
 * `thumbColor` to the "off" one, so without this the switch turns Material
 * teal the moment it's enabled — a colour from nowhere in this palette. The
 * prop isn't in React Native's own Switch types. Same shape as the focus-ring
 * shim in `Input`; a no-op on device, where `thumbColor` covers both states.
 */
const WEB_THUMB = Platform.select({
  web: { activeThumbColor: colors.surface },
  default: {},
}) as object;

export interface ToggleRowProps {
  label: string;
  /** One line on what it changes. Settings that need more are the wrong shape. */
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** Hairline above the row. Omit on the first row in a group. */
  divided?: boolean;
  /** Holds the value steady while a server-backed setting is being saved. */
  disabled?: boolean;
}

/**
 * A setting that's either on or off.
 *
 * The platform switch, in the app's palette — gold when on, the strong border
 * when off. It's the control people already know for this, and drawing our own
 * would be a worse version of it.
 *
 * **A primitive rather than a Profile component**, since 2026-09-19. It lived
 * under `screens/profile/` while Profile was the only screen with settings on
 * it; the record sheet's "skip long rests" then shipped as an
 * `accessibilityRole="switch"` around a bare line of text — a control drawn as
 * a caption, which is the affordance defect §3 names and the second one found
 * on that sheet in a week. The answer to "this screen needs a switch" has to
 * be a switch anyone can reach.
 */
export function ToggleRow({
  label,
  description,
  value,
  onChange,
  divided = true,
  disabled = false,
}: ToggleRowProps) {
  return (
    /*
      **The whole row is the control, not just the switch.**
      A `Switch` measures 40x20 — under half the platform's minimum target on
      its short side — so the only tappable part of a row two hundred points
      wide was a thumbnail-sized rectangle in the corner. Every setting screen
      worth using lets you press the label.

      The row carries the semantics (`role="switch"` and the checked state) and
      the switch is the picture of it: `accessible={false}` and
      `pointerEvents="none"` so a screen reader hears one control rather than
      two, and a tap on the switch itself falls through to the row instead of
      being swallowed by a second handler that would toggle twice.
    */
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      // **Both spellings, deliberately.** `accessibilityState` is what React
      // Native reads; `aria-checked` is what react-native-web emits, and it
      // does *not* derive one from the other — measured: with only the first,
      // the row announced "switch, Haptic feedback" and never said whether it
      // was on.
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      aria-disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.text}>
        {/*
          15pt regular, with a 12pt note (`redesign/Profile.dc.html`): a
          setting's name is read, not pressed like a button's, and the switch
          beside it is what says it is a control.
        */}
        <Text variant="rowLabel">{label}</Text>
        {description ? (
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.description}
          >
            {description}
          </Text>
        ) : null}
      </View>

      {/*
        Hidden from the accessibility tree as well as from touch. Without
        `aria-hidden` react-native-web still renders its own
        `input[type=checkbox][role=switch]` inside, so every setting announced
        **two** switches: the row, labelled but stateless, and the input,
        stateful but unlabelled.
      */}
      <View pointerEvents="none" aria-hidden>
        <Switch
          value={value}
          disabled={disabled}
          accessible={false}
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.borderStrong}
          {...WEB_THUMB}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: ROW_PADDING_VERTICAL,
  },
  disabled: {
    opacity: disabledOpacity,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  text: {
    flexShrink: 1,
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
  },
});
