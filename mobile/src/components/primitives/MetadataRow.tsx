import type { StyleProp, TextStyle } from 'react-native';

import { joinMetadata } from '../../lib/format';
import { Text } from './Text';

export interface MetadataRowProps {
  /** Fragments to join. Null and undefined entries are dropped. */
  items: (string | null | undefined)[];
  /** `metadataSmall` for dense list rows. */
  variant?: 'metadata' | 'metadataSmall';
  style?: StyleProp<TextStyle>;
}

/**
 * A single line of supporting detail — "62%  ·  Practiced 2 days ago".
 *
 * Renders nothing when every fragment is absent, so a card doesn't reserve
 * space for metadata it doesn't have.
 */
export function MetadataRow({
  items,
  variant = 'metadata',
  style,
}: MetadataRowProps) {
  const content = joinMetadata(items);
  if (!content) {
    return null;
  }
  return (
    <Text variant={variant} color="textTertiary" style={style}>
      {content}
    </Text>
  );
}
