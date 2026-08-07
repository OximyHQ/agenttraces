# AgentTraces action plan

Status: implemented baseline; retained as the original planning record

The current contracts and shipped-vs-operator boundary are authoritative in
`CONTEXT.md`, `docs/architecture.md`, the ADRs, and `pnpm readiness`. Later
decisions added email/password as a baseline beside GitHub OAuth, immutable
external shares, all seven current local parsers, and the Better Auth web BFF.

## 1. Product direction

AgentTraces is a cloud-first trace system for coding agents. It captures sessions from supported agents, uploads them to AgentTraces Cloud, normalizes them into a common model, and makes them searchable from the CLI, web application, and MCP.

Core defaults:

- New sessions are captured and uploaded automatically after setup.
- Personal traces are private in the cloud by default.
- A team enrollment routes traces to the team's cloud workspace by default.
- The organization owner defines the default visibility of team traces. Individual developers can always make their own capture or visibility stricter.
- Installation can begin anonymously. The device and its traces can be claimed later.
- The local machine keeps a durable upload spool, capture cursor state, and a small cache. The cloud is the canonical product store after an upload is acknowledged.
- Secret scrubbing happens before upload. Cloud parsing and scrubbing provide a second layer.
- Public or direct-link sharing is always explicit.
- AgentTraces retrieval does not require an AgentTraces-hosted language model. The user's active coding agent calls MCP tools and reasons over the returned evidence using the user's existing subscription.

## 2. First complete user journeys

### Personal installation

```text
npx agenttraces up
  -> explain cloud capture and privacy default
  -> detect supported agents
  -> create an anonymous cloud principal and device key
  -> install capture hooks/watchers
  -> configure AgentTraces MCP and skill
  -> start the local daemon
  -> upload new traces as private
  -> offer historical import
```

The user can use the product before authentication. `agenttraces login` proves control of the device and atomically attaches its anonymous principal, traces, and configuration to the authenticated account.

### Team installation

```text
npx agenttraces up --team-enrollment <signed-token>
  -> validate the enrollment token
  -> create a pending team member/device identity
  -> apply the team's capture and visibility policy
  -> route captured traces to the team workspace
  -> let the human claim the pending identity later
```

The enrollment token must be scoped, expiring, revocable, and optionally bound to an email or domain. It must never contain a reusable organization credential.

### Query from an agent

```text
User asks Codex/Claude/Cursor about earlier work
  -> subscribed host model calls AgentTraces MCP
  -> MCP authenticates to AgentTraces Cloud
  -> cloud search returns compact, permission-filtered evidence
  -> subscribed host model synthesizes the answer
```

### Web experience

The web application is used to browse traces, manage identity, teams, privacy, sharing, GitHub connections, deletion, export, and audit history. It is not required for routine MCP retrieval.

## 3. System shape

```text
Agent artifacts/hooks
        |
        v
Agent adapters -> local daemon -> encrypted ingest -> queue -> parser workers
                       |                                |
                       v                                v
                  spool/cache                    raw object storage
                                                        |
                                                        v
                                               normalized Postgres
                                                        |
                              +-------------------------+-------------------+
                              |                         |                   |
                              v                         v                   v
                         Cloud MCP                  Web app            GitHub worker
                              |
                              v
                    User's existing agent model
```

## 4. Repository layout

Use a standalone TypeScript monorepo. Oximy's collector is implementation reference material, not a runtime dependency.

```text
apps/
  api/                 Fastify HTTP ingest, query, identity, and team endpoints
  worker/              parsing, indexing, GitHub linking, and retention jobs
  web/                 Next.js application
  cli/                 agenttraces commands
  daemon/              local capture, spool, and upload process
  mcp/                 local stdio and remote Streamable HTTP entrypoints

packages/
  contracts/           versioned wire schemas and generated clients
  domain/              trace, identity, team, permission, and usage rules
  agent-adapters/      shared adapter interface and registry
  adapter-claude/      Claude Code implementation
  adapter-codex/       Codex implementation
  adapter-cursor/      Cursor implementation
  collector/           cursor state, watch loop, batching, and redaction
  parsers/             source parser registry and normalized event production
  storage-local/       SQLite spool/cache implementation
  storage-cloud/       Postgres and object-storage implementations
  search/              filter, full-text, ranking, and evidence shaping
  auth/                device keys, anonymous claim, user sessions, and OAuth
  observability/       structured logs, metrics, traces, and error contracts
```

