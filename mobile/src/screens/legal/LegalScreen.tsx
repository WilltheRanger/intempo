import { useRoute, type RouteProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { useBackButton, type BackButton } from '../../navigation/useGoBack';

import { PageHeader, ScreenContainer, Text } from '../../components/primitives';
import { spacing } from '../../design';
import { DOCUMENTS, OWNER, type LegalDocument } from '../../lib/legal';
import type { RootStackParamList } from '../../navigation/types';

interface LegalDocumentViewProps {
  documentId: LegalDocument['id'];
  /** The navigation bar's back button: Profile's, or the sign-up screen's own. */
  back: BackButton;
}

/**
 * The shared legal-document reader.
 *
 * It deliberately has no navigation dependency. Signed-in musicians reach it
 * through the Legal route, while somebody deciding whether to create an
 * account can read the exact same document from the sign-up screen. Keeping
 * one renderer and one document source prevents the pre-account copy from
 * drifting away from what Profile shows later.
 */
export function LegalDocumentView({ documentId, back }: LegalDocumentViewProps) {
  const document = DOCUMENTS[documentId] ?? null;

  if (!document) {
    return (
      <ScreenContainer navigationBar={{ back }}>
        <PageHeader title="Not found" />
        <Text variant="body" color="textSecondary" style={styles.updated}>
          There is no document at this address.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer navigationBar={{ back }}>
      <PageHeader title={document.title} />

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

/**
 * The privacy policy and terms inside the signed-in app.
 *
 * The route only chooses which shared document to show. The same reader is
 * also available before account creation, so reviewing these words never
 * requires handing over an email address first.
 */
export function LegalScreen() {
  const back = useBackButton({ tab: 'Profile' });
  const { params } = useRoute<RouteProp<RootStackParamList, 'Legal'>>();

  return <LegalDocumentView documentId={params.document} back={back} />;
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
