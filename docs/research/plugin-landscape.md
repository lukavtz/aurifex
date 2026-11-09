# Plugin landscape: Claude Code, OMP, DeepSeek Harness

Research date: 2026-11-09. Star counts and install counts are snapshots, not quality proof.
Everything below was read from the linked repository, manifest, source file, or official docs.
Reference clones live in `aurifex/raw/` (git-ignored).

## 1. Executive summary

The three ecosystems solve the same problem with different contracts:

| Concern      | Claude Code                           | OMP                                     | DeepSeek Harness                              |
| ------------ | ------------------------------------- | --------------------------------------- | --------------------------------------------- |
| Unit         | plugin directory                      | package with `omp` manifest             | npm package with `dsh.bundle`                 |
| Manifest     | `.claude-plugin/plugin.json`          | `package.json#omp` (or legacy `#pi`)    | `package.json#dsh`                            |
| Runtime code | optional hooks / mods / MCP           | TS/JS extension module                  | ESM Cordis plugin                             |
| Tool API     | MCP tools, commands                   | `pi.registerTool`                       | `ctx.tools.register(defineTool(...))`         |
| Event API    | lifecycle hooks (JSON + commands)     | `pi.on(...)` in-process                 | Cordis events + policy hooks                  |
| Skills       | `skills/<name>/SKILL.md`              | `skills/<name>/SKILL.md`                | prompt sections + skills via other hosts      |
| Distribution | marketplace + `--plugin-dir`          | `omp plugin install/link` + marketplace | `dsh plugin --profile ... add` + bundle patch |
| Namespacing  | `plugin:component`                    | none                                    | none                                          |
| Isolation    | plugin code runs as the user          | in-process, no sandbox                  | in-process Cordis fibers                      |
| Versioning   | manifest `version`, marketplace entry | package version + lockfile state        | `engines.dsh`, `manifestVersion`              |

The strongest packages separate **content** (skills, agents, docs), **host projection** (manifest + adapters), and **domain logic** (tests, typed results). None of the top packages mixes all three in one file.

## 2. Claude Code

### 2.1 Contract

Official docs: <https://code.claude.com/docs/en/plugins/overview> and
<https://code.claude.com/docs/en/plugins-reference>.

A plugin is a directory, optionally with `.claude-plugin/plugin.json`. Components live at the
plugin root, never inside `.claude-plugin/`:

```text
my-plugin/
  .claude-plugin/plugin.json
  commands/*.md
  agents/*.md
  skills/<name>/SKILL.md
  hooks/hooks.json
  .mcp.json
  scripts/
```

Manifest essentials:

- `name` is required, kebab-case, and namespaces every component (`plugin:command`).
- Optional `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`.
- `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers` can point outside default
  directories; paths are relative to the plugin root, must start with `./`, and cannot escape it.
- `userConfig` prompts the user for typed values; `sensitive: true` masks a secret.
- `${CLAUDE_PLUGIN_ROOT}` is the portable root reference.
- `hooks` use a wrapper object: `{ "hooks": { "PreToolUse": [...] } }`.
- Hooks can be shell commands or prompt-based; `SessionStart`, `PreToolUse`, `PostToolUse`,
  `Stop`, `SubagentStop`, `UserPromptSubmit`, `PreCompact`, `SessionEnd`.
- MCP servers are declared in `.mcp.json` or inline in the manifest.
- `claude plugin validate` is the authoritative schema/path check.
- Distribution: marketplace at `.claude-plugin/marketplace.json`, install scopes user/project/local.
- A plugin runs with user privileges; the docs explicitly treat it as trusted code.

### 2.2 Top examples

