# AgentTraces CLI

Searchable memory for coding agents.

AgentTraces captures the native sessions already written by Claude Code, Codex,
Cursor, Conductor, GitHub Copilot, OpenClaw, and Antigravity. Sessions stay
private by default and become searchable from your terminal or any MCP-capable
agent.

## Install

Node.js 22.13 or newer is required.

```sh
npx agenttraces up --endpoint https://api.agenttraces.sh
```

This detects supported agents, creates an encrypted local device identity,
installs non-interactive capture, and registers the machine. It captures new
sessions automatically; existing history is not uploaded unless you explicitly
request it.

## Everyday commands

```sh
# Verify local capture
npx agenttraces doctor --json

# Search prior work
npx agenttraces search "authentication regression" --json

# Inspect a complete trace
npx agenttraces show TRACE_ID --view full_transcript --json

# Import historical sessions incrementally and idempotently
npx agenttraces daemon backfill --pages 10000 --limit 1000 --json

# Publish an immutable, revocable overview
npx agenttraces share create TRACE_ID --content overview --json
```

## MCP

Add the following stdio server to Claude Code, Codex, Cursor, or another MCP
client:

```json
{
  "command": "npx",
  "args": ["-y", "agenttraces", "mcp"]
}
```

Agents can search traces, retrieve a bounded transcript, inspect usage and pull
request history, generate a title or summary with the current model
subscription, and publish a trace. Mutations use preview-and-confirm tokens so
the agent can state exactly what will happen before it acts.

## Teams

```sh
npx agenttraces login --email owner@example.com
npx agenttraces team create acme --visibility private --json
npx agenttraces team setup-link create TEAM_ID \
  --domain example.com --max-uses 25 --expires 2026-09-01T00:00:00Z --json
```

Enrollment links can be restricted by email or domain, limited by uses,
expired, and revoked. Owners can register team repositories, inspect devices,
and connect coding sessions to pull requests.

The source, security model, self-hosting architecture, and full documentation
are at [github.com/OximyHQ/agenttraces](https://github.com/OximyHQ/agenttraces).
The hosted product is at [agenttraces.sh](https://agenttraces.sh).
