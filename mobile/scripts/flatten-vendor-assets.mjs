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
import { join, dirname, relative } from 'node:path';
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
    await checkNoPrivilegedKeys(await walk(DIST));
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
  await checkNoPrivilegedKeys(await walk(DIST));
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

/**
 * No privileged credential may be in the published bundle.
 *
 * **The anon key is *supposed* to be here.** It is
 * `EXPO_PUBLIC_SUPABASE_ANON_KEY`, Expo inlines every `EXPO_PUBLIC_*` value at
 * build time, and the key is designed to be public — row-level security is
 * what makes it safe (`backend/app/tests/test_rls_invariants.py`).
 *
 * The **service-role** key is the same shape and bypasses RLS entirely. One
 * mistyped variable name, one copy-paste into the wrong `.env`, and it is
 * inlined into 3.3 MB of JavaScript served from a public URL — readable by
 * anyone who runs `strings` on it, and granting full read and write to every
 * musician's rows and files. Nothing would fail. The build would say
 * `Success: Assets published!`, exactly as it did the day fifteen fonts went
 * missing.
 *
 * A name-based check would miss it, because the mistake is usually a *value* in
 * the right-looking variable. So this reads the JWTs themselves: a Supabase key
 * carries its privilege in its own payload as `"role"`, and only `anon` is
 * allowed to travel. That distinguishes the safe key from the catastrophic one
 * exactly, with no false positives to teach anyone to ignore it.
 */
async function checkNoPrivilegedKeys(files) {
  // `header.payload.signature`, base64url. Deliberately loose on length: a
  // short forged-looking token is still worth decoding.
  const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  const ALLOWED_ROLES = new Set(['anon']);
  const found = [];

  for (const file of files) {
    if (!/\.(js|html|json|map|txt|css)$/.test(file)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const token of text.match(JWT) ?? []) {
      let claims;
      try {
        claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      } catch {
        // Not a JWT after all — a hash, or an asset name that happens to match.
        continue;
      }
      const role = claims.role ?? claims.aud ?? '(none)';
      if (!ALLOWED_ROLES.has(role)) {
        found.push(`${relative(DIST, file)}: a token whose role is "${role}"`);
      }
    }
  }

  if (found.length > 0) {
    console.error(
      'flatten-vendor-assets: a privileged credential is in the published ' +
        'bundle:\n  ' +
        found.join('\n  ') +
        '\n\nOnly the anon key may ship. Anything else grants its privileges to ' +
        'everyone who\nloads the site. Check which value is in ' +
        '`EXPO_PUBLIC_SUPABASE_ANON_KEY`, rotate the\nleaked key in the Supabase ' +
        'dashboard, and rebuild.',
    );
    process.exit(1);
  }
  console.log('flatten-vendor-assets: no privileged credential in the bundle.');
}

await main();
