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
    await writeScriptCsp();
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
  await writeScriptCsp();
}

/**
 * The page background in `public/index.html` must equal `colors.bg` — in both
 * appearances.
 *
 * Those two hexes are the only duplicated design tokens in the app — an HTML
 * file cannot import a TypeScript module — and they paint the strip behind the
 * status bar and the overscroll region, which is everything outside the React
 * tree. If one drifts from its token the app gets a band of the wrong colour
 * at the top of every screen: invisible in a diff, obvious on a phone, and
 * impossible to attribute to the commit that caused it.
 *
 * **Both halves of both appearances, and that is what this check learned.** It
 * used to count bare occurrences of one hex and demand at least two, on the
 * reasoning that the stylesheet rule and the `theme-color` meta are the two
 * places it appears. That held while the app had one appearance. It shipped
 * with no dark `theme-color` at all, so an installed PWA on a phone in dark
 * mode drew an ivory strip behind the Dynamic Island above a near-black app —
 * a defect the old check could not have seen, because every hex it was
 * counting was present and correct.
 *
 * Counting is also the wrong instrument now: `#14110E` is `darkColors.bg` and
 * it is *also* the boot watchdog's text colour, so an occurrence count would
 * be satisfied by the error screen. Each of the four is located instead.
 */
async function checkPageBackground() {
  const tokens = await readFile(new URL('../src/design/colors.ts', import.meta.url), 'utf8');
  const paletteBg = (palette) => {
    const block = new RegExp(`export const ${palette}[\\s\\S]*?\\n\\} as const;`).exec(tokens);
    return block ? /\bbg:\s*'(#[0-9A-Fa-f]{3,8})'/.exec(block[0])?.[1] : undefined;
  };

  const light = paletteBg('lightColors');
  const dark = paletteBg('darkColors');
  if (!light || !dark) {
    console.error('Could not find `bg` in both palettes of src/design/colors.ts.');
    process.exit(1);
  }

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  /** The `content` of a `theme-color` meta, matched by its `media` or lack of one. */
  const themeColor = (dark) =>
    [...html.matchAll(/<meta\s+name="theme-color"([^>]*)>/g)]
      .filter(([, attrs]) => /prefers-color-scheme:\s*dark/.test(attrs) === dark)
      .map(([, attrs]) => /content="(#[0-9A-Fa-f]{3,8})"/.exec(attrs)?.[1]);

  /** The `background-color` of the `html, body` rule, inside a media query or not. */
  const darkBlock = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\n {6}\}/.exec(html)?.[0];
  const pageGround = (source) =>
    source === undefined
      ? []
      : [...source.matchAll(/background-color:\s*(#[0-9A-Fa-f]{3,8});/g)].map((m) => m[1]);

  const expected = [
    ['light theme-color', themeColor(false), light],
    ['dark theme-color', themeColor(true), dark],
    ['light page background', pageGround(html.replace(darkBlock ?? '', '')), light],
    ['dark page background', pageGround(darkBlock), dark],
  ];

  const wrong = expected.filter(
    ([, found, want]) => !found.some((hex) => hex?.toUpperCase() === want.toUpperCase()),
  );
  if (wrong.length) {
    for (const [what, found, want] of wrong) {
      console.error(
        `public/index.html: the ${what} should be ${want} ` +
          `(colors.ts); found ${found.length ? found.join(', ') : 'nothing'}.`,
      );
    }
    process.exit(1);
  }
  console.log(
    `flatten-vendor-assets: page background and theme-color match colors.ts ` +
      `in both appearances (${light} / ${dark}).`,
  );
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

/**
 * Generate a strict `script-src` from the scripts this build actually has.
 *
 * `public/_headers` ships a CSP with `base-uri`, `object-src` and
 * `frame-ancestors` and **no `script-src`**, and says why: *"tightening script
 * sources without build-generated hashes would turn a security improvement
 * into a production outage."* That was correct — `public/index.html` carries a
 * checked-in inline boot watchdog, and Expo injects a content-hashed bundle
 * tag — and it left the app's largest remaining hole open. With no
 * `script-src`, an injected `<script src="https://…">` runs, and the access
 * token in browser storage leaves with it.
 *
 * These are the hashes, generated. Measured on the export: **one** external
 * script (same-origin, Expo's bundle) and **one** inline block (the watchdog),
 * with no `eval`, no `new Function` and no external script, style or font
 * origin anywhere. So `'self'` plus one hash is the whole allowance — no
 * `'unsafe-inline'`, which would have permitted the injected inline script
 * this is meant to stop.
 *
 * The hash is over the element's exact text, so it is generated here rather
 * than written down: one edited comment inside the watchdog changes it, and a
 * stale hash is a blank screen.
 */
async function writeScriptCsp() {
  const { createHash } = await import('node:crypto');
  const html = await readFile(join(DIST, 'index.html'), 'utf8');

  // Comment-aware, and **that is the whole difficulty**. A naive scan for
  // `<script` finds the *mentions* of it inside the watchdog's own comment
  // block first — this file has four occurrences and two real tags — and takes
  // a "body" of 10 KB that begins mid-HTML. That produced a plausible-looking
  // hash which the browser then refused: measured, `Refused to execute inline
  // script`, with the app still mounting because the bundle is external. The
  // symptom would have been the crash watchdog silently dead, not a blank
  // screen, which is worse.
  const hashes = [];
  let external = 0;
  for (let at = 0; at < html.length; ) {
    const comment = html.indexOf('<!--', at);
    const open = html.indexOf('<script', at);
    if (open === -1) break;
    if (comment !== -1 && comment < open) {
      const end = html.indexOf('-->', comment);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', open);
    const close = html.indexOf('</script>', gt);
    if (gt === -1 || close === -1) break;
    const tag = html.slice(open, gt);
    const body = html.slice(gt + 1, close);
    if (/\ssrc\s*=/.test(tag)) {
      external += 1;
      if (/src\s*=\s*["']?https?:/i.test(tag)) {
        console.error(
          `flatten-vendor-assets: the export loads a script from another ` +
            `origin:\n  ${tag}>\n\nAdd its origin to the policy deliberately, or ` +
            `bundle it. A cross-origin script can read\nthe access token in ` +
            `browser storage.`,
        );
        process.exit(1);
      }
    } else if (body.trim()) {
      // **The guard that makes a generated hash safe to ship.** A
      // mis-extraction yields HTML/JS soup, which does not compile — so the
      // build fails here instead of publishing a hash the browser will reject.
      // Compiled, never run: `vm.Script` parses without executing.
      try {
        const { Script } = await import('node:vm');
        new Script(body);
      } catch (error) {
        console.error(
          'flatten-vendor-assets: what was extracted as an inline script is ' +
            `not valid JavaScript:\n  ${error.message}\n\nThe hash would be over ` +
            'the wrong bytes and the browser would refuse the script. Fix the ' +
            'scan\nin `writeScriptCsp`, not the policy.',
        );
        process.exit(1);
      }
      hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
    at = close + '</script>'.length;
  }

  if (hashes.length === 0) {
    console.error(
      'flatten-vendor-assets: no inline script found in the export. The boot ' +
        'watchdog is inline\nin public/index.html, so finding none means this ' +
        'scan is broken — and shipping a\n`script-src` that omits a hash the ' +
        'page needs is a blank screen.',
    );
    process.exit(1);
  }

  const headers = join(DIST, '_headers');
  const before = await readFile(headers, 'utf8');
  const directive = `script-src 'self' ${hashes.join(' ')}`;
  if (!/Content-Security-Policy:/.test(before)) {
    console.error(`flatten-vendor-assets: no CSP line in ${headers} to extend.`);
    process.exit(1);
  }
  const after = before.replace(
    /(Content-Security-Policy:)([^\n]*)/,
    (_m, label, rest) => `${label}${rest.trimEnd()}; ${directive}`,
  );
  await writeFile(headers, after);
  console.log(
    `flatten-vendor-assets: script-src pinned to 'self' + ${hashes.length} ` +
      `inline hash(es), ${external} same-origin bundle(s).`,
  );
}

await main();
