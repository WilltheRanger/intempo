import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Downloading your own data, on the three platforms that do it differently.
 *
 * The screen above this says "Download your data" and, when this resolves,
 * "Your export is ready". Two things made that untrue and neither could fail a
 * typecheck:
 *
 * - **iOS shared the JSON as a `message`.** RN's `Share` puts a string into
 *   text destinations; there is no "Save to Files" for one, and `title` — the
 *   only place the filename appeared — is Android-only, so the export had no
 *   name either. The whole account, as a chat message.
 * - **Dismissing the sheet resolves successfully.** Open it, change your mind,
 *   and the screen said the export was ready.
 *
 * `Share` and `expo-file-system` are stood in for the way `scorePlayer.test.ts`
 * stands in for `expo-audio`: the point is which call is made with what, and a
 * device is the one place that cannot be asserted about.
 */

let platformOS = 'ios';
const shared: unknown[] = [];
let shareResult: { action: string } = { action: 'sharedAction' };

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformOS;
    },
  },
  Share: {
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
    share: (content: unknown) => {
      shared.push(content);
      return Promise.resolve(shareResult);
    },
  },
}));

/** Every file the module wrote, in order, with what happened to it. */
interface FakeFile {
  name: string;
  uri: string;
  contents: string | null;
  deleted: boolean;
}
const written: FakeFile[] = [];

vi.mock('expo-file-system', () => {
  class File {
    name: string;
    uri: string;
    private record: FakeFile;

    constructor(_directory: unknown, name: string) {
      this.name = name;
      this.uri = `file:///cache/${name}`;
      this.record = { name, uri: this.uri, contents: null, deleted: false };
      written.push(this.record);
    }

    write(contents: string) {
      this.record.contents = contents;
    }

    delete() {
      this.record.deleted = true;
    }
  }
  return { File, Paths: { cache: '/cache' } };
});

let live = true;
vi.mock('./environment', () => ({
  get IS_LIVE_BACKEND() {
    return live;
  },
}));

const fetched: string[] = [];
vi.mock('./api/client', () => ({
  apiFetch: (path: string) => {
    fetched.push(path);
    return Promise.resolve({ generated_at: '2026-09-03T02:14:55Z' });
  },
}));

const EXPORT = {
  export_version: 1,
  generated_at: '2026-09-03T02:14:55Z',
  account: { email: 'someone@example.com' },
  library: [],
  practice_analyses: [],
  verdict_corrections: [],
  assignments: [],
  owned_studios: [],
  sync_events: [],
  stored_media: {
    profile_photo: true,
    score_pages: 3,
    practice_recordings: 2,
    included_in_json: false as const,
  },
};

/** A fresh copy each time: the module remembers the last file it wrote. */
async function load() {
  vi.resetModules();
  return import('./accountExport');
}

beforeEach(() => {
  live = true;
  fetched.length = 0;
  platformOS = 'ios';
  shareResult = { action: 'sharedAction' };
  shared.length = 0;
  written.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetching the export', () => {
  it('asks the server for it', async () => {
    const { fetchAccountExport } = await load();
    await fetchAccountExport();
    expect(fetched).toEqual(['/v1/me/export']);
  });

  it('refuses on a build with no account behind it', async () => {
    live = false;
    const { fetchAccountExport } = await load();

    // Falling through to `apiFetch` here reached the no-token branch and told
    // the musician "Your session has ended. Sign in again." on a build where
    // every other screen has them signed in — and the alternative, a JSON file
    // of fixtures labelled "your data", is worse than either.
    await expect(fetchAccountExport()).rejects.toThrow(/needs the backend/);
    expect(fetched).toEqual([]);
  });
});

describe('the export filename', () => {
  it('carries the day the export was taken', async () => {
    const { exportFilename } = await load();
    expect(exportFilename('2026-09-03T02:14:55Z')).toBe('intempo-data-2026-09-03.json');
  });

  it('falls back rather than naming the file after a fragment', async () => {
    const { exportFilename } = await load();
    // Slicing ten characters off anything produced `intempo-data-not-a-dat`,
    // which reads as a corrupted download to the one person who sees it.
    expect(exportFilename('')).toBe('intempo-data-account.json');
    expect(exportFilename('not a timestamp at all')).toBe('intempo-data-account.json');
  });
});

