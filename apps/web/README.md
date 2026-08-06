# AgentTraces web

The public website, documentation, Better Auth sign-in, authenticated dashboard,
team and pull-request views, and public trace renderer.

## Run locally

Requires Node.js 22.13+, PostgreSQL, and the AgentTraces API.

```bash
npm ci
export DATABASE_URL=postgres://...
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
export BETTER_AUTH_URL=http://localhost:3001
export AGENTTRACES_API_URL=http://localhost:4318
npm run auth:migrate
npm run dev
```

GitHub OAuth is optional and requires `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. Email/password sign-up works without it.

## Verify

```bash
npm test
npm run lint
```

The production container runs idempotent Better Auth migrations before starting
the web server. Dashboard requests exchange the Better Auth identity for a
short-lived cloud identity on the server; cloud credentials never reach browser
JavaScript.
