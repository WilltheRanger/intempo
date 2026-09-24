/* global fetch, AbortSignal */
// Build-time import of the four string banks the app bundles. Both sources are
// pinned to a commit and every download is hashed into `provenance.json`.
//
//   node scripts/prepare-soundfonts.mjs [--vsco-dir <folder of the WAVs>]
//
// **Viola and cello: GeneralUser GS**, imported whole. The author's sample
// zones, loops, envelopes and modulators are retained rather than extracted
// and reprogrammed.
//
// **Violin and double bass: VS Chamber Orchestra 2 CE** (CC0), built into the
// same single-preset banks by `vsco-instrument.mjs`. GeneralUser's violin and
// bass were the two that sounded like a sample player; these are solo
// recordings with the player's own vibrato and bow. VSCO publishes SFZ and
// WAV, not SF2, which is why these two are built from the recordings instead
// of imported. `--vsco-dir` reads the 28 WAVs from a folder instead of the
// network; their hashes are recorded either way.
//
// **Reproducible.** Run twice, it writes the same bytes: the SF2 writer stamps
// today's date into every bank, which made each run rewrite all four for no
// change in the audio, so each source carries the date its banks were first
// built. License texts are stored with LF line endings, as git keeps them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BasicSoundBank, SoundBankLoader, SpessaLog } from 'spessasynth_core';
import {
  VSCO_BASE,
  VSCO_INSTRUMENTS,
  VSCO_REVISION,
  buildBank,
  prepareSample,
} from './vsco-instrument.mjs';

const revision = '684543d5e5efaef08d02be50dcda8d552478fa60';
const base = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${revision}/`;
const destination = new URL('../assets/soundfonts/', import.meta.url);
/** When each source's banks were first built, stamped into them as ICRD. */
const GENERALUSER_BUILT = new Date('2026-09-05T06:58:23Z');
const VSCO_BUILT = new Date('2026-09-24T00:00:00Z');
const vscoDir = process.argv.includes('--vsco-dir')
  ? process.argv[process.argv.indexOf('--vsco-dir') + 1]
  : null;
await mkdir(destination, { recursive: true });
SpessaLog.setLogLevel(false, false, false);

const sha256 = (bytes) =>
  createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return response;
}

const lf = (text) => text.replace(/\r\n/g, '\n');

async function save(instrument, output) {
  await writeFile(
    new URL(`${instrument}.sf2`, destination),
    new Uint8Array(output),
  );
  return { bytes: output.byteLength, sha256: sha256(output) };
}

// GeneralUser GS: viola and cello.
const bytes = await (await get(base + 'GeneralUser-GS.sf2')).arrayBuffer();
const bank = SoundBankLoader.fromArrayBuffer(bytes);
const generalUser = [];
for (const [instrument, program] of [
  ['viola', 41],
  ['cello', 42],
]) {
  const preset = bank.presets.find(
    (p) => p.program === program && p.bankMSB === 0 && p.bankLSB === 0,
  );
  if (!preset) throw new Error(`Missing program ${program}`);
  const subset = new BasicSoundBank();
  subset.soundBankInfo.creationDate = GENERALUSER_BUILT;
  subset.addCompletePresets([preset]);
  const written = await save(instrument, subset.writeSF2());
  generalUser.push({ instrument, program, name: preset.name, ...written });
  console.log(instrument, preset.name, written.bytes);
}
await writeFile(
  new URL('LICENSE.txt', destination),
  lf(await (await get(base + 'documentation/LICENSE.txt')).text()),
);

// VSCO 2 CE: violin and double bass.
const vsco = [];
for (const [instrument, spec] of Object.entries(VSCO_INSTRUMENTS)) {
  const prepared = {};
  const samples = [];
  for (const [file] of spec.regions) {
    const wav = vscoDir
      ? new Uint8Array(await readFile(`${vscoDir}/${file}`)).buffer
      : await (
          await get(
            VSCO_BASE +
              (spec.folder + file).split('/').map(encodeURIComponent).join('/'),
          )
        ).arrayBuffer();
    prepared[file] = prepareSample(wav, spec.rate, spec.level);
    samples.push({ file: spec.folder + file, sha256: sha256(wav) });
  }
  const built = buildBank(instrument, prepared);
  built.soundBankInfo.creationDate = VSCO_BUILT;
  const written = await save(instrument, built.writeSF2());
  vsco.push({
    instrument,
    program: spec.program,
    name: spec.name,
    ...written,
    samples,
  });
  console.log(instrument, spec.name, written.bytes);
}
await writeFile(
  new URL('VSCO-LICENSE.txt', destination),
  lf(await (await get(VSCO_BASE + 'LICENSE')).text()),
);

await writeFile(
  new URL('provenance.json', destination),
  JSON.stringify(
    {
      tool: 'spessasynth_core 4.3.22',
      generalUser: {
        source: base + 'GeneralUser-GS.sf2',
        revision,
        sourceSha256: sha256(bytes),
        presets: generalUser,
      },
      vsco: {
        source: 'https://github.com/sgossner/VSCO-2-CE (SFZ branch)',
        revision: VSCO_REVISION,
        builtBy: 'scripts/vsco-instrument.mjs',
        presets: vsco,
      },
    },
    null,
    2,
  ) + '\n',
);
