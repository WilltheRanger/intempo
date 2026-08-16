import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, spacing } from '../../design';

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
}

/**
 * A setting that's either on or off.
 *
 * The platform switch, in the app's palette — gold when on, the strong border
 * when off. It's the control people already know for this, and drawing our own
 * would be a worse version of it.
 */
export function ToggleRow({
  label,
  description,
  value,
  onChange,
  divided = true,
}: ToggleRowProps) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <View style={styles.text}>
        <Text variant="button">{label}</Text>
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

      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.borderStrong}
        {...WEB_THUMB}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  text: {
    flexShrink: 1,
  },
  description: {
    marginTop: spacing.xs,
  },
});
