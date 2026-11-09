import type { BotSpec } from "../../spec/bot-spec.ts";
import { assertNoTokenLiteral, type TemplateFile } from "./shared.ts";

const REACT = "19.2.0";
const VITE = "7.2.4";
const PLUGIN_REACT = "5.1.1";
const TYPESCRIPT = "5.9.3";
const TYPES_REACT = "19.2.2";
const TYPES_REACT_DOM = "19.2.2";

function packageName(spec: BotSpec): string {
  return `${spec.name.replace(/_/g, "-")}-miniapp`;
}

function renderPackageJson(spec: BotSpec): string {
  return `${JSON.stringify(
    {
      name: packageName(spec),
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc --noEmit && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: REACT,
        "react-dom": REACT,
      },
      devDependencies: {
        "@types/react": TYPES_REACT,
        "@types/react-dom": TYPES_REACT_DOM,
        "@vitejs/plugin-react": PLUGIN_REACT,
        typescript: TYPESCRIPT,
        vite: VITE,
      },
    },
    null,
    2,
  )}\n`;
}

function renderIndexHtml(spec: BotSpec): string {
  const title = spec.displayName.replace(/[<>&"']/g, "").trim() || "Mini App";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
    <noscript>This Mini App needs JavaScript.</noscript>
  </body>
</html>
`;
}

function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        verbatimModuleSyntax: true,
        types: ["vite/client"],
      },
      include: ["src", "vite.config.ts"],
    },
    null,
    2,
  )}\n`;
}

function renderViteConfig(): string {
  return `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/miniapp",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
`;
}

function renderMainTsx(): string {
  return `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("root element missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;
}

function renderTelegramTs(): string {
  return `export interface TelegramUser {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramWebApp {
  readonly initData: string;
  readonly initDataUnsafe: { readonly user?: TelegramUser };
  readonly colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
}

declare global {
  interface Window {
    readonly Telegram?: { readonly WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Calls ready()/expand() once and returns the SDK handle, or null outside Telegram. */
export function initTelegram(): TelegramWebApp | null {
  const webApp = getWebApp();

  if (!webApp) {
    return null;
  }

  webApp.ready();
  webApp.expand();
  return webApp;
}

/** Raw initData string for the backend session call. Never log or persist it client-side. */
export function getInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function displayName(user: TelegramUser): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || String(user.id);
}
`;
}

function renderAppTsx(spec: BotSpec): string {
  const title = JSON.stringify(spec.displayName);
  return `import { useEffect, useState } from "react";
import { getInitData, initTelegram } from "./telegram";

interface SessionUser {
  readonly id: number;
  readonly displayName: string;
}

interface SessionResponse {
  readonly user?: { readonly id?: unknown; readonly displayName?: unknown };
}

type State =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly user: SessionUser }
  | { readonly phase: "error"; readonly message: string };

const APP_TITLE = ${title};

function parseSession(payload: SessionResponse): SessionUser {
  const id = payload.user?.id;
  const name = payload.user?.displayName;

  if (typeof id !== "number" || typeof name !== "string") {
    throw new Error("Session response is invalid.");
  }

  return { id, displayName: name };
}

export function App() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    initTelegram();
    const initData = getInitData();

    if (!initData) {
      setState({ phase: "error", message: "Open this Mini App inside Telegram." });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/miniapp/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(\`Session request failed (\${response.status}).\`);
        }

        const payload = (await response.json()) as SessionResponse;
        const user = parseSession(payload);

        if (!cancelled) {
          setState({ phase: "ready", user });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Session request failed.",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <main className="app">
      <h1 className="app-title">{APP_TITLE}</h1>
      {state.phase === "loading" ? <p className="status">Signing in…</p> : null}
      {state.phase === "error" ? (
        <p className="status status-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ready" ? (
        <dl className="profile">
          <div className="profile-row">
            <dt>User</dt>
            <dd>{state.user.displayName}</dd>
          </div>
          <div className="profile-row">
            <dt>ID</dt>
            <dd>{state.user.id}</dd>
          </div>
        </dl>
      ) : null}
    </main>
  );
}
`;
}

function renderStyles(): string {
  return `:root {
  color-scheme: light dark;
  --bg: var(--tg-theme-bg-color, #ffffff);
  --fg: var(--tg-theme-text-color, #121212);
  --muted: var(--tg-theme-hint-color, #6b7280);
  --accent: var(--tg-theme-button-color, #2481cc);
  --card: var(--tg-theme-secondary-bg-color, #f4f4f5);
  --danger: var(--tg-theme-destructive-text-color, #c62828);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--fg);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}

.app {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.app-title {
  margin: 0;
  font-size: clamp(1.35rem, 5vw, 1.75rem);
  line-height: 1.2;
}

.status {
  margin: 0;
  color: var(--muted);
}

.status-error {
  color: var(--danger);
}

.profile {
  margin: 0;
  display: grid;
  gap: 0.5rem;
}

.profile-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--card);
  border-radius: 0.75rem;
}

.profile-row dt {
  color: var(--muted);
  font-size: 0.875rem;
}

.profile-row dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

button {
  min-height: 2.75rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--accent);
  color: #ffffff;
  font: inherit;
}
`;
}

function renderGitignore(): string {
  return `node_modules
dist
dist-ssr
*.local
.env
.env.*
!.env.example
.vite
`;
}

export function renderMiniApp(spec: BotSpec): TemplateFile[] {
  const files: TemplateFile[] = [
    { path: "miniapp/package.json", content: renderPackageJson(spec) },
    { path: "miniapp/index.html", content: renderIndexHtml(spec) },
    { path: "miniapp/tsconfig.json", content: renderTsconfig() },
    { path: "miniapp/vite.config.ts", content: renderViteConfig() },
    { path: "miniapp/src/main.tsx", content: renderMainTsx() },
    { path: "miniapp/src/App.tsx", content: renderAppTsx(spec) },
    { path: "miniapp/src/telegram.ts", content: renderTelegramTs() },
    { path: "miniapp/src/styles.css", content: renderStyles() },
    { path: "miniapp/.gitignore", content: renderGitignore() },
  ];

  assertNoTokenLiteral(files);
  return files;
}