Initial tooling:

- Node.js 22, TypeScript, pnpm workspaces, Turborepo
- Fastify API
- Next.js web application
- PostgreSQL with `tsvector`, `pg_trgm`, and optionally `pgvector`
- Redis and BullMQ for durable asynchronous work
- S3-compatible object storage for compressed native artifacts
- Zod or JSON Schema contracts shared by CLI, API, worker, and MCP
- Vitest for module tests; Playwright for installation/web flows

## 5. Deep module seams

### Agent adapter

The rest of the product should only know this conceptual interface:

```ts
interface AgentAdapter {
  detect(): Promise<DetectionResult>;
  discover(request: DiscoveryRequest): AsyncIterable<NativeTraceRef>;
  read(ref: NativeTraceRef, cursor?: CaptureCursor): AsyncIterable<NativeRecord>;
  install(request: InstallRequest): Promise<InstallReceipt>;
  remove(receipt: InstallReceipt): Promise<RemoveResult>;
  diagnose(): Promise<DiagnosticResult>;
}
```

The implementation hides storage paths, SQLite schemas, hook formats, configuration locations, session matching, and host version differences.

### Collector

```ts
interface Collector {
  scan(request: ScanRequest): Promise<ScanResult>;
  watch(signal: AbortSignal): AsyncIterable<CapturedBatch>;
}
```

It owns incremental byte offsets, SQLite cursors, file replacement/truncation, partial records, first-run boundaries, batching, local redaction, retry state, and idempotency inputs.

### Ingest

```ts
interface IngestTraceBatch {
  accept(batch: SignedTraceBatch): Promise<IngestReceipt>;
}
```

Acknowledgement means the encrypted native batch is durably stored or durably queued. Duplicate batch IDs return the original receipt.

### Parser registry

```ts
interface TraceParser {
  supports(source: AgentSource, schemaHint?: string): boolean;
  parse(input: NativeArtifact, context: ParseContext): ParseResult;
}
```

Parsers are versioned and replayable. A parser upgrade can rebuild normalized records from retained native artifacts.

### Search

```ts
interface TraceSearch {
  search(actor: Actor, request: SearchRequest): Promise<SearchPage>;
  get(actor: Actor, request: GetTraceRequest): Promise<TraceView>;
}
```

Authorization, tenant isolation, snippet selection, provenance, pagination, and result-size limits live behind this interface.

## 6. Cloud domain model

### Identity and tenancy

- `Principal`: anonymous installation, human user, or automation identity.
- `Device`: locally generated signing key, platform, version, and claim state.
- `Organization`: team tenant and policy owner.
- `Membership`: human or pending identity's role in an organization.
- `Enrollment`: signed, scoped, expiring path for a device to join a team.
- `Namespace`: personal or organization-owned trace container.

### Trace data

- `Trace`: one coding-agent session with source, repository, time, state, visibility, and author.
- `TraceEvent`: ordered normalized user, assistant, tool, command, file, usage, and lifecycle event.
- `NativeArtifact`: immutable compressed source material stored in object storage.
- `CaptureCursor`: device-side progress through an artifact.
- `IngestBatch`: signed idempotent upload and processing status.
- `ParserVersion`: exact normalization implementation used for an event.
- `Repository`: canonical Git remote identity plus aliases.
- `GitSnapshot`: cwd, branch, HEAD, worktree, changed files, and remote evidence.
- `PullRequestLink`: evidence linking a trace to a commit or PR.
- `UsageMeasurement`: exact, estimated, subscription-allocated, or unavailable usage.

### Access and collaboration

- `Visibility`: private, organization, direct-link, or public.
- `Grant`: actor, resource, allowed views/actions, and expiry.
- `Share`: revocable capability link with an access log.
- `OrganizationPolicy`: capture scope, visibility ceiling/default, exclusions, retention, and sharing rules.

