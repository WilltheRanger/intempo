#!/usr/bin/env node
/**
 * What a musician downloads on a first visit, and a ceiling on it.
 *
 *     node tools/check-bundle-size.mjs            # against mobile/dist
 *     node tools/check-bundle-size.mjs --report   # and where the bytes went
 *
 * **Written the day the bundle halved.** `lucide-react-native` ships 1,768
 * icons, this app draws 25, and Metro does not tree-shake — so importing from
 * the package barrel put the other 1,743 in front of every musician: 3,686 KB
 * raw, 697 KB gzipped, of which roughly half was icons nobody sees. Deep
 * imports through the package's own `./icons/*` subpath took it to 1,893 KB
 * raw and 515 KB gzipped.
 *
 * **Nothing stopped that coming back.** One `import { Play } from
 * 'lucide-react-native'` typed by a future session — the obvious spelling,
 * the one every example uses — undoes it silently. Type-checks, lints, tests
 * green, app identical, bundle up by 180 KB. This is the check that notices.
 *
 * **Gzipped, because that is what is served.** Cloudflare Pages compresses,
 * and a raw byte count would move for reasons nobody is billed for.
 *
 * A ratchet rather than a target: when the bundle genuinely has to grow, raise
 * the budget in the same commit and say why. The number is worthless if it is
 * raised without a sentence.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'mobile', 'dist', '_expo', 'static', 'js', 'web');

/**
 * The ceiling, in gzipped kilobytes, for the app's main bundle.
 *
 * 560 against a measured 515 — about 9% of headroom. Wide enough that an
 * ordinary feature does not trip it and narrow enough that re-importing an
 * icon barrel does, which is the specific regression it was written for.
 *
 * **Raised to 580 on 2026-09-23, at a measured 563.** The redesign rebuilt
 * every screen from `redesign/` in five batches, and the last one added the
 * onboarding flow with three drawn illustrations (the page scan, the staff,
 * the waveform) and the photographic Sign in. That is the app growing, not a
 * regression: no new dependency, no barrel import. 580 still trips on the
 * ~180 KB an icon barrel costs.
 */
const BUDGET_KB = 580;

function mainBundle() {
  if (!existsSync(WEB)) {
    console.error(
      `no web build at ${WEB}\n` +
        'Run `npm run build:web` in mobile/ first — or `tools/preflight.py --full`, ' +
        'which builds it and then runs this.',
    );
    process.exit(2);
  }
  const candidates = readdirSync(WEB)
    .filter((name) => name.startsWith('index-') && name.endsWith('.js'))
    .map((name) => join(WEB, name));
  if (candidates.length === 0) {
    console.error(`no index-*.js in ${WEB}`);
    process.exit(2);
  }
  // The largest, not the first: Metro emits several `index-*` chunks and the
  // one that matters is the one carrying the app.
  return candidates.sort((a, b) => statSync(b).size - statSync(a).size)[0];
}

/** Where the bytes went, when a source map was built beside the bundle. */
function report(bundlePath) {
  const map = `${bundlePath}.map`;
  if (!existsSync(map)) {
    console.log(
      '\n  (no source map beside the bundle — rebuild with `expo export ' +
        '--source-maps` to see where the bytes went)',
    );
    return;
  }
  const { sources = [], sourcesContent = [] } = JSON.parse(readFileSync(map, 'utf8'));
  const bytes = new Map();
  sources.forEach((source, index) => {
    const size = (sourcesContent[index] ?? '').length;
    const path = source.replaceAll('\\', '/');
    const dep = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
    const own = /(src\/[^/]+)\//.exec(path);
    const key = dep ? `node_modules/${dep[1]}` : (own?.[1] ?? path);
    bytes.set(key, (bytes.get(key) ?? 0) + size);
  });
  const total = [...bytes.values()].reduce((sum, n) => sum + n, 0);
  console.log('\n  where the source bytes are, before minifying:');
  for (const [name, size] of [...bytes].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const kb = (size / 1024).toFixed(0).padStart(6);
    const pct = ((size * 100) / total).toFixed(1).padStart(5);
    console.log(`    ${kb} KB  ${pct}%  ${name}`);
  }
}

const bundle = mainBundle();
const raw = statSync(bundle).size;
const gz = gzipSync(readFileSync(bundle)).length;
const gzKb = gz / 1024;

console.log(
  `bundle: ${(raw / 1024).toFixed(0)} KB raw, ` +
    `${gzKb.toFixed(0)} KB gzipped (budget ${BUDGET_KB} KB)`,
);

if (process.argv.includes('--report')) {
  report(bundle);
}

if (gzKb > BUDGET_KB) {
  console.error(
    `\nFAIL  the main bundle is ${gzKb.toFixed(0)} KB gzipped, over the ` +
      `${BUDGET_KB} KB budget by ${(gzKb - BUDGET_KB).toFixed(0)} KB.\n\n` +
      'Before raising the number, check for the cheap cause: a package ' +
      'imported from its barrel rather than by the path of the thing you\n' +
      'actually use. That is what put 1,743 unused icons in front of every ' +
      'musician, and it is invisible to every other check here.\n\n' +
      'Run with --report to see where the bytes are. If the growth is real, ' +
      'raise BUDGET_KB in the same commit and write down why.',
  );
  process.exit(1);
}
// Not silent on success: the number is the point, and a check that only speaks
// when it fails leaves nobody watching a slow climb.
console.log(`  ok    ${(BUDGET_KB - gzKb).toFixed(0)} KB of headroom`);
