import { apiFetch } from './api/client';
import {
  checkAppConnection,
  type ConnectionReport,
} from './supportDiagnostics';

/** Run the production connection check without exposing its transport. */
export function checkLiveAppConnection(): Promise<ConnectionReport> {
  return checkAppConnection(apiFetch);
}
