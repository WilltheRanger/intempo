import { Asset } from 'expo-asset';
import {
  SoundBankLoader,
  SpessaLog,
  type BasicSoundBank,
} from 'spessasynth_core';
import type { Instrument } from '../../data/types';
import { readSampleBytes } from './sampleBytes';
import { SOUNDFONT_ASSETS } from './soundfontAssets';

export const INSTRUMENT_PROGRAMS: Record<Instrument, number> = {
  violin: 40,
  viola: 41,
  cello: 42,
  double_bass: 43,
};
const cache = new Map<Instrument, Promise<BasicSoundBank>>();
SpessaLog.setLogLevel(false, false, false);

/** Keep full preset programming; reject mismatched or compressed banks. */
export function parseSoundfont(
  bytes: ArrayBuffer,
  instrument: Instrument,
): BasicSoundBank {
  if (bytes.byteLength < 12 || bytes.byteLength > 8 * 1024 * 1024)
    throw new Error('Invalid instrument bank');
  const view = new Uint8Array(bytes);
  if (
    String.fromCharCode(...view.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...view.slice(8, 12)) !== 'sfbk'
  )
    throw new Error('Invalid instrument bank');
  const bank = SoundBankLoader.fromArrayBuffer(bytes);
  if (bank.samples.some((sample) => sample.isCompressed))
    throw new Error('Compressed banks are not supported');
  if (
    bank.presets.length !== 1 ||
    bank.presets[0].program !== INSTRUMENT_PROGRAMS[instrument] ||
    bank.presets[0].bankMSB !== 0 ||
    bank.presets[0].bankLSB !== 0
  )
    throw new Error('Incorrect instrument bank');
  return bank;
}

export function loadSoundfont(instrument: Instrument): Promise<BasicSoundBank> {
  const previous = cache.get(instrument);
  if (previous) return previous;
  const pending = readSampleBytes(
    Asset.fromModule(SOUNDFONT_ASSETS[instrument]),
  ).then((bytes) => parseSoundfont(bytes, instrument));
  cache.set(instrument, pending);
  void pending.catch(() => cache.delete(instrument));
  return pending;
}
