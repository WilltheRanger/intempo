import { getAnalysis } from '../api/analyses';
import { ApiError } from '../api/client';

export type PendingAnalysisStatus = 'working' | 'ready' | 'missing';

/** Read the durable hand-off while keeping API details out of the screen. */
export async function readPendingAnalysisStatus(
  analysisId: string,
): Promise<PendingAnalysisStatus> {
  try {
    const analysis = await getAnalysis(analysisId);
    return analysis.status === 'done' ||
      analysis.status === 'failed' ||
      analysis.status === 'failed_recoverable'
      ? 'ready'
      : 'working';
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      return 'missing';
    }
    throw cause;
  }
}
