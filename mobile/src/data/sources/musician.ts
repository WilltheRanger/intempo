import type { MeResponse, Musician } from '../types';

/**
 * The account, from /v1/me plus the provider avatar available in the auth
 * session. Kept pure so wire-to-view-model consent behavior can be tested
 * without loading React Native or the live API client.
 */
export function toMusician(
  me: MeResponse,
  providerAvatarUrl: string | null,
): Musician {
  return {
    id: me.id,
    email: me.email,
    tier: me.tier,
    role: me.role,
    studioId: me.studio_id,
    usage: me.analyses ?? null,
    // The account's picture wins; the provider's is the fallback for accounts
    // that never set one. Someone who deliberately cleared theirs must not
    // have Google's put back in its place.
    avatarUrl: me.avatar_url ?? providerAvatarUrl,
    displayName: me.display_name,
    instrument: me.instrument,
    onboarded: me.onboarded_at !== null,
    // The timestamp remains server-side as the consent record. The interface
    // only needs the current answer.
    trainingConsent: me.training_consent,
  };
}
