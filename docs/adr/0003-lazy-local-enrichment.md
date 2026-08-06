# Titles and summaries are enriched lazily with local subscriptions

AgentTraces creates a deterministic title and extractive summary immediately, then requests one cached structured enrichment when a trace is first viewed, searched, or shared. The enrichment runs through an already authenticated local coding-agent CLI when available, never uploads that credential, and marks its own process as excluded from capture; managed cloud or customer-provided API inference remains optional.
