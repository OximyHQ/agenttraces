# AgentTraces web

The public website, system atlas, and dashboard prototype for AgentTraces.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3001`. The prototype is a single interactive page that
documents the product architecture, complete route inventory, dashboard model,
repository layout, and delivery sequence.

## Verify

```bash
npm test
npm run lint
```

`npm test` creates a production build and checks the rendered HTML for the core
AgentTraces surfaces and responsive design contract.

## Current boundary

This directory is the proposed `apps/web` package in the AgentTraces monorepo.
It contains no production backend, authentication, or persistence yet. Those
runtime boundaries are specified in the repository map inside the atlas and in
[`../../docs/action-plan.md`](../../docs/action-plan.md).

The generated Vinext shell retains optional Cloudflare/D1 helpers for a future
deployment decision; the current prototype does not depend on them.
