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
  /**
   * **`dist-*` as well as `dist`, and the argument for it was already written
   * down next door.** `tsconfig.json` excludes `dist-*` with a comment saying
   * why: the test harness builds a second bundle into `dist-live/`, and tsc
   * "happily walked into 3.4 MB of minified output and blew its stack on it".
   * That reasoning is about anything the bundler emits, and it was applied to
   * one of the two tools.
   *
   * Measured: with a second bundle present, `npm run lint` reports **11,110
   * errors** — `__d is not defined`, `DOMException is not defined`, an
   * unexpected console statement at column 42794 — all of it in minified
   * output. A lint that fails for everyone who has run the harness is a lint
   * people stop running, which is how this tree had six `eslint-disable`
   * directives for a linter that was not installed.
   */
  globalIgnores(['dist', 'dist-*', '.expo', 'node_modules', 'patches']),
  {
    // **The recording worklet is real code that runs, so it is linted** —
    // but it runs in an AudioWorklet thread, which has its own globals and
    // none of the DOM. Ignoring `public/` instead would leave the one file in
    // this repository that executes outside the bundle unchecked.
    files: ['public/*.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        currentFrame: 'readonly',
      },
    },
  },  {
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
     * **A browser-driving script is Node that also writes browser code.** The
     * body of a `page.evaluate` callback is serialised and run inside the page,
     * where `document` and friends genuinely exist — so this declares them
     * rather than disabling `no-undef`, the same way the AudioWorklet block
     * above declares its thread's globals. A disable would silence real typos
     * in the Node half of the same file.
     */
    files: ['scripts/*-shot.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        getComputedStyle: 'readonly',
        matchMedia: 'readonly',
      },
    },
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
  {
    /**
     * **Type-aware rules, scoped to `src/`.** The three below are the only
     * ones in the type-checked set that this tree cannot express any other
     * way: they need to know that an expression is a promise, which no
     * syntactic rule can.
     *
     * `no-floating-promises` is the reason. This app uploads photos, records
     * takes and flushes a queue; a promise nobody awaits and nobody `.catch`es
     * fails *silently* — the upload does not happen, no error surfaces, and
     * the screen looks like it worked. `tsc` does not see it, the tests do not
     * see it, and a review sees it only if the reviewer knows the callee is
     * async.
     *
     * Adopted at zero cost, and measured rather than assumed: the three rules
     * were run over all of `src/` before being turned on and reported
     * **nothing**, because the tree already marks its deliberate fire-and-
     * forget calls with `void`. Then a floating call was planted in a scratch
     * file to prove the rules were live and not silently skipping — it failed,
     * as it should. Same argument as `noUnusedLocals` in `tsconfig.json`: the
     * moment a tree is clean is the only moment a rule like this is free.
     *
     * `src/` only, and `projectService` only here: the config files and
     * `scripts/*.mjs` are outside `tsconfig.json`, and pointing a type-aware
     * parser at a file the program does not contain is an error per file
     * rather than a finding.
     */
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // A promise handed to something expecting `void` — an `onPress`, a
      // `useEffect` body, a `.forEach` — is the same silent failure wearing a
      // React callback.
      '@typescript-eslint/no-misused-promises': 'error',
      // `await` on a non-promise is not harmless: it reads as sequencing that
      // is not happening, and it usually means a missing call.
      '@typescript-eslint/await-thenable': 'error',
    },
  },
]);
