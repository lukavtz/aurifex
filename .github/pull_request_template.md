## Summary

<!-- What changes, and why. Link the issue. -->

Closes #

## Type

- [ ] Core behavior (`src/core`)
- [ ] Template or generated project
- [ ] Host adapter (OMP, DSH, MCP)
- [ ] CLI
- [ ] Skills, agents, commands, prompts, rules
- [ ] CI, packaging, docs

## Verification

<!-- Paste exact commands and their result. Untested claims are rejected. -->

- [ ] `pnpm verify` passes
- [ ] `pnpm build` passes
- [ ] Generated projects still pass their own suites (`AURIFEX_E2E=1 pnpm test:e2e`)
- [ ] New behavior has a failing-first test, or the reason it cannot is stated

```
# commands and output
```

## Security

- [ ] No token, webhook secret, API key, or private chat ID is added, logged, or committed
- [ ] Every filesystem path still resolves through `PathPolicy`
- [ ] Webhook handling keeps the secret token and constant-time comparison
- [ ] New dependencies are pinned to exact versions and pass `pnpm audit --prod`
- [ ] Bot API 10.4 gaps are handled by the raw adapter, not claimed as native framework support
