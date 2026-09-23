import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BORDER_WIDTH, colors } from '../../design';
import { Text } from './Text';

export interface RuledHeadingProps {
  label: string;
  /**
   * The rule's weight. `border` between the sections of one reading (the
   * Verdict's "Across the take"); `borderStrong` where the rows under it carry
   * hairlines of their own and the section has to read as the heavier line
   * (Profile's "Account").
   */
  rule?: 'border' | 'borderStrong';
  style?: StyleProp<ViewStyle>;
}

/**
 * A section heading in the redesign's register: sentence case, secondary ink,
 * on a rule rather than in a box (`redesign/Verdict.dc.html`,
 * `redesign/Profile.dc.html`).
 *
 * It replaces `SectionHeader`'s uppercase eyebrow on redesigned screens. The
 * rule does the separating the letterspacing used to, which leaves the label
 * free to read as words. Spacing around it is the caller's: a heading over a
 * chart wants room below it, one over a list of ruled rows wants none.
 */
export function RuledHeading({ label, rule = 'border', style }: RuledHeadingProps) {
  return (
    <View style={[styles.ruled, { borderTopColor: colors[rule] }, style]}>
      <Text variant="sectionLabel" color="textSecondary" accessibilityRole="header">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ruled: {
    paddingTop: 14,
    borderTopWidth: BORDER_WIDTH,
  },
});
