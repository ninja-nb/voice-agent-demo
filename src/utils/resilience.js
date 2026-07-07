import { AppError, isAppError } from "./errors.js";

export async function executeStage({ stage, fn, timeoutMs, retries, onRetry }) {
  let attempt = 0;
  const maxAttempts = 1 + Math.max(0, Number(retries) || 0);
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(fn(), timeoutMs, stage);
    } catch (error) {
      const stageError = classifyStageError(stage, error);
      lastError = stageError;
      const canRetry = stageError.retryable && attempt < maxAttempts;
      if (!canRetry) break;
      onRetry?.({ stage, attempt, maxAttempts, error: stageError });
    }
  }

  throw lastError || new AppError("Unknown stage failure.", { code: "INTERNAL_ERROR", status: 500, stage });
}

function withTimeout(promise, timeoutMs, stage) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new AppError(`${upper(stage)} request timed out after ${timeoutMs}ms.`, {
            code: `${upper(stage)}_TIMEOUT`,
            status: 504,
            stage,
            retryable: true
          })
        );
      }, timeoutMs);
    })
  ]);
}

function classifyStageError(stage, error) {
  if (isAppError(error)) return error;

  const message = String(error?.message || "");
  const upperStage = upper(stage);
  const has5xx = /\b5\d\d\b/.test(message);
  const isAbort = error?.name === "AbortError";
  const isTimeout = isAbort || /timeout/i.test(message);

  if (isTimeout) {
    return new AppError(`${upperStage} request timed out.`, {
      code: `${upperStage}_TIMEOUT`,
      status: 504,
      stage,
      retryable: true,
      cause: error
    });
  }

  if (has5xx) {
    return new AppError(`${upperStage} upstream service returned a 5xx error.`, {
      code: `${upperStage}_5XX`,
      status: 502,
      stage,
      retryable: true,
      cause: error
    });
  }

  return new AppError(message || `${upperStage} stage failed.`, {
    code: `${upperStage}_FAILED`,
    status: 502,
    stage,
    retryable: false,
    cause: error
  });
}

function upper(value) {
  return String(value || "").toUpperCase();
}