Do not introduce reusable skills, working profiles, or inferred people/project graphs into the first schema beyond extension points.

## 7. Anonymous capture and claim protocol

1. The CLI creates an Ed25519 device keypair and stores the private key in the operating-system keychain.
2. The API creates an anonymous principal and returns a short-lived access token plus refresh credential bound to the device public key.
3. Every batch contains a stable batch ID, device ID, sequence range, hashes, and a device signature.
4. The server accepts retries idempotently and rejects sequence/hash conflicts.
5. `agenttraces login` starts browser OAuth and receives a single-use claim challenge.
6. The CLI signs the challenge with the device key.
7. The server transactionally attaches the device and anonymous namespace to the authenticated user, or merges them into an existing personal namespace.
8. Team-enrolled devices preserve organization ownership while replacing the pending author with the claimed human membership.

Recovery cases that must be designed and tested:

- Device key deleted before claim
- Same person claims several devices
- Device was enrolled into the wrong team
- Enrollment revoked while uploads are queued
- User already belongs to the target team
- User leaves a team after producing traces
- Anonymous data reaches its retention deadline without being claimed

## 8. Capture and upload behavior

### New sessions

- Hooks provide session identity and lifecycle events where supported.
- Artifact watchers remain the durable source of transcript content.
- JSONL is tailed with byte offsets.
- SQLite is read through read-only connections with source-specific incremental cursors.
- Partial records are retried rather than uploaded as corrupt data.
- A file shrink or replacement starts a new artifact generation.
- Capture must never block or crash the coding agent.

### Historical sessions

Recommended default: discover and count historical sessions during setup, automatically capture new sessions, and ask once before uploading history. Offer `all`, `30d`, `current repository`, and `none`.

### Local persistence

- SQLite stores capture cursors, encrypted pending batches, receipts, and minimal cached metadata.
- A batch is deleted from the local spool only after durable cloud acknowledgement and the local retention window.
- The daemon enforces a hard disk budget and exposes queue health in `agenttraces status`.

### Redaction and exclusions

- Run high-confidence secret detection before upload.
- Support `~/.config/agenttraces/config.toml` and repository `.agenttracesignore`.
- Provide `agenttraces pause`, `agenttraces private`, and per-repository disablement.
- Never silently discard a batch because parsing failed; quarantine it with a visible diagnostic state.

## 9. MCP plan

### Transport

- V1: configure a local stdio command, `agenttraces mcp`, in every detected host.
- The stdio process authenticates to AgentTraces Cloud using the claimed user or anonymous device credentials.
- V2: expose a stateless Streamable HTTP endpoint with OAuth for clients that support remote MCP well.
- Publish the remote server in the official MCP Registry after the interface stabilizes.

### Initial complete tool surface

```text
search_traces
get_trace
get_current_trace
get_pr_trace
list_skills
get_skill
prepare_share_trace
confirm_share_trace
revoke_share
prepare_create_skill
confirm_create_skill
```

Search returns compact structured evidence, match reasons, provenance, and a cursor. Full transcripts are retrieved in bounded pages.

Sharing and skill creation use a mandatory two-step mutation protocol:

1. `prepare_*` validates authorization and returns the exact content, audience, visibility, expiry, and consequences without changing state.
2. The agent presents that preview to the user and asks for explicit confirmation.
3. `confirm_*` consumes a short-lived, single-use confirmation token and performs exactly the previewed mutation.

The confirm call rejects expired tokens or any changed parameters. Tool annotations still identify read-only, mutating, destructive, and idempotent behavior, but safety does not depend on every MCP host rendering those annotations correctly.

### Subscription model

AgentTraces performs deterministic search and retrieval. The coding agent already running under the user's subscription decides when to call the tools, can refine the search through subsequent calls, and synthesizes the answer. Background cloud summaries are a separate optional inference feature and are never implied by MCP installation.

## 10. Search plan

V1 ranking:

