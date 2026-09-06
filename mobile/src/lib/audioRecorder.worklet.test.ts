import { describe, expect, it } from 'vitest';

import worklet from '../../public/pcm-recorder.worklet.js?raw';
import headers from '../../public/_headers?raw';
import recorder from './audioRecorder.web.ts?raw';
import { WORKLET_FILE } from './audioRecorder.web';

/**
 * The recording worklet must be a file on this origin, and stay one.
 *
 * **Recording failed on the deployed site and worked everywhere it was
 * tested.** The worklet was a string turned into a `blob:` URL, and
 * `public/_headers` pins `script-src` to `'self'` plus the boot script's hash
 * — deliberately, so an injected `<script src>` cannot run. `'self'` does not
 * cover `blob:`, so `addModule` was refused with `AbortError: Unable to load a
 * worklet's module.` and the screen said "The recording worklet could not be
 * loaded."
 *
 * Measured in this repository's own Chromium against the built bundle: a blob
 * worklet is refused with the production CSP applied and loads without it; a
 * file is loaded either way. Nothing local had ever applied that CSP, because
 * `npx serve` ignores `_headers` — `tools/serve-with-headers.mjs` is what the
 * walk runs against now.
 *
 * This file is the cheap half of that: it needs no browser, and it fails if
 * anybody puts the worklet back in a blob, renames the file out from under the
 * loader, or loosens the policy to make a blob work.
 */

describe('the worklet the recorder loads', () => {
  it('is the file the module names', () => {
    // A rename on one side only is a recording that fails on every platform,
    // which is at least louder than one that fails on the deployed one.
    expect(WORKLET_FILE).toBe('pcm-recorder.worklet.js');
    expect(worklet).toContain("registerProcessor('pcm-recorder'");
  });

  it('carries no template interpolation', () => {
    // It used to be a template literal in the module, with the quanta count
    // interpolated in. A file cannot interpolate: a surviving `${…}` is a
    // syntax error in the worklet thread, which surfaces as the same
    // "could not be loaded" sentence.
    expect(worklet).not.toMatch(/\$\{/);
  });

  it('takes its one constant through processorOptions, and is sent one', () => {
    // Rather than a second copy of the number, free to drift from the
    // module's.
    expect(worklet).toContain('processorOptions');
    expect(worklet).toContain('quantaPerMessage');

    // **Both halves.** The worklet falls back to the same number when the
    // option is absent, so a version that reads it and is never sent it
    // behaves identically — which is how the first draft of this change was
    // written, and lint caught it only because the constant went unused. A
    // test on behaviour would have passed.
    expect(recorder).toContain('processorOptions: { quantaPerMessage:');
  });
});

describe('the policy it has to satisfy', () => {
  it('still refuses blob scripts, which is the point of it', () => {
    // If `blob:` is ever added to `script-src`, the worklet would work again
    // and so would an injected one. The file exists so the policy does not
    // have to be loosened.
    const csp = headers.split('\n').find((line) => line.includes('Content-Security-Policy'));

    expect(csp).toBeDefined();
    expect(csp).not.toContain('blob:');
  });

  it('is pinned to self, which is what makes a same-origin file enough', () => {
    // **The directive line, not the file.** `_headers` explains itself at
    // length in comments — including the words `unsafe-inline`, to say the
    // generated policy has none — so matching the whole file matches the prose
    // and fails on a correct policy. The first draft of this test did exactly
    // that.
    //
    // `script-src` itself is appended at build time by
    // `flatten-vendor-assets.mjs`, so what the source carries is everything
    // else; what matters is that no directive here opens the origin up.
    const directive = headers
      .split('\n')
      .find((line) => /^\s+Content-Security-Policy:/.test(line));

    expect(directive).toBeDefined();
    expect(directive).not.toContain('unsafe-inline');
    expect(directive).not.toContain('*');
  });
});
