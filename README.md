# AgentTraces

Searchable memory for coding agents.

AgentTraces captures the native sessions already written by Claude Code, Codex,
Cursor, Conductor, GitHub Copilot, OpenClaw, and Antigravity. It turns them into
private, permissioned traces that you can search from your terminal, retrieve
from any MCP-compatible agent, connect to pull requests, or share with a link.

Your current coding agent does the reasoning. AgentTraces supplies the smallest
authorized slice of earlier work, with the original source and provenance.

## Start in two minutes

Requires Node.js 22.13 or newer.

```bash
npx agenttraces up --endpoint https://api.agenttraces.sh
```

That command:

1. detects supported coding agents on the machine;
2. creates a local encrypted device identity;
3. installs non-interactive capture hooks;
4. begins capturing new sessions; and
5. registers the device with AgentTraces Cloud.

Nothing is public by default. Existing history is not uploaded unless you add
`--history all`.

Give an agent this prompt if you prefer:

> Set up AgentTraces for this machine using the production endpoint, run its
> doctor checks, explain what sources were detected, and verify that the MCP
> server is available. Do not ask me questions unless setup fails.

## Use it

```bash
# See capture health and detected sources
npx agenttraces doctor --json

# Search earlier work
npx agenttraces search "the queue timeout investigation" --json

# Inspect one trace
npx agenttraces show TRACE_ID --view full_transcript --json

# Import existing sessions, safely and incrementally
npx agenttraces daemon backfill --pages 10000 --limit 1000 --json

# Publish an immutable overview and receive a revocable link
npx agenttraces share create TRACE_ID --content overview --json
```

AgentTraces also exposes MCP tools for search, retrieval, pull-request history,
usage, title and summary enrichment, sharing, and reusable skills. Once the CLI
has been set up, use this server command in Claude Code, Codex, Cursor, or any
other MCP client:

```json
{
  "command": "npx",
  "args": ["-y", "agenttraces", "mcp"]
}
```

Then an agent can handle requests such as:

- “Find the earlier session where we fixed the queue timeout.”
- “Show me every trace connected to PR 42.”
- “Summarize this session using my current model subscription.”
- “Publish this trace as an immutable overview and give me the link.”

Sharing through MCP uses a preview followed by a single-use confirmation token,
so an agent can explain exactly what will become accessible before it publishes.

## Teams

An owner creates a team and an enrollment link. The link can be restricted by
email or domain, limited by uses, expired, and revoked.

```bash
npx agenttraces login --email owner@example.com --name "Owner"
npx agenttraces team create acme --visibility private --json
npx agenttraces team setup-link create TEAM_ID \
  --domain example.com \
  --max-uses 50 \
  --expires 2026-09-01T00:00:00Z \
  --json
```

A teammate joins without a separate installer:

```bash
npx agenttraces up \
  --endpoint https://api.agenttraces.sh \
  --team-token SETUP_TOKEN \
  --email teammate@example.com
```

Owners and admins can see registered devices, set the team’s default visibility,
register owned repositories, and inspect the traces and usage connected to pull
requests. Developers may still pause capture, exclude a repository, or choose a
stricter personal default.

## How capture works

```text
native agent artifacts
        │  read-only, incremental parsers
        ▼
encrypted local spool
        │  redacted + Ed25519 signed batches
        ▼
cloud object storage ──► parser worker
                              │
                              ▼
                    PostgreSQL trace index
                       │       │       │
                      CLI     MCP     web
```

- Source files and SQLite databases are never modified.
- JSONL readers use byte cursors and preserve partial lines.
- SQLite readers use bounded, source-specific high-water marks.
- Secrets are scrubbed before an AES-256-GCM encrypted spool is written.
- Upload cursors advance only after durable cloud acknowledgement.
- Re-running backfill is idempotent; stable event IDs prevent duplicates.
- Cloud search applies authorization before returning snippets or trace metadata.
- Public shares are point-in-time snapshots unless `live` is explicitly selected.

See [architecture](docs/architecture.md), [search design](docs/search-design.md),
and the [security policy](SECURITY.md) for the full trust model.

## Supported sources

| Source | Native formats | Capture |
| --- | --- | --- |
| Claude Code | JSONL | incremental |
| OpenAI Codex | JSONL | incremental |
| Cursor | SQLite, JSON, text | bounded |
| Conductor | SQLite, JSONL | bounded + incremental |
| GitHub Copilot | JSON, JSONL, SQLite | bounded + incremental |
| OpenClaw | JSON, JSONL, SQLite | bounded + incremental |
| Antigravity | JSON, JSONL, SQLite, binary metadata | bounded + incremental |

The parser inventory is executable. Run `pnpm verify:machine` to test it against
the artifacts present on the current machine without changing those artifacts.

## Web surfaces

- `/` — product website and installation path
- `/docs` — documentation home
- `/docs/quickstart` — CLI and MCP setup
- `/sign-in` — Better Auth email/password and optional GitHub OAuth
- `/dashboard` — personal trace history and usage
- `/dashboard/team` — team policy, devices, and enrollment
- `/dashboard/pull-requests` — PR-to-trace history
- `/t/<title>/<opaque-token>` — revocable public trace snapshot

The readable title in a public URL is presentation only. The opaque token is the
permission capability.

## Repository map

AgentTraces is intentionally one public monorepo:

```text
apps/cli       npm command and user workflows
apps/mcp       stdio MCP entrypoint
apps/daemon    continuous local capture and retry loop
apps/api       cloud HTTP API and remote MCP endpoint
apps/worker    queued native-batch parser
apps/web       website, docs, auth, dashboard, and public traces
packages/core  contracts, parsers, collector, local store, search, and permissions
packages/cloud PostgreSQL, Redis/BullMQ, object storage, tenancy, and cloud APIs
tests          parser, security, CLI, MCP, cloud, tenancy, and entrypoint tests
```

Production credentials, DNS ownership, backups, and incident procedures belong
in the deployment control plane, not in a second copy of the application source.
A private operations repository is only necessary when private infrastructure or
commercial services are added; the platform itself remains buildable here.

## Develop

```bash
git clone https://github.com/OximyHQ/agenttraces.git
cd agenttraces
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm readiness
```

Run services locally:

```bash
pnpm api
pnpm worker
pnpm agenttraces doctor --json
pnpm mcp
```

Run the web app:

```bash
cd apps/web
npm ci
DATABASE_URL=postgres://... BETTER_AUTH_SECRET=... npm run dev
```

Cloud environment variables and service boundaries are documented in
[docs/architecture.md](docs/architecture.md). The release test matrix is in
[docs/test-matrix.md](docs/test-matrix.md), and architectural decisions live in
[docs/adr](docs/adr).

## Contributing

AgentTraces is Apache-2.0 licensed. See [CONTRIBUTING.md](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).
