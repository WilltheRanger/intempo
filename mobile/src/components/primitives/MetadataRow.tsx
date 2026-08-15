import type { StyleProp, TextStyle } from 'react-native';

import { joinMetadata } from '../../lib/format';
import { Text } from './Text';

export interface MetadataRowProps {
  /** Fragments to join. Null and undefined entries are dropped. */
  items: (string | null | undefined)[];
  style?: StyleProp<TextStyle>;
}

/**
 * A single line of supporting detail — "62%  ·  Practiced 2 days ago".
 *
 * Renders nothing when every fragment is absent, so a card doesn't reserve
 * space for metadata it doesn't have.
 */
export function MetadataRow({ items, style }: MetadataRowProps) {
  const content = joinMetadata(items);
  if (!content) {
    return null;
  }
  return (
    <Text variant="metadata" color="textTertiary" style={style}>
      {content}
    </Text>
  );
}
