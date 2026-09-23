import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';

import type { PickedFile } from '../../data/practice/pickedTake';
import { describePickedTake } from '../../lib/record/pickedTake';

/**
 * Open the system file picker for a recording, and check what comes back.
 *
 * One place for it, because two screens open it: Record's ⋮ menu, which must
 * call it straight from the tap (a browser refuses a file picker that was not
 * opened by one), and the Upload screen's "Choose a different file".
 *
 * `describePickedTake` is the rule — which formats, how large — and is tested;
 * this is only the picker's plumbing around it.
 */
export type ChosenFile =
  | { kind: 'picked'; file: PickedFile }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export async function chooseAudioFile(): Promise<ChosenFile> {
  let asset: DocumentPicker.DocumentPickerAsset | undefined;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      // `audio/*` is advisory on some pickers; the extension check below is
      // the one that decides.
      type: 'audio/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return { kind: 'cancelled' };
    }
    asset = result.assets?.[0];
  } catch {
    return { kind: 'failed', message: 'That file could not be opened. Try choosing it again.' };
  }
  if (!asset) {
    return { kind: 'failed', message: 'Nothing was selected.' };
  }

  const size = asset.size ?? null;
  const picked = describePickedTake({ name: asset.name, size });
  if (!picked.ok) {
    return { kind: 'failed', message: picked.message };
  }

  let audio: Blob;
  try {
    // The web picker hands over a `File`, which is a `Blob`. Native hands over
    // a URI, and `expo-file-system`'s `File` is what `fetch` can upload.
    audio = asset.file ?? (new FSFile(asset.uri) as unknown as Blob);
  } catch {
    return { kind: 'failed', message: 'That file could not be read. Try choosing it again.' };
  }

  return {
    kind: 'picked',
    file: {
      audio,
      name: asset.name,
      filename: picked.filename,
      contentType: picked.contentType,
      sizeBytes: size,
    },
  };
}
