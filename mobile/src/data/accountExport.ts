import { File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { apiFetch } from './api/client';
import { IS_LIVE_BACKEND } from './environment';

export interface AccountExport {
  export_version: number;
  generated_at: string;
  account: Record<string, unknown>;
  library: Array<Record<string, unknown>>;
  practice_analyses: Array<Record<string, unknown>>;
  verdict_corrections: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  owned_studios: Array<Record<string, unknown>>;
  sync_events: Array<Record<string, unknown>>;
  stored_media: {
    profile_photo: boolean;
    score_pages: number;
    practice_recordings: number;
    included_in_json: false;
  };
}

/**
 * The whole account, as the server holds it.
 *
 * Guarded the way `useSubmitCorrection` and `useUpdateProfile` are guarded: a
 * build on sample data has no account to export, and handing someone a JSON
 * file of fixtures labelled "your data" is a worse answer than refusing.
 *
 * Without the guard this screen was the one place in the app that fell through
 * to `apiFetch` with no session and told the musician **"Your session has
 * ended. Sign in again."** — on a build where they are signed in as far as
 * every other screen is concerned. That sentence is right for an expired
 * token and wrong for everything else that reaches it.
 */
export async function fetchAccountExport(): Promise<AccountExport> {
  if (!IS_LIVE_BACKEND) {
    throw new Error(
      'Downloading your data needs the backend. This build is running on sample data.',
    );
  }
  return apiFetch<AccountExport>('/v1/me/export');
}

/**
 * The name the export is saved under.
 *
 * The date is checked rather than sliced blindly: `generated_at` comes off the
 * wire, and a value that is not a date produced filenames like
 * `intempo-data-not-a-dat.json`, which reads as corruption to the one person
 * who ever looks at it.
 */
export function exportFilename(generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  return `intempo-data-${/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'account'}.json`;
}

/**
 * The last file written on a device, so the next export can replace it.
 *
 * An account export is the musician's data in the clear. It goes to the cache
 * directory, which is sandboxed and purgeable, but leaving one copy per export
 * there is a growing pile of it — so each export removes the one before it.
 * Deleting the *current* file once the share sheet closes would be tidier
 * still, and is not done: the destination copies the file during the activity,
 * and getting that wrong loses the export rather than a few kilobytes of cache.
 */
let previousExport: File | null = null;

/**
 * Save a human-readable JSON export. Answers whether it left the app.
 *
 * Browsers receive a real downloaded file.
 *
 * On iOS the JSON is **written to a file** and the file is shared, which is
 * what puts "Save to Files" in the sheet and gives the export its name. It
 * used to share the JSON as a `message` — a share sheet full of text
 * destinations, no filename (RN's `title` is Android-only), and a screen
 * saying "Download your data" above something that could not be downloaded.
 * A whole account as a chat message is also megabytes into destinations that
 * are built for a sentence.
 *
 * Android still shares the text: RN's `Share` ignores `url` there, and
 * attaching a file needs a dependency this app does not carry. iOS is the
 * shipping target; when Android ships, this is the line that has to change.
 *
 * The return value exists because **dismissing the share sheet resolves
 * successfully**. The screen said "Your export is ready" to anyone who opened
 * the sheet and changed their mind. Android cannot report a dismissal at all,
 * so there it is `true` optimistically — the one platform where the old bug
 * survives, narrowed from every platform to that one.
 */
export async function saveAccountExport(data: AccountExport): Promise<boolean> {
  const json = JSON.stringify(data, null, 2);
  const filename = exportFilename(data.generated_at);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(
      new Blob([json], { type: 'application/json;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  if (Platform.OS !== 'ios') {
    await Share.share({ title: filename, message: json });
    return true;
  }

  previousExport?.delete();
  previousExport = null;

  const file = new File(Paths.cache, filename);
  file.write(json);
  previousExport = file;

  // `url` alone, not alongside `message`: a sheet handed both offers some
  // destinations the text instead of the file, which is the behaviour being
  // fixed showing up again in half the sheet.
  const result = await Share.share({ url: file.uri });

  if (result.action === Share.dismissedAction) {
    file.delete();
    previousExport = null;
    return false;
  }

  return true;
}
