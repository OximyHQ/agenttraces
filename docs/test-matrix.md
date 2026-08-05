# Test matrix

| Surface | Scenarios covered |
|---|---|
| Seven parsers | Registry parity; every one of 31 configured file/row types; text, reasoning, tools, results, metadata, usage |
| JSONL capture | First-run high-water mark, explicit history, append, partial line, truncation, bounded read, replay, dedupe |
| Full capture | Content digest, text/JSON/binary envelope, custom and built-in redaction, oversize refusal |
| SQLite capture | Read-only open, first-run high-water mark, numeric/time cursors, bounded rows, multiple query types |
| Durable ingest | AES-GCM ciphertext, batch retry, event retry, parser worker replay, stable trace/event IDs |
| Remote API | Device registration, Ed25519 signature, tamper rejection, tenant ownership, health, bad JSON, 404 |
| Identity | Anonymous install, device proof, later claim without changing principal/device/namespace/trace IDs |
| Authorization | Owner, stranger, public, team-visible, owner-private team, capability view ceiling, expiry/view limit |
| Sharing and skills | Preview, exact single-use confirmation, create, list, provenance, revoke/archive paths |
| CLI | Up/status, capture, search/show/current, login, privacy, links, skill, team policy, GitHub, doctor, uninstall |
| MCP | Initialize, list ten tools, search/related work, share confirmation, skill confirmation, stable error response |
| Host integration | Claude JSON, Codex managed TOML block, Cursor JSON, skill/rule files, safe removal preserving user config |
| Real machine | Detection for all seven sources; bounded dry-run read for installed sources; no raw output or cursor mutation |

Run `pnpm verify` for the compile, synthetic/integration, and real-machine gates. Run `pnpm test:coverage` for statement/branch/function coverage and `pnpm readiness` for component inventory.
