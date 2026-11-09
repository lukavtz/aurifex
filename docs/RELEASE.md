# Releasing Aurifex

## CI

`.github/workflows/ci.yml` runs on every push to `main`/`feat/**` and every pull
request:

| Job                               | What it proves                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `verify (ubuntu, macos, windows)` | format, lint, strict types, unit, security, integration, host, site check, secret scan, package dry-run |
| `e2e (generated projects)`        | generated grammY and aiogram projects install, typecheck, test, and build                               |
| `infra`                           | Postgres/Redis queue, payments, broadcast, readiness, backup                                            |
| `docker`                          | generated images build, run non-root, answer `/healthz`                                                 |
| `fuzz`                            | 10,000 fast-check cases for BotSpec and PathPolicy                                                      |
| `load`                            | generated webhook p95 and error-rate thresholds                                                         |
| `package smoke`                   | the packed tarball installs, `aurifex` runs, and `aurifex-mcp` answers over stdio                       |
| `audit`                           | `pnpm audit --prod --audit-level high` and the repository secret scan                                   |
| `workflow lint`                   | `actionlint` over every workflow                                                                        |

`security.yml` adds CodeQL (`javascript-typescript`, `security-and-quality`) on pushes,
pull requests, and a weekly schedule. Dependency review runs on every pull request.

`pages.yml` deploys `site/` to <https://lukavtz.github.io/aurifex/> when site files
change. The workflow requires Pages configured with **Source: GitHub Actions**.

## Release checklist

1. Update `version` in `package.json`.
2. Run `pnpm verify` and `AURIFEX_E2E=1 pnpm test:e2e`.
3. Commit, then tag:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. `.github/workflows/release.yml` verifies, packs, writes `SHA256SUMS`, generates a
   CycloneDX SBOM, signs the tarball keyless with cosign, publishes the checked-in
   example images to GHCR, creates a GitHub Release, and publishes to npm **only when
   `NPM_TOKEN` is configured**.
5. Without `NPM_TOKEN`, the workflow still creates a GitHub Release. Add the secret in
   repository settings before expecting npm publication.
6. `.github/workflows/host-matrix.yml` runs nightly against pinned OMP, DSH, and
   Claude Code versions.

## Release workflow contract

| Job              | Blocking                 | Outputs                                                                                    |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `verify`         | yes                      | tarball, `SHA256SUMS`, `aurifex.sbom.json`, `*.sigstore.json` (best effort) as an artifact |
| `github-release` | yes                      | GitHub Release assets: tarball, `SHA256SUMS`, SBOM, plus the signature bundle when signed  |
| `npm`            | no                       | npm publish only when `NPM_TOKEN` is set                                                   |
| `examples`       | no (`continue-on-error`) | `ghcr.io/lukavtz/aurifex-example-<stack>:<tag>`, or an explicit skip summary               |

`verify` asserts the tarball, `SHA256SUMS`, and the SBOM exist before uploading the
artifact, so a broken pack or SBOM step fails the run instead of shipping a release
without them. `github-release` then creates the release when it is absent and always
runs `gh release upload ... --clobber`, so re-running a release for an existing tag
replaces the assets instead of failing on `already_exists`. Signature assets are
optional: they are uploaded when present and never gate the release.

### cosign signing

`sigstore/cosign-installer@v4.1.3` installs cosign 3.x. Since cosign v3, `sign-blob`
has **no** `--output-signature`/`--output-certificate`; signing is done with
`--bundle <file>.sigstore.json`, and each bundle is verified in the same step with
`verify-blob --certificate-identity-regexp`/`--certificate-oidc-issuer`. Signing is
`continue-on-error`: a failure writes `::error title=cosign signing failed::` and an
UNSIGNED line to the job summary, and the GitHub Release proceeds without signature
assets. Verify a downloaded artifact with:

```sh
cosign verify-blob aurifex-0.2.0.tgz \
  --bundle aurifex-0.2.0.tgz.sigstore.json \
  --certificate-identity-regexp '^https://github.com/lukavtz/aurifex/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### GHCR example images

The `examples` job is optional and non-blocking. Before building, each matrix leg asks
`ghcr.io/token` for a `repository:<owner>/<image>:pull,push` grant with the workflow
token. A grant that includes `push` proceeds; a grant limited to `pull` marks the image
as skipped with a job-summary remediation note; an empty or unparsable grant is treated
as inconclusive and the push is attempted, leaving the registry authoritative. A push
failure marks the job failed (red) without failing the run, and the GitHub Release has
already completed.

**Known external blocker:** `permission_denied: write_package` on
`ghcr.io/lukavtz/aurifex-example-*` is a repository/package setting, not a workflow bug.
The workflow job already requests `packages: write`. Fix it in one of two ways:

1. GitHub → package settings → **Manage Actions access** → add `lukavtz/aurifex` with
   **Write** for each `aurifex-example-*` package (this is the case when a package was
   first published by another repository, so the token is not linked to it).
2. Provide a `GHCR_TOKEN` secret holding a PAT with `write:packages` and pass it to
   `docker/login-action` instead of `secrets.GITHUB_TOKEN`.

Until one of these is done, releases ship successfully with the images skipped and a
warning annotation. Nothing in the workflow reports a skipped image as published.

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
