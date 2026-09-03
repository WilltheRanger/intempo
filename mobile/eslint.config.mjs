import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * The shipping app had no linter at all.
 *
 * Not a loose one — none. No `eslint` dependency, no config, no script, and
 * nothing in CI. Six files in `src/` carried `eslint-disable` directives for a
 * linter that was not running, four of them suppressing
 * `react-hooks/exhaustive-deps`, which is a comment claiming a judgement
 * nobody had made. `frontend/`, the legacy tree that is *not* the product, was
 * the one with the config.
 *
 * The rules here are chosen to be the ones that catch bugs, not the ones that
 * make a diff. This tree is 127 test files and a working app; a lint pass that
 * reformats it would be a large risky change dressed as hygiene.
 */
export default defineConfig([
  globalIgnores(['dist', '.expo', 'node_modules', 'patches']),
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      /**
       * **The rule this was worth installing for.** A hook below an early
       * return is React error #310, and `EDIT_LOG` records this project
       * shipping exactly that — a white screen, in a build that compiled,
       * typechecked and passed its tests. Nothing else here can see it.
       */
      'react-hooks/rules-of-hooks': 'error',
      /**
       * A stale closure reads a value from the render it was created in, so
       * the symptom is a screen acting on last minute's data — which looks
       * like a backend problem and is not.
       *
       * `error`, not `warn`. A warning in a tree with no linter is a warning
       * nobody sees, and the four existing suppressions are already written as
       * `eslint-disable-next-line` with a reason beside each — the honest form.
       */
      'react-hooks/exhaustive-deps': 'error',
      /**
       * `CLAUDE.md` §1: no `print`/`console.log` debug shipped. `App.tsx`
       * disables this on one line, deliberately and with a paragraph saying
       * why — the boot line that names whether a build is on fixtures or on
       * real data. That is the shape an exception should take.
       */
      'no-console': 'error',
      // The type import left behind by a deleted function is invisible to
      // `tsc` under this tree's settings; it was found by hand this morning.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // `plugins` separately so the rules above resolve; the plugin's own
    // recommended set brings more than this tree is ready to answer for.
    plugins: { 'react-hooks': reactHooks },
  },
  {
    /**
     * React Native resolves bundled assets through `require()`, and there is
     * no import form that does it — `fixtures.ts` and `design/typography.ts`
     * load fonts and sheet crops that way because it is the only way. The rule
     * is about CommonJS creeping into ESM, which is not what these are.
     */
    files: ['**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    /**
     * Build scripts run under Node and print by design — a bench that cannot
     * say what it measured is not a bench. They are linted for everything
     * else.
     */
    files: ['scripts/**/*.mjs', '*.js', '*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    /**
     * Tests build deliberately wrong objects — a stub graph missing half its
     * methods, a `this` captured out of a fake constructor — to drive the code
     * down paths a well-typed caller cannot reach. Typing those stubs properly
     * would be typing the mistake.
     */
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
]);
