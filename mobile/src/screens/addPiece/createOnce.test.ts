import { describe, expect, it } from 'vitest';

import manualSource from './ManualPieceForm.tsx?raw';
import importSource from './ImportFile.tsx?raw';
import scanSource from '../transcriptionReview/TranscriptionReviewScreen.tsx?raw';

/**
 * A screen that creates a piece creates one, however many times it is asked.
 *
 * **`isPending` is a render late.** TanStack Query tells React about a mutation
 * on the next tick, so a button disabled by `isPending` still takes a second
 * tap, and Return in a form's last field never consults it at all. Against the
 * stub API with a slow server, Return twice on "Add manually", a double tap on
 * its button, and Return twice on "Open a score file" each made two pieces
 * (2026-10-06). A slow server is the ordinary case here — the host sleeps — and
 * nothing on screen changes while it wakes, which is when a musician presses
 * again.
 *
 * The guard is a ref set before the first await, which the scan's "Save and
 * read" already had. Source text, for the reason in `loadErrors.test.ts`:
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
const screens = [
  ['ManualPieceForm', manualSource, 'createPiece.mutateAsync('],
  ['ImportFile', importSource, 'importPiece.mutateAsync('],
  ['TranscriptionReviewScreen', scanSource, 'transcribe.mutateAsync('],
] as const;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('a screen that creates a piece', () => {
  it.each(screens)('%s refuses a second submit while the first is in flight', (_name, raw, call) => {
    const source = withoutComments(raw);
    const guard = source.search(/if \((?:![a-zA-Z]+ \|\| )?saving\.current\)/);
    const claim = source.indexOf('saving.current = true;');
    const request = source.indexOf(call);
    const release = source.indexOf('saving.current = false;');

    expect(guard, 'checks the flag').toBeGreaterThan(-1);
    expect(claim, 'sets it before the request').toBeGreaterThan(guard);
    expect(request).toBeGreaterThan(claim);
    expect(release, 'lets go of it afterwards, so a failure can be retried').toBeGreaterThan(request);
  });
});
