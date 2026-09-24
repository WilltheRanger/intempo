# InTempo string instruments — sources and terms

Four single-preset SoundFont banks, one per instrument, from two sources.
`provenance.json` records the pinned source revisions and the SHA-256 of every
source file and bank. Regenerate with `node scripts/prepare-soundfonts.mjs`,
which needs network access at build time and writes the same bytes on every
run. Normal playback uses only the bundled banks.

## Viola and cello — GeneralUser GS 2.0.3

By S. Christian Collins. Original: https://schristiancollins.com/generaluser.php

Two complete bank-0 presets (41 and 42, zero-based MIDI) are bundled. Their
sample zones, tuning, filters, modulators and release envelopes are retained.
No proprietary Muse Sounds or MS Basic assets are included.

See LICENSE.txt for the author's full terms. These permit software use and
modification, but explicitly disclose uncertainty about the origin of some
inherited samples. We preserve that caveat; this is not a guarantee of title.

## Violin and double bass — VS Chamber Orchestra 2: Community Edition

By Versilian Studios: recorded by Sam Gossner and Simon Dalzell, sample
cutting by Elan Hickler (Soundemote). Original:
https://github.com/sgossner/VSCO-2-CE

The loud layer of the solo violin (Arco Vib) and solo contrabass (SusVib)
recordings, trimmed, looped, levelled and built into banks for programs 40 and
43 by `scripts/vsco-instrument.mjs`. Released under CC0 1.0 (VSCO-LICENSE.txt).
The authors ask that the samples not be sold on their own and that work
improving them stay open; neither applies to their use as an instrument here,
and the builder that produced these banks is published with them.
