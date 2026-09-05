# InTempo — App Store preparation

Status: local preparation only. No paid build, account creation, signing or
submission has been initiated. Validate the real iPhone recording flow before
requesting review. Existing publisher fields and artwork remain unfinished.

## Listing draft

Name: InTempo

Subtitle: Find your practice pace

Description:

Make your next practice session more focused. InTempo brings your sheet music,
practice recordings and timing feedback into one place.

Photograph or import your part, check the recognized notation, choose a tempo,
and record a take. Review timing feedback bar by bar and listen back to your
recording. Return to recent sessions to decide what to practise next.

Choose violin, viola, cello or double bass for instrument playback. Use the
metronome and count-in to prepare your practice.

An account and an internet connection are required for score reading and timing
analysis. Clear recordings and checked notation produce more useful feedback.
Automated feedback is a practice aid, not a substitute for a teacher.

Suggested category: Music. Final category, territories and age-rating answers
must be confirmed in App Store Connect. Do not claim pitch grading, perfect OCR,
offline analysis, unlimited usage, or guaranteed bass accuracy.

## Reviewer walkthrough draft

Provide a dedicated review account through App Store Connect, never in Git.
Populate it with music the publisher is authorized to use.

1. Sign in using the supplied review account.
2. Open a piece from Today or Library and inspect its notation.
3. Choose an instrument in Profile; use Listen on the piece.
4. Start practice, allow the microphone, and record a short passage.
5. Stop and wait for analysis. Inspect the result and replay the recording.
6. Open Insights for history. Comparable takes appear only when the score,
   settings and usable timing data match; old takes lack this metadata.
7. Account deletion is under Profile → Delete account. Test only with the
   disposable account. Do not supply the owner's personal account for review.

## TestFlight handoff

The `testflight` build profile extends production. Both use EAS's production
environment. A build hook blocks missing backend URLs, non-public Supabase keys
and fixture flags. This does not verify service health or publisher details.

Configure production environment values in the owner's Expo project:

- EXPO_PUBLIC_SUPABASE_URL
- EXPO_PUBLIC_SUPABASE_ANON_KEY (publishable/anon only)
- EXPO_PUBLIC_API_BASE_URL

After linking the real EAS project and configuring signing, the owner-authorized
build command is `eas build --platform ios --profile testflight`. Submit the
specific verified build ID with the production submit profile. Do not blindly
submit the latest build or enable automatic public release.

## Outstanding owner inputs

- Apple Developer and Expo accounts; real EAS project ID and signing setup.
- Confirm availability/ownership of bundle ID `com.intempo.app`.
- Publisher legal name, monitored support email, jurisdiction, review contact.
- Public privacy-policy and support URLs.
- Final app icon and genuine device screenshots (no placeholder artwork).
- Privacy declarations verified against deployed processors, stored audio,
  uploaded music and profile data; review the consent and deletion experience.
- App Store listing and disposable review account; pricing and territory choice.

Apple Developer membership is normally paid. No purchase is authorized by this
document. Check eligibility for any fee waiver directly with Apple.

References checked September 5, 2026:

- https://docs.expo.dev/submit/ios/
- https://docs.expo.dev/build-reference/npm-hooks/
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
