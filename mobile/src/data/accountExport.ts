import { Platform, Share } from 'react-native';

import { apiFetch } from './api/client';

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

export async function fetchAccountExport(): Promise<AccountExport> {
  return apiFetch<AccountExport>('/v1/me/export');
}

/**
 * Save a human-readable JSON export.
 *
 * Browsers receive a real downloaded file. Native uses the system share sheet,
 * which offers Files/Drive and any other installed destination without adding
 * a second storage permission to the app.
 */
export async function saveAccountExport(data: AccountExport): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const date = data.generated_at.slice(0, 10) || 'account';
  const filename = `intempo-data-${date}.json`;

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
    return;
  }

  await Share.share({
    title: filename,
    message: json,
  });
}
