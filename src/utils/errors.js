export class AppError extends Error {
  constructor(message, { code = "INTERNAL_ERROR", status = 500, stage, retryable = false, cause } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.stage = stage;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function normalizeError(error) {
  if (isAppError(error)) return error;
  return new AppError(error?.message || "Unknown error.", {
    code: "INTERNAL_ERROR",
    status: 500,
    cause: error
  });
}
