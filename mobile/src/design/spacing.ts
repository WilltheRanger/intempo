/**
 * Spacing scale. Every margin, padding, and gap in the app resolves to one of
 * these. If a layout seems to need a value that isn't here, the layout is
 * wrong — don't add a step without a design decision behind it.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export type SpacingToken = keyof typeof spacing;
