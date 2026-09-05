/* global fetch, AbortSignal */
// Build-time import: retain the author's sample zones, loops, envelopes and
// modulators, rather than extracting and reprogramming individual WAV notes.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BasicSoundBank, SoundBankLoader, SpessaLog } from 'spessasynth_core';

const revision = '684543d5e5efaef08d02be50dcda8d552478fa60';
const base = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${revision}/`;
const destination = new URL('../assets/soundfonts/', import.meta.url);
await mkdir(destination, { recursive: true });
SpessaLog.setLogLevel(false, false, false);
async function get(path) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return response;
}
const bytes = await (await get('GeneralUser-GS.sf2')).arrayBuffer();
const bank = SoundBankLoader.fromArrayBuffer(bytes);
const presets = [];
for (const [instrument, program] of [
  ['violin', 40],
  ['viola', 41],
  ['cello', 42],
  ['double_bass', 43],
]) {
  const preset = bank.presets.find(
    (p) => p.program === program && p.bankMSB === 0 && p.bankLSB === 0,
  );
  if (!preset) throw new Error(`Missing program ${program}`);
  const subset = new BasicSoundBank();
  subset.addCompletePresets([preset]);
  const output = subset.writeSF2();
  await writeFile(
    new URL(`${instrument}.sf2`, destination),
    new Uint8Array(output),
  );
  presets.push({
    instrument,
    program,
    name: preset.name,
    bytes: output.byteLength,
    sha256: createHash('sha256').update(new Uint8Array(output)).digest('hex'),
  });
  console.log(instrument, preset.name, output.byteLength);
}
await writeFile(
  new URL('LICENSE.txt', destination),
  await (await get('documentation/LICENSE.txt')).text(),
);
await writeFile(
  new URL('provenance.json', destination),
  JSON.stringify(
    {
      source: base + 'GeneralUser-GS.sf2',
      revision,
      sourceSha256: createHash('sha256')
        .update(new Uint8Array(bytes))
        .digest('hex'),
      tool: 'spessasynth_core 4.3.22',
      presets,
    },
    null,
    2,
  ) + '\n',
);
