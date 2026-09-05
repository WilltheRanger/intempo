/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this Node CommonJS configuration. */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('sf2');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The selected banks contain uncompressed PCM only. Spessa's optional SF3
  // Vorbis decoder otherwise eagerly starts WASM, unavailable on Hermes and
  // disallowed by our web CSP. Keep unsupported compressed banks explicit.
  if (moduleName === 'stb-vorbis') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/lib/score/sf2OnlyDecoder.ts'),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
