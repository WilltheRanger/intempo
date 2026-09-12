import { describe, expect, it } from 'vitest';

// `?raw` so this reads the hook as text — the project has no `@types/node`,
// and `useProfile.ts` is a React hook with no testing library here to render
// it (`DECISIONS.md`, 2026-08-24).
import useProfileSource from '../hooks/useProfile.ts?raw';

/**
 * The avatar is shrunk on the one path that uploads one.
 *
 * **Found by mutation, not by design.** `avatarImage.test.ts` holds the rule
 * itself — the long edge, the untouched small picture, the JPEG it reports
 * after converting — and every one of those passed with `prepareAvatar`
 * removed from the call site. A module that is written, documented and tested
 * but never called is this repository's most-repeated defect, and it had
 * quietly reproduced it inside the change that was fixing a different instance
 * of the same thing.
 *
 * `check-dead-exports` cannot see this one either: the import in `useProfile`
 * is real, so the export counts as referenced whether or not anything invokes
 * it.
 *
 * **What goes wrong when it is false.** Nothing, visibly. The upload succeeds,
 * the picture appears, the circle looks identical — it is drawn at 76 points
 * either way. The only symptom is 3.1 MB in the bucket instead of 50 KB, on a
 * free tier of 1 GB, and it is invisible until somebody measures storage.
 * That is precisely the failure a screenshot and a walk cannot catch.
 */
describe('the avatar upload path', () => {
  it('prepares the picture before it reads the bytes', () => {
    expect(useProfileSource).toMatch(/prepareAvatar\(/);
  });

  it('uploads the prepared picture, not the original', () => {
    // The ordering is the whole point: `fetch(uri)` would read the 12-megapixel
    // original and hand it to storage while the resized copy sat unused, which
    // is the shape a careless merge leaves behind.
    const prepared = useProfileSource.indexOf('prepareAvatar(');
    const fetched = useProfileSource.indexOf('await fetch(prepared.uri)');

    expect(prepared).toBeGreaterThan(-1);
    expect(fetched).toBeGreaterThan(prepared);
  });

  it('files the object under the prepared type', () => {
    // The extension follows the type, and the type changes to JPEG whenever
    // the picture was re-encoded. Sending `mimeType` here would file a JPEG as
    // `avatar.heic` — which the server refuses for an avatar, because the
    // picture is handed straight to an `<img>`.
    expect(useProfileSource).toMatch(/extensionFor\(prepared\.mimeType\)/);
    expect(useProfileSource).toMatch(/uploadToSignedUrl\([\s\S]{0,120}prepared\.mimeType/);
  });
});
