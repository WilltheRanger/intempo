import { Switch } from 'react-native';

import { colors } from '../../design';

/**
 * The picture of a switch inside a `ToggleRow`, which is the control.
 *
 * On a phone this is the platform's own switch — UISwitch on iOS — in the
 * app's palette: gold when on, the strong border when off. The web draws its
 * own (`SwitchGlyph.web.tsx`), because react-native-web's is a 40×20 Material
 * toggle that no iPhone owner has seen before.
 */
export function SwitchGlyph({ value, disabled }: { value: boolean; disabled: boolean }) {
  return (
    <Switch
      value={value}
      disabled={disabled}
      accessible={false}
      trackColor={{ false: colors.borderStrong, true: colors.accent }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.borderStrong}
    />
  );
}
