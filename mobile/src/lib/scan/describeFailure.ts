import { ApiError } from '../../data/api/client';
import { UploadError } from '../../data/api/upload';
import { ScanUploadError } from './uploadPage';

/** Return only upload failure text that was written for a musician. */
export function describeScanFailure(cause: unknown): string {
  if (
    cause instanceof UploadError ||
    cause instanceof ScanUploadError ||
    cause instanceof ApiError
  ) {
    return cause.message;
  }
  return 'Couldn’t send the scan. Check your connection.';
}
