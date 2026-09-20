/**
 * What a picked audio file has to be before the app will send it.
 *
 * **A second opinion, deliberately, not the only one.** The real guard is
 * `backend/app/services/audio_intake.py`, which sniffs the bytes and reads a
 * duration out of the container header before any decoder sees the file. That
 * one is load-bearing and this one is not: a client check can be skipped by
 * anyone willing to talk to the API directly, so nothing here may be the only
 * thing standing between a hostile file and ffmpeg.
 *
 * What it is for is the musician. Uploading fifty megabytes to be told the
 * file is a video costs a minute of cellular data and a minute of waiting for
 * an answer that was knowable from its name. This refuses that locally and
 * instantly, and lets everything it accepts go on to be checked properly.
 *
 * **Which means the two must not disagree in the direction that matters.**
 * Accepting something the backend will refuse is a bad experience; refusing
 * something the backend would accept is a bug that makes a working file
 * unusable. So this list is deliberately no narrower than the server's, with
 * one exception it shares a reason with — see `webm` below.
 */

/**
 * Extensions the backend will accept, from `upload.py`, minus `webm`.
 *
 * **`webm` is refused here as it is there, and for the same reason.**
 * `audio_intake.py` leaves it out of its signature table: it is what a
 * *browser recorder* produces rather than something a musician picks out of a
 * file manager, and it is the one allowed container `soundfile` cannot probe
 * without handing the file to ffmpeg — which is the thing being avoided. A
 * musician who picks one should be told to convert it, here, in an instant,
 * rather than after an upload.
 */
const ACCEPTED: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
};

/** The names, for a sentence that tells a musician what does work. */
export const ACCEPTED_LABEL = 'WAV, MP3, M4A, FLAC and OGG';

/**
 * The bucket's own cap, so the refusal happens before the upload rather than
 * part-way through it. Matches the storage limit, not the duration cap: the
 * duration is only knowable from the container header, which is the
 * backend's job.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type PickedTake =
  | { ok: true; filename: string; contentType: string }
  | { ok: false; message: string };

/** The extension, lowercased, or '' when the name has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  // `lastIndexOf` finds the dot in `.hidden`, whose "extension" is the whole
  // name. A leading dot is not a separator here.
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Whether this file can be sent, and what to say if not.
 *
 * Ordered so the cheapest and most certain refusal comes first, and so each
 * message names the one thing to do about it. A file that passes here has not
 * been *approved* — it has only stopped being obviously wrong.
 */
export function describePickedTake({
  name,
  size,
}: {
  name: string;
  size: number | null;
}): PickedTake {
  const extension = extensionOf(name);

  if (!extension) {
    return {
      ok: false,
      message: `That file has no extension, so we can’t tell what it is. ${ACCEPTED_LABEL} all work.`,
    };
  }

  if (extension === 'webm') {
    // Named rather than lumped in with "not audio", because it *is* audio and
    // being told otherwise would send someone looking for a different file
    // instead of exporting the one they have.
    return {
      ok: false,
      message: `WebM recordings can’t be read. Export it as ${ACCEPTED_LABEL.replace(' and ', ' or ')} and try again.`,
    };
  }

  const contentType = ACCEPTED[extension];
  if (!contentType) {
    return {
      ok: false,
      message: `We can’t read .${extension} files. ${ACCEPTED_LABEL} all work.`,
    };
  }

  // A null size is "the picker did not say", which is not the same as zero.
  // Let it through: the backend measures the bytes it actually receives, and
  // refusing a file for a number we never got would be this check inventing a
  // problem.
  if (size !== null) {
    if (size === 0) {
      return { ok: false, message: 'That file is empty.' };
    }
    if (size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        // **`ceil`, not `round`.** A file one byte over the cap rounds to
        // the cap, and "That file is 50 MB and the limit is 50 MB" reads as
        // the app being broken rather than as a limit. Rounding up overstates
        // by less than a megabyte and can never report the two as equal.
        message: `That file is ${Math.ceil(size / 1_048_576)} MB and the limit is ${MAX_UPLOAD_BYTES / 1_048_576} MB. A shorter recording, or one saved as MP3 rather than WAV, will fit.`,
      };
    }
  }

  return { ok: true, filename: name, contentType };
}