describe('saving the export on iOS', () => {
  it('shares a written file, not the JSON as a message', async () => {
    const { saveAccountExport } = await load();

    await expect(saveAccountExport(EXPORT)).resolves.toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('intempo-data-2026-09-03.json');
    expect(JSON.parse(written[0].contents ?? 'null')).toEqual(EXPORT);

    expect(shared).toEqual([{ url: 'file:///cache/intempo-data-2026-09-03.json' }]);
  });

  it('sends the sheet a file and nothing else', async () => {
    const { saveAccountExport } = await load();
    await saveAccountExport(EXPORT);

    // A sheet handed a `message` alongside the `url` offers some destinations
    // the text instead of the file — the same defect, in half the sheet.
    expect(Object.keys(shared[0] as object)).toEqual(['url']);
  });

  it('reports a dismissed sheet as not saved, and keeps no copy', async () => {
    const { saveAccountExport } = await load();
    shareResult = { action: 'dismissedAction' };

    await expect(saveAccountExport(EXPORT)).resolves.toBe(false);
    expect(written[0].deleted).toBe(true);
  });

  it('replaces the previous export rather than piling them up', async () => {
    const { saveAccountExport } = await load();

    await saveAccountExport(EXPORT);
    await saveAccountExport({ ...EXPORT, generated_at: '2026-09-04T02:14:55Z' });

    expect(written.map((f) => f.name)).toEqual([
      'intempo-data-2026-09-03.json',
      'intempo-data-2026-09-04.json',
    ]);
    // An account export is the musician's data in the clear; one copy of it in
    // the cache at a time is the most this should ever leave lying around.
    expect(written.map((f) => f.deleted)).toEqual([true, false]);
  });
});

describe('saving the export on Android', () => {
  it('shares the text, because RN cannot attach a file there', async () => {
    platformOS = 'android';
    const { saveAccountExport } = await load();

    await expect(saveAccountExport(EXPORT)).resolves.toBe(true);

    expect(written).toEqual([]);
    expect(shared).toHaveLength(1);
    const content = shared[0] as { title: string; message: string };
    expect(content.title).toBe('intempo-data-2026-09-03.json');
    expect(JSON.parse(content.message)).toEqual(EXPORT);
  });
});

describe('saving the export in a browser', () => {
  it('downloads a named JSON file and shares nothing', async () => {
    platformOS = 'web';

    const link: Record<string, unknown> = { style: {}, click: vi.fn(), remove: vi.fn() };
    const revoked: string[] = [];
    vi.stubGlobal('document', {
      createElement: () => link,
      body: { appendChild: vi.fn() },
    });
    // A subclass rather than an object literal: something in the import chain
    // builds a `URL`, so a plain object fails at load with `URL is not a
    // constructor`. And a subclass rather than `Object.assign` onto the real
    // one, because that mutation outlives `unstubAllGlobals` — the binding is
    // restored, the property stays, and the next file in this worker sees a
    // `URL.createObjectURL` that returns a fixed string.
    class StubURL extends globalThis.URL {
      static createObjectURL = () => 'blob:export';
      static revokeObjectURL = (url: string) => {
        revoked.push(url);
      };
    }
    vi.stubGlobal('URL', StubURL);

    const { saveAccountExport } = await load();
    await expect(saveAccountExport(EXPORT)).resolves.toBe(true);

    expect(link.download).toBe('intempo-data-2026-09-03.json');
    expect(link.href).toBe('blob:export');
    expect(link.click).toHaveBeenCalled();
    // Held for the life of the tab otherwise, and it holds the whole export.
    expect(revoked).toEqual(['blob:export']);
    expect(shared).toEqual([]);
    expect(written).toEqual([]);
  });
});
