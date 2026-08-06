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
         cloud HTTP API -> object storage -> parser worker
                              |
        PostgreSQL identity, traces, links, shares, search
                  |              |              |
                 CLI            MCP          web + docs
                                  |
                     user's existing agent subscription
```

`AgentTracesStore` is the encrypted local implementation. `CloudRuntime` mirrors the important tenancy, search, team, repository, PR, enrichment, and snapshot-share semantics in PostgreSQL. Compressed native batches are durably written to S3-compatible storage before BullMQ schedules parsing.

## Trust boundaries

- Source files and databases are read-only. Symlinks and paths outside the selected user home are refused.
- First setup establishes a high-water mark; history is read only with explicit `--history all`.
- JSONL uses byte cursors and retains partial lines. SQLite uses bounded queries and source-specific high-water marks.
- The spool is AES-256-GCM encrypted. Device private keys and encryption keys are mode `0600`.
- Upload batches carry a stable ID, device ID, and Ed25519 signature. Registration binds a device ID to one public key.
- Personal traces are private. Team default visibility is owner/admin controlled and begins private.
- Search filters authorization before returning trace objects. Inaccessible trace IDs use the same not-found response.
- HTTP query and worker routes fail closed unless their deployment tokens are configured; health returns no installation or tenant identifiers.
- Direct links are revocable capabilities with expiry/view limits. External shares are immutable snapshots by default; live shares require an explicit flag.
- Setup-link and share tokens are stored as hashes. Setup links support email/domain binding, expiry, maximum uses, and revocation.
- Owners and admins gain access to private team traces only for repositories explicitly registered as team-owned.
- Pull-request links retain evidence, confidence, and manual confirmation instead of collapsing attribution into a scalar.
- MCP mutations are prepared first. Confirmation consumes an exact, expiring, single-use preview token.
- The MCP supplies deterministic evidence; it performs no hosted reasoning and therefore uses the subscription of the calling coding agent.

## Identity and claim

Installation generates an anonymous principal, personal namespace, device record, and Ed25519 keypair. Claim proves possession of that key and updates the existing identity/device transactionally, preserving device, trace, and namespace IDs. If the email already owns another claimed device or web session, the anonymous identity is merged into that account, including memberships and ownership, so all of the person's devices appear together. A team namespace is separately owned; choosing it changes the destination for future capture without copying prior personal traces.

## Web identity

The web app uses Better Auth with PostgreSQL, GitHub OAuth when configured, and email/password as a baseline. CLI devices continue to use independent signed device identities and scoped access tokens. The authenticated web user is mapped to its cloud principal at the BFF boundary; service credentials are server-only and never exposed to the browser.

## Deployment inputs

Deploy the API, worker, and web independently. PostgreSQL owns normalized identity, auth, trace, and access data; object storage owns compressed native artifacts; and Redis/BullMQ owns parser jobs. The web app needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AGENTTRACES_API_URL`, and the same `AGENTTRACES_WEB_AUTH_SECRET` configured on the API. GitHub OAuth additionally needs `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Provider, region, domain, backups, retention jobs, callback URLs, and the GitHub App installation remain explicit operator inputs.
