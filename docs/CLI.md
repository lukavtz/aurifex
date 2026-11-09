# CLI

Binary: `aurifex` (`dist/cli.js`). Usage string and option table live in
[`src/cli.ts`](../src/cli.ts).

```text
aurifex <command> [arguments] [options]
```

Global options:

| Option         | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `--root <dir>` | workspace root, resolved against the current directory; default `.` |
| `--json`       | print one machine-readable result instead of the text summary       |

`--root` bounds every project path. `new` rejects a destination outside it. All
project commands resolve `realpath` first, so symlinks cannot escape the root.

## Commands

| Command        | Arguments and required options             | Effect                                                                |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `target`       | `--stack grammy\|aiogram`                  | returns framework, runtime, Bot API, and warnings                     |
| `new`          | `<destination> --spec <file\|->`           | scaffolds a project; `--overwrite` allows a nonempty destination      |
| `inspect`      | `<root>`                                   | reports stack, mode, Bot API gap, and findings                        |
| `verify`       | `<root>`                                   | runs the check set; any `fail` makes the result `ok: false`           |
| `add`          | `<root> --feature <feature> --name <name>` | writes one feature; `--overwrite` allows replacement                  |
| `deploy`       | `<root> --domain <domain>`                 | writes deploy plan; optional `--mode webhook\|polling`; `--overwrite` |
| `harness`      | `<root>`                                   | writes offline update fixtures and a fake transport; `--overwrite`    |
| `upgrade`      | `<root>`                                   | dry-run upgrade report; `--apply` writes the manifest-only migration  |
| `upgrade-plan` | `<root>`                                   | reports Bot API migration actions without writing                     |
| `install`      | none                                       | installs the package into detected hosts                              |

`new --spec -` reads the document from stdin. The document must be valid JSON and
must pass `validateBotSpec`; see [BOT_SPEC.md](BOT_SPEC.md).

`add --feature` accepts the feature enum. `--name` must match
`^[a-z][a-z0-9_]{1,31}$` and must not be reserved (`index`, `main`, `bot`, `config`,
`admin`, `start`, `help`). `miniapps` requires the name `miniapp`.

`upgrade` and `upgrade-plan` differ: `upgrade` checks `.aurifex/manifest.json` and,
with `--apply`, rewrites only the manifest. `upgrade-plan` reads the stack and lists
Bot API 10.4 actions. Neither command rewrites generated source files.

### `install`

| Option      | Values                        | Default                                              |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| `--host`    | `omp`, `dsh`, `claude`, `all` | `all`                                                |
| `--profile` | DSH profile name              | `aurifex`                                            |
| `--scope`   | `user`, `project`             | `user`                                               |
| `--source`  | local path or package spec    | package root when it has `.git`, otherwise `aurifex` |
| `--dry-run` | flag                          | off                                                  |
| `--json`    | flag                          | off                                                  |
| `--yes`     | flag                          | accepted; there is no interactive prompt             |

For a local source, `install` runs `pnpm build` (falling back to `npm run build`)
when `dist/adapters/mcp/server.js` is missing. A host binary that is not on `PATH`
is reported as `skipped`. OMP falls back from `plugin install` to `plugin link`
when the install fails for a local source. `install` prints the exact command for
each host; it does not configure credentials.

## JSON contract

`--json` prints exactly one line containing one `domain-result-1.0.0` object. Keys
are sorted. Human output goes to stdout only on success; errors go to stderr.

Success:

```json
{
  "schemaVersion": "domain-result-1.0.0",
  "status": "ok",
  "value": {},
  "evidence": []
}
```

Failure:

```json
{
  "schemaVersion": "domain-result-1.0.0",
  "status": "error",
  "error": {
    "code": "invalid_request",
    "detail": "spec.name: must match ^[a-z][a-z0-9_]{1,63}$",
    "retryable": false,
    "details": { "path": "spec.name" }
  },
  "evidence": []
}
```

`error.details` is present only when the core provided structured context.
`evidence` entries have `path`, a lowercase SHA-256 `sha256`, and optional
`checkId`. Paths are project-relative; `new` and `add` rebase `files` entries to
`--root`.

Command-specific `value` fields:

| Command        | Fields                                                               |
| -------------- | -------------------------------------------------------------------- |
| `target`       | `schemaVersion`, `stack`, `target`, `botApi`, `warnings`             |
| `new`          | `root`, `stack`, `specHash`, `files`, `manifest`, `nextSteps`        |
| `inspect`      | `stack`, `frameworkVersion?`, `mode`, `botApi`, `rawGap`, `findings` |
| `verify`       | `ok`, `checks`, `summary` (`pass`, `warn`, `fail`)                   |
| `add`          | `root`, `feature`, `files`                                           |
| `deploy`       | `files`, `env`, `setWebhook`, `checklist`                            |
| `harness`      | `files`, `commands`                                                  |
| `upgrade`      | `currentBotApi`, `targetBotApi`, `specVersion`, `actions`, `changed` |
| `upgrade-plan` | `currentBotApi`, `targetBotApi`, `actions`                           |
| `install`      | `hosts`, `packageRoot`, `source`                                     |

`files` entries carry `path`, `bytes`, and `sha256`. `new` rebases paths relative to
`--root`; `add` does the same. `verify.checks` entries carry `id`, `status`
(`pass`, `warn`, `fail`), `detail`, and optional `evidence`.

## Exit codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | success                                                                                       |
| `1`  | domain failure, unexpected error, failed build, or any failed host install                    |
| `2`  | usage error: unknown command, unknown option, missing required option, wrong positional count |

`install` returns `1` when any selected host ends in `failed` and `0` when hosts are
`installed`, `planned`, or `skipped`. If a local build is required and fails, it
prints `build_failed` in JSON mode and returns `1`.

Common error codes: `invalid_request`, `project_unreadable`, `destination_exists`,
`feature_exists`, `unauthorized_path`, `invalid_path`, `not_a_file`,
`not_a_directory`, `file_exists`, `internal_error`, `build_failed`.

Examples:

```text
aurifex target --stack grammy --json
aurifex new bots/demo --spec spec.json
aurifex verify bots/demo
aurifex add bots/demo --feature llm --name chat
aurifex upgrade bots/demo --apply
aurifex install --host all --dry-run
```
