import type { Instrument } from '../../data/types';
export const SOUNDFONT_ASSETS: Record<Instrument, number> = {
  violin: require('../../../assets/soundfonts/violin.sf2'),
  viola: require('../../../assets/soundfonts/viola.sf2'),
  cello: require('../../../assets/soundfonts/cello.sf2'),
  double_bass: require('../../../assets/soundfonts/double_bass.sf2'),
};
