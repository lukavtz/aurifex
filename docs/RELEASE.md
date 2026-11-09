# Releasing Aurifex

## CI

`.github/workflows/ci.yml` runs on every push to `main`/`feat/**` and every pull
request:

| Job                               | What it proves                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `verify (ubuntu, macos, windows)` | format, lint, strict types, 118 unit, 11 security, 60 integration, 9 host, site check, secret scan, package dry-run |
| `e2e (generated projects)`        | generated grammY and aiogram projects install, typecheck, test, and build                                           |
| `package smoke`                   | the packed tarball installs, `aurifex` runs, and `aurifex-mcp` answers over stdio                                   |
| `audit`                           | `pnpm audit --prod --audit-level high` and the repository secret scan                                               |
| `workflow lint`                   | `actionlint` over every workflow                                                                                    |

`security.yml` adds CodeQL (`javascript-typescript`, `security-and-quality`) on pushes,
pull requests, and a weekly schedule, plus dependency review on pull requests.

`pages.yml` deploys `site/` to <https://lukavtz.github.io/aurifex/> when site files
change. The workflow requires Pages configured with **Source: GitHub Actions**.

## Release checklist

1. Update `version` in `package.json`.
2. Run `pnpm verify` and `AURIFEX_E2E=1 pnpm test:e2e`.
3. Commit, then tag:
   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```
4. `.github/workflows/release.yml` verifies, packs, writes `SHA256SUMS`, creates a
   GitHub Release, and publishes to npm **only when `NPM_TOKEN` is configured**.
5. Without `NPM_TOKEN`, the workflow still creates a GitHub Release with the tarball and
   checksums. Add the secret in repository settings before expecting npm publication.

## Secrets

| Secret                    | Used by                                   | Required           |
| ------------------------- | ----------------------------------------- | ------------------ |
| `NPM_TOKEN`               | `release.yml` npm publish with provenance | optional           |
| `TELEGRAM_TEST_BOT_TOKEN` | `live-e2e.yml`                            | only for live runs |
| `TELEGRAM_TEST_CHAT_ID`   | `live-e2e.yml`                            | only for live runs |

Live E2E is `workflow_dispatch` only and fails before tests if either Telegram secret is
missing. Use a dedicated test bot and chat; never a production token.

## Pages

Pages is enabled with `build_type=workflow`. The deploy job needs `pages: write` and
`id-token: write`; the site check runs before upload. The site is static, relative-path
safe, and has no build step.
