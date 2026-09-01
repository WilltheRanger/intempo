import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { PageHeader, ScreenContainer, Text } from '../../components/primitives';
import { spacing } from '../../design';
import { DOCUMENTS, OWNER } from '../../lib/legal';
import type { RootStackParamList, RootNavigation } from '../../navigation/types';

/**
 * The privacy policy and the terms.
 *
 * **A document, so it is set as one.** No cards: a policy is continuous prose
 * and boxing each section would break the one thing a reader needs, which is
 * the ability to go from top to bottom without losing the thread (§3 law 3).
 * The hierarchy is typographic — a serif title, small sans section labels,
 * body text — because that is what a type scale is for (§3 law 8).
 *
 * **Three-foot test.** First the title, second the section labels marching down
 * the page, third the body. Nothing else is on the screen to compete.
 *
 * The publisher's details render only when they exist. A policy that names a
 * plausible-looking company nobody registered, or an address nobody reads, is
 * worse than one that is quiet about it — see `OWNER`.
 */
export function LegalScreen() {
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Legal'>>();
  // **A URL can name a document that does not exist**, and this crashed on
  // one: `DOCUMENTS['nope']` is undefined and `document.title` then throws into
  // the error boundary, so `/legal/nope` took the whole app down with
  // "Something broke". A stale link, a typo or a truncated share is enough.
  //
  // The route's *type* says `'privacy' | 'terms'`, which is exactly the
  // reassurance that made this easy to miss: TypeScript checks the callers it
  // can see, and a URL is not one of them.
  const document = DOCUMENTS[params.document] ?? null;

  if (!document) {
    return (
      <ScreenContainer>
        <PageHeader
          title="Not found"
          onBack={() => navigation.goBack()}
          backLabel="Back"
        />
        <Text variant="body" color="textSecondary" style={styles.updated}>
          There is no document at this address. The privacy policy and the terms
          are both in Profile, under About.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <PageHeader
        title={document.title}
        onBack={() => navigation.goBack()}
        backLabel="Back"
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.updated}>
        {`Last updated ${document.updated}`}
      </Text>

      {document.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text variant="sectionLabel" color="textSecondary">
            {section.heading}
          </Text>
          {section.body.map((paragraph) => (
            <Text
              key={paragraph.slice(0, 32)}
              variant="body"
              color="textSecondary"
              style={styles.paragraph}
            >
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

      {OWNER.entity ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.owner}>
          {`Published by ${OWNER.entity}.`}
        </Text>
      ) : null}
      {OWNER.contact ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.ownerLine}>
          {`Questions about your data: ${OWNER.contact}`}
        </Text>
      ) : null}
      {document.id === 'terms' && OWNER.jurisdiction ? (
        <Text variant="metadataSmall" color="textTertiary" style={styles.ownerLine}>
          {`These terms are read under the law of ${OWNER.jurisdiction}.`}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  updated: {
    marginTop: spacing.xs,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  paragraph: {
    marginTop: spacing.md,
  },
  owner: {
    marginTop: spacing['3xl'],
  },
  ownerLine: {
    marginTop: spacing.xs,
  },
});
