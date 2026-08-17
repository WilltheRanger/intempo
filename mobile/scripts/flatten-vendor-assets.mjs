/**
 * Move exported assets out of `node_modules/` paths, because Cloudflare Pages
 * refuses to upload them.
 *
 * Metro names an asset after the path of the module that imported it, so a
 * font from `@expo-google-fonts` lands at
 * `dist/assets/node_modules/@expo-google-fonts/inter/400Regular/Inter_….ttf`.
 * Cloudflare Pages skips anything under a directory called `node_modules` when
 * it uploads a build output — silently. The build log says
 * `Success: Assets published!` and the files simply aren't there.
 *
 * On 2026-08-16 that cost a day. The count was in the log the whole time:
 * 27 assets in `dist`, `Uploaded 12 files`, and exactly 15 files under
 * `node_modules`. The four fonts 404'd, `useFonts` never resolved, and the app
 * rendered its loading placeholder — a blank ivory screen — forever.
 *
 * So: rename the directory and rewrite the references. Metro has no config
 * knob for the asset destination path; the name is derived from the importing
 * module's location, and there is no supported way to change it.
 *
 *     node scripts/flatten-vendor-assets.mjs
 *
 * Idempotent, and a no-op when there is nothing under `node_modules`.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(MOBILE, 'dist');

const FROM = 'assets/node_modules';
const TO = 'assets/vendor';

/** Every file under a directory, recursively. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await walk(path) : [path]));
  }
  return out;
}

async function main() {
  if (!existsSync(DIST)) {
    console.error(`No ${DIST} — run \`expo export --platform web\` first.`);
    process.exit(1);
  }

  const source = join(DIST, FROM);
  if (!existsSync(source)) {
    console.log('flatten-vendor-assets: nothing under node_modules, skipping.');
    // The background check still runs: it is about the checked-in source, not
    // about this export, and skipping it on a re-run would mean the guard
    // passed once and then quietly stopped guarding.
    await checkPageBackground();
    return;
  }

  const moved = (await walk(source)).length;
  await rename(source, join(DIST, TO));

  // Only the files that can carry an asset path. Rewriting the whole export
  // would mean reading 3 MB of font binary looking for a string.
  const rewritable = (await walk(DIST)).filter(
    (path) => path.endsWith('.js') || path.endsWith('.html') || path.endsWith('.json'),
  );

  let replacements = 0;
  for (const path of rewritable) {
    const before = await readFile(path, 'utf8');
    if (!before.includes(FROM)) {
      continue;
    }
    replacements += before.split(FROM).length - 1;
    await writeFile(path, before.split(FROM).join(TO));
  }

  console.log(
    `flatten-vendor-assets: moved ${moved} files to ${TO}, ` +
      `rewrote ${replacements} references.`,
  );

  // A rename with no rewrite would produce exactly the failure this exists to
  // prevent, and it would look like success.
  if (replacements === 0) {
    console.error('No references were rewritten — the assets are now unreachable.');
    process.exit(1);
  }

  await checkPageBackground();
}

/**
 * The page background in `public/index.html` must equal `colors.bg`.
 *
 * That hex is the one duplicated design token in the app — an HTML file cannot
 * import a TypeScript module — and it paints the strip behind the status bar
 * and the overscroll region. If it drifts from the token, the app gets a band
 * of the wrong ivory at the top of every screen: invisible in a diff, obvious
 * on a phone, and impossible to attribute to the commit that caused it.
 */
async function checkPageBackground() {
  const tokens = await readFile(new URL('../src/design/colors.ts', import.meta.url), 'utf8');
  const token = /\bbg:\s*'(#[0-9A-Fa-f]{3,8})'/.exec(tokens)?.[1];
  if (!token) {
    console.error('Could not find `colors.bg` in src/design/colors.ts.');
    process.exit(1);
  }

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const used = [...html.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
  const background = used.filter((hex) => hex.toUpperCase() === token.toUpperCase());

  // Two: the stylesheet rule and the theme-color meta. Fewer means one of them
  // was edited on its own.
  if (background.length < 2) {
    console.error(
      `public/index.html should use ${token} (colors.bg) for both the page ` +
        `background and theme-color; found ${background.length} of 2.`,
    );
    process.exit(1);
  }
  console.log(`flatten-vendor-assets: page background matches colors.bg (${token}).`);
}

await main();
