import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';
import { FileMusic } from '../../components/icons';
import { useGoBack } from '../../navigation/useGoBack';
import { ComposerField } from '../../components/pieces/ComposerField';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../components/overlays/BottomSheet';
import { InlineCameraCapture } from '../../components/pieces/InlineCameraCapture';
import {
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
  Text,
} from '../../components/primitives';
import { captureSession } from '../../data/captureSession';
import { useImportPiece } from '../../data/hooks/usePieces';
import { BORDER_WIDTH, colors, MIN_TOUCH_TARGET, spacing } from '../../design';
import {
  composerIn,
  MusicXMLFileError,
  partsIn,
  readMusicXML,
  titleIn,
  type MusicXMLPart,
} from '../../lib/musicxml/file';
import type { RootNavigation } from '../../navigation/types';

/**
 * What a file picker can be told to offer.
 *
 * Deliberately loose. iOS resolves `.musicxml` and `.mxl` through declared
 * document types that not every device knows, and Android's MIME lookup for
 * both is unreliable — an exact filter hides the file the musician is looking
 * straight at. So the filter is wide and the *format* check happens after the
 * file is open, where sniffing the bytes gives a real answer.
 */
const PICKER_TYPES = [
  'application/vnd.recordare.musicxml',
  'application/vnd.recordare.musicxml+xml',
  'application/xml',
  'text/xml',
  'application/zip',
  '*/*',
];

/** The backend's `musicxml` field cap. Refusing here saves a long upload. */
const MAX_XML_CHARS = 8_000_000;

interface Chosen {
  fileName: string;
  xml: string;
  parts: MusicXMLPart[];
}

/**
 * A piece from a notation file — the route where the notes arrive exact.
 *
 * Every other way into the library ends in a guess. The camera reads a
 * photograph with a model that can misread a bar; typing a piece in produces
 * no notes at all. A MusicXML file *states* the durations, and durations are
 * what `alignment.py` builds its timeline from, so this is the one route where
 * the thing a verdict is measured against cannot be wrong.
 *
 * **`.mxl` is unzipped here.** The endpoint takes uncompressed XML and says
 * unpacking is the client's job. MuseScore, Sibelius and Finale all export the
 * compressed form by default, so without this the picker would reject most
 * scores people actually have.
 *
 * **Three states, one at a time**, so the screen always has a single job and a
 * single dominant element (§3 laws 4 and 10): choose a file → pick your part,
 * if the file holds more than one → name it and save. The part question only
 * appears when it is a real question; a solo part never sees it.
 *
 * The part list is not a separate screen. It would mean putting a multi-megabyte
 * XML string into navigation params, and it is one question — a screen for it
 * would be chrome around a list.
 *
 * Composition: fields and rows on the page, not in cards (§3 law 3). The action
 * is pinned to the foot, in reach (§3 law 7).
 */