1. Hard authorization and namespace filter.
2. Repository, branch, PR, agent, date, author, and outcome filters.
3. PostgreSQL full-text ranking over titles, user messages, assistant messages, commands, file paths, and summaries when present.
4. Recency and repository-affinity boosts.
5. Diversity by trace so one long session does not occupy every result.
6. Compact event-level snippets with trace/event IDs.

V2 can add local or cloud embeddings and reciprocal-rank fusion. Embeddings must not be required for the initial useful product.

## 11. Web application plan

V1 pages:

- Claim/sign-in completion
- Personal trace list
- Trace detail with transcript timeline
- Device and capture status
- Privacy and repository exclusions
- Organization trace list
- Members, pending devices, and enrollment commands
- GitHub connection and repository mapping

V2 pages:

- Share links and access logs
- PR trace view
- Search across team history
- Usage and agent/model analytics
- Retention, export, and deletion administration

## 12. GitHub linkage

Capture local Git evidence with every trace: repository root, normalized remote, branch, HEAD, worktree, dirty paths, and commits observed during the session.

The GitHub App subscribes to push and pull-request events. A worker links traces using strong evidence in this order:

1. Exact commit SHA
2. Branch plus repository
3. Explicit trace marker in commit/PR metadata
4. Time/file overlap as a labeled inference, never as a confirmed link

## 13. Security and trust requirements

- TLS everywhere and envelope encryption for native artifacts at rest.
- Tenant ID included in every storage key and database uniqueness constraint.
- Authorization evaluated server-side for every search and trace view.
- Device tokens are scoped, rotatable, and revocable.
- Team enrollment tokens are one-time or usage-limited.
- Native artifacts never appear directly in search responses.
- Secrets are scrubbed before upload and again during parsing.
- Every share, permission change, export, and destructive action is audited.
- Account deletion and organization deletion have explicit, testable retention behavior.
- Query text and MCP retrieval logs receive their own retention and privacy controls.
- No user content is used for model training by default.

## 14. Delivery phases

### Phase 0: foundations

Deliver:

- Resolve the product decisions at the end of this document.
- Record architecture decisions for tenancy, claim, ownership, retention, and encryption.
- Scaffold the monorepo and continuous integration.
- Define versioned contracts and fixtures from real Claude Code and Codex sessions.

Exit condition: fixtures can be validated against the native-envelope schema and the anonymous/team ownership rules are unambiguous.

### Phase 1: tracer-bullet cloud path

Deliver one thin path:

- `agenttraces up`
- Anonymous principal and device registration
- Claude Code and Codex discovery
- One-shot upload of a selected trace
- Object-storage persistence
- Queue and parser worker
- Normalized Postgres trace/events
- Minimal authenticated web trace page
- `agenttraces status` and `doctor`

Exit condition: a fresh machine can upload one real trace and see the same ordered conversation in the web application.

### Phase 2: reliable continuous capture

Deliver:

- Daemon lifecycle for macOS and the agreed additional platforms
- Hooks where supported and artifact watcher fallback
- Cursor state, encrypted spool, retries, idempotency, and backpressure
- Historical import choice
- Local secret scrubbing and ignore rules
- Capture health telemetry

Exit condition: abrupt restarts, offline work, duplicate delivery, file truncation, and large active sessions do not lose or duplicate visible events.

### Phase 3: claim and team enrollment

Deliver:

- GitHub OAuth claim flow
- Multi-device merge
- Organization creation, invitations, enrollment tokens, roles, and policy
- Pending-member attribution
- Team-default cloud routing
- Leave/revoke/reassign flows

Exit condition: anonymous personal and anonymous team installations can both be claimed without changing trace IDs or losing ownership/audit history.

### Phase 4: MCP retrieval

Deliver:

- `agenttraces mcp` stdio server
- Codex, Claude Code, and Cursor configuration adapters
- Installed AgentTraces skill/rules
- Search, trace, current-trace, PR-trace, and skill retrieval tools
- Confirmation-gated share, revoke, and skill-creation tools
- Permission filtering, pagination, provenance, and size limits
- MCP Inspector and real-host test matrix

