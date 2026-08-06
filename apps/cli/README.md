# AgentTraces

Capture coding-agent sessions locally, search prior work, and expose authorized traces to MCP clients.

```sh
npx agenttraces up
npx agenttraces search "authentication regression"
npx agenttraces mcp
```

New sessions are private by default in personal namespaces. A team owner controls the team default. Configure a cloud endpoint with `agenttraces config set endpoint https://…`.