export function ImportFileScreen() {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  const importPiece = useImportPiece();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [part, setPart] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [showCamera, setShowCamera] = useState(false);

  /** Web hands back a Blob; native hands back a URI. Both read the same way. */
  async function bytesOf(asset: DocumentPicker.DocumentPickerAsset) {
    const blob: Blob = asset.file ?? new FSFile(asset.uri);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function pick() {
    setBusy(true);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: PICKER_TYPES,
        multiple: false,
        // Copied into the cache so it can be read straight away. These are
        // kilobytes of XML, not a video.
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets?.[0];
      if (!asset) {
        setError('Nothing was selected.');
        return;
      }

      const xml = readMusicXML(await bytesOf(asset));
      if (!/<score-partwise|<score-timewise/i.test(xml)) {
        setError(
          `${asset.name} isn't a MusicXML score. Export one from MuseScore, Sibelius or Finale and try again.`,
        );
        return;
      }
      if (xml.length > MAX_XML_CHARS) {
        setError('That score is too large to import.');
        return;
      }

      const parts = partsIn(xml);
      setChosen({ fileName: asset.name, xml, parts });
      // One part is not a question. Nor is none — the backend takes the only
      // `<part>` there is, and a file with no `<part-list>` still has one.
      setPart(parts.length > 1 ? null : (parts[0]?.id ?? null));
      setTitle(titleIn(xml) ?? asset.name.replace(/\.[^.]+$/, ''));
      setComposer(composerIn(xml) ?? '');
    } catch (cause) {
      setError(
        cause instanceof MusicXMLFileError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "That file couldn't be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!chosen) {
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setError('A title, at least — it is how you will find this again.');
      return;
    }

    setError(null);
    try {
      const piece = await importPiece.mutateAsync({
        title: trimmed,
        composer: composer.trim() || null,
        movement: null,
        musicxml: chosen.xml,
        part,
      });
      // Replace, not push: going back from the piece you just added should land
      // in the library, not in the form that made it.
      navigation.replace('PieceScore', { pieceId: piece.id });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't import that file.",
      );
    }
  }

  /**
   * The camera fallback's own capture — a fresh session and straight to
   * review, same as `AddPieceSheet`'s camera option, since this screen never
   * takes `attachToPieceId` or `adding`: reached only from "Add piece", never
   * from a piece already in the library.
   */
  function handleCameraCapture(uri: string) {
    captureSession.reset();
    captureSession.capture(uri);
    setShowCamera(false);
    navigation.replace('CapturedPages');
  }

  const choosingPart = chosen !== null && part === null;
  const chosenPart = chosen?.parts.find((entry) => entry.id === part) ?? null;

  return (
    <ScreenContainer>
      <PageHeader
        title="Open a notation file"
        onBack={goBack}
        backLabel="Back"
      />

      {chosen === null ? (
        <>
          <Text variant="body" color="textSecondary" style={styles.lede}>
            A MusicXML file from MuseScore, Sibelius or Finale. The notes come
            through exactly as written, so nothing has to be read from a
            photograph.
          </Text>

          <PrimaryButton
            label="Choose a file"
            icon={FileMusic}
            onPress={() => void pick()}
            loading={busy}
            disabled={busy}
            style={styles.action}
          />

          <SecondaryButton
            label="Photograph the music instead"
            onPress={() => setShowCamera(true)}
            style={styles.secondary}
          />

          <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
            Compressed .mxl files are fine. A score with several parts will ask
            which one you play.
          </Text>
        </>
      ) : (
        // The file, and the part chosen out of it. The part was a decision the
        // musician made and then could not see, which on an orchestral score is
        // the one thing worth being sure about — a cellist who lands on Violin
        // II gets a transcription that is timed, verdicted and wrong in a way
        // that looks right. Changing it is a labelled control, not a tap on the
        // line, because an affordance nobody can see is not one.
        <View style={styles.file}>
          <Text
            variant="metadataSmall"
            color="textTertiary"
            style={styles.fileName}
            numberOfLines={1}
          >
            {chosenPart ? `${chosen.fileName} · ${chosenPart.name}` : chosen.fileName}
          </Text>
          {chosen.parts.length > 1 && !choosingPart ? (
            <Pressable
              onPress={() => setPart(null)}
              accessibilityRole="button"
              accessibilityLabel="Change part"
              style={({ pressed }) => [styles.change, pressed && styles.pressed]}
            >
              <Text variant="sectionAction">Change part</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {choosingPart ? (
        <View style={styles.parts}>
          <Text variant="body" style={styles.question}>
            Which part do you play?
          </Text>
          {chosen.parts.map((entry, index) => (
            <Pressable
              key={entry.id}
              onPress={() => setPart(entry.id)}
              accessibilityRole="button"
              accessibilityLabel={entry.name}
              style={({ pressed }) => [
                styles.part,
                index > 0 && styles.divided,
                pressed && styles.pressed,
              ]}
            >
              <Text variant="button">{entry.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : chosen !== null ? (
        <>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Sonata No. 1 in G minor"
            serif
            autoCapitalize="words"
            returnKeyType="next"
            style={styles.first}
          />
          {/*
            **The route most likely to produce a variant spelling.** The name
            comes out of the file — "J.S. Bach", "BACH", "Johann Sebastian
            Bach (1685-1750)" — and this was the one place that offered no way
            to settle on one of them. Four spellings of Bach are four rows and
            four covers in a library, which is half of why `composers.ts`
            exists.
          */}
          <ComposerField
            value={composer}
            onChangeText={setComposer}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            style={styles.field}
          />

          <PrimaryButton
            label="Add to library"
            onPress={() => void save()}
            loading={importPiece.isPending}
            disabled={importPiece.isPending}
            style={styles.action}
          />
        </>
      ) : null}

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <BottomSheet
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        expand
        hideCloseButton
        dragWholeBody
      >
        <InlineCameraCapture
          onCapture={handleCameraCapture}
          onCancel={() => setShowCamera(false)}
        />
      </BottomSheet>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.md,
  },
  file: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  fileName: {
    flex: 1,
  },
  change: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  action: {
    marginTop: spacing['2xl'],
  },
  secondary: {
    marginTop: spacing.md,
  },
  caveat: {
    marginTop: spacing['2xl'],
  },
  first: {
    marginTop: spacing['2xl'],
  },
  field: {
    marginTop: spacing.lg,
  },
  parts: {
    marginTop: spacing['2xl'],
  },
  question: {
    marginBottom: spacing.sm,
  },
  part: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopColor: colors.border,
    borderTopWidth: BORDER_WIDTH,
  },
  pressed: {
    opacity: 0.6,
  },
  error: {
    marginTop: spacing.lg,
  },
});
