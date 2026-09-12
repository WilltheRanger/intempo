/** Optional decoder adapter: this app deliberately supports PCM SF2, not SF3. */
export const StbVorbis = {
  ready: Promise.resolve(),
  decode(): never {
    throw new Error(
      'Compressed sound banks are not supported. Use the bundled PCM SF2 instruments.',
    );
  },
};
