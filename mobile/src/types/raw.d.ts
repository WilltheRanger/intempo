/**
 * Vite/vitest `?raw` imports, so a test can read a checked-in file without
 * `@types/node`.
 *
 * This project has no node types (see `transcriptionProgress.test.ts`), so
 * `readFileSync` does not typecheck. `?raw` is the bundler's own answer, and it
 * makes the file a build-time dependency rather than a runtime path that can
 * drift.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
