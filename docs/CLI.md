# CLI

Binary: `aurifex` (`dist/cli.js`). The usage string and option table live in
[`src/cli.ts`](../src/cli.ts).

```text
aurifex <command> [arguments] [options]
```

Global options:

| Option         | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `--root <dir>` | workspace root, resolved against the current directory; default `.` |
| `--json`       | print one machine-readable result instead of the text summary       |

`--root` bounds every project path. `inspect` and `verify` resolve their positional path
against it, then `realpath` it, so symlinks cannot escape the root. There are four
commands and no write operation over bot projects.

## Commands

| Command   | Arguments and required options | Effect                                                      |
| --------- | ------------------------------ | ----------------------------------------------------------- |
| `target`  | `--stack grammy\|aiogram`      | resolves framework, runtime, Bot API, and warnings          |
| `inspect` | `<project>`                    | reports stack, mode, Bot API gap, and findings              |
| `verify`  | `<project>`                    | runs the 29 checks; any `fail` makes the result `ok: false` |
| `install` | none                           | installs the plugin into detected hosts                     |

### `target`

```text
aurifex target --stack grammy
```

Returns the pinned target record: framework version, runtime constraint,
`supportedBotApi`, `testedBotApi`, supported features, and warnings. The stack enum is
exactly `grammy` and `aiogram`; anything else is a usage error.

### `inspect`

```text
aurifex inspect examples/grammy_commands --json
```

Read-only. Detects the stack from `package.json` or `pyproject.toml`, the framework
version when declared, the delivery mode (`webhook`, `polling`, or `unknown`), the Bot
API gap (`botApi: "10.4"`, `rawGap: "10.3"`), and findings with `id`, `status`,
`detail`, and optional `evidence.path`. Missing files produce `unknown` plus findings,
not an error.

### `verify`

```text
aurifex verify examples/aiogram_commands
aurifex verify examples/aiogram_commands --json
```

Runs the 29 static file-content checks over a bounded snapshot (64 MiB total, 1 MiB per
file). It does not execute project code, use the network, or call Telegram. Output:

| Field     | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `ok`      | `true` only when no check is `fail`                                  |
| `checks`  | `id`, `status` (`pass`/`warn`/`fail`), `detail`, optional `evidence` |
| `summary` | counts of `pass`, `warn`, `fail`                                     |

Human output is one line: `ok: <pass> pass, <warn> warn, <fail> fail` when `ok` is true,
and the same counts prefixed `failed:` otherwise. A failed check does not turn the
command into a domain error: the operation succeeded and the verdict is in `ok` and
`summary.fail`. Exit code is `1` only when the operation itself fails — for example an
unreadable project. CI should gate on `ok` from `--json`:

```sh
aurifex verify . --json | jq -e '.value.ok'
```

### `install`

| Option      | Values                        | Default                                              |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| `--host`    | `omp`, `dsh`, `claude`, `all` | `all`                                                |
| `--profile` | DSH profile name              | `aurifex`                                            |
| `--scope`   | `user`, `project`             | `user`                                               |
| `--source`  | local path or package spec    | package root when it has `.git`, otherwise `aurifex` |
| `--dry-run` | flag                          | off                                                  |
| `--json`    | flag                          | off                                                  |
| `--yes`     | flag                          | accepted; skips the interactive prompt               |

`install` detects installed hosts, prints the exact command per host, and runs it. A host
binary that is not on `PATH` is reported as `skipped`. A local source runs `pnpm build`
(falling back to `npm run build`) when `dist/adapters/mcp/server.js` is missing. OMP
falls back from `plugin install` to `plugin link` for a local source. For a local
source, a path that is not an Aurifex checkout returns `invalid install source: …`; an
unsupported spec returns `unsupported install source: …`. `install` does not configure
credentials.

## JSON contract

`--json` prints exactly one line containing one `domain-result-1.0.0` object. Keys are
sorted. Human output goes to stdout only on success; errors go to stderr.

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
    "code": "project_unreadable",
    "detail": "project directory not found",
    "retryable": false
  },
  "evidence": []
}
```

`error.details` is present only when the core provided structured context. `evidence`
entries have `path`, a lowercase SHA-256 `sha256`, and optional `checkId`.

Command-specific `value` fields:

| Command   | Fields                                                               |
| --------- | -------------------------------------------------------------------- |
| `target`  | `schemaVersion`, `stack`, `target`, `botApi`, `warnings`             |
| `inspect` | `stack`, `frameworkVersion?`, `mode`, `botApi`, `rawGap`, `findings` |
| `verify`  | `ok`, `checks`, `summary` (`pass`, `warn`, `fail`)                   |
| `install` | `hosts`, `packageRoot`, `source`                                     |

## Exit codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | success                                                                                       |
| `1`  | domain failure: unreadable project, unauthorized path, failed build, or a failed host install |
| `2`  | usage error: unknown command, unknown option, missing required option, wrong positional count |

`install` returns `1` when any selected host ends in `failed` and `0` when hosts are
`installed`, `planned`, or `skipped`. If a local build is required and fails, it prints
`build_failed` in JSON mode and returns `1`.

Common error codes: `invalid_request`, `target_unsupported`, `project_unreadable`,
`unauthorized_path`, `invalid_path`, `not_a_directory`, `file_too_large`,
`output_too_large`, `verification_failed`, `build_failed`, `internal_error`.

## Examples

```text
aurifex target --stack grammy --json
aurifex inspect examples/grammy_commands
aurifex verify examples/grammy_commands --json
aurifex install --host all --dry-run
aurifex install --host omp --scope project --yes
```
