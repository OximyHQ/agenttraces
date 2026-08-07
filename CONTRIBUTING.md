# Contributing to AgentTraces

AgentTraces welcomes fixes, collector adapters, parser fixtures, documentation, and focused product improvements.

## Development

Requirements: Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm verify
pnpm --dir apps/web test
```

Keep native fixture data synthetic and scrubbed. A collector change should include a parser fixture, an incremental-capture test where applicable, and a note documenting the local artifacts it reads.

## Pull requests

- Explain the user-visible result and security/privacy implications.
- Keep unrelated formatting or generated output out of the diff.
- Add or update tests for changed behavior.
- Run `pnpm verify` and the web tests before requesting review.
- Do not include secrets, real coding transcripts, or customer repository data.

By contributing, you agree that your contribution is licensed under Apache-2.0.