Exit condition: each supported coding agent can answer a question about an earlier uploaded session using its existing subscription and cite the source trace. It can also preview and, only after explicit confirmation, perform an authorized share or skill creation.

### Phase 5: GitHub and team knowledge

Deliver:

- GitHub App installation
- Repository mapping and webhook processing
- Commit/PR trace linking
- Organization search and PR trace pages
- Team retention and visibility controls

Exit condition: an authorized teammate can find prior work for a repository or PR while unauthorized users receive no metadata leakage.

### Phase 6: sharing and usage

Deliver:

- Direct, organization, expiring, and public shares
- Revocation and access logs
- Usage provenance and exact/estimated/subscription-allocated labels
- Team dashboards
- Export and deletion flows

Exit condition: every shared view is permission-constrained, revocable, audited, and tested against the original trace's policy.

### Phase 7: beta hardening

Deliver:

- Parser compatibility matrix and replay tooling
- Installer upgrade/rollback tests
- Load, abuse, and tenant-isolation tests
- Backup/restore and disaster-recovery exercise
- Privacy documentation, terms, DPA posture, and incident runbooks
- Billing and quotas if needed

Exit condition: invited external teams can install, claim, capture, retrieve, and remove AgentTraces without operator intervention.

## 15. Test strategy

- Native fixtures for every supported agent and schema version
- Contract tests shared by daemon/API and API/worker
- Adapter tests against temporary fake home directories
- Golden parser tests for ordered normalized events
- Property tests for cursor/idempotency behavior
- Authorization matrix tests for every namespace, role, visibility, and claim state
- End-to-end installation tests in disposable macOS/Linux/Windows environments as applicable
- Real-host MCP smoke tests for Codex, Claude Code, and Cursor
- Chaos tests for offline capture, retry storms, duplicate batches, and worker replay
- Security tests for enrollment replay, cross-tenant IDs, signed-batch tampering, and share revocation

## 16. Initial launch scope

Recommended first public beta:

- macOS first, with Linux immediately behind it
- Claude Code, Codex, and Cursor
- GitHub authentication
- Personal and team cloud namespaces
- Continuous capture of new sessions
- Optional historical import
- Web trace browser
- MCP retrieval plus confirmation-gated sharing and skill creation
- GitHub repository and PR linkage
- Private and team visibility only

Public sharing, working profiles, sophisticated cost allocation, and cloud model summarization should not block beta.

## 17. Product decisions

Decided:

1. Team enrollment uploads to the organization cloud. The organization owner/admin defines the default visibility; traces are not unconditionally team-visible.
2. New sessions upload automatically. Historical sessions are discovered and offered as an explicit import choice.
3. The organization retains organization traces after a member leaves. The former member does not automatically receive a personal transcript copy.
4. Better Auth provides email/password as the baseline and GitHub OAuth when configured; device claim credentials remain separate.
5. Ship macOS first and Linux immediately after. Windows must remain architecturally possible but does not block beta.
6. Implement Claude Code and Codex in the tracer bullet, followed by Cursor during continuous-capture work.
7. Unclaimed personal traces expire after 30 days and are subject to an abuse-prevention storage ceiling.
8. Organization owners/admins define policy and visibility ceilings. Individual developers can always pause capture, exclude repositories, or choose stricter privacy, but cannot weaken organization protections.
9. AgentTraces is a standalone product and repository. Oximy is implementation reference material only.
10. MCP includes retrieval plus two-step, explicit-confirmation sharing and skill creation.

Still required before the first deployment:

1. Choose the production domain.
2. Choose the cloud account/provider and deployment region.

## 18. Immediate execution queue

After the product decisions are answered:

1. Convert the answers into architecture decision records.
2. Scaffold the monorepo and CI.
3. Capture sanitized Claude Code and Codex fixtures.
4. Implement contracts and the two agent adapters test-first.
5. Implement anonymous device registration and signed one-shot ingest.
6. Implement raw persistence, queueing, parsing, and normalized storage.
7. Implement the minimal web trace viewer.
8. Validate the tracer bullet with real sessions.
9. Add daemonized continuous capture and recovery behavior.
10. Add claim, team enrollment, and then MCP retrieval.
