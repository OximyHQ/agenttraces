# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AgentTraces serves individual software developers and engineering teams using coding agents such as Claude Code, Codex, and Cursor. Individuals need to recover previous work without searching raw session files. Teams need a permissioned record of agent-assisted work across repositories, pull requests, and contributors.

## Product Purpose

AgentTraces continuously captures coding-agent sessions, uploads them to a claimable cloud identity, normalizes them, and makes them available through the CLI, MCP, and web. Success means prior work can be found and reused from the developer's current agent without repeating investigation or losing provenance.

## Positioning

AgentTraces is cloud memory for coding agents: capture begins before account creation, team installs inherit organization policy, and the developer's existing subscribed agent performs the reasoning through permission-aware MCP retrieval.

## Operating Context

The product lives alongside coding-agent CLIs and IDEs, local JSONL and SQLite session artifacts, Git repositories, GitHub pull requests, terminal installation, and organization administration. The cloud is canonical after an upload is durably acknowledged; the machine retains capture cursors, an encrypted spool, receipts, and a small cache.

## Capabilities and Constraints

- Cloud-first automatic capture after explicit installation disclosure.
- Anonymous device identity that can be claimed later through GitHub OAuth.
- Personal traces are private by default.
- Team enrollment uploads into the organization namespace; the organization owner controls the default visibility.
- Developers may always pause capture, exclude repositories, or choose stricter privacy.
- Claude Code and Codex lead the first end-to-end implementation; Cursor follows.
- macOS ships first, Linux follows, and Windows remains architecturally possible.
- MCP retrieval uses the user's current coding-agent subscription. AgentTraces does not imply background hosted inference.
- Sharing and skill creation require a preview followed by an explicit confirmation.
- Unclaimed personal traces expire after 30 days and remain subject to a storage ceiling.

## Brand Commitments

The product name is AgentTraces, plural. The CLI command and package name use `agenttraces`. The website and dashboard use a restrained, text-first system with original AgentTraces copy, diagrams, and interaction patterns.

## Evidence on Hand

- The complete implementation plan is at `docs/action-plan.md`.
- Oximy's local collector is reference evidence for incremental artifact collection, redaction, encrypted state, batching, upload, server parsing, and deduplication.
- No customer testimonials, commercial pricing, production domain, or deployment claims are approved; future surfaces must not fabricate them.

## Product Principles

- Capture once; make the resulting work useful everywhere.
- Private by default personally, policy-controlled by the organization, and never public by accident.
- Preserve native evidence and provenance before deriving summaries or skills.
- Keep installation agent-native and explanation plain.
- Let the subscribed coding agent reason; make AgentTraces retrieval deterministic and permission-aware.

## Accessibility & Inclusion

All web surfaces must support keyboard navigation, visible focus, reduced motion, responsive layouts, semantic structure, and WCAG AA text contrast.
