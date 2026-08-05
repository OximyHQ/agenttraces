# Architecture

## Runtime surfaces

```text
Claude / Cursor / Codex / OpenClaw / Conductor / Antigravity / Copilot
                              |
                    source definitions + parsers
                              |
                   bounded local collector
                              |
             redaction -> encrypted SQLite spool
                              |
                 Ed25519 signed ingest batch
                              |
                 HTTP API -> parser worker
                              |
            native durable evidence + normalized traces
                  |              |              |
                 CLI            MCP        future web UI
                                  |
                     user's existing agent subscription
```

The local store is a single-node implementation of the production seams. It is not a claim that SQLite is the eventual multi-tenant cloud database. `AgentTracesStore`, `LocalCollector`, `ParserRegistry`, and `AgentTracesMcp` keep capture, parsing, authorization, and retrieval behind narrow interfaces so PostgreSQL, object storage, and a durable queue can replace local persistence without changing adapters or tool contracts.

## Trust boundaries

- Source files and databases are read-only. Symlinks and paths outside the selected user home are refused.
- First setup establishes a high-water mark; history is read only with explicit `--history all`.
- JSONL uses byte cursors and retains partial lines. SQLite uses bounded queries and source-specific high-water marks.
- The spool is AES-256-GCM encrypted. Device private keys and encryption keys are mode `0600`.
- Upload batches carry a stable ID, device ID, and Ed25519 signature. Registration binds a device ID to one public key.
- Personal traces are private. Team default visibility is owner/admin controlled and begins private.
- Search filters authorization before returning trace objects. Inaccessible trace IDs use the same not-found response.
- HTTP query and worker routes fail closed unless their deployment tokens are configured; health returns no installation or tenant identifiers.
- Direct links are revocable capabilities with expiry/view limits. Their allowed trace view is enforced server-side.
- MCP mutations are prepared first. Confirmation consumes an exact, expiring, single-use preview token.
- The MCP supplies deterministic evidence; it performs no hosted reasoning and therefore uses the subscription of the calling coding agent.

## Identity and claim

Installation generates an anonymous principal, personal namespace, device record, and Ed25519 keypair. Claim proves possession of that key and updates the existing principal/device transactionally, preserving trace and namespace IDs. A team namespace is separately owned; choosing it changes the destination for future capture without copying prior personal traces.

## Production replacement points

Railway deployment should split the current API, worker, and daemon surfaces. PostgreSQL owns normalized identity/trace/access data, object storage owns compressed native artifacts, and a durable queue owns parser jobs. Device-signature verification, native-envelope versioning, parser replay, authorization, and MCP contracts stay unchanged. The final provider, region, domain, secrets manager, backups, retention scheduler, OAuth callback, and GitHub App values remain explicit deployment inputs.
