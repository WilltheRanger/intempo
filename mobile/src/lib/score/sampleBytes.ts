import type { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export async function readSampleBytes(asset: Asset): Promise<ArrayBuffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      asset.downloadAsync(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Instrument download timed out')),
          20000,
        );
      }),
    ]);
    if (!asset.localUri) throw new Error('Instrument download incomplete');
    return await new File(asset.localUri).arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}
