# AgentTraces

Capture coding-agent sessions locally, search prior work, and expose authorized traces to MCP clients.

```sh
npx agenttraces up
npx agenttraces search "authentication regression"
npx agenttraces pr show --repository https://github.com/org/repo --number 42
npx agenttraces mcp
```

New sessions are private by default in personal namespaces. A team owner controls the team default. Configure a cloud endpoint with `agenttraces config set endpoint https://…`.

Team owners can create constrained setup links with `agenttraces team setup-link create`, register team-owned repositories with `agenttraces team repository add`, and inspect registered devices with `agenttraces team devices`. External trace shares are immutable snapshots unless `--live` is explicitly supplied.
