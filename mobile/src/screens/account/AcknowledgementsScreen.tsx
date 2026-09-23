import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import {
  Card,
  MetadataRow,
  PageHeader,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { LICENCES } from '../../data/licences';
import { BORDER_WIDTH, colors, spacing } from '../../design';

/**
 * The open-source work InTempo is built on.
 *
 * Generated from the installed tree by `scripts/generate-licences.mjs`, not
 * typed out — a hand-kept list is wrong within a release, and a wrong
 * attribution list is worse than none.
 *
 * Direct dependencies only. The transitive tree is several hundred packages,
 * and a list nobody can read attributes nothing to anyone.
 */
export function AcknowledgementsScreen() {
  const goBack = useGoBack({ tab: 'Profile' });

  return (
    <ScreenContainer>
      {/*
        **Two words, and that is the load-bearing part.** "Acknowledgements" is
        sixteen characters with nowhere to break, and a page title has to wrap
        at a word boundary — at 2x text it ran 218pt off a 390pt screen, which
        no amount of shrinking the container fixes. "Open source" wraps, says
        what the screen actually holds, and is the term the stores use.
      */}
      <PageHeader
        eyebrow={`${LICENCES.length} packages`}
        title="Open source"
        onBack={goBack}
        backLabel="Back to profile"
      />

      <Text variant="body" color="textSecondary" style={styles.lede}>
        InTempo is built on open-source work. The score fixtures are
        public-domain editions; their provenance is recorded in the repository.
      </Text>

      {/*
        **Photography, above the package list rather than buried under it.**
        One photograph carries a whole screen of this app, and a person took
        it. The Unsplash Licence does not require attribution, which makes
        this a choice — and a list of three hundred npm packages that omits
        the one human being is the wrong choice.
      */}
      <Text variant="sectionLabel" color="textSecondary" style={styles.heading}>
        Photography
      </Text>
      <Text variant="body" style={styles.credit}>
        The Today screen&rsquo;s photograph of a rehearsal room is from
        Unsplash, under the Unsplash Licence. Its photographer was not recorded
        when it was chosen; if it is yours, tell us and it will be named here.
      </Text>

      <Text variant="sectionLabel" color="textSecondary" style={styles.heading}>
        Packages
      </Text>

      <Card padded={false}>
        <View style={styles.rows}>
          {LICENCES.map((entry, index) => (
            <View
              key={entry.name}
              style={[styles.row, index > 0 && styles.divided]}
            >
              <Text variant="button">{entry.name}</Text>
              <MetadataRow
                variant="metadataSmall"
                items={[entry.version, entry.licence]}
                style={styles.meta}
              />
            </View>
          ))}
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginBottom: spacing.xl,
  },
  heading: {
    marginBottom: spacing.sm,
  },
  credit: {
    marginBottom: spacing.xl,
  },
  rows: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    paddingVertical: spacing.lg,
  },
  divided: {
    borderTopWidth: BORDER_WIDTH,
    borderTopColor: colors.border,
  },
  meta: {
    marginTop: spacing.xs,
  },
});
