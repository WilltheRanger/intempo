import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../navigation/useGoBack';

import {
  Input,
  PageHeader,
  PrimaryButton,
  ScreenContainer,
  Text,
} from '../../components/primitives';
import { useCreatePiece } from '../../data/hooks/usePieces';
import { usePreferences } from '../../data/preferences';
import { spacing } from '../../design';
import { clefFor } from '../../lib/instrument';
import type { RootNavigation } from '../../navigation/types';
import { ComposerField } from '../../components/pieces/ComposerField';

/** The backend's `bpm_hint` bounds. Rejecting here saves a round trip. */
const MIN_BPM = 20;
const MAX_BPM = 300;

/** `4/4`, `6/8`, `12/8`. Anything else is a typo, not a metre. */
const TIME_SIGNATURE = /^\d{1,2}\/\d{1,2}$/;

/**
 * A piece the musician types in rather than photographs.
 *
 * **The only way into the library that needs nothing but a keyboard** — no
 * camera, no OCR provider, no API keys. That matters more than it sounds:
 * every other route in depends on a photograph being readable, and a
 * handwritten part or a library copy under a reading lamp often isn't. It is
 * also the route for a piece someone is working from a book they'd rather not
 * photograph at all.
 *
 * **What it cannot do, and says so.** Four fields describe a piece; they don't
 * transcribe it. Without notes the analysis pipeline has nothing to align a
 * recording against, so a piece added here can be opened and practised with
 * the metronome but will not produce a verdict. The line under the button says
 * that in the musician's own terms rather than letting them find out after a
 * take.
 *
 * The clef is not asked for. It comes from the instrument in the profile,
 * which is right for nearly every piece a player works on — and "which clef is
 * this written in" is a question about a page, put to someone who is
 * describing a piece from memory.
 *
 * Composition: fields on the page rather than in a card. They are the content
 * of this screen, not a group within it, and a box around the only thing
 * present is a box doing nothing (§3 laws 3 and 10). The action sits at the
 * foot, in reach (§3 law 7).
 */
export function ManualPieceForm() {
  const navigation = useNavigation<RootNavigation>();
  const goBack = useGoBack({ tab: 'Library' });
  const { instrument } = usePreferences();
  const createPiece = useCreatePiece();

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [movement, setMovement] = useState('');
  const [timeSignature, setTimeSignature] = useState('');
  const [bpm, setBpm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('A title, at least — it is how you will find this again.');
      return;
    }

    const trimmedSignature = timeSignature.trim();
    if (trimmedSignature && !TIME_SIGNATURE.test(trimmedSignature)) {
      setError('Time signature looks like 4/4 or 6/8.');
      return;
    }

    // Empty stays null rather than becoming 0: "they didn't say" and "twenty
    // beats a minute" are different answers.
    const trimmedBpm = bpm.trim();
    const parsedBpm = trimmedBpm ? Number(trimmedBpm) : null;
    if (
      parsedBpm !== null &&
      (!Number.isInteger(parsedBpm) || parsedBpm < MIN_BPM || parsedBpm > MAX_BPM)
    ) {
      setError(`Tempo is a whole number between ${MIN_BPM} and ${MAX_BPM}.`);
      return;
    }

    setError(null);
    try {
      const piece = await createPiece.mutateAsync({
        title: trimmedTitle,
        composer: composer.trim() || null,
        movement: movement.trim() || null,
        clef: clefFor(instrument),
        timeSignature: trimmedSignature || null,
        bpm: parsedBpm,
      });
      // Replace, not push: going "back" from the piece you just added should
      // land in the library, not in the empty form that made it.
      navigation.replace('PieceDetail', { pieceId: piece.id });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save the piece. Try again.",
      );
    }
  }

  return (
    <ScreenContainer>
      <PageHeader
        title="Add manually"
        onBack={goBack}
        backLabel="Back"
      />

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
      <ComposerField value={composer} onChangeText={setComposer} style={styles.field} />
      <Input
        label="Movement"
        value={movement}
        onChangeText={setMovement}
        placeholder="I. Adagio — optional"
        autoCapitalize="words"
        returnKeyType="next"
        style={styles.field}
      />
      <Input
        label="Time signature"
        value={timeSignature}
        onChangeText={setTimeSignature}
        placeholder="4/4"
        autoCapitalize="none"
        returnKeyType="next"
        style={styles.field}
      />
      <Input
        label="Tempo"
        value={bpm}
        onChangeText={setBpm}
        placeholder="beats per minute"
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        style={styles.field}
      />

      {error ? (
        <Text variant="metadataSmall" color="textSecondary" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label="Add to library"
        onPress={() => void submit()}
        loading={createPiece.isPending}
        disabled={createPiece.isPending}
        style={styles.submit}
      />

      <Text variant="metadataSmall" color="textTertiary" style={styles.caveat}>
        A piece added this way has no notes behind it, so you can practise it
        with the metronome but it won&apos;t be analysed. Photograph the music
        to get verdicts.
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  first: {
    marginTop: spacing.md,
  },
  field: {
    marginTop: spacing.lg,
  },
  error: {
    marginTop: spacing.lg,
  },
  submit: {
    marginTop: spacing['2xl'],
  },
  caveat: {
    marginTop: spacing.lg,
  },
});
