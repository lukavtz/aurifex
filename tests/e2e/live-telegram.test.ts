import assert from "node:assert/strict";
import test from "node:test";

const ENABLED = process.env.AURIFEX_LIVE === "1";
const SKIP_REASON = "AURIFEX_LIVE=1 not set; skipping live Telegram Bot API test";
const API_ROOT = "https://api.telegram.org";

interface TelegramResponse<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
  readonly error_code?: number;
}

test(
  "live Telegram Bot API: getMe, getWebhookInfo, sendMessage",
  { skip: ENABLED ? false : SKIP_REASON, timeout: 60_000 },
  async () => {
    const token = process.env.TELEGRAM_TEST_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_TEST_CHAT_ID;
    assert.ok(token, "AURIFEX_LIVE=1 requires TELEGRAM_TEST_BOT_TOKEN");
    assert.ok(chatId, "AURIFEX_LIVE=1 requires TELEGRAM_TEST_CHAT_ID");

    const redact = (text: string): string => text.split(token).join("<redacted>");

    const call = async <T>(method: string, body: Record<string, unknown> = {}): Promise<T> => {
      let response: Response;
      try {
        response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(redact(`network failure calling ${method}: ${reason}`), { cause: error });
      }
      let payload: TelegramResponse<T>;
      try {
        payload = (await response.json()) as TelegramResponse<T>;
      } catch {
        throw new Error(redact(`non-JSON response from ${method} (HTTP ${response.status})`));
      }
      if (payload.ok !== true || payload.result === undefined) {
        const code = payload.error_code ?? response.status;
        throw new Error(
          redact(`Telegram ${method} failed: ${code} ${payload.description ?? "unknown error"}`),
        );
      }
      return payload.result;
    };

    try {
      const me = await call<{ id: number; is_bot: boolean; username?: string }>("getMe");
      assert.equal(me.is_bot, true);
      assert.equal(typeof me.id, "number");

      const webhook = await call<{ url: string }>("getWebhookInfo");
      assert.equal(typeof webhook.url, "string");

      const sent = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: `aurifex live e2e ${new Date().toISOString()}`,
        disable_notification: true,
      });
      assert.equal(typeof sent.message_id, "number");
      assert.ok(sent.message_id > 0);
    } catch (error) {
      assert.fail(redact(error instanceof Error ? error.message : String(error)));
    }
  },
);
