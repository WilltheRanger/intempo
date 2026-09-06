/*
 * The recording worklet, as a real file on this origin.
 *
 * **It used to be a string turned into a `blob:` URL**, and that is why
 * recording failed on the deployed site while working everywhere it was
 * tested. `public/_headers` pins `script-src` to `'self'` plus the boot
 * script's hash — deliberately, so an injected `<script src>` cannot run — and
 * `script-src 'self'` does not cover `blob:`. So `addModule` was refused with
 * `AbortError: Unable to load a worklet's module.`, which the recorder reports
 * as "The recording worklet could not be loaded."
 *
 * Measured in this repository's own Chromium against the built bundle: refused
 * with the production CSP applied, loaded without it. `tools/serve-with-
 * headers.mjs` is what applies it, because `npx serve` ignores `_headers` and
 * so every local check ran the app without its production policy.
 *
 * **The fix is this file, not `blob:` in the policy.** Adding `blob:` to
 * `script-src` would re-open exactly the hole the hash-pinned policy closes.
 * A file served from the origin is what `'self'` already means.
 *
 * Files in `public/` are copied into the build verbatim, so this is not
 * bundled, not renamed and not transformed — which is also why it is plain ES5
 * `class` syntax with no imports: nothing compiles it.
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // **Passed in, not baked in.** This file used to be a template literal in
    // `audioRecorder.web.ts` with the quanta count interpolated into it. A
    // file cannot interpolate, and copying the number here would be two
    // constants free to drift — so it arrives through `processorOptions`,
    // which is what that option exists for. The fallback is the value that
    // used to be interpolated, for a caller that forgets.
    this.quantaPerMessage = (options && options.processorOptions
      && options.processorOptions.quantaPerMessage) || 32;
    this.buffer = [];
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage('flushed');
      }
    };
  }

  flush() {
    if (this.buffer.length === 0) {
      return;
    }
    let length = 0;
    for (const part of this.buffer) {
      length += part.length;
    }
    const out = new Int16Array(length);
    let offset = 0;
    for (const part of this.buffer) {
      out.set(part, offset);
      offset += part.length;
    }
    this.buffer = [];
    // Transferred, not copied — the main thread owns it after this.
    this.port.postMessage(out.buffer, [out.buffer]);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      // No input connected yet. Staying alive rather than returning false,
      // which would retire the processor for the rest of the take.
      return true;
    }
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.buffer.push(pcm);
    if (this.buffer.length >= this.quantaPerMessage) {
      this.flush();
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
