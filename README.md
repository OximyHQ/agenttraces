# AgentTraces

AgentTraces is permissioned memory for coding agents. A local daemon discovers supported session artifacts, scrubs secrets, durably encrypts pending work, and uploads signed idempotent batches to a cloud backend. A CLI and MCP server retrieve the resulting evidence while the coding agent already running under the user's Claude, Codex, Cursor, or Copilot subscription does the reasoning.

The product name and repository are plural: `AgentTraces`, `agenttraces`, and `oximyhq/agenttraces`.

## What works locally

- Seven source adapters: Claude Code, Cursor, Codex, OpenClaw, Conductor, Antigravity, and GitHub Copilot.
- Thirty-one native file/row types across incremental JSONL, full text/JSON/binary files, fold-style streams, and bounded read-only SQLite queries.
- Secret scrubbing before durable enqueue and again before parsing.
- AES-256-GCM local spool encryption, Ed25519 device identity, signed remote ingest, idempotent batches, parser retries, and normalized trace storage.
- Anonymous install and later claim, owner-defined team visibility, permission-filtered search, capability shares, usage rollups, Git evidence, and reusable skills.
- CLI, stdio MCP, HTTP API, continuous daemon, and parser worker entrypoints.
- Ten MCP tools. Share and skill mutations require short-lived, single-use confirmation tokens.
- Safe real-machine verification reads at most two artifacts per installed source, prints no source content, and never advances capture cursors.

The current backend uses SQLite so the complete system can run and be tested on one machine. The storage seam is intentionally isolated for the production Postgres/object-store implementation when Railway deployment is selected. npm publication, Railway, the production domain/region, and final website/dashboard design are deferred by product decision.

## Run

```bash
pnpm install
pnpm verify
pnpm readiness

pnpm agenttraces -- up --history all --json
pnpm agenttraces -- search "earlier cache work" --json
pnpm mcp
```

`agenttraces up` captures new sessions by default and asks for historical intent through `--history all`. Personal traces default to private. Team traces default to private until an owner or admin sets the team policy.

## Repository

```text
apps/cli       command surface and installation workflow
apps/mcp       newline-delimited stdio MCP transport
apps/api       signed ingest and permissioned query HTTP service
apps/daemon    continuous capture, spool, retry, and upload loop
apps/worker    parser/normalization worker entrypoint
apps/web       deferred visual prototype; not part of the CLI/MCP build
packages/core  contracts, adapters, collector, identity, storage, search, permissions
tests          parser, capture, API, CLI, MCP, security, and tenancy tests
scripts        bounded real-machine verification and readiness inventory
```

See [architecture](docs/architecture.md), [test matrix](docs/test-matrix.md), and the original [action plan](docs/action-plan.md).
