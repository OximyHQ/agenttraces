# Historical trace search

## The user contract

`search_traces` searches work the caller is authorized to see, not raw files and not an unbounded event stream. A result page contains at most 10 traces, three evidence snippets per trace, 600 characters per snippet, a reason the trace matched, provenance, and an opaque cursor. The default is five traces.

Hard filters run before ranking: principal/team access, repository, branch, pull request, source, and time. PostgreSQL full-text search ranks normalized message text, commands, tool names, and source-file evidence. Exact repository context and recent activity provide bounded boosts. Results are grouped by trace to keep one noisy session from flooding the context window.

Semantic retrieval is a later reranking layer, not an ingestion dependency. It can retrieve a wider candidate set and fuse it with lexical results using reciprocal-rank fusion, while authorization and response limits remain outside that layer.

## Public implementations we used

- [Agent Sessions](https://github.com/jazzyalex/agent-sessions) is the closest public collector/search reference. Its search architecture progressively loads lightweight metadata, caches rendered transcripts instead of raw event JSON, batches files under 10 MB, and handles unusually large transcripts separately. It validates the local discovery, incremental cache, and progressive-results side of this design.
- [GitHub Copilot agent-session management](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) is a public product reference for natural-language retrieval over prompts, responses, file changes, and session context. Its visibility caveat also reinforces that searchability must follow the caller's access, not merely possession of a session identifier.
- [Agent Replay](https://github.com/agentreplay/agentreplay) is a public reference for an optional semantic layer using local vector indexes and temporal/trace indexes. We do not require that cost or operational complexity for the first useful search.
- [Arize Phoenix](https://github.com/Arize-ai/phoenix) and [Langfuse](https://github.com/langfuse/langfuse) are public trace-platform references for structured trace identity, filtering, multi-tenancy, and asynchronous ingestion. AgentTraces differs by discovering native coding-agent artifacts rather than requiring applications to emit telemetry.

There is no public implementation that is a drop-in for AgentTraces: the useful pieces are split across local session browsers, cloud observability systems, and vector-memory projects.

## Ranking and limits

1. Reject an unauthenticated query.
2. Select only owned, public, or team-visible traces in a namespace where the caller is a member.
3. Apply exact metadata filters.
4. Build candidates with `websearch_to_tsquery` against the stored `tsvector`.
5. Score lexical relevance with `ts_rank_cd`, then add a bounded recency component.
6. Return the top grouped traces and separately select the three strongest snippets for each.
7. Return match reasons and an opaque time cursor.

The first scale target is one million events and 100,000 traces per team while keeping a filtered search p95 below 750 ms. We add partitioning or ClickHouse only after measurements show PostgreSQL is the limiting component.

## MCP examples

```json
{"name":"search_traces","arguments":{"query":"the auth regression we fixed","repository":"OximyHQ/agenttraces","limit":5}}
```

```json
{
  "results": [{
    "id": "tr_…",
    "title": "Fix device-token claim regression",
    "repository": "OximyHQ/agenttraces",
    "score": 3.41,
    "matchedBecause": ["authorized trace", "lexical evidence", "repository filter"],
    "snippets": [{"kind":"assistant","text":"…","sourceFile":"~/.codex/sessions/…"}]
  }],
  "nextCursor": null,
  "bounds": {"maxTraces":10,"maxSnippetsPerTrace":3,"maxSnippetCharacters":600}
}
```
