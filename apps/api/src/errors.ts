import type { ErrorCode } from '@browserlab/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_URL: 400, INVALID_REQUEST: 400, NOT_FOUND: 404, UNSUPPORTED_ARCH: 409, BROWSER_NOT_PROVISIONED: 409,
  BROWSER_VERSION_MISMATCH: 409, WORKER_OFFLINE: 503, NO_SESSION_CAPACITY: 429, SESSION_START_TIMEOUT: 504,
  VIEWER_UNAVAILABLE: 409, SESSION_EXPIRED: 410, SESSION_NOT_RUNNING: 409, EVIDENCE_CAPTURE_FAILED: 502,
  GRID_UNAVAILABLE: 503, TRANSFER_UNSUPPORTED: 409, TRANSFER_TOO_LARGE: 413, FORBIDDEN_ORIGIN: 403, CONFLICT: 409,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.details = details;
  }
}

export const fail = (code: ErrorCode, message: string, details?: unknown): never => { throw new AppError(code, message, details); };
