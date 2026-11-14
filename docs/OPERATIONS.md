# Operations

Scope: installing, wiring, updating, and diagnosing the Aurifex plugin, plus running the
static gate on a bot project. Runtime operations of a bot project (queue workers,
migrations, backups, payments reconciliation) belong to that project; the knowledge for
them lives in `skills/telegram-deploy`, `skills/telegram-bot-recipes`, and
`skills/telegram-payments`.

## Installation

```sh
npx aurifex install
```

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/lukavtz/aurifex/main/install.sh | sh
```

```powershell
# Windows PowerShell
powershell -c "irm https://raw.githubusercontent.com/lukavtz/aurifex/main/install.ps1 | iex"
```

```sh
# from a checkout
node dist/cli.js install
```

The scripts keep a checkout at `~/.aurifex/src` (`%LOCALAPPDATA%\Aurifex\src` on
Windows), build it once, and run the CLI installer. Re-running updates that checkout.

| Variable             | Effect                                                |
| -------------------- | ----------------------------------------------------- |
| `AURIFEX_REF`        | repository ref to fetch; default `main`               |
| `AURIFEX_SOURCE_DIR` | use an existing local checkout instead of downloading |
| `AURIFEX_HOSTS`      | host list for non-interactive runs, e.g. `omp,claude` |
| `AURIFEX_SCOPE`      | `user` or `project`                                   |
| `AURIFEX_YES`        | accept defaults without prompting                     |
| `AURIFEX_DRY_RUN`    | print host commands, do not run them                  |

On an interactive terminal the installer asks which hosts and which scope to use. It
runs to completion and exits without waiting for a keypress.

`aurifex install` accepts `--host`, `--profile`, `--scope`, `--source`, `--dry-run`,
`--json`, and `--yes`. A local source must be an absolute path or a `./relative` path to
an Aurifex checkout. A host binary that is not on `PATH` is reported as `skipped`; a
selected host that fails is reported as `failed` and the command exits `1`.

The installer creates an `aurifex` launcher in `~/.local/bin`
(`%LOCALAPPDATA%\Aurifex\bin` on Windows). If that directory is not on `PATH`, use the
printed path or:

```sh
node "$HOME/.aurifex/src/dist/cli.js" --help
```

## Host wiring

| Host             | Mechanism                                                                    | Artifact                      |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------- |
| OMP              | `package.json#omp.extensions`, `omp plugin link .`                           | `dist/adapters/omp/index.js`  |
| DeepSeek Harness | `cordis.patch.yml`, `dsh plugin add`                                         | `dist/adapters/dsh/index.js`  |
| Claude Code      | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json` | `dist/adapters/mcp/server.js` |
| MCP client       | stdio JSON-RPC                                                               | `dist/adapters/mcp/server.js` |

Manual setup:

```sh
omp plugin link .
dsh plugin --profile botdev add /absolute/path/to/aurifex   # default profile: aurifex
claude plugin marketplace add /absolute/path/to/aurifex
claude plugin install aurifex@aurifex
```

```json
{
  "mcpServers": {
    "aurifex": {
      "command": "node",
      "args": ["/absolute/path/to/aurifex/dist/adapters/mcp/server.js"],
      "env": { "AURIFEX_ROOT": "/absolute/path/to/workspace" }
    }
  }
}
```

All three tools are read-only with respect to bot projects. `AURIFEX_ROOT` bounds every
read; it defaults to the process working directory.

## Running the gate

```sh
aurifex verify path/to/bot
aurifex verify path/to/bot --json
```

- The project path is resolved against `--root` (default `.`) and then `realpath`ed.
- The snapshot is bounded: 64 MiB total, 1 MiB per file. Inputs over the bound fail
  `scan.bounded`, which is a `fail`, not a silent skip.
- `ok` is true only when no check is `fail`. Warnings remain visible in the report.
- The command exits `1` only when the operation fails, not when checks fail. CI gates on
  the JSON verdict: `aurifex verify . --json | jq -e '.value.ok'`.
- The gate never executes project code, writes files, uses the network, or calls
  Telegram. It is safe to run on an untrusted checkout.

Recommended CI step:

```yaml
- run: npx aurifex verify . --json | jq -e '.value.ok'
```

For an installed plugin, `node "$HOME/.aurifex/src/dist/cli.js" verify . --json` avoids
PATH assumptions.

## Updating the plugin

1. Re-run the installer, or `AURIFEX_REF=<ref>` to pin a ref.
2. The checkout is rebuilt; host registrations point at `dist/`, so no host file edit is
   needed for a linked checkout.
3. Restart the host so the new MCP server process and extension code load.
4. Run `aurifex target --stack grammy` and `--stack aiogram` to confirm the new pins.
5. Re-run `aurifex verify` on any project you report on; check ids can change across
   releases and a stale cached result is not evidence.

For a Claude Code plugin-cache install, remove and reinstall the plugin so the cached
copy is replaced.

## Diagnostics

| Symptom                               | Check                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Host lists no tools                   | `node dist/adapters/mcp/server.js`, send `initialize` and `tools/list`; expect three tools |
| Tool call returns `unauthorized_path` | `AURIFEX_ROOT` or `ctx.cwd` does not contain the project                                   |
| `project_unreadable`                  | the path is not a directory, or it does not exist                                          |
| `target_unsupported`                  | the stack is not `grammy` or `aiogram`                                                     |
| `verify` fails `scan.bounded`         | a file exceeds 1 MiB or the snapshot exceeds 64 MiB                                        |
| Installer reports `skipped`           | the host binary is not on `PATH`; install it or use a manual registration                  |
| Installer reports `failed`            | read the printed host command, run it directly, fix the host state                         |

The MCP server reserves stdout for JSON-RPC. Diagnostics go to stderr; a host that
captures stderr is the place to look for startup errors.

## Secret handling

- Aurifex never asks for and never prints a bot token, webhook secret, API key, or
  password. Install output, error text, and verification evidence pass through
  `redactSecrets`.
- Verification reads project files to detect token-shaped literals, but the report never
  echoes the matched value.
- If a token appears in a log, a screenshot, an issue, or a commit, follow the
  revocation procedure in [SECURITY.md](../SECURITY.md). Rotating the token is
  mandatory; deleting the message is not enough.
- Do not paste `.env` files or full request URLs into a support thread. A webhook URL can
  contain the token.

## Uninstalling

```sh
# OMP
omp plugin remove aurifex

# DSH
dsh plugin --profile aurifex remove aurifex

# Claude Code
claude plugin uninstall aurifex@aurifex
```

Then remove `~/.aurifex` (`%LOCALAPPDATA%\Aurifex` on Windows) and the `aurifex` launcher
from `~/.local/bin`. Projects are unaffected: they never depended on the plugin at
runtime.
