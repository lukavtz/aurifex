import type { Context, MiddlewareFn } from "grammy";

const ACK_TIMEOUT_MS = 2_000;

/**
 * Answer a callback query when its handler fails before replying.
 *
 * The timer starts when the update arrives. A failure answers once and
 * re-raises; success clears the timer. The answered flag and the timer live in
 * this invocation, so bots never share state and cannot answer twice.
 */
export function callbackAckMiddleware(timeoutMs: number = ACK_TIMEOUT_MS): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.callbackQuery) {
      await next();
      return;
    }
    let answered = false;
    const answerOnce = async (): Promise<void> => {
      if (answered) return;
      answered = true;
      try {
        await ctx.answerCallbackQuery();
      } catch {
        // The query may have expired; never mask the handler outcome.
      }
    };
    const timer = setTimeout(() => {
      void answerOnce();
    }, timeoutMs);
    try {
      await next();
    } catch (error) {
      await answerOnce();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
