import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMiniApp } from "../../src/core/projects/templates/miniapp.ts";
import { TELEGRAM_TOKEN_RE } from "../../src/core/security/secrets.ts";
import { validateBotSpec, BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";

const SPEC = validateBotSpec({
  schemaVersion: BOT_SPEC_VERSION,
  name: "demo_bot",
  displayName: "Demo <Bot>",
  stack: "grammy",
  features: ["commands", "miniapps"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: true,
    idempotency: true,
  },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
});

const EXPECTED_PATHS = [
  "miniapp/package.json",
  "miniapp/index.html",
  "miniapp/tsconfig.json",
  "miniapp/vite.config.ts",
  "miniapp/src/main.tsx",
  "miniapp/src/App.tsx",
  "miniapp/src/telegram.ts",
  "miniapp/src/styles.css",
  "miniapp/.gitignore",
];

function fileContent(path: string): string {
  const file = renderMiniApp(SPEC).find((candidate) => candidate.path === path);
  assert.ok(file, `missing rendered file ${path}`);
  return file.content;
}

describe("renderMiniApp", () => {
  it("renders deterministic file set", () => {
    assert.deepEqual(renderMiniApp(SPEC), renderMiniApp(SPEC));
  });

  it("renders exactly the required paths under miniapp/", () => {
    const files = renderMiniApp(SPEC);
    assert.deepEqual(
      files.map((file) => file.path),
      EXPECTED_PATHS,
    );
    for (const file of files) {
      assert.ok(file.path.startsWith("miniapp/"), `${file.path} escapes miniapp/`);
      assert.ok(!file.path.includes(".."), `${file.path} contains traversal`);
      assert.ok(file.content.length > 0, `${file.path} is empty`);
    }
  });

  it("loads no external scripts or assets", () => {
    const html = fileContent("miniapp/index.html");
    assert.ok(!/<script[^>]*src\s*=\s*["']?https?:/i.test(html));
    assert.ok(!/<link[^>]*href\s*=\s*["']?https?:/i.test(html));
    const css = fileContent("miniapp/src/styles.css");
    assert.ok(!/url\(\s*["']?https?:/i.test(css));
  });

  it("pins react and vite versions in a parseable package.json", () => {
    const pkg = JSON.parse(fileContent("miniapp/package.json")) as {
      name: string;
      private: boolean;
      type: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(pkg.name, "demo-bot-miniapp");
    assert.equal(pkg.private, true);
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies["react"], "19.2.0");
    assert.equal(pkg.dependencies["react-dom"], "19.2.0");
    assert.equal(pkg.devDependencies["vite"], "7.2.4");
    assert.equal(pkg.devDependencies["@vitejs/plugin-react"], "5.1.1");
    assert.equal(pkg.devDependencies["typescript"], "5.9.3");
    assert.equal(pkg.scripts["build"], "tsc --noEmit && vite build");
    assert.ok(!("@telegram-apps/sdk" in pkg.dependencies));
    assert.ok(!("@telegram-apps/sdk" in pkg.devDependencies));
  });

  it("parses a strict tsconfig without external type packages", () => {
    const tsconfig = JSON.parse(fileContent("miniapp/tsconfig.json")) as {
      compilerOptions: Record<string, unknown>;
    };
    assert.equal(tsconfig.compilerOptions["strict"], true);
    assert.equal(tsconfig.compilerOptions["noEmit"], true);
    assert.equal(tsconfig.compilerOptions["jsx"], "react-jsx");
    assert.deepEqual(tsconfig.compilerOptions["types"], ["vite/client"]);
  });

  it("builds relative with outDir ../dist/miniapp", () => {
    const config = fileContent("miniapp/vite.config.ts");
    assert.match(config, /base:\s*"\.\/"/);
    assert.match(config, /outDir:\s*"\.\.\/dist\/miniapp"/);
    assert.match(config, /emptyOutDir:\s*true/);
  });

  it("initializes the Telegram WebApp locally without the SDK", () => {
    const telegram = fileContent("miniapp/src/telegram.ts");
    assert.match(telegram, /window\.Telegram\?\.WebApp/);
    assert.match(telegram, /\.ready\(\)/);
    assert.match(telegram, /\.expand\(\)/);
    assert.match(telegram, /initData/);
    assert.ok(!telegram.includes("@telegram-apps/sdk"));
  });

  it("posts initData to the session endpoint and renders errors as text", () => {
    const app = fileContent("miniapp/src/App.tsx");
    assert.match(app, /fetch\("\/api\/miniapp\/session"/);
    assert.match(app, /JSON\.stringify\(\{ initData \}\)/);
    assert.match(app, /state\.user\.id/);
    assert.match(app, /state\.user\.displayName/);
    assert.ok(!app.includes("innerHTML"));
    assert.ok(!app.includes("dangerouslySetInnerHTML"));
  });

  it("renders no token-shaped literal", () => {
    for (const file of renderMiniApp(SPEC)) {
      TELEGRAM_TOKEN_RE.lastIndex = 0;
      assert.ok(!TELEGRAM_TOKEN_RE.test(file.content), `${file.path} contains a token literal`);
    }
  });

  it("ignores env files in the miniapp gitignore", () => {
    const gitignore = fileContent("miniapp/.gitignore");
    assert.match(gitignore, /^node_modules$/m);
    assert.match(gitignore, /^dist$/m);
    assert.match(gitignore, /^\.env$/m);
  });
});
