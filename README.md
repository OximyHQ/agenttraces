# AgentTraces

AgentTraces is searchable, permissioned history for coding agents. It captures native sessions from the tools developers already use, connects them to repositories and pull requests, and makes the resulting evidence available through a CLI, an MCP server, a web dashboard, and immutable share links.

The current coding agent does the reasoning. AgentTraces retrieves the smallest authorized slice of earlier work and preserves its provenance.

## Start locally

```bash
npx agenttraces up
```

Or give this to a coding agent:

> Install AgentTraces for this machine, run its doctor checks, and tell me exactly what will be captured before enabling it.

Capture starts with an anonymous device identity. Personal traces are private by default, the pending local spool is encrypted, and the device can be claimed later without changing its trace IDs.

Shared trace links use `/t/<readable-title>/<opaque-token>` so the work is recognizable when the link travels. The title slug is presentation only; the revocable token remains the permission capability.

```bash
agenttraces doctor --json
agenttraces search "the queue timeout investigation" --json
agenttraces show TRACE_ID --view full_transcript --json
```

## What is included

- Native collectors for Claude Code, Codex, Cursor, OpenClaw, Conductor, Antigravity, and GitHub Copilot.
- Incremental JSONL, bounded SQLite, text, JSON, and binary artifact readers.
- Secret scrubbing, AES-256-GCM spool encryption, Ed25519 device identity, signed ingest, and idempotent batches.
- Permission-first local and PostgreSQL search with bounded snippets and trace provenance.
- Twelve local MCP tools for search, retrieval, PR history, usage, lazy subscription-powered enrichment, sharing, and reusable skills.
- Team setup links with email/domain constraints, expiry, usage limits, revocation, registered devices, and owner-defined policy.
- Many-to-many trace, commit, repository, and pull-request linkage with visible evidence and confidence.
- Immutable public shares by default, with overview, conversation, highlights, and full-trace views.
- A Better Auth web sign-in surface, team dashboard, semantic trace viewer, pull-request history, documentation, and public trace pages.
- PostgreSQL, Redis/BullMQ, and S3-compatible cloud services for normalized storage and durable native batches.

## Repository map

```text
apps/cli       npm command, installation, team, trace, PR, and share workflows
apps/mcp       newline-delimited stdio MCP transport
apps/api       cloud HTTP and remote MCP service
apps/daemon    continuous local capture, retry, and upload loop
apps/worker    queued native-batch parser
apps/web       Next/Vinext website, docs, Better Auth, dashboard, and public shares
packages/core  contracts, parsers, collector, encrypted local store, search, and permissions
packages/cloud PostgreSQL schema, Redis queue, object storage, cloud authorization, and APIs
tests          parser, collector, store, CLI, MCP, cloud routing, tenancy, and entrypoint tests
```

The terminology and invariants are in [CONTEXT.md](CONTEXT.md). Architecture decisions are recorded under [docs/adr](docs/adr), with the broader [architecture](docs/architecture.md), [search design](docs/search-design.md), and [test matrix](docs/test-matrix.md) alongside them. The interface contract is [DESIGN.md](DESIGN.md); [design references](docs/design-references.md) record how givemeanode.com and the supplied traces.com examples informed the work without copying either product.

## Develop

Requirements: Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm verify
pnpm readiness
```

The web app is intentionally a standalone npm workspace:

```bash
cd apps/web
npm install
npm run db:local
npm test
```

For sign-in, configure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; GitHub OAuth additionally needs `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The dashboard reads `AGENTTRACES_API_URL` and a server-side `AGENTTRACES_API_TOKEN`. Without them, operational pages show clearly labeled preview data.

The cloud API needs PostgreSQL, Redis, and S3-compatible credentials described in [docs/architecture.md](docs/architecture.md). Deployment-specific resource creation and secrets stay outside this repository.

## Security and privacy

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Share and reusable-skill mutations require explicit confirmation in MCP. External shares are point-in-time snapshots unless `live` is deliberately enabled. Cost is always labeled as exact, estimated, subscription-included, or unavailable; missing price data is never represented as zero.

## Contributing

AgentTraces is licensed under [Apache License 2.0](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
