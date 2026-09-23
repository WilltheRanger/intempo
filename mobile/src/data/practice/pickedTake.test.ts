import { describe, expect, it } from 'vitest';

import {
  clearPickedFile,
  queuePickedFileForSend,
  stagePickedFile,
  stagedPickedFile,
  takeQueuedPickedFile,
  type PickedFile,
} from './pickedTake';

function file(name: string): PickedFile {
  return {
    audio: new Blob(['x']),
    name,
    filename: name,
    contentType: 'audio/mp4',
    sizeBytes: 1,
  };
}

describe('the picked-file hand-off', () => {
  it('holds a file per piece for the Upload screen', () => {
    stagePickedFile('p1', file('a.m4a'));
    stagePickedFile('p2', file('b.m4a'));
    expect(stagedPickedFile('p1')?.name).toBe('a.m4a');
    expect(stagedPickedFile('p2')?.name).toBe('b.m4a');
    clearPickedFile('p1');
    clearPickedFile('p2');
  });

  it('replaces the held file when another is chosen', () => {
    stagePickedFile('p1', file('first.m4a'));
    stagePickedFile('p1', file('second.m4a'));
    expect(stagedPickedFile('p1')?.name).toBe('second.m4a');
    clearPickedFile('p1');
  });

  it('moves a held file to Record with its start bar, and gives it up once', () => {
    stagePickedFile('p1', file('take.m4a'));
    expect(queuePickedFileForSend('p1', 9)).toBe(true);
    expect(stagedPickedFile('p1')).toBeNull();

    const queued = takeQueuedPickedFile('p1');
    expect(queued?.file.name).toBe('take.m4a');
    expect(queued?.fromMeasure).toBe(9);
    // Once: a second focus must not send the same file twice.
    expect(takeQueuedPickedFile('p1')).toBeNull();
  });

  it('refuses to queue when nothing is held', () => {
    expect(queuePickedFileForSend('nothing', 1)).toBe(false);
    expect(takeQueuedPickedFile('nothing')).toBeNull();
  });

  it('lets a file go without sending it', () => {
    stagePickedFile('p1', file('take.m4a'));
    clearPickedFile('p1');
    expect(queuePickedFileForSend('p1', 1)).toBe(false);
  });
});
