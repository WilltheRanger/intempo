import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

const screens: Record<string, string> = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('screen data boundary', () => {
  it('finds the screen tree', () => {
    expect(Object.keys(screens).length).toBeGreaterThan(50);
  });

  it('keeps low-level API clients out of screens', () => {
    const offenders: string[] = [];

    for (const [file, source] of Object.entries(screens)) {
      if (file.endsWith('/dataBoundary.test.ts')) {
        continue;
      }
      source.split('\n').forEach((line, index) => {
        if (/\bfrom\s+['"][^'"]*data\/api(?:\/[^'"]*)?['"]/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
