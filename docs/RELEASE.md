# Releasing Aurifex

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

| Job                               | What it proves                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `verify (ubuntu, macos, windows)` | format, lint, strict types, unit, security, fuzz, integration, host, skill structure, site truth, secret scan, package dry-run |
| `package smoke`                   | the packed tarball installs, `aurifex` runs four commands, and `aurifex-mcp` answers three tools over stdio                    |
| `audit`                           | `pnpm audit --prod --audit-level high` and the repository secret scan                                                          |
| `workflow lint`                   | `actionlint` over every workflow                                                                                               |

`security.yml` adds CodeQL (`javascript-typescript`, `security-and-quality`) on pushes,
pull requests, and a weekly schedule. Dependency review runs on pull requests and stays
advisory, including high-severity runtime findings. The CI audit job gates runtime
high-severity vulnerabilities with `pnpm audit --prod --audit-level high`.
`pages.yml` deploys `site/` to <https://lukavtz.github.io/aurifex/> when site files
change. Pages must be configured with **Source: GitHub Actions**.

`host-matrix.yml` runs nightly against pinned OMP, DSH, and Claude Code versions, using
isolated profiles. It asserts three tools and four commands, not the previous nine-tool
surface.

## Release checklist

1. Update `version` in `package.json` (current target: `0.3.0`).
2. Run the full matrix from [TEST_PLAN.md](TEST_PLAN.md): `pnpm verify`, both reference
   project suites, both `verify --json` runs, `--help`, and the MCP stdio smoke.
3. Confirm `node scripts/check-skills.mjs` prints `ok · 15 skills` and
   `node scripts/check-site.mjs` prints the three locales with
   checks 29 / tools 3 / commands 4.
4. Commit, then tag:
   ```sh
   git tag v0.3.0
   git push origin v0.3.0
   ```
5. `.github/workflows/release.yml` checks that the requested tag matches `package.json`,
   verifies, packs, writes `SHA256SUMS`, and generates a CycloneDX SBOM. It attempts
   keyless cosign signing; signing failure does not block the release. It creates a
   GitHub Release and publishes to npm **only when `NPM_TOKEN` is configured**.
6. Without `NPM_TOKEN`, the workflow still creates a GitHub Release. Add the secret in
   repository settings before expecting npm publication.

## Release workflow contract

| Job              | Blocking                 | Outputs                                                                                    |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `verify`         | yes                      | tarball, `SHA256SUMS`, `aurifex.sbom.json`, `*.sigstore.json` (best effort) as an artifact |
| `github-release` | yes                      | GitHub Release assets: tarball, `SHA256SUMS`, SBOM, plus the signature bundle when signed  |
| `npm`            | no                       | npm publish only when `NPM_TOKEN` is set                                                   |
| cosign signing   | no (`continue-on-error`) | signature bundle when signing succeeds                                                     |

`verify` asserts the tarball, `SHA256SUMS`, and the SBOM exist before uploading the
artifact, so a broken pack or SBOM step fails the run instead of shipping a release
without them. `github-release` creates the release when it is absent and always runs
`gh release upload ... --clobber`, so re-running a release for an existing tag replaces
the assets instead of failing on `already_exists`. Signature assets are optional: they
are uploaded when present and never gate the release.

The release workflow also checks the CLI surface: `--help` lists exactly `target`,
`inspect`, `verify`, and `install`. Any extra or missing command fails the job.

### cosign signing

`sigstore/cosign-installer@v4.1.3` installs cosign 3.x. Since cosign v3, `sign-blob`
has **no** `--output-signature`/`--output-certificate`; signing is done with
`--bundle <file>.sigstore.json`, and each bundle is verified in the same step with
`verify-blob --certificate-identity-regexp`/`--certificate-oidc-issuer`. Signing is
`continue-on-error`: a failure writes `::error title=cosign signing failed::` and an
UNSIGNED line to the job summary, and the GitHub Release proceeds without signature
assets. Verify a downloaded artifact with:

```sh
cosign verify-blob aurifex-0.3.0.tgz \
  --bundle aurifex-0.3.0.tgz.sigstore.json \
  --certificate-identity-regexp '^https://github.com/lukavtz/aurifex/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Reference projects in the release

The reference projects are proven before tagging, not published as images. They are
evidence for the release notes:

```sh
(cd examples/grammy_commands && bun install --frozen-lockfile && bun run typecheck && bun test)
(cd examples/aiogram_commands && uv sync --frozen && uv run pytest -q)
node dist/cli.js verify examples/grammy_commands --json
node dist/cli.js verify examples/aiogram_commands --json
```

Attach the actual output to the release notes. Do not claim a reference project passes
without the current candidate's output.

## Secrets

| Secret      | Used by                                   | Required |
| ----------- | ----------------------------------------- | -------- |
| `NPM_TOKEN` | `release.yml` npm publish with provenance | optional |

There is no live Telegram suite in `0.3.0`, so no Telegram token or chat id is a release
secret. Any test token used manually stays in a local environment and is never committed.

## Pages

Pages is enabled with `build_type=workflow`. The deploy job needs `pages: write` and
`id-token: write`; the site check runs before upload. The site is static, relative-path
safe, and has no build step. It describes knowledge and verification, not generation;
`data-truth` markers must stay at checks 29, tools 3, commands 4.
