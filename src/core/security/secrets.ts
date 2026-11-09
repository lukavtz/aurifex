export const TELEGRAM_TOKEN_RE = /\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
export const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

const BEARER_RE = /\b(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi;
const PLACEHOLDER_RE =
  /^(?:x+|your[_-]?.*|token|example|placeholder|dummy|redacted|change[_-]?me)$/i;

export interface TokenHit {
  readonly line: number;
  readonly redacted: string;
}

export function isTelegramToken(value: string): boolean {
  const match = /^\d{6,}:([A-Za-z0-9_-]{30,})$/.exec(value);
  return match !== null && !PLACEHOLDER_RE.test((match[1] ?? "").replace(/[_-]+/g, "_"));
}

export function findTelegramTokens(text: string): TokenHit[] {
  const hits: TokenHit[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TELEGRAM_TOKEN_RE.exec(line)) !== null) {
      const [token] = match;
      const [id = "", body = ""] = token.split(":");
      if (PLACEHOLDER_RE.test(body.replace(/[_-]+/g, "_"))) continue;
      hits.push({ line: index + 1, redacted: `${id}:${body.slice(0, 4)}…` });
    }
  }
  return hits;
}

export function redactSecrets(text: string): string {
  return text
    .replace(TELEGRAM_TOKEN_RE, (token) => {
      const [id = "", body = ""] = token.split(":");
      return PLACEHOLDER_RE.test(body.replace(/[_-]+/g, "_")) ? token : `${id}:<redacted>`;
    })
    .replace(BEARER_RE, "$1<redacted>");
}

export function assertWebhookSecret(value: string): void {
  if (!WEBHOOK_SECRET_RE.test(value)) {
    throw new Error("webhook secret must be 1-256 characters of A-Z, a-z, 0-9, _ or -");
  }
}
