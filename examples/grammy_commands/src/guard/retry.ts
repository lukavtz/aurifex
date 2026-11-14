interface TelegramErrorLike {
  parameters?: { retry_after?: unknown };
}

/** Reads the Telegram retry_after hint (seconds) from a grammY error. */
export function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const parameters = (error as TelegramErrorLike).parameters;
  if (typeof parameters !== "object" || parameters === null) return undefined;
  const seconds = parameters.retry_after;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.ceil(seconds * 1000);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Retries a send exactly once when Telegram answers 429 with retry_after. */
export async function sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const delay = retryAfterMs(error);
    if (delay === undefined) throw error;
    await sleep(delay);
    return send();
  }
}
