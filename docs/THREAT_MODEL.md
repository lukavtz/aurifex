# Threat model

Scope: the `aurifex` package — CLI, MCP server, OMP and DSH adapters, installer,
verification, skill corpus, and the two reference projects. This model covers shipped
code, not future platform expansion and not the runtime of a user's bot (a user's bot is
that operator's system).

## Assets

- The Telegram bot token and webhook secret of a user's project.
- Postgres, Redis, and LLM credentials referenced by a user's project.
- User ids, usernames, and message content read from a project during verification.
- The integrity of the skill corpus and the verifier results.
- The integrity of the installed plugin copy.
- The host process in which the plugin runs.

## Trust boundaries

| Boundary                  | Untrusted side                                                    | Trusted side                        |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Model to tool arguments   | stack name, project path, arbitrary strings                       | MCP/adapter schema and `PathPolicy` |
| Project files to verifier | file content, file size, symlinks                                 | bounded read and marker checks      |
| Project files to inspect  | manifests, source text                                            | bounded read, no execution          |
| Telegram docs to skills   | page content, page availability                                   | curated reference list and cache    |
| Package install           | repository archive (`AURIFEX_REF`), npm registry, host plugin CLI | local build and host registration   |
| Host plugin process       | model-supplied paths                                              | authorized root                     |

## Threats and mitigations

### Secret disclosure through verification evidence

Verification reads project files, which routinely contain token-shaped strings in
fixtures, comments, and `.env` copies.

- Matches are reported as check id, path, and line — never the matched value.
- CLI and MCP output pass through `redactSecrets`, which replaces token-shaped values and
  bearer headers ([`src/core/security/secrets.ts`](../src/core/security/secrets.ts)).
- The MCP result size cap (`output_too_large` at 256 KiB) prevents dumping a large file
  body by accident.
- The installer never prompts for credentials and never prints an environment file.

Residual risk: a user can paste a real token into a support thread. That is outside the
tool's control; [SECURITY.md](../SECURITY.md) states the revocation procedure.

### Path traversal and read amplification

The model supplies `projectRoot`.

- `PathPolicy` resolves the real root and requires the project path to be inside it, with
  no symlink escape ([`src/core/security/path-policy.ts`](../src/core/security/path-policy.ts)).
- Reads are capped at 1 MiB per file and 64 MiB per snapshot; an oversized file fails
  `scan.bounded` instead of being silently skipped.
- No operation in `0.3.1` writes to a project.
- Directories such as `node_modules`, `.git`, and build output are excluded from the scan.

Residual risk: a project with many small files can still cost the 64 MiB bound. The
bound is a hard ceiling, so the worst case is bounded CPU and memory, not an arbitrary
read.

### False confidence from static verification

The verifier matches text. A marker can be present while the behaviour is broken, and a
missing marker does not always mean the invariant is absent.

- Every check returns `pass`, `warn`, or `fail` with a `detail` that names the marker.
- Documentation, the SPEC, and the skills state repeatedly that the gate is necessary but
  not sufficient; L2/L3 evidence requires running the bot.
- Checks that matter most are `fail`, not `warn`: token literal, webhook secret, update
  deduplication, `retry_after`, non-root container, 10.4 adapter, lockfile presence is a
  warning by design.
- `dedupe.fail_closed` exists specifically because an open-fail dedupe is a real design
  choice that must be surfaced, not hidden.

Residual risk: an agent can report "verified" after a green gate and skip runtime proof.
The mitigation is instruction content (`telegram-bot` evidence scale and
`telegram-testing`), not code.

### Skill corpus integrity

Skills are instruction content consumed by a model.

- `tools/check-skills.mjs` enforces structure, link resolution, and a forbidden-string
  list; a skill that names a removed generator tool fails the build.
- Sources must be absolute `https://` URLs, so a relative or local instruction source is
  visible.
- Heavy content lives in `references/*.md` under the same owner; there is no dynamic
  fetch at load time.
- Documentation fetched by `tg_docs.py` is cached and treated as data. A page cannot
  change plugin code; it can only inform the agent.

Residual risk: documentation pages can contain adversarial text. The agent must treat
fetched content as reference, not as instructions that override the skill procedure.

### MCP server exposure

The server can be registered in any MCP client.

- Stdout is reserved for JSON-RPC; diagnostics go to stderr.
- Input is validated against a strict schema; unknown fields are rejected.
- Only three read operations exist. There is no shell, no write, no network.
- `AURIFEX_ROOT` bounds every read; the default is the process working directory.
- The protocol version is fixed at `2025-11-25`, independent of the client's request.

Residual risk: a host that leaves `AURIFEX_ROOT` at `/` exposes the whole filesystem to
read-only marker scans. Set it to the workspace.

### Installer and supply chain

- Install scripts fetch a repository archive at `AURIFEX_REF` (default `main`) and build
  locally. They do not verify release checksums, SBOMs, or cosign bundles; installation
  trusts the publisher.
- The CLI prints and executes host install commands; it does not fetch or run arbitrary
  scripts from the project.
- Root development dependencies are pinned exactly; the reference projects use frozen
  lockfiles.
- Release builds produce `SHA256SUMS` and a CycloneDX SBOM and attempt keyless cosign
  signing; signing is non-blocking, so a release may ship unsigned. npm publishing runs
  only when `NPM_TOKEN` exists.

Residual risk: a compromised publisher account or a selected repository ref can change
the installed code. Pin `AURIFEX_REF` to a tag for production installs and verify the
published digest when one exists.

### Host process compromise

- The plugin runs inside the host process; it is trusted code with the host's
  permissions.
- There is no sandbox claim. Tool inputs are untrusted, but a host extension defect is a
  host-level defect.
- The Claude Code plugin cache copy runs without `node_modules`, so it cannot be extended
  by an installed dependency at runtime.

Residual risk: any code in the host process can do what the host can do. Review the
installed version and the ref it came from.

### Reference-project compromise

- `examples/grammy_commands` and `examples/aiogram_commands` are test fixtures and
  documentation, not a deployment template.
- They carry no manifest, no secrets, and no deployment credentials.
- Verification of an example is advisory: `verify` reports findings, it does not bless a
  deployment.

Residual risk: an operator may copy an example and treat it as production-ready. The
skills state what production additionally requires (webhook secret, storage, queue,
monitoring, backup).

## Verification coverage

`aurifex verify` checks a project for token literals, scan bounds, ignored `.env`, secret
file indirection, log redaction, allowlist presence, webhook secret/HTTPS/port/constant
time, allowed updates, dedupe, dedupe fail-closed mode, `retry_after`, non-root container,
healthcheck, Bot API 10.4 adapter and types, lockfile presence, queue worker and schema,
payment schema and validation, readiness and metrics, Mini App session and CSP, and test
presence and infrastructure.

Checks match textual markers over a bounded snapshot. Webhook checks detect
configuration and comparison markers. Payment checks detect `charge_id`, `refunds`,
`subscriptions`, `invoice_payload`, `currency`, and `total_amount`; their presence does
not prove payment integrity at runtime. See
[`src/core/projects/verify.ts`](../src/core/projects/verify.ts) and
[TEST_PLAN.md](TEST_PLAN.md).
