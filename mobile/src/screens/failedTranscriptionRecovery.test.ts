import { describe, expect, it } from 'vitest';

import manualPiece from './addPiece/ManualPieceForm.tsx?raw';
import scoreScreen from './pieceScore/PieceScoreScreen.tsx?raw';

describe('failed transcription recovery', () => {
  it('keeps a camera retake attached to the failed piece', () => {
    expect(scoreScreen).toMatch(
      /navigate\('Scanner',\s*\{ attachToPieceId: piece\.id \}\)/,
    );
  });

  it('keeps replacement images attached to the failed piece', () => {
    expect(scoreScreen).toMatch(
      /navigate\('AddPiece',\s*\{\s*option: 'import',\s*attachToPieceId: piece\.id,/,
    );
  });

  it('offers both ways to replace an unreadable photograph', () => {
    expect(scoreScreen).toContain('Retake photos');
    expect(scoreScreen).toContain('Choose other photos');
  });

  it('does not promise practice features before the piece has notes', () => {
    expect(manualPiece).toContain(
      'Photograph the music to listen, record, and get timing',
    );
    expect(manualPiece).not.toContain('your practice history');
  });
});
