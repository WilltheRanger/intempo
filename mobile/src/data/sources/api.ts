import { getMe } from '../api/me';
import { getScore, listScores } from '../api/scores';
import { getAuthAvatarUrl } from '../auth/session';
import type { Musician, Piece, ScoreResponse } from '../types';
import type { MusicianSource, PieceSource } from './types';

/**
 * The real backend, mapped into the shape the UI renders.
 *
 * Four fields come back null because nothing behind `/v1/scores` can supply
 * them yet. They are listed here rather than quietly omitted so the work
 * needed to light each one up stays visible:
 *
 *  - `movement`         — no column on `scores`.
 *  - `progress`         — no progress concept anywhere in the schema.
 *  - `lastPracticedAt`  — would come from `analyses.created_at`; `/v1/analyses`
 *                         is unbuilt (Batch 4).
 *  - `thumbnail`        — score images sit in a private bucket and no endpoint
 *                         signs a download URL.
 */
function toPiece(score: ScoreResponse): Piece {
  return {
    id: score.id,
    title: score.title,
    composer: score.composer,
    movement: null,
    progress: null,
    lastPracticedAt: null,
    thumbnail: null,
  };
}

export const apiPieceSource: PieceSource = {
  async listPieces() {
    const scores = await listScores();
    return scores.map(toPiece);
  },

  async getCurrentPiece() {
    // `/v1/scores` is ordered created_at DESC, so this is "most recently
    // added". Once analyses exist it should become "score of the most recent
    // analysis", which is what "continue practicing" actually means.
    const scores = await listScores({ limit: 1 });
    const [mostRecent] = scores;
    return mostRecent ? toPiece(mostRecent) : null;
  },

  async getPiece(id) {
    return toPiece(await getScore(id));
  },
};

/**
 * The account, from `/v1/me` plus the auth session.
 *
 * Every field but the photo comes from the endpoint. The photo has no column
 * on `users` and no upload endpoint, so it is read from the Supabase auth
 * user's metadata — the one avatar the app can reach without a schema change,
 * and only present for accounts created through an OAuth provider.
 */
function toMusician(
  me: Awaited<ReturnType<typeof getMe>>,
  avatarUrl: string | null,
): Musician {
  return {
    id: me.id,
    email: me.email,
    tier: me.tier,
    role: me.role,
    studioId: me.studio_id,
    avatarUrl,
  };
}

export const apiMusicianSource: MusicianSource = {
  async getMusician() {
    // Both read the session that's already established; neither depends on the
    // other, so there's no reason to wait on them in turn.
    const [me, avatarUrl] = await Promise.all([getMe(), getAuthAvatarUrl()]);
    return toMusician(me, avatarUrl);
  },
};