| Project                                                                                                                |   Stars | License             | Why it matters                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------: | ------------------- | ----------------------------------------------------------------- |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                | 314,877 | MIT                 | Cross-harness skills library with a bootstrap injector per host   |
| [anthropics/skills](https://github.com/anthropics/skills)                                                              | 190,300 | **no LICENSE file** | Canonical skill corpus and Agent Skills spec; do not vendor       |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)                            |  46,554 | Apache-2.0          | Official marketplace: 317 entries, 54 in-repo plugins             |
| [wshobson/agents](https://github.com/wshobson/agents)                                                                  |  42,350 | MIT                 | 92 plugins, 185 skills, 202 agents, 7 harness adapters            |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates)                                      |  33,229 | MIT                 | CLI + catalog: 434 agents, 348 commands, 5,727 skill files        |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                        |  26,000 | MIT                 | One skills source + per-host plugin dirs, including `.omp-plugin` |
| [contains-studio/agents](https://github.com/contains-studio/agents)                                                    |  12,422 | none declared       | Popular agents, but no license file: do not vendor                |
| [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)                                |   3,973 | none declared       | Hook/subagent patterns and specs; reference only                  |
| [plugins/plugin-dev](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/plugin-dev)               |       — | Apache-2.0          | Official meta-plugin: structure, hooks, MCP, agents, settings     |
| [plugins/hookify](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify)                     |       — | Apache-2.0          | Data-driven hooks: markdown + YAML rules, no plugin release       |
| [plugins/code-review](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review)             |       — | Apache-2.0          | Multi-agent PR review with confidence scoring                     |
| [plugins/security-guidance](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/security-guidance) |       — | Apache-2.0          | Policy hooks plus a large Python test suite                       |
| [external_plugins/telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) |       — | Apache-2.0          | Production MCP bridge with pairing, allowlists, state, tests      |

### 2.3 How Superpowers works

Superpowers is the best cross-harness reference. It ships the same `skills/` content to Claude
Code, Codex, Cursor, Gemini, Kimi, Devin, Hermes, OpenCode, and pi/OMP.

- Root `skills/` is the source of truth. Skills describe actions ("dispatch a subagent",
  "read a file"), never a specific tool name.
- Each host gets a manifest: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
  `.cursor-plugin/plugin.json`, `.gemini-extension.json`, `.hermes-plugin/plugin.yaml`,
  `.pi/extensions/superpowers.ts`.
- The actual integration is a **bootstrap injector**: at session start, the
  `using-superpowers` skill is injected into context with a host-specific tool mapping.
- The injector is delivered by the host's install mechanism. It never edits the user's global
  config.
- For pi/OMP the extension hooks `session_start`, `session_compact`, and `context`; it inserts a
  synthetic user message only when the bootstrap marker is absent.
- The design doc states the hard requirement: automatic session-start injection, no per-session
  opt-in.

This is the pattern to copy for behavior-shaping skills. It is also a warning: injecting a large
bootstrap on every provider request costs context. Superpowers accepts that cost because the skill
is the product. Aurifex should inject only a small router, not a full manual.

### 2.4 How the official Telegram plugin works

`external_plugins/telegram` is a self-contained MCP server, not a bot builder:

- `grammy` + `@modelcontextprotocol/sdk`, stdio server started by `.mcp.json`.
- Token is read from `TELEGRAM_BOT_TOKEN` or `~/.claude/channels/telegram/.env`, file mode `0600`.
- State lives in `~/.claude/channels/telegram/access.json`.
- Default DM policy is **pairing**: unknown sender gets a 6-character code; the assistant session
  approves it.
- Allowlist stores numeric Telegram IDs, not mutable usernames.
- Groups are opt-in, mention-gated, and have per-group allowlists.
- Stale poller PID cleanup avoids the `409 Conflict` of two `getUpdates` consumers.
- Outbound file sending refuses the server's own state directory.
- Tools are reply-only because Bot API has no history/search.

This is the strongest access-control design in the ecosystem. Aurifex should reuse the pairing,
numeric-ID allowlist, and state-directory discipline, but its job is to build bots, not to be one.

### 2.5 Reusable Claude Code patterns

- One manifest, conventional component directories; no code required for a skills-only plugin.
- Namespace every component; never squat a generic command name.
- Hooks are a policy seam, not business logic: block, redact, validate, then get out of the way.
- `userConfig` with `sensitive` is the right place for a token, not a committed `.env`.
- Marketplace entries pin a Git SHA or version; that is what makes installs reproducible.
- `claude plugin validate` in CI catches path escapes and malformed component maps.
- Official plugins ship tests and a security/trust section; the popular unlicensed ones do not.

## 3. OMP

### 3.1 Contract

Official docs: `omp://extensions.md`, `omp://extension-loading.md`,
`omp://plugin-manager-installer-plumbing.md`, <https://omp.sh/docs/plugins>,
<https://omp.sh/docs/extension-authoring>.

A plugin is a package with an `omp` manifest. A runtime extension is a TS/JS module whose default
export is a factory:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => ctx.ui.notify("loaded", "info"));
  pi.registerTool({/* ... */});
  pi.registerCommand("hello", {/* ... */});
}
```

Manifest:

```json
{
  "name": "my-plugin",
  "omp": {
    "extensions": ["./dist/index.js"],
    "tools": "./tools",
    "hooks": "./hooks",
    "commands": ["./commands/review.md"],
    "features": { "search": { "default": true, "extensions": ["./dist/search.js"] } },
    "settings": { "apiKey": { "type": "string", "secret": true } }
  }
}
```

Conventional directories at the package root: `skills/`, `commands/`, `agents/`, `hooks/pre|post/`,
`tools/`, `rules/`, `prompts/`, `.mcp.json`/`mcp.json`.

Key runtime facts:

- Extensions are in-process, unsandboxed, and share one event bus.
- Factory load is registration-only. `pi.sendMessage()` during load throws.
- `pi.registerTool` accepts `approval: "read" | "write" | "exec"`,
  `loadMode: "essential" | "discoverable"`, `hidden`, `defaultInactive`, `onSession`,
  `renderCall`, `renderResult`.
- `execute(toolCallId, params, signal, onUpdate, ctx)` — `signal` comes before `onUpdate`.
- Events include `session_start`, `input`, `before_agent_start`, `context`, `tool_call`,
  `tool_result`, `turn_end`, `session_stop`, `session_shutdown`, and more.
- `tool_call` errors are fail-closed.
- Raw timers crash the session; use `ctx.setInterval`/`ctx.setTimeout`.
- Discovery: `.omp/extensions`, `~/.omp/agent/extensions`, hooks, installed plugin manifests,
  explicit `-e/--extension`, settings `extensions`.
- `omp plugin link ./pkg` is the local development loop. Restart the session for code changes.
- Marketplace: `.omp-plugin/marketplace.json`, install with `name@marketplace`.
- No namespacing: a command or skill name is global.

### 3.2 Top examples

| Project                                                                                         | Signal                      | License       | Structure                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------- | ------------- | --------------------------------------------------------------------- |
| [@dietrichgebert/ponytail](https://github.com/DietrichGebert/ponytail)                          | 187,318★; installed locally | MIT           | `pi.extensions` only; skills, hooks, commands, fake-host tests        |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | 26,000★                     | MIT           | One skills source + `.omp-plugin` marketplace + per-host adapters     |
| [musingfox/omp-plugins](https://github.com/musingfox/omp-plugins)                               | 14 native plugins           | none declared | Each subdir is an `omp` package; `obw` has dual `omp`+`pi` extensions |
| [wolfiesch/omp-best-of](https://github.com/wolfiesch/omp-best-of)                               | 77★                         | MIT           | Marketplace + extension + CLI + benchmark suite                       |
| [btspoony/mstar-harness](https://github.com/btspoony/mstar-harness)                             | 69★                         | MIT           | Monorepo with `packages/omp`, `packages/dsh`, engine, judgment, UI    |
| [Whamp/pi-token-burden](https://github.com/Whamp/pi-token-burden)                               | 54★                         | MIT           | `pi.extensions`, 20+ Vitest suites, architecture docs                 |
| [seenark/omp-plugins](https://github.com/seenark/omp-plugins)                                   | 7★; 10 features             | none declared | Monorepo with `omp.features` per capability package                   |
| [DevVig/omp-claude-bridge](https://github.com/DevVig/omp-claude-bridge)                         | 14★                         | MIT           | Provider registration + AskClaude tool + context switch               |
| [voxellume](https://github.com/lukavtz/voxellume)                                               | production package          | MIT           | Shared core + OMP/DSH/MCP adapters + skills/commands/agents           |
| [develop7/omp-agency](https://github.com/develop7/omp-agency)                                   | workflow package            | MIT           | Marketplace + `omp.extensions` + skills/agents + workflow engine      |
| [mentalfl0w/smart-approve](https://github.com/mentalfl0w/smart-approve)                         | approval hook               | MIT           | `omp`+`pi` extension, risk analysis, tests                            |
| [kabmo-labs/kabmo](https://github.com/kabmo-labs/kabmo)                                         | web console                 | MIT           | Bun/Elysia/Preact, marketplace, CLI, extensions                       |
| [omp-voice](https://codeberg.org/mozircline/omp-voice)                                          | generated OMP extension     | MIT           | Python CLI installs `extensions/omp-voice.js` + `hooks/post/speak.js` |
| [omp-resetroles](https://codeberg.org/mozircline/omp-resetroles)                                | config CLI                  | MIT           | Uses `omp config set/reset`, never edits YAML                         |

### 3.3 How `musingfox/omp-plugins` is built

- Root is a collection, not a monorepo package. Each child has its own `package.json`.
- Most plugins are **skills/commands only**; `package.json` contains `"omp": {}` plus an
  `upstream` marker. That is the cheapest useful OMP plugin.
- `obw` is the exception: dual `omp` and `pi` manifests, separate extension entrypoints
  (`./index.ts`, `./pi.ts`), shared core modules, and host-specific adapters.
- `obw` registers tools with `approval: "write"` and `loadMode: "essential"`, uses
  `pi.appendEntry` for durable bindings, and restores UI state on session switch/branch/tree.
- Tests are a mix of `bun test` TypeScript and shell contract tests.
- There is no namespacing; the README explicitly says skills/commands are global.

### 3.4 How `omp-best-of` is built

- `package.json` has `bin`, `peerDependencies` on `@oh-my-pi/pi-coding-agent`, and no `omp.extensions`
  in the root manifest: the marketplace entry points at `./` and the package exposes a CLI.
- `.omp-plugin/marketplace.json` is a one-plugin catalog.
- `/best-of` runs N isolated OMP sessions, ranks trajectories with a verifier, and optionally
  applies the winning patch.
- It refuses a dirty tree, records `HEAD`, and re-checks before applying.
- Tests cover process isolation, verifier cache, transcript parsing, CLI args, and packaging.
- This is the reference for an OMP plugin that orchestrates OMP itself.

### 3.5 How `omp-voice` integrates without a plugin manifest

`omp-voice` is the clearest example of an external tool that installs OMP integration:

- Python package with a `omp-voice` console script.
- `setup` writes a generated extension to `~/.omp/agent/extensions/omp-voice.js`.
- It writes a generated hook to `~/.omp/agent/hooks/post/speak.js`.
- The hook is an OMP extension module: `export default function speakHook(pi)` and
  `pi.on("session_stop", ...)`.
- The hook writes nothing into the conversation and never blocks the turn.
- The slash command `/tts` is generated into the same extension; it calls the CLI and returns a
  notification, not a model turn.
- State is files (`enabled`, speaker PID), so toggling needs no restart.
- It refuses to overwrite a foreign hook without `--force`; uninstall removes only its own file.
- Tests assert exact payload fields (`last_assistant_message`, `event?.messages`) and run a real
  hook against a stand-in speaker.

This is a pattern Aurifex can use when it must modify the user's OMP environment: generate a small,
self-describing extension/hook, install it atomically, mark it as generated, and support safe
uninstall.

### 3.6 Reusable OMP patterns

- Start with skills/commands; add an extension only when executable behavior is required.
- Keep `omp` and `pi` manifests side by side if the same package targets both.
- Use `omp plugin link` for development; restart for extension changes.
- Register tools with an explicit `approval` tier and a stable result shape.
- Never edit YAML by hand when `omp config set` exists (`omp-resetroles`).
- If installing generated files, use a generated marker, atomic write, foreign-file refusal, and
  uninstall that removes only owned files (`omp-voice`).
- Test the host contract, not just the domain logic: loader unwrap, registration, command lookup,
  shutdown cleanup.

### 3.7 How `ponytail` works

`@dietrichgebert/ponytail` is the highest-adoption OMP-compatible package (187k★) and the best
example of a **prompt/skill shaper** rather than a tool provider.

- Manifest uses legacy `pi.extensions: ["./pi-extension/index.js"]` with no `omp` key. OMP's
  `package.json.omp || package.json.pi` fallback loads it unchanged.
- The factory registers five commands and four event handlers. There are **no tools and no schemas**.
- State is a session entry: `pi.appendEntry("ponytail-mode", { mode })`; `session_start`
  reconstructs it by walking the branch backwards with `resolveSessionMode`.
- Commands that need a skill call `pi.sendUserMessage("/skill:ponytail-review")`; when
  `ctx.isIdle()` is false they pass `{ deliverAs: "followUp" }`, so the skill queues instead of
  interrupting.
- Prompt injection tries three tiers, preferring the most stable:
  1. `event.systemPromptOptions.sections.ponytail = instructions`;
  2. append to the parts array;
  3. string concatenation with a null guard.
     When mode is `off`, it deletes the stale section instead of leaving it.
- Config precedence is env → XDG config → `~/.config`. Writes are bounded; there is no `pi.exec`,
  no arbitrary path write, no network.
- Tests use a hand-rolled fake host object (`on`, `registerCommand`, `appendEntry`,
  `sendUserMessage`) backed by maps and spies. No mocking framework. `withTempConfig()` redirects
  `XDG_CONFIG_HOME` and restores it.

The lesson: OMP plugins split into **prompt/skill shapers** (low risk, no tools) and **tool
providers** (schema, approval, path policy). Aurifex needs both, but they should be separate
modules with separate tests.

### 3.8 Features as install-time capability selection

`seenark/omp-plugins` is the clearest example of `omp.features`:

```json
"omp": {
  "extensions": ["./packages/codesook-omp-plugin/index.ts"],
  "features": {
    "ponytail": { "default": false, "extensions": ["./packages/ponytail/src/index.ts"] },
    "headroom": { "default": true, "extensions": ["./packages/headroom/index.ts"] }
  }
}
```

Install-time selection uses brackets: `pkg[ponytail]`, `pkg[*]`, `pkg[]`. `enabledFeatures: null`
means "use `default: true` features". The base entry should stay minimal; heavy or risky surfaces
belong in features. This is a better fit for Aurifex than one giant extension: Telegram bot
generation, verification, deploy, and userbot support can be separate features.

## 4. DeepSeek Harness

### 4.1 Contract

Docs source of truth: the `docs/` tree in
<https://github.com/deepseek-ai/deepseek-harness>; the site is a developer-preview shell.
Package template and contract: <https://github.com/omdsh-dev/plugin-template>.

A dsh plugin is a Cordis plugin, loaded as an ESM module and unwrapped as
`exports.default ?? exports`.

Function-plugin form:

```ts
export const name = "aurifex";
export const inject = ["tools", "systemPrompt"];
export const Config = schema.object({/* ... */});
export function apply(ctx, config) {
  /* registrations */
}
```

Hard rules:

- Do **not** add a default export to a function plugin; it discards `name`, `inject`, `Config`,
  `apply`.
- `Config` must be a Schemastery schema value, not a plain object.
- All registrations are fiber-owned; disposal must be testable.
- Service providers default-export a `Service` subclass instead; do not mix forms in one module.

Manifest:

```json
{
  "engines": { "node": ">=24.9.0", "dsh": ">=0.2.2-0 <0.3.0" },
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" } },
  "exports": { ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" } }
}
```

Bundle patch:

```yaml
- insert:
    - id: aurifex
      name: aurifex
      config:
        root: !!js process.cwd()
```

Composition order: each `dsh.profile.bundles` entry in order, then profile `cordis.patch.yml`,
then `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays. A row-targeted override replaces the
entire `config`; restate retained keys. Missing target id is a composition failure.

Tools:

```ts
ctx.tools.register(
  defineTool({
    name: "telegram_bot_verify",
    parameters: { root: { type: "string", required: true } },
    output: {
      schema: { type: "json" },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return run(args.root, exec.signal);
    },
  }),
);
```

`defineTool` validates args, requires `output.schema`, and `execute` returns one canonical JSON
value (not content blocks). `exec.signal` must be honored. `ctx.systemPrompt.section` adds ordered
prompt guidance. `ctx.jobs.start` owns background work. A browser face adds `dsh.client` and a
`./client` export.

### 4.2 Top examples by installs

Data from the DSH registry API, 2026-11-09 (`sortBy=installs`; counts are snapshots):

| Plugin                                                                                                                   | Installs |  Stars | License    | What it does                                  |
| ------------------------------------------------------------------------------------------------------------------------ | -------: | -----: | ---------- | --------------------------------------------- |
| [volcengine/OpenViking dsh-memory-plugin](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin) |      487 | 41,854 | check repo | Long-term memory + knowledge + skills         |
| [tt-a1i/archify](https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness)                              |      356 | 94,942 | check repo | Motion-rich architecture diagrams             |
| [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight/tree/main/hindsight-integrations/coding-agents)       |      250 | 60,022 | check repo | Agent memory                                  |
| [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)                                          |      157 |  5,027 | check repo | Sidebar workbench                             |
| [Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill/tree/main/packages/dsh-plugin-browserskill)               |      141 | 10,225 | check repo | Real browser control                          |
| [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)                                              |      135 |  2,809 | check repo | Multi-agent teams                             |
| [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im)                                                                      |       88 |  3,411 | check repo | IM bridge for 8 platforms, including Telegram |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)                                                        |        — | 11,600 | MIT        | Plugin marketplace, 1.09M npm downloads/month |

Reference implementations (not all top by installs, but strongest engineering):

| Project                                                                   | License      | Why it matters                                                |
| ------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| [omdsh-dev/plugin-template](https://github.com/omdsh-dev/plugin-template) | BSD-3-Clause | Authoritative bundle/test/build layout                        |
| [bpc-oss/dsh-verification](https://github.com/bpc-oss/dsh-verification)   | Apache-2.0   | Production policy hook, evidence, gate, projection, 140 tests |
| [dsh-windows-mcp](https://github.com/helloHub1212/dsh-windows-mcp)        | MIT          | Carrier bundle; disables a risky bridge by default            |
| [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)                        | MIT          | Browser face and compatibility map                            |
| [voxellume](https://github.com/lukavtz/voxellume)                         | MIT          | One core, OMP + DSH + MCP adapters                            |

### 4.3 How `plugin-template` is built

- One ESM namespace, no default export.
- `src/config.ts` owns the Schemastery `Config` and a `resolveConfig()` for non-Cordis callers.
- `src/runtime.ts` keeps host boundaries behind a fakeable interface.
- `src/index.ts` re-exports `name`, `inject`, `Config`, `apply`.
- `tests/harness.ts` mounts the real Cordis `Context` and disposes the fiber.
- `tests/plugin.test.ts` asserts Loader unwrapping, schema defaults, composition config, and one
  log per activation.
- Build is `tsdown` to `lib/`; tests are Vitest; lint is type-aware oxlint.
- The repo ships stage skills for plan/scaffold/align/implement/client/i18n/compose/test/release.
  The template is itself an agent workflow, not just a scaffold.

### 4.4 How `dsh-verification` is built

This is the best example of a plugin that changes host policy safely.

- Multi-package workspace: engine, pure evidence schemas, client UI.
- `inject = ["agents", "tools", "systemPrompt"]`.
- `apply()` installs evidence capture, a completion gate, intent tools, a pro-review tool, a goal
  transition guard, a session projection, and a prompt section.
- Policy is a `tools/pre-execute` hook returning typed `{ kind: "deny" | ... }` decisions, not
  throwing.
- Read-only tools are never blocked. Write tools are blocked only when a contract is missing in
  enforce mode.
- Default mode is `advisory` after an enforce-by-default incident.
- Evidence and verdicts are append-only session events; a projection makes them replayable.
- It registers a custom session event type at import time by mutating a `ReadonlySet` that is a
  `Set` at runtime. The report flags this as a hack, not a pattern.
- 140 tests cover recall, false positives, gate behavior, and replay.

### 4.5 Reusable DSH patterns

- Separate manifest from composition: the package declares a bundle layer; the profile owns order.
- One typed seam per concern, explicitly injected.
- Policy as hooks, not code inside tools.
- Canonical JSON value + separate renderer; this is also what makes MCP parity easy.
- Honest defaults: disable risky bridges, default to advisory, fail open only with a recorded
  reason.
- Test the Loader unwrap, schema defaults, disposal, and composition; a unit test that bypasses
  Cordis proves little.
- Treat compatibility maps (`dsh.compatibility.dshReleases`) as ecosystem invention until the
  official contract adopts them.

### 4.6 Contested: where DSH host packages belong

Two working layouts exist, and the choice affects fresh-profile activation:

| Layout                                                                                        | Evidence                             | Risk                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `peerDependencies` for `@deepseek-ai/cordis` + `schemastery`, duplicated in `devDependencies` | Official `omdsh-dev/plugin-template` | Fresh profile with `autoInstallPeers=false` may fail `ERR_MODULE_NOT_FOUND` if the host does not provide the package |
| Exact `dependencies` for every imported `@deepseek-ai/*`                                      | Some production packages             | Duplicate copies, version skew with the host, larger install                                                         |

Correction from a later check: `voxellume`'s actual `package.json` has **no** `@deepseek-ai/*` in
`dependencies`; it uses a `devDependency` for local checks. So "voxellume ships exact dependencies"
was wrong. Do not move packages based on a doc claim.

Decision rule: build two tiny candidate packages, install each into a **fresh** `dsh --profile`
with the same `autoInstallPeers` policy, run `--dump-config`, boot, and call one tool. Pin the
layout that actually activates. Also verify the exact version: `npm view @deepseek-ai/dsh-tools`
reports `0.0.1-rc.1` as `latest`, while DSH 0.2.2 expects `0.2.2-rc.1`; never install from
`latest`.

## 5. Cross-host patterns for Aurifex

### 5.1 Shared core, thin projections

`voxellume` is the closest architectural match:

```text
core operations (domain, policy, results)
  ├── OMP adapter (pi.registerTool, pi.zod)
  ├── DSH adapter (defineTool, Cordis)
  └── MCP adapter (McpServer, zod/v4)
```

Adapters only translate schema and result projections. Domain logic, path policy, and verification
live once.

### 5.2 Shared content, per-host manifests

`superpowers` and `EGM` show the content pattern:

- One `skills/` tree and one `agents/` tree.
- Per-host manifests and tool mappings.
- A small bootstrap/router per host, not a duplicated skill body.
- Tests per harness, not one generic smoke test.

For Aurifex this means:

```text
skills/           # shared Telegram knowledge
agents/           # shared subagent personas
commands/         # shared markdown commands
.omp/             # OMP manifest bits (if split)
.claude-plugin/   # Claude manifest (if published there)
cordis.patch.yml  # DSH bundle layer
```

If Aurifex only targets OMP + DSH + MCP, Claude packaging is optional. The root `plugin.json`
Agent Plugins 1.0.0 format from EGM is a cheap future-proofing step.

### 5.3 Generated integration vs packaged plugin

`omp-voice` proves there are two valid OMP distribution models:

1. **Packaged extension** in a plugin manifest (`omp.extensions`) — loaded by `omp plugin link/install`.
2. **External CLI that installs generated files** into `~/.omp/agent/extensions` and
   `~/.omp/agent/hooks/post` — useful when the tool is language-agnostic or must support OMP and
   non-OMP hosts with one binary.

Aurifex should default to model 1 for its own capabilities, and model 2 only for bootstrapping a
generated project's local dev hook if needed.

### 5.4 Security invariants

All three ecosystems share the same boundary:

- Plugin code runs with user privileges. There is no sandbox.
- Marketplace scope changes discovery, not permissions.
- Secrets belong in env or a `sensitive` config field, never in a manifest or committed file.
- Paths from a model are untrusted. Resolve realpath, reject symlink escape, write with `wx`.
- Hooks that block must fail closed. Hooks that observe must not crash the session.

Aurifex's differentiator should be that generated projects enforce these invariants, and that the
plugin's own tools verify them deterministically.

### 5.5 Testing patterns worth copying

- **Host contract tests**: Loader unwrap (DSH), extension registration (OMP), manifest validation
  (Claude).
- **Fake host**: Cordis `Context` harness (DSH), fake `omp` binary (omp-resetroles), fake gateway
  (omp-voice), fake Bot API transport (Telegram).
- **Golden manifests**: assert exact `omp`/`dsh` fields and built exports.
- **Packaging tests**: `pnpm pack --dry-run`, `npm pack --dry-run`, install from tarball, verify
  entrypoints resolve.
- **Live tests**: secret-gated, never the default gate.

### 5.6 CLI + skills core, host adapters second

The user-supplied examples do not look like `voxellume`; they look like portable tools:

- `omp-voice`: Python CLI + `install.sh`, writes a generated OMP extension and hook, but the core
  is a normal command-line program.
- `omp-resetroles`: Python CLI, calls `omp config`, no extension at all.
- `EGM`: shared `skills/` + `agents/`, per-host manifests, no runtime extension where the host
  does not need one.

Aurifex should follow that shape:

```text
aurifex (CLI + shared core)
  ├── skills/ + agents/          # portable content
  ├── OMP adapter                 # pi.registerTool / pi.registerCommand
  ├── DSH adapter                 # defineTool / systemPrompt
  └── MCP adapter                 # stdio server
```

A deterministic CLI (`aurifex new`, `aurifex verify`, `aurifex deploy`) is testable without any
host, usable by humans, and callable from all three adapters. The agent plugin is a projection,
not the only product. This also matches the user's choice of "generator + runtime + orchestrator":
the CLI is the substrate all three share.

### 5.7 Two LLM layers, never conflated

There are two independent model integrations:

1. **Host model → Aurifex tools.** OMP or DSH model decides to call `telegram_bot_scaffold` or
   `telegram_bot_verify`. Aurifex stays provider-neutral; it must not assume DeepSeek, OpenAI, or
   any specific host.
2. **Generated bot → its own LLM.** A bot with the `llm` feature needs a provider adapter. Use an
   OpenAI-compatible interface with configurable `baseUrl`, `model`, and `apiKey`, so DeepSeek,
   OpenAI, local vLLM, and others work. Never hardcode a vendor into the template.

Tests must separate these layers: tool-contract tests for (1), bot runtime tests for (2). A change
in the host model must not require regenerating bot templates, and vice versa.

### 5.8 Adapter fan-out without copy-paste

`wshobson/agents` and `EveryInc/compound-engineering-plugin` both solve "one source, many hosts":

- Author once under `plugins/<name>/`.
- A capability matrix declares per-host support (`skills_native`, `agents_native`,
  `commands_native`, `parallel_agents`, `mcp_servers`, etc.).
- Adapters emit host-specific trees; generated artifacts are git-ignored.
- A generator `--clean` uses an ownership map so canonical sources are never deleted.
- A release tool syncs versions across `package.json`, `.claude-plugin/plugin.json`,
  `.cursor-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.omp-plugin/marketplace.json`, etc.
- CI runs a drift check: regenerate and fail if the tree changes.

For Aurifex this is the right way to keep OMP, DSH, MCP, and optional Claude packaging aligned
without maintaining four hand-written copies.

## 6. Recommendations for Aurifex

1. **Architecture**: CLI + shared core + thin host adapters. The CLI is the substrate; OMP, DSH,
   and MCP are projections. Do not duplicate Telegram logic per host.
2. **CLI**: `aurifex new`, `aurifex verify`, `aurifex deploy`, `aurifex upgrade`. Deterministic
   JSON output (`--json`) for agents and machines; human output for people.
3. **OMP packaging**: root `aurifex` package with `omp.extensions` ->
   `dist/adapters/omp/index.js`, conventional `skills/`, `commands/`, `agents/`, `rules/`.
   Split heavy/risky surfaces into `omp.features`; keep the base entry minimal. Register tools
   with explicit `approval` tiers.
4. **DSH packaging**: `cordis.patch.yml` with one row, `dsh.manifestVersion: 1`,
   `engines.dsh` pinned to the tested range, `defineTool` with canonical JSON output and renderer.
   Test both peer/dev and exact-dependency layouts in a fresh profile before pinning.
5. **MCP packaging**: official `@modelcontextprotocol/server` v2, strict Zod v4 schemas, stdio,
   256 KiB result cap. Ship a real `aurifex-mcp` bin with a shebang.
6. **Content**: shared skills for Bot API 10.4, grammY, aiogram, security, testing, deploy,
   payments, Mini Apps. Shared subagents for architecture, security review, and test writing.
   Skills are the router; keep bodies small and push detail into references.
7. **Generated projects**: standalone by default, but expose an optional shared runtime later.
   The user chose all three layers, so plan for `@aurifex/runtime` as a separate package.
8. **Two LLM layers**: host model → tools (provider-neutral) and generated bot → LLM
   (OpenAI-compatible, configurable base URL/model/key). Never hardcode DeepSeek in templates.
9. **Security**: token detection is a hard fail; webhook secret is mandatory; generated code uses
   constant-time comparison; admin allowlist is server-side; Mini App `initData` is HMAC-validated.
10. **Testing**: Node `node:test` + `pytest`, fake Bot API transport, tgfake only behind
    `AURIFEX_LIVE=1`. Test registration performs no I/O; test symlink/path escapes; test host
    contract, not just domain logic.
11. **Distribution**: npm package + OMP marketplace catalog + DSH bundle. Pin versions and tags.
    Use a single release tool to sync versions across host manifests.
12. **What not to copy**:
    - Do not mutate a host's internal `ReadonlySet` like `dsh-verification` does.
    - Do not inject a full manual on every provider request like a naive bootstrap.
    - Do not ship a plugin with no license file (`contains-studio/agents`,
      `disler/claude-code-hooks-mastery`, `musingfox/omp-plugins`, `anthropics/skills`).
    - Do not edit `~/.omp/agent/config.yml` directly; use `omp config` or a generated, owned file.
    - Do not claim Bot API 10.4 support from a framework that only advertises 10.3; expose the
      raw-method gap.
    - Do not copy `cp -r` installers; they have no update, uninstall, or collision safety.

## 7. Source index

- Claude Code plugins: <https://code.claude.com/docs/en/plugins/overview>,
  <https://code.claude.com/docs/en/plugins-reference>
- Superpowers: <https://github.com/obra/superpowers>
- Claude skill corpus: <https://github.com/anthropics/skills>
- Official Claude marketplace: <https://github.com/anthropics/claude-plugins-official>
- Cross-host adapter fan-out: <https://github.com/wshobson/agents>,
  <https://github.com/EveryInc/compound-engineering-plugin>
- OMP extension docs: `omp://extensions.md`, `omp://extension-loading.md`,
  <https://omp.sh/docs/plugins>, <https://omp.sh/docs/extension-authoring>
- OMP examples: <https://github.com/DietrichGebert/ponytail>,
  <https://github.com/EveryInc/compound-engineering-plugin>,
  <https://github.com/musingfox/omp-plugins>,
  <https://github.com/seenark/omp-plugins>,
  <https://github.com/wolfiesch/omp-best-of>, <https://github.com/btspoony/mstar-harness>,
  <https://codeberg.org/mozircline/omp-voice>, <https://codeberg.org/mozircline/omp-resetroles>
- DSH: <https://github.com/deepseek-ai/deepseek-harness>,
  <https://github.com/omdsh-dev/plugin-template>,
  <https://github.com/bpc-oss/dsh-verification>
- Cross-host example: <https://github.com/google/elephant-goldfish-model>
- Telegram stack: <https://core.telegram.org/bots/api>,
  <https://core.telegram.org/bots/webhooks>, <https://grammy.dev/>, <https://docs.aiogram.dev/>
