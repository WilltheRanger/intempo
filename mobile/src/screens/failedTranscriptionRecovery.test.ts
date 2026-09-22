import { describe, expect, it } from 'vitest';

import manualPiece from './addPiece/ManualPieceForm.tsx?raw';
import scoreScreen from './pieceScore/PieceScoreScreen.tsx?raw';

describe('failed transcription recovery', () => {
  it('keeps a camera retake attached to the failed piece', () => {
    expect(scoreScreen).toMatch(/const pieceId = piece\.id;/);
    expect(scoreScreen).toMatch(
      /captureSession\.reset\(\{\s*attachToPieceId: pieceId\s*\}\)/,
    );
  });

  it('keeps replacement images attached to the failed piece', () => {
    expect(scoreScreen).toMatch(
      /navigate\('AddPiece',\s*\{\s*option: 'import',\s*attachToPieceId: piece\.id,/,
    );
  });

  it('offers both ways to replace an unreadable photograph', () => {
    expect(scoreScreen).toContain('Take new photographs instead');
    expect(scoreScreen).toContain('Choose different images');
  });

  it('does not promise practice features before the piece has notes', () => {
    expect(manualPiece).toContain(
      'Photograph the music to listen, record, and get',
    );
    expect(manualPiece).not.toContain('your practice history');
  });
});
